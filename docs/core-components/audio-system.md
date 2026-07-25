---
title: 'Audio System'
description: 'AudioManager interface, AudioBusId (master/music/sfx/voice), PlayOptions, EventAudioBinding, settings integration, 32-voice pool, lifecycle ownership, audio invariants, and the design-stage cue / loop-point / fade / crossfade extensions.'
tags: [audio, sound, renderer, event-driven, bus]
---

# Audio System

> §4.25 of the Chimera architecture.
> Related: [Settings System](settings-system.md) · [Asset Reference System](asset-reference-system.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

Renderer-only audio playback for music, sound effects, and voice cues. Zero coupling to the simulation — game reducers emit `GameEvent`s; the renderer's `EventAudioBinding` maps event types to `AssetRef<AudioClipAsset>` and plays them through `AudioManager`.

Beyond fire-and-forget event SFX, the [Cue, Fade & Crossfade Extensions](#cue-fade--crossfade-extensions) below (design-stage) add cue-bounded playback, native loop points, per-voice fades, and seamless two-track crossfades — the primitives games need for music transitions.

---

## Layered Architecture

```
GameEvent[] in PlayerSnapshot   ← simulation emits; renderer observes
         │
         ▼
[EventAudioBinding]             ← pure config: eventType → AssetRef<AudioClipAsset>
         │
         ▼
[AudioManager.play(ref, opts)]  ← resolves via AssetManager (§4.10)
         │
         ▼
[AudioBus] (master / music / sfx / voice)   ← per-bus gain, mute, ducking
         │
         ▼
Web Audio API (via THREE.Audio or plain AudioContext)
```

---

## Core Types

```typescript
// renderer/audio/AudioManager.ts

export interface PlayOptions {
    bus?: AudioBusId; // Default: 'sfx'
    loop?: boolean; // Default: false
    volume?: number; // [0, 1]; multiplied with bus gain
    position?: Vector3Tuple; // If present, played as spatial (THREE.PositionalAudio)
    priority?: number; // Lower-priority sounds dropped when pool is full
}

export type AudioBusId = 'master' | 'music' | 'sfx' | 'voice';

export interface AudioManager {
    play(ref: AssetRef<AudioClipAsset>, opts?: PlayOptions): AudioHandle;
    stop(handle: AudioHandle): void;
    stopAll(bus?: AudioBusId): void;
    /** Duck a bus to duckedVolume for durationMs, then restore. */
    duck(bus: AudioBusId, duckedVolume: number, durationMs: number): void;
    /** Dispose all active sources and clear the pool. Called on game session end by GameShell. */
    dispose(): void;
}
```

---

## EventAudioBinding

```typescript
// renderer/audio/EventAudioBinding.ts

export type EventAudioBinding = {
    [eventType: string]: {
        ref: AssetRef<AudioClipAsset>;
        bus?: AudioBusId;
        volume?: number;
    };
};
```

Games declare their event-to-audio map as pure data. The engine's `<EventAudioPlayer>` component reads `events: GameEvent[]` from `gameStore` and calls `AudioManager.play()` for each entry it recognises.

---

## Settings Integration

Audio volume sliders (`settings.audio.masterVolume`, `musicVolume`, etc.) are declared in `EngineSettings` (§4.13). `AudioBus` subscribes to `settingsStore` and updates its gain node on every change — no polling required.

---

## Voice Pool

Default pool: **32 concurrent voices**. When saturated, the lowest-priority currently-playing sound is preempted. Pool size is configurable via `AudioManager` construction options.

---

## Lifecycle Ownership

`AudioManager` is constructed once per app launch by `renderer/app/providers.tsx` and exposed via `AudioManagerContext`. `Providers` owns `dispose()` — it is called at engine shutdown (app exit), not at game session end.

`GameShell.tsx` manages the session lifecycle:

- On game start it registers the game-level `AssetManager` with the app-level `DelegatingAssetManager` via `SetGameAssetManagerContext`. This allows `AudioManager.play()` to load game-specific audio assets through the game resolver and manifest.
- On match end (`phase: ended`) it calls `AudioManager.stopAll()` to stop all active voices.
- On unmount it clears the delegate (`setGameAssetManager(null)`) and disposes the game-level `AssetManager`.

---

## Cue, Fade & Crossfade Extensions

> **Design-stage spec** (audio F-series). Adds **play-from-cue**, **play-to-cue**, **loop points**, **fades** (in / out to end-or-cue), and **crossfade / two simultaneous tracks**. It extends the existing 32-voice pool, the per-voice `GainNode`, and the three-stage bus graph **without changing them** — every new behaviour writes only a voice's own stage-1 gain and leans on native `AudioBufferSourceNode` scheduling (`start(when, offset, duration)`, `loopStart`/`loopEnd`, `source.stop(when)`) rather than JS timers. All timing is renderer-only and driven by `AudioContext.currentTime`; nothing crosses into the simulation (Invariant #63).

### Cue model

A **cue** is a position in a decoded clip's local timeline:

```typescript
// renderer/audio/Cue.ts
export type Cue = number | 'start' | 'end' | { readonly name: AudioCueName };
```

- **`number`** — seconds from buffer start. The primary, always-available form: needs no metadata, matches every `AudioBufferSourceNode` unit, resolves by identity.
- **`'start'` / `'end'`** — symbolic bounds (`0` / `buffer.duration`). `'end'` is buffer-relative, so only resolvable **after decode**.
- **`{ name }`** — an authored named cue, resolved against the clip's own **cue sheet**.

Cue sheets are authored as data in the existing `AssetManifestEntry.metadata` slot — never on `AudioClipAsset` (a phantom brand that decodes to a bare `AudioBuffer` with no sidecar). The metadata is **opaque to the simulation** (Invariant #20): the simulation _constructs and stores_ the sheet; only `renderer/audio` _parses_ it. The name type is defined sim-side and flows **sim → renderer** (never the reverse):

```typescript
// simulation/foundation/audio-cue-sheet.ts (NEW — pure types, zero workspace imports)
export type AudioCueName = string;
export type WellKnownAudioCueName = 'intro' | 'loopStart' | 'loopEnd' | 'outro';

export interface AudioClipMetadata {
    readonly cues?: Readonly<Record<AudioCueName, number>>; // name → seconds (finite, ≥ 0)
    readonly defaultLoopRegion?: readonly [AudioCueName, AudioCueName];
    readonly durationSeconds?: number; // MANDATORY when `cues`/`defaultLoopRegion` present (§Invariant #125)
}
```

Because metadata needs no decode, the sheet is parsed **synchronously inside `play()`** — `parseAudioCueSheet(assetManager.getManifestMetadata(ref))` — before any voice is reserved, then cached on the voice. Resolution is **fail-soft** and never throws into a caller.

**Two-tier validation, discriminated by _provenance_ (not by operator):**

- **Static — synchronous reject at `play()`** (no voice reserved): fires _only_ when both bounds resolve to finite seconds synchronously (raw number, `'start'`, or a `{ name }` present in the parsed sheet) **and** the order is already invalid (`to ≤ from`, `loopEnd ≤ loopStart`). Returns an already-invalid handle.
- **Dynamic — resolve + clamp `[0, duration]` + drop-window at `startVoice`**: fires for any comparison that needs `buffer.duration` (either bound is `'end'`, a raw number valid only after clamping, or a `{ name }` absent from the sheet). If a window is still collapsed after clamping, it is **dropped and playback continues** (non-loop → play to natural end; loop → loop disabled), with one warning.

A load-bearing `{ name }` that cannot resolve (e.g. `from` on a non-looping voice, name absent) abandons that play as an invalid handle with one warning; end-point cues (`to`, `loopEnd`) degrade per the dynamic rule.

### New & changed core types

```typescript
export type FadeCurve = 'linear' | 'exponential' | 'equalPower'; // default 'linear'

export interface FadeInSpec {
    readonly durationMs: number;
    readonly curve?: FadeCurve;
}
export interface LoopRegion {
    readonly start: Cue;
    readonly end: Cue;
}

export interface PlayOptions {
    // existing — bus, loop, volume, position, priority ... (unchanged)
    readonly from?: Cue; // play-from-cue → start(when, offsetSec). Default 'start' (0).
    readonly to?: Cue; // play-to-cue. Non-loop: buffer window. Loop: elapsed play duration.
    readonly loopRegion?: LoopRegion; // → source.loopStart/loopEnd; IMPLIES loop = true.
    readonly fadeIn?: FadeInSpec; // start-time fade from silence up to `volume`.
}

// Fade-out target — each variant ramps stage-1 gain to 0, then stops:
export type FadeOutSpec =
    | { readonly overMs: number; readonly curve?: FadeCurve } // ramp [now, now+overMs]
    | { readonly toCue: Cue; readonly curve?: FadeCurve } // ramp [now, cueContextTime]
    | { readonly toEnd: true; readonly curve?: FadeCurve }; // ramp [now, scheduledStopAt]

// Ramp a live voice's gain to an ABSOLUTE target and HOLD (does not stop):
export interface FadeToSpec {
    readonly to: number; // absolute stage-1 gain, clamped [0,1]; becomes the new ceiling
    readonly durationMs: number; // ≤ 0 or non-finite ⇒ applied instantly
    readonly curve?: FadeCurve;
}

// Crossfade = play(incoming, {fadeIn}) + a LINKED fade-out of `outgoing`, both anchored to one shared t0:
export interface CrossfadeOptions extends Omit<PlayOptions, 'fadeIn'> {
    readonly durationMs: number;
    readonly curve?: FadeCurve; // default 'equalPower' (constant perceived power, no mid-fade dip)
}

export interface AudioManager {
    // existing — play, stop, stopAll, duck, dispose ... (unchanged)
    /** Ramp stage-1 gain to 0 per `spec`, then stop+release via the native onended path. No-op on invalid handle. */
    fadeOut(handle: AudioHandle, spec: FadeOutSpec): void;
    /** Ramp stage-1 gain to `spec.to` and HOLD (dip/swell); updates the voice ceiling. No-op on invalid handle. */
    fadeTo(handle: AudioHandle, spec: FadeToSpec): void;
    /** Start `incoming` with a linked crossfade anchored to its real start; returns the incoming handle. */
    crossfade(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CrossfadeOptions,
    ): AudioHandle;
}
```

**`AudioHandle` shape is unchanged** (Invariant #126). All start-time / offset / phase / schedule context lives on the internal `VoiceRecord`, never on the public handle — the trust-boundary type stays frozen and is never spread-built.

A single new `AssetManager` accessor exposes metadata to the audio layer:

```typescript
// renderer/assets/AssetManager.ts — kind-agnostic, no interpretation, no decode (sync at play()):
getManifestMetadata(ref: AssetRef): unknown;
```

### Feature semantics

**Play-from-cue** — `from` resolves to `startOffsetSeconds`, clamps to `[0, duration]`, and is passed as the offset arg of `source.start(when, offset)`.

```typescript
audio.play(sfxRef, { from: 1.5 });
audio.play(musicRef, { from: { name: 'chorus' } });
```

**Play-to-cue** — `durationSec = resolve(to) − startOffsetSeconds` (same formula both branches). Non-loop: passed as the 3rd arg of `source.start(when, offset, durationSec)` → native `onended` → release. Loop: `to` bounds **total elapsed play duration**, realised by `source.stop(startedAtContextTime + durationSec)` anchored to the real start (never call time). Overrun clamps the window to `buffer.duration`.

```typescript
audio.play(voiceRef, { from: 'start', to: 3.2 }); // play first 3.2 s, then release
```

**Loop points** — `loopRegion: { start, end }` sets `source.loop = true; loopStart; loopEnd` and **implies `loop = true`**. `loop: true` with no region uses the sheet's `defaultLoopRegion` if present, else whole-buffer. This is the intro-then-loop pattern: playback runs from `from` into `[loopStart, loopEnd)`, then loops that region forever.

```typescript
audio.play(musicRef, {
    from: 'start',
    loopRegion: { start: { name: 'loopStart' }, end: { name: 'loopEnd' } },
});
```

**Fades** —

- **In** (`PlayOptions.fadeIn`): `startVoice` sets stage-1 gain to the curve floor at `t0`, ramps to `volume` over `durationMs` (ramp end clamped to any scheduled end — the window is never extended).
- **Out then stop** (`fadeOut`): `{ overMs }` ramps `[now, now+overMs]`; `{ toCue }` ramps to exactly when the playhead reaches the cue (`cueContextTime = startedAtContextTime + (resolvedCueSec − startOffsetSeconds)`, loop-period-aware); `{ toEnd }` ramps to the voice's scheduled end. All then `source.stop(rampEnd)` so native `onended` is the single release path. Cue already passed → immediate silence + stop + warn. No scheduled end (infinite loop) → 250 ms ramp, logged.
- **To-hold** (`fadeTo`): ramps to the absolute `to`, rewrites the ceiling, keeps playing.
- **Curves**: `linear` (default); `exponential` with **both** endpoints clamped off zero (a target of 0 ramps to the epsilon then `setValueAtTime(0)`; falls back to linear only when the **departure** is legitimately 0, which no exponential ramp can leave); `equalPower` as a ≥ 64-waypoint piecewise-linear approximation of the sin/cos quarter-wave — its waypoints depart from the re-anchored held value (established by the re-anchor itself, not by a waypoint at the start time), so it composes with cancel-and-reanchor (never `setValueCurveAtTime`). A curve that needs an optional `AudioParam` method is feature-detected and degrades to linear when that method is missing or throws; `equalPower` is composed from `linearRampToValueAtTime`, so it has nothing to detect.

```typescript
audio.fadeOut(music, { toEnd: true });
audio.fadeTo(ambience, { to: 0.3, durationMs: 800 });
```

**Crossfade / two tracks** — `crossfade(outgoing, incoming, opts)` is **stateless sugar** that starts `incoming` and links a fade-out of `outgoing`, **both anchored to the incoming voice's real start `t0`**. When incoming `startVoice` fires it lays the incoming fade-in over `[t0, t0+durationMs]` _and_ the outgoing fade-out over the identical window — so two `equalPower` curves are genuinely complementary (`g_in² + g_out²` constant, no dip) and there is no premature gap. Until incoming starts, outgoing plays at full volume.

```typescript
const next = audio.crossfade(currentMusic, battleThemeRef, {
    durationMs: 2000,
    bus: 'music',
    loop: true,
});
```

Failure behaviour is fail-soft: incoming decode fails → outgoing keeps playing **unfaded** (never silence-with-nothing-incoming); outgoing already invalid → incoming still fades in; outgoing still loading → it never becomes audible; a second crossfade re-targeting the same outgoing cancel-and-reanchors its in-flight ramp click-free.

> A higher-level **MusicDirector** (named slots, phase-locked stems, in-flight retarget) is an explicit **future optional layer** built on these primitives — not part of the core `AudioManager` surface.

### Lifecycle

**Three gain stages (graph unchanged):** `source → voiceGain (1) → [panner] → busGain (2) → masterGain (3) → destination`. **Every fade/crossfade/cue op writes only stage 1.** Bus volume / settings / mute / `duck` write only stage 2; master is settings-only. They compose multiplicatively and never contend — a duck during a crossfade attenuates both tracks together; a settings change mid-fade survives (Invariant #116).

- **Handle validity across ramps.** A scheduled fade-out keeps the voice in the pool with `handle.valid === true` (phase `'fading-out'`, `scheduledStopAt` set, still re-targetable). `valid` flips false exactly once, inside `releaseVoice`, guarded by `voices.delete(id)` (Invariant #119).
- **One termination path, no timers.** `fadeOut` ramps to 0 then `source.stop(rampEnd)`; the existing `source.onended` handler drives the sole `releaseVoice`. An explicit `stop` mid-fade releases immediately; the still-pending `source.stop` throws harmlessly in try/catch and the nulled `onended` never double-releases. A second `fadeOut` recomputes and reschedules (last `stop()` wins).
- **Native-duration precedence.** A play-to-cue voice's native end sets `scheduledStopAt`; a later fade clamps `rampEnd` to `min(scheduledStopAt, rampEnd)` — the authored bound is authoritative and never extended.
- **Overlapping-ramp safety.** Every new stage-1 ramp first cancel-and-reanchors (`cancelAndHoldAtTime(now)` in try/catch, else `cancelScheduledValues + setValueAtTime(param.value)`) — the pattern `AudioBus.duck` already uses.
- **Fade before the source exists (async load).** `play()` returns before `startVoice` runs, so ops arriving during `'loading'` are stored on the `VoiceRecord` and applied atomically at `t0` in fixed precedence: `releaseOnStart` (source never created) → `pendingFadeIn` → `pendingFadeTo` → `linkedFadeOut`. No ramp is ever scheduled against a null source (Invariant #121).
- **Preemption (rank, not hard-exempt).** `reserveVoiceSlot` prefers `'fading-out'` voices, then ranks looping/music voices worse than any equal-or-higher-priority non-looping voice, then lower priority, then older sequence. No class is exempt (a saturated pool never deadlocks a higher-priority request); music continuity comes from a high recommended `MUSIC_PRIORITY`. Documented consequence: an SFX burst during a long music crossfade can reclaim the dying tail — incoming continuity is preserved, only the tail is cut (Invariant #123).
- **Cleanup.** `stop`/`stopAll` cancel scheduled ramps, stop, and disconnect. `dispose()` → `stopAll()` (cancels every ramp and pending `source.stop`) → dispose buses → `audioContext.close()`. Because fades use no timers, nothing dangles past close.

### Edge cases (selected)

| Input / situation                                           | Defined behaviour                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load-bearing `{ name }` unresolvable (`from`, non-loop)     | Abandon that play → invalid handle + one warning. Raw seconds still work with no sheet.                                                                           |
| End-point cue unresolvable / `> duration` (`to`, `loopEnd`) | Dynamic tier: clamp to `duration`, or drop window and continue + warn.                                                                                            |
| `to ≤ from`, both bounds synchronously finite               | Static reject at `play()` → invalid handle, no voice reserved.                                                                                                    |
| `from` at/beyond loop window (looping voice)                | Folded into the loop: `entryOffset = loopStart + ((from − loopStart) mod (loopEnd − loopStart))`.                                                                 |
| `fadeIn.durationMs` longer than a bounded play window       | Ramp end clamped to `min(t0+durationMs, scheduledStopAt)`; window never extended; may not reach `volume`.                                                         |
| `fadeOut{toCue}` where cue already passed                   | Immediate `setValueAtTime(0)` + `stop(now)` + warn — no ramp into the past.                                                                                       |
| Later fade whose `rampEnd` would pass a native end          | Clamped to `min(scheduledStopAt, rampEnd)` — native end authoritative.                                                                                            |
| `fadeTo{ to: 0, curve: 'exponential' }`                     | Exponential ramp to the `1e-4` epsilon then `setValueAtTime(0)`; ceiling becomes 0. Linear fallback only when the _departure_ is legitimately 0 (Invariant #120). |
| Fade requested during async load (`source === null`)        | Stored as pending intent, applied in precedence order at `startVoice`; a pre-start `fadeOut`/`stop` sets `releaseOnStart`.                                        |
| Crossfade, incoming decode never resolves / fails           | Outgoing keeps playing **unfaded**; call is a logged no-op. Never silent-then-stuck.                                                                              |
| Second crossfade / `fadeOut` on the same outgoing           | Later op cancel-and-reanchors the in-flight ramp at the held value; each incoming fades independently.                                                            |
| `dispose()` mid-fade/crossfade                              | `stopAll` cancels every scheduled gain value + pending `source.stop` before `close()`; no dangling timers.                                                        |

### Invariants introduced by this design (#116–#126)

> The canonical text for these now lives in [`architecture-invariants.md`](../executive-architecture/architecture-invariants.md#design-stage-invariants-pending-implementation) under **Design-stage invariants (pending implementation)** — held **separate from the enforced/roll-called 115** because the behaviour is not yet implemented. The table below is a local summary; the **Enforcement** column is the tier each will hold **on graduation**. No `check-invariants` Check, ESLint rule, `validate-assets` gate, or test asserts them yet (see _Landing this design_). Numbers continue from the current maximum (#115).

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Enforcement            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| #116 | Every fade / crossfade / fade-in / cue op writes **exclusively** to a voice's own stage-1 `GainNode`; bus and master gains are never written by them, so the stages compose purely multiplicatively.                                                                                                                                                                                                                                                                                                   | code-verified (spy)    |
| #117 | Provenance-scoped two-tier cue validation: static synchronous reject at `play()` **only** when both bounds are synchronously finite and already out of order; otherwise dynamic resolve-clamp-drop at `startVoice`. `loopRegion` implies `loop = true`. For a looping voice `to` bounds **elapsed play duration**, not a buffer wrap.                                                                                                                                                                  | code-verified          |
| #118 | Cue resolution is **fail-soft** — never throws into a caller. Load-bearing unresolvable cues abandon the play (invalid handle + warn); end-point cues clamp; post-clamp-collapsed windows drop and playback continues; `parseAudioCueSheet` returns `null` for malformed metadata.                                                                                                                                                                                                                     | code-verified          |
| #119 | Fade-out-then-stop is realised **only** by `source.stop(rampEnd)` → native `onended` → the sole `releaseVoice`; no wall-clock timer schedules a release; the handle stays valid across the ramp and `valid` flips false exactly once (guarded by `voices.delete`).                                                                                                                                                                                                                                     | code-verified          |
| #120 | Every new stage-1 ramp first cancels prior automation and re-anchors at the held value; exponential ramps clamp **both** endpoints to a `1e-4` epsilon (terminal `setValueAtTime(0)` when the target is 0; linear fallback when the **departure** is legitimately 0); `equalPower` is piecewise-linear waypoints (never `setValueCurveAtTime`); no curve can hard-fail — `exponential` degrades to linear when its method is missing or throws, and `equalPower` needs only `linearRampToValueAtTime`. | code-verified          |
| #121 | Ops requested before `startVoice` are stored on the `VoiceRecord` and applied atomically at `t0` in the order `releaseOnStart → pendingFadeIn → pendingFadeTo → linkedFadeOut`; no ramp is ever scheduled against a null source.                                                                                                                                                                                                                                                                       | code-verified          |
| #122 | Cue-relative fade timing is computed from `startedAtContextTime`, `startOffsetSeconds` and `AudioContext.currentTime` (playback rate fixed at 1) — never `setTimeout` — so a fade completes at the intended sample position regardless of main-thread jitter.                                                                                                                                                                                                                                          | code-verified          |
| #123 | Preemption prefers `'fading-out'` voices, then ranks looping/music voices below any equal-or-higher-priority non-looping voice, then lower priority, then older sequence. No class is hard-exempt; music continuity is achieved via a high `MUSIC_PRIORITY`.                                                                                                                                                                                                                                           | code-verified          |
| #124 | Cue sheets exist only as `AudioClipMetadata` inside an `'audio-clip'` entry's `metadata` and are **opaque to `simulation/`/`ai/`** (extends #20): `metadata` is typed `unknown` sim-side, `AudioCueName`/`AudioClipMetadata` are defined sim-side and consumed by renderer (never the reverse), and only `renderer/audio` parses them.                                                                                                                                                                 | import-ban + type test |
| #125 | `validate-assets` validates every `'audio-clip'` cue sheet at build time: each cue second finite, `≥ 0`, `≤ durationSeconds`; `defaultLoopRegion` names exist with `end > start`; a sheet declaring `cues` without `durationSeconds` **fails**; malformed sheets fail CI.                                                                                                                                                                                                                              | enforced               |
| #126 | The public `AudioHandle` gains no fields; all start-time / offset / phase / schedule context lives on the internal `VoiceRecord`; the handle is never spread-built.                                                                                                                                                                                                                                                                                                                                    | code-verified          |

### Landing this design (follow-up — not done in this pass)

1. **`renderer/audio`** — implement the contracts above via TDD (new `Cue.ts`, `audioCueSheet.ts`; `VoiceRecord` phase/intent fields; `fadeOut`/`fadeTo`/`crossfade`; `AssetManager.getManifestMetadata`).
2. **`simulation/foundation/audio-cue-sheet.ts`** + **`simulation/content/audioManifest.ts`** — the pure cue-sheet types and the `audioClipEntry` authoring builder (`AssetManifestEntry` itself stays `metadata?: unknown`, unchanged).
3. **`useSound`** memo key list gains `from`/`to`/`loopRegion`/`fadeIn`; live-handle verbs (`fadeOut`/`fadeTo`/`crossfade`) get a separate `useMusicTrack`/`useAudioHandle` hook that obtains the manager via `useAudioManager()` only (Invariant #84).
4. **`docs/architecture-overview.md` §4.25** — extend the summary line (cue/fade/crossfade + the new `getManifestMetadata` channel).
5. **F73 roll-call** (`f73-invariant-roll-call.md` + its `.github` mirror) — graduate #116–#126 from the design-stage section of [`architecture-invariants.md`](../executive-architecture/architecture-invariants.md#design-stage-invariants-pending-implementation) (where their text already lives) into the numbered roll-call, updating the total and per-invariant classification; add `check-invariants` fixture cases where a static check is feasible (e.g. the sim→renderer import-ban backing #124).
6. **`validate-assets` tooling** — add the cue-sheet build gate (#125) with red-first anti-rot fixtures.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #63 | The simulation never produces audio. No reducer, validator, or `ActionDefinition` may import from `renderer/audio/`.                                                                                                                                                                                                                                                                                          |
| #64 | `AudioManager.dispose()` is called unconditionally at engine shutdown (app exit). `Providers` (`renderer/app/providers.tsx`) is the unique owner of `dispose()` for the app-level `AudioManager`. At game session end (match phase `ended`), `GameShell` calls `AudioManager.stopAll()` to stop all active voices — it does **not** call `dispose()`. Active `AudioHandle`s become invalid after `dispose()`. |

---

## Cross-References

- [Settings System](settings-system.md) — `EngineSettings.audio.*` bus volumes
- [Asset Reference System](asset-reference-system.md) — `AssetRef<AudioClipAsset>` resolution
- [Renderer State Stores](renderer-state-stores.md) — `gameStore.events` observed by `<EventAudioPlayer>`
- [Renderer Contexts](gameshell-ui-design-system.md#renderer-contexts) — `AudioManagerContext` / `useAudioManager()`
