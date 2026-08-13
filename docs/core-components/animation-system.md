---
title: 'Animation System'
description: 'Clip-sheet authoring vocabulary, the pure compile half, the ClipBackend seam and its mesh and sprite implementations, ClipPlayer and its blended transitions, the useClipPlayer / useSpriteClipPlayer / AnimatedSprite bindings, beat-owned gameplay windows, and authoritative time dilation.'
tags:
    [animation, clips, markers, passages, blending, time-dilation, renderer, simulation, invariants]
---

# Animation System

> §4.40 of the Chimera architecture.
> Related: [Asset Reference System](asset-reference-system.md) · [Camera System](camera-system.md) · [Simulation Core & Action Pipeline](simulation-core-action-pipeline.md) · [Game Timers](game-timers.md) · [Performance HUD & Device Info](performance-hud-device-info.md) · [Audio System](audio-system.md)

---

## Overview

The layer a game animates against: authored **clip sheets**, a pure **marker scheduler** that turns
playhead samples into `notify` / `passage-start` / `passage-tick` / `passage-end` / `clip-end`
emissions, **blended transitions** between clips, **beat-owned gameplay windows** the simulation
opens, and **authoritative time dilation** that re-paces the host heartbeat and every clip together.

Two features built it and their design records — the reasoning, the measurements and the deferred
list — live in the roadmap rather than here:
[F82 — Animation Clip Sheets, Marker Scheduling & Time Dilation](../roadmap-sections/m10-first-public-release-v1.0.0.md)
and F89 — Blended Clip Transitions, Finished-Clip Pose Retention & Authored Blend Durations, in the
same file. This section is the contract.

---

## Two clocks, and where they meet

|           | Renderer clock                                                   | Simulation clock                                         |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Unit      | float seconds, normalized phase in `[0, 1]`                      | the integer **beat** — one outer `engine:tick`           |
| Driven by | one `useFrame` at default priority                               | the host's action dispatch (`RealtimeTicker`, or a turn) |
| Owns      | clip position, marker firing, passage open/close, playback speed | hit windows, damage, cooldowns, AI, saves, replays       |

Playback is **frame-driven**; every gameplay consequence is **beat-driven**. The two meet only at
**authoring time**: a passage is written twice — once as clip-relative positions the renderer plays,
once as the beat span the simulation opens — and the two are verified against each other when
content loads. Neither is derived from the other at run time, so a host pacing knob never decides a
gameplay window's length. The lint leg of that separation is `chimera/no-animation-derivation-in-reduce`,
which matches by name at the call site (an aliased import goes unreported — measured in its own suite).

A consequence worth stating because it has caught prose repeatedly: `GameSnapshot.tick` counts
**actions**, not beats. A tick that fires a timer dispatches children through the same
`ActionPipeline.process()`, and each advances the counter — so a beat is one outer `engine:tick`,
and reading a beat off a `tick` **difference** is wrong on exactly the ticks a timer fired.

---

## Layered architecture

```
AssetManifestEntry.metadata          ← sim-authored ModelAnimationMetadata / SpriteAnimationMetadata
         │                             (opaque to AssetManager; validate-assets gates it at build time)
         ▼
[parseModelAnimationMetadata]        ← renderer/assets: fail-soft allow-list reader, warnings returned
         │
         ▼
[resolveClipPosition → compileClipTimeline]   ← pure compile half: authored position → phase, sorted marks
         │
         ▼
[ClipPlayer]                         ← speed stack, per-playback step bound, transitions, handler fan-out
         │                              (clipMarkerScheduler produces the batches; ClipPlayer fans them out)
         ▼
[ClipBackend]                        ← MeshClipBackend (three AnimationMixer) │ SpriteClipBackend (atlas uv)
         │
         ▼
useClipPlayer │ useSpriteClipPlayer │ AnimatedSprite      ← @chimera-engine/renderer/components/r3f
```

The simulation half runs beside it, never underneath it: `compileAnimationWindows` at content load,
`AnimationWindowManager` and `applyTimeScale` inside the beat pass, and `TimeScaleBridge` carrying one
integer from the snapshot into the renderer's dilation store.

---

## The authoring vocabulary — clip sheets

Declared in [`simulation/foundation/animation-clip-sheet.ts`](../../simulation/foundation/animation-clip-sheet.ts):
pure type declarations, zero runtime code, zero workspace imports. A sheet is carried **opaquely** in
`AssetManifestEntry.metadata` — `ModelAnimationMetadata` for a `'gltf-model'` entry,
`SpriteAnimationMetadata` for a `'sprite-sheet'` one — so the asset layer never learns the shape.

```typescript
interface AnimationTrackSheet {
    readonly durationSeconds?: number; // needed to resolve a phase or a frame
    readonly frameCount?: number; // needed to resolve a { frame } position
    readonly loop?: AnimationLoopMode; // 'once' | 'loop'; absent means the player decides
    readonly blendInSeconds?: number; // seconds to blend INTO this clip; real time, never dilated
    readonly notifies?: Readonly<Record<AnimationMarkName, AnimationNotify>>;
    readonly passages?: Readonly<Record<AnimationMarkName, AnimationPassage>>;
}

interface AnimationNotify {
    readonly at: ClipPosition;
}

interface AnimationPassage {
    readonly from: ClipPosition;
    readonly to: ClipPosition;
    readonly beatWindow?: readonly [number, number]; // the authored mechanical span, integers ≥ 0
    readonly window?: AnimationWindowName; // the gameplay window id this passage claims
}
```

A `ClipPosition` is authored in whichever unit suits the content — a bare `number` is a normalized
phase, `{ seconds }` an absolute offset, `{ frame }` a zero-based frame index. `AnimationLoopMode` is
`'once' | 'loop'` and deliberately has no ping-pong: nothing downstream models a reversing playhead,
so the mode is refused at the type level rather than clamped into one of the two later.

`SpriteClipDeclaration` extends the same sheet with `frames` — atlas frame indices in play order, so a
clip may repeat or reorder cells without duplicating atlas entries.

**`blendInSeconds` sits on the shared sheet, not on a mesh-only declaration.** The compile half is
backend-agnostic on purpose; a mesh-only home would teach it the one distinction it exists not to know.
A sprite clip may therefore author it and simply not have it honoured — `supportsBlending` declines at
run time. The runtime option is the asymmetric one: `blendSeconds` is published on the **mesh** hook's
options and narrowed **off** the sprite hook's, because a React prop that typechecks and silently does
nothing is a trap sprung at the call site.

**Three layers read the sheet field and each fails silently in isolation**, which is why each
range-checks rather than trusting its neighbour: the `validate-assets` gate is a static AST read that
refuses what it cannot read (its `invalidAnimationSheets` bucket), the renderer parser is an allow-list
over runtime values that drops unknown keys, and the compiled timeline carries the resolved result.
All accept exactly `0` — what an author writes to say _this clip cuts in_.

---

## The compile half

Pure arithmetic: no three.js, no React, no DOM, no logger, and no clock. Problems are **returned**,
never thrown and never logged, so a caller counts warnings synchronously and decides once where they go.

| Module                                                                      | Role                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ClipPosition.ts`](../../renderer/animation/ClipPosition.ts)               | `resolveClipPosition` — an authored position → a phase in `[0, 1]`. Fail-soft: a position that merely points past an end **clamps** (the author meant "the end"); one the resolver cannot place at all is **rejected**, because a defaulted `0` or `1` would be a mark the author never wrote.                                                                                        |
| [`ClipTimeline.ts`](../../renderer/animation/ClipTimeline.ts)               | `compileClipTimeline` — one sheet → the sorted, phase-denominated mark list the scheduler walks. Order is decided once, here: ascending by phase, ties broken by raw-string name comparison (never `localeCompare`, whose result depends on the host locale). Range checks read the **runtime** clip duration, not the authored one, so a re-exported clip does not drift every mark. |
| [`spriteClipSpecs.ts`](../../renderer/animation/spriteClipSpecs.ts)         | Authored `durationSeconds` → the backend's `fps`, as `frames.length / durationSeconds`, so the backend's own `frames.length / fps` returns the authored length and every compiled mark lands on the phase the game wrote. A clip that cannot be converted is **dropped with one warning**, never defaulted.                                                                           |
| [`clipMarkerScheduler.ts`](../../renderer/animation/clipMarkerScheduler.ts) | `initSchedulerState` / `stepScheduler` / `terminateScheduler` — a stream of `PlayheadSample`s → marker batches. Owns no clock and no state: the caller supplies every sample and threads the state through.                                                                                                                                                                           |

The scheduler's own rules: **MARK-CROSS** — an ordinary step covers the half-open span
`(lastPhase, nextPhase]`, so a mark sitting exactly on a step's end fires on that step and not again on
the next. **CLOSE-BEFORE-WRAP** — a step whose cycle advanced is split into `(lastPhase, 1)` then
`[0, nextPhase]`, with every open passage closed as `'looped'` between them; phase 1 belongs to neither
half, because a looping playhead passes through the loop point rather than resting on it.

---

## The playback seam — `ClipBackend`

[`ClipBackend.ts`](../../renderer/animation/ClipBackend.ts) is the seam between the animation layer and
whatever moves pixels. It holds interfaces, one narrowing guard, and the argument refusals the seam owns
rather than each backend (`checkedPlaybackSpeed`, `checkedFade`, `checkedLoopMode`).

```typescript
interface PlayheadSample {
    readonly phase: number; // normalized, [0, 1]
    readonly cycle: number; // loop boundaries crossed, counted from the step
    readonly ended: boolean;
}

interface ClipPlayback {
    readonly clipName: AnimationClipName;
    sample(): PlayheadSample;
    setSpeed(speed: number): void;
    stop(): void; // terminal AND releases: the model returns to its original state
    hold(): void; // terminal, releases nothing: the action keeps posing where it was
}

interface ClipBackend {
    getDurationSeconds(clipName: AnimationClipName): number | null;
    play(clipName: AnimationClipName, options?: ClipPlayOptions): ClipPlayback | null;
    advance(deltaSeconds: number): void;
    dispose(): void;
}

interface SupportsClipBlending extends ClipBackend {
    crossfadeTo(clipName, fadeSeconds, options?): ClipPlayback | null;
}
```

Two shapes here are deliberate:

- **`advance` is on the backend, not on the playback.** One `AnimationMixer.update(delta)` advances
  every action that mixer owns; there is no per-action step. A `ClipPlayback.advance` would have to
  step every sibling too, or throw — a contract the mesh implementation cannot honour. Per-clip pacing
  is expressed as **speed** instead, which composes.
- **Blending is a separate interface.** A mesh mixer crossfades between actions; a sprite atlas has
  nothing to interpolate. `crossfadeTo` is therefore an extension a caller narrows to via
  `supportsBlending(backend)`, not a method the sprite backend has to ship as a throw.

### `MeshClipBackend`

Over a three.js `AnimationMixer`, by **composition** — it subclasses neither the mixer nor
`AnimationAction`. The mixer arrives through the constructor because one mixer belongs to one root and
may carry more binders than this backend, so its lifetime and its `timeScale` belong to whoever
allocated it. `dispose()` releases exactly what this backend allocated: the actions it asked the mixer
to cache, and nothing else — it never stops all actions and never uncaches the root.

`setSpeed` writes one number onto that playback's `AnimationAction.timeScale`; the mixer's own
`timeScale` is only ever **read**. The two compose multiplicatively, which is why a caller driving this
backend through `ClipPlayer` must leave `mixer.timeScale` at `1` — the player has already folded clip
speed, player speed and the global dilation into the single multiplier it hands `setSpeed`.

**The weight ramps are the backend's own, not three's.** three's `fadeIn`/`fadeOut` schedule an
interpolant between hardcoded endpoints regardless of where the action's weight actually is, which
gives three visible artefacts: a blend interrupted a quarter of the way in snaps back to nearly full
weight, a blend with nothing outgoing dissolves the model out of its rest pose, and a clip still fading
out cannot be brought back without restarting it at phase 0. So a ramp is a `(from, to, duration)` on
the record, stepped once per `advance` before the mixer update; this layer schedules no three fade
interpolant at all, and `crossfadeTo(name, 0)` is a **real cut** rather than the degenerate ramp three
produces, whose action reaches weight 0 without ever being deactivated.

`cycle` is counted from the **step**, not from the phase: three reports a wrapped `action.time` and
nothing about how it got there, and the largest step the player permits — exactly one clip length —
comes back on the phase it started from, which makes a phase comparison unusable.

### `SpriteClipBackend`

Over a sprite atlas: its own integrating clock, a run of atlas cells, and four `uv` pairs written into a
**caller-owned** geometry. `BufferGeometry` is imported as a **type**; nothing here reaches three at run
time. That is the point of having two implementations behind one seam — the second is not a mixer
wearing a different hat, so a `ClipBackend` promise only an `AnimationMixer` happens to keep breaks here
rather than in a release.

**Rule SPRITE-NO-SHARED-MUTATION.** The `Texture` a sprite samples is owned by the `AssetManager` and
shared by every sprite cut from the same sheet (Invariant #21), so this backend never receives one: it
holds a measured `SpriteAtlas` of pixel rects and UVs. Per-frame state lives entirely in the caller's
geometry, so `offset`, `repeat`, `wrapS`, `wrapT`, `flipY`, `colorSpace`, `matrix` and `needsUpdate` are
never written on a shared texture — there is nothing to write them on. `dispose()` releases only this
backend's own bookkeeping; the injected geometry is left readable, exactly as the last frame wrote it.

---

## `ClipPlayer`

[`ClipPlayer.ts`](../../renderer/animation/ClipPlayer.ts) composes the compile half and the scheduler
into the object a frame loop drives. It owns one backend, the clips in flight on it, the three-layer
speed stack, and the fan-out of every batch the scheduler returns. It reads no store, no clock and no
snapshot: the dilation multiplier arrives through an injected `getTimeScale`, and a handler fault leaves
through an injected `report`, so the module depends on no package at all.

| Verb                              | Contract                                                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play(request)`                   | Start a clip, replacing any live playback of the same clip and leaving every other clip in flight alone. Returns `false` when the backend has no such clip — nothing changed.                                                                                                    |
| `transitionTo(request)`           | Start a clip as the **only** clip: every other clip in flight closes with `'clip-changed'`. Every refusal happens before any mutation; the incoming playback starts and is registered **before** the others are released, so a handler that plays a clip from that fan-out wins. |
| `stop(clipName)`                  | Close that clip with `'stopped'`, and take down whatever of it is still on screen without being played — a last frame a clip end left, and a blend still fading out.                                                                                                             |
| `stopAll()`                       | Stop every clip with `'stopped'` and take down everything on screen that is not being played. Idempotent; the player stays usable.                                                                                                                                               |
| `setClipSpeed` / `setPlayerSpeed` | Re-target one layer of the speed stack; both refuse a negative or non-finite multiplier.                                                                                                                                                                                         |
| `tick(rawDeltaSeconds)`           | Advance everything in flight by one frame of wall clock. A delta that is not a positive finite number is treated as zero: open passages still tick, nothing moves.                                                                                                               |

### One tick, six steps, in this order

1. **Scale** — each playback's rate is `clipSpeed × playerSpeed × timeScale`, clamped into
   `[0, MAX_CLIP_SPEED]` on the **product** rather than per layer. The time scale is read **once** per
   tick, so every clip on the backend is paced against the same reading.
2. **Bound** — Rule STEP-BOUNDED clamps the step **per playback**, against that playback's own clip
   length. The bound reaches the backend as a speed, because one `advance` moves every playback the
   backend owns and per-playback speed is the only per-clip channel a shared mixer has.
3. **Sample before advancing** — the scheduler steps from where the playhead actually is, not from
   where the previous tick left it, so a playhead something else moved fires no marks for the span it
   skipped.
4. **Advance** — one `backend.advance(rawDelta)` for the whole backend.
5. **Step** — one `stepScheduler` per playback, the only producer of `clip-end`.
6. **Fan out** in array order, under Rule HANDLER-ISOLATION.

### Transitions, poses and blends

**Mark ownership: the incoming clip owns the stream from the instant the transition starts.** Every open
passage on every outgoing clip closes synchronously inside the call, and the outgoing clip then fires no
`notify`, no `passage-tick` and no `clip-end` however long its action keeps posing. Leaving an outgoing
entry active would emit a **fabricated `clip-end`** on the next tick — the scheduler reads `ended` off a
frozen sample — including for a `'loop'` clip, which can never end. Ownership by the incoming clip is
the only answer whose failure mode is silence rather than fiction.

**The `'clip-changed'` reason is unconditional.** A clip prop that moved, a `loop` change and a `sheet`
change all close the outgoing playback as `'clip-changed'`, whether or not a blend was asked for; gating
the reason on the blend length would make a game's `switch (event.reason)` mean two different things
depending on a duration. `'stopped'` is what a caller **asking** for a stop gets; `'released'` means the
player or its backend was disposed.

**A clip that ends is held, not stopped.** Both are terminal and the clip leaves the active set either
way; what differs is the screen. Stopping a finished `'once'` clip hands its resources back, which on a
mesh backend restores the model's original state synchronously — a bind-pose flash on the same tick the
`clip-end` handler runs. So the playback is **held**, and the pose comes down when a caller asks for it
to. Every other teardown still stops, because "play nothing" legitimately means the model goes back to
where it started.

**The player keeps two maps, and the separation is load-bearing.** One holds the playbacks a clip **end**
left posing; the other holds what a **blend** is fading out. `transitionTo` refuses to blend into a clip
it is posing — a finished clip resumed mid-hold would stay on its last frame for ever — while a clip
that is fading is one a backend can take up again. Reading one map for both downgrades every second
transition of an A→B→A alternation to a cut.

**A blend length is wall-clock seconds and does not compose with the dilation multiplier.** The mesh
backend drives its ramps from the raw delta `tick` hands `advance`, so a 0.3 s blend takes 0.3 s in a
scene running at quarter speed. The multiplier paces _content_; a transition between two states of the
UI reads as broken when it stretches with the slow-motion it is announcing. A call site's own
`blendSeconds` **overrides** the sheet's `blendInSeconds` rather than composing with it — including
with a `0`, which asks for a cut.

---

## Marker events

Five event kinds reach a game, all through `ClipMarkerHandlers` — `onNotify`, `onPassageStart`,
`onPassageTick`, `onPassageEnd`, `onClipEnd`. Every field is optional: a clip may be played purely for
its visuals.

| `PassageEndReason` | Meaning                                                             |
| ------------------ | ------------------------------------------------------------------- |
| `reached-end`      | the playhead passed the passage's `to`                              |
| `looped`           | the clip wrapped with the passage still open                        |
| `clip-ended`       | the clip finished with the passage still open                       |
| `stopped`          | a caller asked for a stop (`stop`, `stopAll`, or declaring no clip) |
| `clip-changed`     | a transition, a `loop` change or a `sheet` change replaced the clip |
| `seeked`           | the playhead was moved                                              |
| `released`         | the player or its backend was disposed                              |

The first three come from the playhead; the last four come from outside it and are the only ones
`terminateScheduler` accepts — a type-level exclusion, so a stopped, re-targeted, seeked or disposed
clip cannot be reported as having reached its end.

**No handler signature carries a dispatcher** — see Invariant #132 below.

---

## The React bindings

All of them ship from `@chimera-engine/renderer/components/r3f` (Invariant #96);
`renderer/animation/` is renderer-internal and has no package subpath of its own. The sheet and atlas
readers that feed them — `useAnimationSheet`, `useSpriteAnimationSheet`, `useSpriteAtlas` and
`parseSpriteAtlas` — ship from `@chimera-engine/renderer/assets` instead (§4.10).

| Export                  | What it is                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useClipPlayer`         | The **mesh** binding: a declarative `clip` / `loop` / `speed` / `blendSeconds` surface over one `ClipPlayer` driving one `MeshClipBackend` on one owned `AnimationMixer`.                                                              |
| `useSpriteClipPlayer`   | The **sprite** binding: the same declarative surface over one `SpriteClipBackend` writing a caller-owned quad. `blendSeconds` is narrowed off its options.                                                                             |
| `AnimatedSprite`        | The sprite half as one element — an `AssetRef` to a sprite sheet in, an animated quad out. A `Mesh` with its own `PlaneGeometry`, never a `THREE.Sprite`, which shares one module-level geometry across every instance in the process. |
| `useAnimationTimeScale` | The exported dilation scalar, for everything a game animates by hand — a camera tween, a particle rate, a shader uniform, a HUD countdown.                                                                                             |
| `useModelAnimation`     | The pre-existing route: a bare mixer for a game that drives actions itself. Still supported, no longer the only option.                                                                                                                |

Both players share `useClipPlayback.ts` — the declarative surface, the single default-priority frame
driver, and the `ClipPlayerHandle` (`setClipSpeed`, which refuses an unusable multiplier whether or not
a player exists behind it yet). Two copies would be two contracts, both green.

**Every allocation is a commit-phase effect, never `useMemo`.** StrictMode double-invokes memo factories
and **discards one result**, which would orphan a mixer retaining a clone root with no `uncacheRoot`
ever running, and a `ClipPlayer` holding a backend with no `dispose` ever running.

**Rule ONE-MIXER-PER-ROOT.** A model root carries `useClipPlayer` **or** `useModelAnimation`, never
both: `MeshClipBackend` derives a playback's wrap count from the deltas that came through its own
`advance`, so a mixer carrying its playbacks must have exactly one driver. A root carrying both is not
torn down — `mixerBindingRegistry` counts the claims and **reports** the duplicate through the log
bridge a frame later, while both hooks keep running. The sprite side has no mixer and therefore no such
claim; its exclusion is **Rule ONE-WRITER-PER-QUAD** — one `SpriteClipBackend` per geometry, arranged by
the caller, because two backends over one geometry would fight over its `uv` at frame rate.

---

## Beat-owned gameplay windows

The simulation half of an animation. A passage's `beatWindow` is **recomputed** from its clip-relative
`from`/`to` at content load and **compared** with what the author wrote — never derived from it at
reduce time.

**Rule WINDOW-OUTWARD-ROUNDING** — a passage's beats are the beats it _touches_:

```
startBeat = floor(fromBeats + BEAT_EPSILON)
endBeat   = max(startBeat + 1, ceil(toBeats - BEAT_EPSILON))    where beats = seconds × 1000 / tickRateMs
```

The `max` is the structural one-beat floor: at the default 20 Hz beat the finest expressible mechanical
window is one beat, and a narrower authored span is floored at one rather than collapsing to the empty
window `[n, n]`. The epsilon snaps a bound that lands on a beat boundary onto it, so a span the author
wrote as whole beats is not pushed outward by the float division. A mismatch is an
`AnimationWindowMismatchError` at content load, not a run-time surprise.

At run time the windows live on `BaseGameSnapshot.animationWindows`, written by `AnimationWindowManager`
(`open`, `advance`, `interrupt`). Every verb is **pure**: none installs a `GameTimer`, dispatches an
`EngineAction` or reads a clock. **Within a match** a window closes for one of four reasons —
`expired`, `owner-gone`, `replaced`, `interrupted` — and the sweep runs inside the beat pass, whose
closures reach the game through the per-beat `GameDefinition.onBeat` hook. The match boundary is not
one of the four: `animationWindows` is a `MatchScopedSnapshotKey`, so `engine:start_game` and
`engine:return_to_lobby` drop the whole registry with no per-window event at all. A passage that omits
`beatWindow` is presentation-only: at 20 Hz a 30 ms flourish needs no gameplay beat at all.

---

## Time dilation

One integer on the wire, one float in the renderer.

`PlayerSnapshot.timeScalePermille` is the authored dilation in permille — `1000` real time, `250` quarter
speed — clamped to `[50, 4000]` by `clampTimeScalePermille`, with a fractional permille refused rather
than rounded. Beside it sits `timeScaleRestoreBeats`, a countdown the beat pass decrements: two
overlapping requests are last-write-wins, so nothing stacks and nothing leaks un-restored. Neither the
window registry nor the countdown is projected.

`timeScaleMultiplier` (the renderer's playback rate) and `dilatedBeatPeriodMs` (the host's beat period)
are **reciprocal by construction** — both divide by the same `clampTimeScalePermille` result, in
[`simulation/foundation/time-scale.ts`](../../simulation/foundation/time-scale.ts), so a sign or
reciprocal error is one visible edit rather than two formulas drifting apart. On the host,
`RealtimeTicker` re-arms a self-scheduling chain against an **absolute** next-fire target, so a beat's
own dispatch cost is not added to the next delay.

In the renderer the multiplier is derived in exactly one place —
[`timeScaleStore.ts`](../../renderer/animation/timeScaleStore.ts)'s `setAuthoritativePermille`, which
calls `timeScaleMultiplier` and performs no arithmetic of its own. `TimeScaleBridge` is its **sole**
writer and carries one integer in one direction; its unmount seats real time again, because a leftover
multiplier would slow every clip the app mounts afterwards with no writer reachable to reset it.

**Rule GLOBAL-BY-DEFAULT.** A clip player follows that store unless `options.timeScale` names a
multiplier, which **overrides** rather than composes — so an authoritative dilation reaches every mounted
clip with no per-call-site wiring, and a call site that wants out says so once.

The multiplier scales **clip playback only** — never the R3F clock, which the performance probe reads.
Scaling that clock would make the perf HUD report a dilated frame rate, which is precisely the defect
the frame-cap work repaired (§4.16, §4.22).

---

## Named rules

The animation modules carry their rules by name, in the module headers that own them. Each row below
points at the test that measures the rule.

| Rule                  | What it holds                                                                                                                                                                                                                                                                       | Measured by                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SPEED-NON-NEGATIVE`  | A negative or non-finite multiplier is **refused** with a `RangeError` at the layer it was written, never clamped — reverse playback is not modelled anywhere on the seam. One definition, `checkedPlaybackSpeed`, shared by the player and both backends.                          | [`ClipPlayer.test.ts`](../../renderer/animation/ClipPlayer.test.ts) › `Rule SPEED-NON-NEGATIVE`; [`useClipPlayer.test.tsx`](../../renderer/components/r3f/useClipPlayer.test.tsx) › `refuses a negative declarative speed the same way the imperative verb does`                                                                                                     |
| `STEP-BOUNDED`        | One tick's step is clamped **per playback**, against that playback's own clip length — never against a single shared minimum, which would let the shortest clip on a mixer decide how far a four-second clip may move in one frame.                                                 | [`ClipPlayer.test.ts`](../../renderer/animation/ClipPlayer.test.ts) › `Rule STEP-BOUNDED — the bound is per playback, not per backend`                                                                                                                                                                                                                               |
| `LAST-WRITER-WINS`    | The clip-speed layer has two writers — the declarative `speed` option and the handle's `setClipSpeed` — and the later one wins outright. They never compose, and an unchanged `speed` prop does not overwrite an imperative override on re-render.                                  | [`useClipPlayer.test.tsx`](../../renderer/components/r3f/useClipPlayer.test.tsx) › `keeps an imperative setClipSpeed across three re-renders with an unchanged speed prop`; [`useClipPlayer.test.tsx`](../../renderer/components/r3f/useClipPlayer.test.tsx) › `lets a changed speed prop overrule the imperative override`                                          |
| `GLOBAL-BY-DEFAULT`   | Absent `options.timeScale`, playback follows the shared dilation store; present, it **overrides** rather than composes. Dilation therefore needs no per-call-site wiring, and opting out is one declaration.                                                                        | [`useSpriteClipPlayer.test.tsx`](../../renderer/components/r3f/useSpriteClipPlayer.test.tsx) › `follows the authoritative dilation with no per-call-site wiring`; [`time-dilation-end-to-end.test.tsx`](../../renderer/components/r3f/__tests__/time-dilation-end-to-end.test.tsx) › `lets options.timeScale OVERRIDE the dilated store rather than compose with it` |
| `ONE-ACTION-PER-CLIP` | three caches one action per `(clip, root)` pair, so replaying a clip **re-targets the same object**. The previous handle is terminal and answers from a captured sample rather than from an action that has moved on or gone back to zero.                                          | [`MeshClipBackend.test.ts`](../../renderer/animation/MeshClipBackend.test.ts) › `releases the live playback of a clip when the same clip is played again`                                                                                                                                                                                                            |
| `HANDLER-ISOLATION`   | A throwing marker handler is reported once per `(player, mark)` and never re-thrown: the clip keeps playing and the events after it are still delivered. Once per mark rather than once per throw, because a mark that fires every frame would otherwise fill a log with one fault. | [`ClipPlayer.test.ts`](../../renderer/animation/ClipPlayer.test.ts) › `Rule HANDLER-ISOLATION`; [`useClipPlayer.test.tsx`](../../renderer/components/r3f/useClipPlayer.test.tsx) › `relays a throwing game handler under the error the GAME threw, and keeps playing`                                                                                                |
| `POSING-RELEASE`      | A crossfaded-out or held playback is terminal but **still posing**: `hold()` freezes without releasing, `stop()` is the release that hands the binding back. That split is what lets a finished `'once'` clip stay on its last frame, and what a blend fades out of.                | [`MeshClipBackend.test.ts`](../../renderer/animation/MeshClipBackend.test.ts) › `leaves the bound node posed when the playback is held instead`; [`blended-transition.test.ts`](../../renderer/animation/__tests__/blended-transition.test.ts) › `blends out of the last frame a finished once clip is holding`                                                      |

Two further rules are named in the modules that own them and stated in context above:
**SPRITE-NO-SHARED-MUTATION** (the sprite backend never receives a shared `Texture`),
**WINDOW-OUTWARD-ROUNDING** (a passage's beats are the beats it touches), alongside the scheduler's
**MARK-CROSS** / **CLOSE-BEFORE-WRAP** and the binding-level **ONE-MIXER-PER-ROOT** /
**ONE-WRITER-PER-QUAD**.

---

## Invariants

Stated here, defined in
[Architecture Invariants](../executive-architecture/architecture-invariants.md); per-invariant
enforcement status lives in the
[Invariant Roll-Call](../executive-architecture/invariant-roll-call.md).

| Invariant | What it holds for this layer                                                                                                                                                                                                                                                                                                                                                                                                        | Measured by                                                                                                                                                                                                                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #21       | `AssetManager` owns loaded assets and disposes them on session end; nothing here mutates or disposes a shared resource. A stopped playback hands its `PropertyMixer` binding back and the model returns to its original state — the visible half of Rule POSING-RELEASE's split.                                                                                                                                                    | [`MeshClipBackend.test.ts`](../../renderer/animation/MeshClipBackend.test.ts) › `hands the bound node back to its original state and stops writing to it`                                                                                                                                                                                           |
| #96       | The bindings above ship from `@chimera-engine/renderer/components/r3f`; `renderer/animation/` is internal and has no subpath. The barrel's surface, including the `blendSeconds` split between the mesh options and the sprite ones, is pinned.                                                                                                                                                                                     | [`r3f-barrel-side-effects.test.ts`](../../renderer/components/r3f/__tests__/r3f-barrel-side-effects.test.ts) › `exports exactly the documented public surface`; [`r3f-barrel-side-effects.test.ts`](../../renderer/components/r3f/__tests__/r3f-barrel-side-effects.test.ts) › `publishes a blend duration on the mesh options and on nothing else` |
| #128      | `ReduceContext.beatReducer` is the engine-internal per-game per-beat hook, called by `engine:tick` only, exactly once per outer tick, **last** in the beat pass — after the window sweep, whose closures it receives. It is pure and adds no nested dispatch, which is what keeps a match using it replayable.                                                                                                                      | [`EngineActions.test.ts`](../../simulation/engine/EngineActions.test.ts) › `engine:tick — the per-beat pass (F82)`                                                                                                                                                                                                                                  |
| #129      | Beat-owned windows live on `BaseGameSnapshot.animationWindows` and are **host-only**: the projector's explicit field allowlist omits the registry, so no window record ever crosses to a client. Records are integer or `FixedPoint` throughout.                                                                                                                                                                                    | [`StateProjector.test.ts`](../../simulation/projection/StateProjector.test.ts) › `animationWindows and timeScaleRestoreBeats are absent from the projection`; [`AnimationWindow.test.ts`](../../simulation/engine/AnimationWindow.test.ts) › `the four close reasons`                                                                               |
| #130      | The renderer turns `timeScalePermille` into a multiplier in exactly **one** place, through the shared `timeScaleMultiplier` and with no arithmetic of its own — pinned by a source scan with a positive control. The multiplier scales clip playback only, never the R3F clock the performance probe reads.                                                                                                                         | [`timeScaleStore.test.ts`](../../renderer/animation/timeScaleStore.test.ts) › `contains no division and no literal 1000`; [`time-dilation-end-to-end.test.tsx`](../../renderer/components/r3f/__tests__/time-dilation-end-to-end.test.tsx) › `reports the same frame rate at quarter speed as at real time`                                         |
| #131      | `TimeScaleBridge` is the dilation store's **sole** writer and carries one integer in one direction; no animation state is ever written back, and its unmount seats real time again.                                                                                                                                                                                                                                                 | [`TimeScaleBridge.test.tsx`](../../renderer/components/shell/TimeScaleBridge.test.tsx) › `returns the renderer to real time when it unmounts`                                                                                                                                                                                                       |
| #132      | **No animation event may gate an `EngineAction`.** A clip's marks are renderer-local reports of where a playhead is, and a consequence derived from one would be derived from the frame clock, which no two machines share. The rule is held by **absent parameters** — no handler and no event names a dispatcher, a `SendAction`, a `PlayerId` or a tick — so there is nothing to dispatch with, and nothing to `eslint-disable`. | [`marker-handler-no-dispatch.test.ts`](../../renderer/animation/__tests__/marker-handler-no-dispatch.test.ts) › `Invariant #132 — the surface DECLARES no dispatcher`                                                                                                                                                                               |

---

## File map

```
renderer/animation/                   # renderer-internal; no package subpath
├── ClipPosition.ts                   # resolveClipPosition — authored position → phase, fail-soft
├── ClipTimeline.ts                   # compileClipTimeline — sorted, phase-denominated marks
├── spriteClipSpecs.ts                # authored durationSeconds → the backend's fps
├── clipMarkerScheduler.ts            # pure playhead → marker batches; sole producer of clip-end
├── ClipBackend.ts                    # the seam: ClipPlayback, PlayheadSample, supportsBlending, the refusals
├── MeshClipBackend.ts                # over an INJECTED AnimationMixer; owns its own weight ramps
├── SpriteClipBackend.ts              # over an atlas run; writes uv into an injected geometry
├── ClipPlayer.ts                     # speed stack, step bound, transitions, poses, handler fan-out
├── timeScaleStore.ts                 # the one dilation float (Invariant #130)
└── useAnimationTimeScale.ts          # read seam onto it; re-exported from the components/r3f barrel

renderer/components/r3f/
├── useClipPlayback.ts                # shared declarative surface, frame driver, ClipPlayerHandle
├── useClipPlayer.ts                  # mesh binding
├── useOwnedMixer.ts                  # allocates and claims the mixer the mesh binding drives
├── mixerBindingRegistry.ts           # counts the claims; reports a duplicate a frame later
├── useSpriteClipPlayer.ts            # sprite binding
└── AnimatedSprite.tsx                # the sprite half as one element

renderer/assets/
├── animationSheet.ts                 # fail-soft allow-list readers for both metadata shapes
├── useAnimationSheet.ts              # useAnimationSheet / useSpriteAnimationSheet
├── spriteAtlas.ts                    # parseSpriteAtlas — the non-React atlas reader
└── useSpriteAtlas.ts                 # useSpriteAtlas — measures a loaded sheet's cells

renderer/components/shell/
└── TimeScaleBridge.tsx               # the dilation store's sole writer (Invariant #131)

simulation/foundation/
├── animation-clip-sheet.ts           # the authoring vocabulary — types only
└── time-scale.ts                     # clampTimeScalePermille, timeScaleMultiplier, dilatedBeatPeriodMs

simulation/content/animationWindows.ts  # compileAnimationWindows — content-load verification
simulation/engine/AnimationWindow.ts    # the host-only registry and its pure manager
simulation/engine/TimeScale.ts          # applyTimeScale / clearTimeScale / advanceTimeScale
electron/main/runtime/RealtimeTicker.ts  # re-paces the beat sequence by the same permille
```

---

## Out of scope

The full deferred list, with the measurements behind each entry, is in the roadmap's F82 and F89
sections. The load-bearing ones for anyone extending this layer: no cross-client clip phase anchoring
(two clients see a swing at phases differing by network latency, cosmetic by construction); no reverse
or ping-pong playback anywhere on the seam; no layered or masked blending, blend trees, parametric
blends or inertialisation — the single crossfade verb is the whole blending surface; no state-machine
or blend-tree authoring layer, and no engine-level animation-event registry slot; no sub-beat gameplay
windows; and no `@chimera-engine/renderer/animation` subpath.
