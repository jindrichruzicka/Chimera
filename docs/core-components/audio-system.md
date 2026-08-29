---
title: 'Audio System'
description: 'AudioManager interface, AudioBusId (master/music/sfx/voice), PlayOptions, EventAudioBinding, settings integration, 32-voice pool, lifecycle ownership, audio invariants, and the cue / loop-point / fade / crossfade / playback-rate extensions.'
tags: [audio, sound, renderer, event-driven, bus]
---

# Audio System

> §4.25 of the Chimera architecture.
> Related: [Settings System](settings-system.md) · [Asset Reference System](asset-reference-system.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

Renderer-only audio playback for music, sound effects, and voice cues. Zero coupling to the simulation — game reducers emit `GameEvent`s; the renderer's `EventAudioBinding` maps event types to `AssetRef<AudioClipAsset>` and plays them through `AudioManager`.

Beyond fire-and-forget event SFX, the [Cue, Fade & Crossfade Extensions](#cue-fade--crossfade-extensions) below add cue-bounded playback, native loop points, per-voice fades, and seamless two-track crossfades — the primitives games need for music transitions. [Cue Observation & Cue-Aligned Transitions](#cue-observation--cue-aligned-transitions) then adds the two mechanisms built on those: watching a playhead pass its cues, and booking a transition to land on one. [Playback Rate](#playback-rate) covers the last per-voice knob, `PlayOptions.rate` — a resample, so pitch and speed move together, and fixed for the life of the voice. [Shell-Scoped Audio](#shell-scoped-audio) is where all of it becomes reachable outside a match: the binding that makes the hooks resolve a clip on a menu screen, the bed a game declares there, and the handoff that carries it into a match.

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

/** Recommended PlayOptions.priority for music. Never applied implicitly (Invariant #123). */
export const MUSIC_PRIORITY = 100;

export interface PlayOptions {
    bus?: AudioBusId; // Default: 'sfx'
    loop?: boolean; // Default: false
    volume?: number; // [0, 1]; multiplied with bus gain
    spatial?: SpatialOptions; // If present, played through a PannerNode; statically validated at play()
    priority?: number; // Preemption rank when the pool is full — see Voice Pool; music passes MUSIC_PRIORITY
    rate?: number; // Resample rate, default 1. Pitch AND speed, never one alone; fixed for the voice's life. Non-positive or non-finite ⇒ 1, with one warning.

    // Cue extensions — see Cue, Fade & Crossfade Extensions below.
    from?: Cue; // Play-from-cue. Default 'start' (0).
    to?: Cue; // Play-to-cue. Non-loop: buffer window. Loop: elapsed play duration.
    loopRegion?: LoopRegion; // Native loop points; IMPLIES loop = true.
    fadeIn?: FadeInSpec; // Start-time fade from the curve floor up to `volume`.
}

export type AudioBusId = 'master' | 'music' | 'sfx' | 'voice';

export interface AudioManager {
    play(ref: AssetRef<AudioClipAsset>, opts?: PlayOptions): AudioHandle;
    stop(handle: AudioHandle): void;
    /** Ramp stage-1 gain to 0 per `spec`, then stop via the native onended path. */
    fadeOut(handle: AudioHandle, spec: FadeOutSpec): void;
    /** Ramp stage-1 gain to the absolute `spec.to` and HOLD (dip/swell); rewrites the voice ceiling. */
    fadeTo(handle: AudioHandle, spec: FadeToSpec): void;
    /** Start `incoming` with a fade-in and link a fade-out of `outgoing`, both anchored to the INCOMING voice's real t0; returns the incoming handle. */
    crossfade(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CrossfadeOptions,
    ): AudioHandle;
    /** Arm a crossfade now and execute it at the outgoing voice's next arrival at `opts.atCue`: the incoming clip loads at once and its `source.start` is scheduled for that instant, with BOTH ramps anchored there — native scheduling throughout, never a wall-clock timer. The arrival is read when the buffer is in hand, so a decode landing after the cue takes the NEXT pass. One warning and an immediate swap for a cue the voice never reaches again — past `loopEnd`, already gone, or beyond the voice's own scheduled end; immediate and silent when the outgoing voice is gone or still loading. Returns the incoming handle. */
    crossfadeAtCue(
        outgoing: AudioHandle,
        incoming: AssetRef<AudioClipAsset>,
        opts: CueAlignedCrossfadeOptions,
    ): AudioHandle;
    /** Hold `spec.fade` until this voice's next arrival at `spec.atCue`, then run it from there — a fade that STARTS at a cue, where `fadeOut({ toCue })` is one that ENDS at one. The whole `FadeOutSpec` vocabulary resolves against the cue instant rather than the call. The ramp and its stop are written now, so the voice is `'fading-out'` from here while still audible at full volume until the cue. An unreachable cue gets one warning and then falls back to `now`, i.e. to whatever a bare `fadeOut` would do from there; a voice still loading parks a release; invalid handle: silent no-op. */
    fadeOutAtCue(handle: AudioHandle, spec: CueAlignedFadeOutSpec): void;
    /** Seconds until the playhead next reaches `cue`, or null when nothing in the voice's schedule brings it there — the read direction of the cue timeline, resolving the cue exactly as fadeOut({ toCue }) does. Relative, silent, and null (never 0) on an invalid, loading, not-yet-started or ended voice, on a cue out of the loop window, and on one the voice's scheduled end arrives before — where the fade clamps to that end instead. */
    secondsUntilCue(handle: AudioHandle, cue: Cue): number | null;
    /** Observe a voice's cue / loop / end emissions; returns the unsubscribe. Frame-sampled by one requestAnimationFrame chain the manager owns, started on the FIRST observation and cancelled on the last — a game that observes no cue pays no frame cost. A voice still loading may be observed and is seated where it starts from; whatever ends the voice ends the observation with one final `end`, while `dispose()` cancels the chain instead. Invalid handle: a callable no-op. */
    observeCues(handle: AudioHandle, handlers: CueHandlers): () => void;
    stopAll(bus?: AudioBusId): void;
    /** Duck a bus to duckedVolume for durationMs, then restore. */
    duck(bus: AudioBusId, duckedVolume: number, durationMs: number): void;
    /** Set the app's ONE listener pose — game-supplied, never camera-derived. Feature-detected AudioParam path with a setPosition/setOrientation fallback; ramps unless { immediate: true }. */
    setListener(pose: AudioListenerPose, opts?: SetListenerOptions): void;
    /** Move a spatial voice's source. Live: ramped (or immediate). Loading: parked on the record, applied at t0, last write wins (Invariant #121). Non-spatial: no-op + one warning. Invalid handle: silent no-op. */
    setVoicePosition(
        handle: AudioHandle,
        position: AudioPosition,
        opts?: SetVoicePositionOptions,
    ): void;
    /** Dispose all active sources and clear the pool. Called by `Providers` at app shutdown (Invariant #64). */
    dispose(): void;
}

// renderer/audio/Cue.ts — the cue-aligned option types. `atCue` is a position on the voice
// the transition is measured against, resolved under the same END-POINT rules
// `fadeOut({ toCue })` uses, so an absent `{ name }` degrades to the decoded end.
export interface CueAlignedCrossfadeOptions extends CrossfadeOptions {
    readonly atCue: Cue; // read from the OUTGOING voice, at the incoming decode
}
export interface CueAlignedFadeOutSpec {
    readonly atCue: Cue; // where the ramp BEGINS, on this voice's own timeline
    readonly fade: FadeOutSpec; // the fade to run from there, resolved against the cue
}

// renderer/audio/cueMarkerScheduler.ts — what a cue observer is handed. Every member
// takes its event and returns nothing: no dispatcher, no PlayerId, no tick, so a handler
// has nothing to reach a game's authoritative state with.
export interface CueHandlers {
    onCue?: (event: CueCrossedEvent) => void; // a named cue was crossed
    onLoop?: (event: CueLoopEvent) => void; // the playhead wrapped back to loopStart
    onEnd?: (event: CueEndEvent) => void; // the voice finished
}
```

A component gets the manager from `useAudioManager()` and never from a module-level import (Invariant #84); `GameShell` and `<EventAudioPlayer>` use it directly. `renderer/audio` builds its hooks on it:

```typescript
// renderer/audio/useSound.ts — start a sound
export function useSound(ref: AssetRef<AudioClipAsset>, opts?: PlayOptions): () => AudioHandle;

// renderer/audio/useMusicTrack.ts — act on a voice already playing
export type AudioTrackControls = Pick<
    AudioManager,
    'fadeOut' | 'fadeTo' | 'crossfade' | 'crossfadeAtCue' | 'fadeOutAtCue'
>;
export function useMusicTrack(): AudioTrackControls;

// renderer/audio/useAudioCues.ts — observe a voice's playhead
export function useAudioCues(handle: AudioHandle | null, handlers: CueHandlers): void;

// renderer/audio/useSpatialAudio.ts — the spatial verbs
export type SpatialAudioControls = Pick<AudioManager, 'setListener' | 'setVoicePosition'>;
export function useSpatialAudio(): SpatialAudioControls;
```

`useSound` memoizes its callback on **every** `PlayOptions` field, so a rerender that changes only `fadeIn` still plays the new fade. `AudioTrackControls` is taken from `AudioManager` by `Pick` rather than restated — the handle names the voice, so one control object serves however many voices a component holds. `useAudioCues` is the other half: a `null` handle observes nothing, and the handler record is read at emission rather than at subscribe, so a game may pass an inline one without tearing the subscription down each render.

This block tracks the **shipped** surface. Every member of the cue / fade / crossfade design has landed on it; the [full listing](#new--changed-core-types) below remains as that design's own narrative.

---

## EventAudioBinding

```typescript
// renderer/audio/EventAudioBinding.ts

export type EventAudioBinding = {
    [eventType: string]: {
        ref: AssetRef<AudioClipAsset>;
        bus?: AudioBusId;
        volume?: number;
        /** Per-occurrence overrides, merged OVER the static fields; sim-safe primitives only. */
        options?: (event: GameEvent) => EventAudioOverrides;
    };
};
```

Games declare their event-to-audio map (the shape is type-pinned in `renderer/audio/EventAudioBinding.test.ts`). The engine's `<EventAudioPlayer>` component reads `events: GameEvent[]` from `gameStore` and calls `AudioManager.play()` for each entry it recognises. An entry's optional `options` resolver runs once per event occurrence and its result merges over the static `bus`/`volume` (an omitted key leaves the static value); `EventAudioOverrides` is defined sim-side (`simulation/foundation/game-screen-contract.ts`) over primitives only — it can vary `volume`, `priority`, `rate` or `bus`, never a position, and a throwing resolver is contained with one warning while the static entry plays.

---

## Settings Integration

Audio volume sliders (`settings.audio.masterVolume`, `musicVolume`, etc.) are declared in `EngineSettings` (§4.13). `AudioBus` subscribes to `settingsStore` and updates its gain node on every change — no polling required.

---

## Voice Pool

Default pool: **32 concurrent voices**; pool size is configurable via `AudioManager` construction options.

When saturated, `play()` reclaims one voice to host the new one, ranked **worst standing first** on four lexicographic terms (Invariant #123):

1. **`'fading-out'`** — already dying, so cutting its tail costs the least. This partitions rather than flattens: the terms below still rank inside each half.
2. **Lower `priority`.**
3. **Looping, at equal priority only** — a loop runs until something else ends it, while an equally-important one-shot ends itself and cannot be re-triggered once its moment has passed. "Looping" is the **effective** loop window, not the requested intent and not the absence of a stop: a bare `loopRegion` that collapsed after clamping is a one-shot, while an explicit `loop: true` surviving that collapse as a whole-buffer loop — or a `to`-bounded loop that schedules its own end — still counts as looping.
4. **Older `sequence`.**

**No class of voice is exempt** — the scan is unfiltered, so a saturated pool always yields a candidate and can never deadlock a higher-priority request. Music survives by **ranking**, not by exemption: pass the exported `MUSIC_PRIORITY` (`100`) as `PlayOptions.priority`. Nothing applies it implicitly — not `bus: 'music'`, not `loop: true` — and because the loop term sits _below_ priority, naming it is what lifts a music bed clear of the comparison. (`Infinity` is not a substitute: non-finite priorities normalise to the _default_ `0` rather than the highest, putting the voice below everything the game ranked above `0`.)

---

## Lifecycle Ownership

`AudioManager` is constructed once per app launch by `renderer/app/providers.tsx` and exposed via `AudioManagerContext`. `Providers` owns `dispose()` — it is called at engine shutdown (app exit), not at game session end.

`GameShell.tsx` manages the session lifecycle:

- On game start it registers the game-level `AssetManager` with the app-level `DelegatingAssetManager` via `SetGameAssetManagerContext`. This allows `AudioManager.play()` to load game-specific audio assets through the game resolver and manifest. The registration runs **during render**, not only in the passive effect that owns it for the rest of the mount: React flushes mount effects children-first, so a screen that plays a bed in its own mount effect would otherwise reach the delegating manager before the delegate is set, and `play()` swallows the resulting `NoActiveGameSessionError` — silence, with nothing logged. A `React.lazy` screen masks that on a session's first match alone (it suspends once and mounts a commit late, then renders synchronously from the resolved payload thereafter), which is why the symptom was a bed that played once per session.
- On match end (`phase: ended`) it calls `AudioManager.stopAll()` to stop all active voices.
- On unmount it clears the delegate (`setGameAssetManager(null)`) and disposes the game-level `AssetManager`.

---

## Shell-Scoped Audio

`useSound` and `useMusicTrack` resolve their clips through the app-level `AudioManager` (Invariant #64), which loads through the app-level `DelegatingAssetManager`. Bind nothing to that manager and every load rejects `NoActiveGameSessionError`, which `play()` swallows — so before this existed a menu bed or a select blip was simply silent, with nothing logged. `ShellAudioSession` (`renderer/components/shell/ShellAudioSession.tsx`, mounted by `AppShell`) is the binding for the shell surfaces.

**What a game declares.** Two fields on the shell payload, both optional:

- `shellAudioAssets: AssetManifest` — the inventory the session builds its manager over. It may be the same `shell-asset-manifest.ts` value the background uses; the asset validator discovers that file by name, so neither field carries a build-time gate of its own. It is deliberately separate from `shellBackgroundAssets` because the two publish to different places: a background session publishes to its own subtree through `AssetManagerContext`, which the app-level `AudioManager` is not inside.
- `shellMusicBed: { ref, volume?, fadeInMs? }` — a menu bed the engine plays for the session's whole life, as a looping `music`-bus voice at `MUSIC_PRIORITY`. A declaration rather than a hook call, because the bed outlives every individual shell screen. Declared without `shellAudioAssets` it is inert: the ref would resolve against nothing.

**Where it runs.** `SHELL_AUDIO_SURFACES` — `main-menu`, `settings`, `lobby`, `saves`, `replays` and every declared game `page`. Wider than `SHELL_BACKGROUND_SURFACES`, which skips `saves` and `replays`: a bed that cut out on the way to the save browser would read as a bug, while a background there would paint over a full-screen list. The two are separate sets so that widening one never widens the other. `match` and `replay-player` sit outside it because both sound a match; `renderer/shell/shellRoutes.test.ts` holds the whole membership.

**What it is not.** It is not a match impersonation. It publishes no manager to any subtree, it opens no session on the two match surfaces, and it is **non-spatial** — it never touches the listener pose, because a menu is not a place and a bed panned against a listener nobody moved would be a claim about a scene that does not exist. A game that wants a positioned shell sound passes `spatial` to its own `useSound` call. Volumes and mute need nothing of their own: the bed plays through the app-level manager's `music` bus, which already carries `EngineSettings.audio.*`.

**The menu→match handoff.** The match-entry flows arm a `to-match` `ShellTransition` (§4.37.18) the moment an entry begins — before they navigate — and that arm is the handoff cue. On it the session:

1. **Hands the bed off rather than cutting it.** When the bed's clip declares an `'outro'` cue in its sheet, the fade is F85's cue-aligned `fadeOutAtCue({ atCue: { name: 'outro' }, fade: { overMs } })`. With no such cue it is a plain `fadeOut({ overMs })` over the screen fade the entry is already running. The check is on the CUE and not on the sheet: an unknown `{ name }` resolves under end-point rules to the clip's decoded end, so a sheet-exists check would arm the transition against an instant the game never authored. What a cue-aligned arm does when the playhead's schedule does not bring it to the cue is `AudioManager.fadeOutAtCue`'s own contract, measured there. Either way the fade schedules the voice's own stop, so the session lets go of a bed that is still sounding. A `crossfade` is not reachable from here — its incoming half is the match's music, which the shell cannot name.
2. **Releases the delegate.** Because the arm precedes the navigation, the binding is free while the shell route is still the current one — before `GameShell` registers the match manager during its own render. Every entry the arm does not cover is caught by releasing on **identity** (`DelegatingAssetManager.releaseDelegate`), which cannot clear a binding a match already took over. That backstop is what the mount ordering demands: a session driven by the shell-state store tears down on a store update that lands _after_ the router's commit, so an unconditional clear on teardown would silence the match it just handed over to.

**One bed at a time.** A handed-off bed is not a finished one: `fadeOutAtCue` books its ramp at the cue and holds the voice at full volume until the playhead arrives, which for a menu loop can be a whole loop period away, and nothing else ends it — no bus is exclusive, preemption only fires on a saturated pool, and an `audio-clip` has no dispose path. So the session remembers the voice it let go of and stops it before it starts the next one. Without that, the two paths back to a shell surface — a cancelled entry, and an ordinary quit to the menu — would each lay a second copy of the same loop over the first.

A cancelled entry (a refused quick start clears the transition) re-registers and restarts the bed, which is what leaves the player on a menu that still sounds like one.

---

## Cue, Fade & Crossfade Extensions

> **The cue / fade / crossfade design** (F74, shipped across #910–#923). Adds **play-from-cue**, **play-to-cue**, **loop points**, **fades** (in / out to end-or-cue), and **crossfade / two simultaneous tracks**. It extends the existing 32-voice pool, the per-voice `GainNode`, and the three-stage bus graph **without changing them** — every new behaviour writes only a voice's own stage-1 gain and leans on native `AudioBufferSourceNode` scheduling (`start(when, offset, duration)`, `loopStart`/`loopEnd`, `source.stop(when)`) rather than JS timers. All timing is renderer-only and driven by `AudioContext.currentTime`; nothing crosses into the simulation (Invariant #63).

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
    // existing — bus, loop, volume, priority ... (unchanged)
    readonly from?: Cue; // play-from-cue → start(when, offsetSec). Default 'start' (0).
    readonly to?: Cue; // play-to-cue. Non-loop: buffer window. Loop: elapsed play duration.
    readonly loopRegion?: LoopRegion; // → source.loopStart/loopEnd; IMPLIES loop = true.
    readonly fadeIn?: FadeInSpec; // start-time fade from the curve floor up to `volume`; truncated by a scheduled end.
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
    readonly curve?: FadeCurve; // default 'equalPower' (constant perceived power for a MATCHED pair — see below)
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

**Play-from-cue** — `from` resolves to `anchorSeconds`, clamped to `[0, duration]`. That value is passed as the offset arg of `source.start(when, offset)` — except when a loop **window** actually resolved, in which case it is first folded into that window and the folded result is `startOffsetSeconds` (see the table below). A whole-buffer loop has no window and is never folded.

```typescript
audio.play(sfxRef, { from: 1.5 });
audio.play(musicRef, { from: { name: 'chorus' } });
```

**Play-to-cue** — `durationSec = resolve(to) − anchorSeconds` (same formula both branches), where `anchorSeconds` is the resolved, clamped `from` **before any loop fold**. Non-loop at `rate: 1`: passed as the 3rd arg of `source.start(when, offset, durationSec)` → native `onended` → release. Non-loop at any other rate: the same window, realised instead by `source.stop(startedAtContextTime + durationSec / rate)`, because `start()`'s 3rd arg is buffer-relative and its reading under a resample is not portable — the same reason the looping branch never uses it, while a stop is an absolute context time that means one thing everywhere. `onended` still fires, so the single release path is unchanged; a platform that refuses the scheduled stop drops the bound onto the clip's natural end and says so. Loop: `to` bounds **total elapsed play duration**, realised by `source.stop(startedAtContextTime + durationSec / rate)` anchored to the real start (never call time). Overrun clamps the window to `buffer.duration`, so the longest bound `to` can express is one pass of the clip (`duration − from`) — an over-long `to` on a looping voice clamps rather than extending across wraps.

Two distinct offsets fall out of this, and conflating them is a defect:

| Quantity             | Value                                         | Consumed by                                                |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `anchorSeconds`      | resolved, clamped `from` — **pre**-fold       | the `to` window length                                     |
| `startOffsetSeconds` | the loop-folded `entryOffset` — **post**-fold | `start()`'s offset argument, and fade-to-cue timing (#122) |

The **static** order gate consumes neither: it runs before any buffer exists and compares the _raw, unclamped_ seconds a cue resolves to synchronously. That is a third quantity, and deliberately so — see the two-tier rule above.

Measuring the window from the folded entry point would systematically overrun the authored bound (folding only ever _decreases_ the offset) and would break the static gate, which must be able to reject `{ loop, from: 9, to: 8, loopRegion: [2,6] }` without the buffer.

```typescript
audio.play(voiceRef, { from: 'start', to: 3.2 }); // play first 3.2 s, then release
```

**Loop points** — `loopRegion: { start, end }` sets `source.loop = true; loopStart; loopEnd` and **implies `loop = true`**. `loop: true` with no region uses the sheet's `defaultLoopRegion` if present, else whole-buffer. This is the intro-then-loop pattern: playback runs from `from` into `[loopStart, loopEnd)`, then loops that region forever.

A failing loop region degrades by **provenance**, mirroring the two-tier rule above, and `loop` and `loopRegion` count as **separate authored intents**:

| Authored                                      | Region unresolvable (`start` anchor) | Region collapses after clamping |
| --------------------------------------------- | ------------------------------------ | ------------------------------- |
| `loopRegion` only                             | abandon the play (#118)              | looping is disabled             |
| `loop: true` + `loopRegion`                   | abandon the play (#118)              | whole-buffer loop               |
| `loop: true` only (sheet `defaultLoopRegion`) | whole-buffer loop                    | whole-buffer loop               |

An **explicit** `loopRegion` is authored intent, so its `start` is a load-bearing anchor and an unresolvable one abandons the play. A region that merely _collapses_ cannot be honoured either way, but it must not silently discard a `loop: true` the caller asked for in its own right — only a loop that the region itself implied goes away with it. A **sheet-supplied `defaultLoopRegion`** is an engine default the caller never asked for, so any failure degrades to a whole-buffer loop with one warning and can never silence the play. The realistic trigger is a sheet whose `durationSeconds` overstates the clip: the region then sits past `buffer.duration` through no fault of the call site.

Every degrade path emits a warning naming the outcome that actually happened. The manager never re-logs `resolveCueWindow`'s message where the two differ — that helper is consequence-neutral by contract, so its `abandon` wording says "abandoning playback" even on paths that continue.

```typescript
audio.play(musicRef, {
    from: 'start',
    loopRegion: { start: { name: 'loopStart' }, end: { name: 'loopEnd' } },
});
```

**Fades** —

- **In** (`PlayOptions.fadeIn`): `startVoice` sets stage-1 gain to the curve floor at `t0` — `0`, or the `1e-4` epsilon for `exponential`, which cannot leave zero — and ramps to `volume` over `durationMs`. A ramp end past the voice's scheduled end is **truncated, not compressed**: the window clamps to `scheduledStopAt` (never extended) _and_ the target comes down to the value the authored curve holds at that moment, so the fade keeps the rate it authored and may never reach `volume`.
- **Out then stop** (`fadeOut`): `{ overMs }` ramps `[now, now+overMs]`; `{ toCue }` ramps to exactly when the playhead **next** reaches the cue (`cueContextTime = startedAtContextTime + (resolvedCueSec − startOffsetSeconds) / rate`, loop-period-aware — the period converts on the same axis); `{ toEnd }` ramps to the voice's scheduled end. All then `source.stop(rampEnd)` so native `onended` is the single release path. Cue already passed → immediate silence + stop + warn. No scheduled end → 250 ms ramp, logged once that substituted stop has been accepted.

    A looping voice runs its **entry pass** from `startOffsetSeconds` out to `loopEnd`, then repeats `[loopStart, loopEnd]` forever, so a cue is reached in the entry pass, only after a wrap (when it sits behind the entry point), or **never**. The window is closed at `loopEnd` — that is where the playhead wraps. "Never" covers a cue outside the loop window as well as one already gone by, and both take the already-passed path. Which arrival is named, and how the entry offset and the loop period each convert onto the context clock, is `nextCueContextTime` in `renderer/audio/voicePlayhead.ts`, pinned by its co-located test.

    The two fail-soft branches deliberately differ on whether a discontinuity is acceptable, because the caller has ruled out different things. An unreachable `{ toCue }` takes a hard step to silence: the caller named the moment the voice should be gone, and borrowing a ramp would keep it audible **past** that moment. `{ toEnd }` on a voice with no scheduled end names no moment at all, so a 250 ms ramp invents nothing the caller excluded.

- **To-hold** (`fadeTo`): ramps to the absolute `to`, rewrites the ceiling, keeps playing. Only the ramp **window** clamps to the voice's scheduled end — the target does not, since `to` is an absolute the caller named. Nothing about the voice's death moves: no stop is scheduled and none is rewritten, so a voice already fading out is re-targetable (#119) yet still dies on time, its ramp **compressed** into what remains rather than truncated the way a fade-in is. It therefore reaches the full `to` at the clamped end — `fadeTo({ to: 1 })` on a dying voice peaks at full gain on the exact sample `source.stop` fires, a hard cut and the honest one, since Web Audio cannot un-schedule that stop and lowering the target would rewrite the request.

    The ceiling is what a later fade's departure bound caps a stale `param.value` read against (#120), and `fadeTo` moves it at ramp **start** while the gain only arrives at it at the **end**. That makes the ceiling alone insufficient as a bound, and not only for `fadeTo`: **every** voice ramp travels off the settled value for its own window — a `fadeOut` that cancels an unfinished dip descends on a trajectory above it, and a truncated `fadeIn` climbs to less than it. So the bound is recorded per ramp, by the single helper all three go through rather than by each verb, as the higher of that ramp's two endpoints (every curve is monotonic between them), expiring by comparison against a context time and never against a timer. Without it the cap manufactures the very artifact it exists to prevent: a step **down** to a gain the voice has not reached, audible as a waypoint-sized jump on `equalPower`, as a hard `setValueAtTime` on every curve where `cancelAndHoldAtTime` is missing, and — where the cap reads `0` — as an exponential ramp silently degraded to linear.

- **Curves**: `linear` (default); `exponential` with **both** endpoints clamped off zero (a target of 0 ramps to the epsilon then `setValueAtTime(0)`; falls back to linear only when the **departure** is legitimately 0, which no exponential ramp can leave); `equalPower` as a ≥ 64-waypoint piecewise-linear approximation of the sin/cos quarter-wave — its waypoints depart from the re-anchored held value (established by the re-anchor itself, not by a waypoint at the start time), so it composes with cancel-and-reanchor (never `setValueCurveAtTime`). A curve that needs an optional `AudioParam` method is feature-detected and degrades to linear when that method is missing or throws; `equalPower` is composed from `linearRampToValueAtTime`, so it has nothing to detect.

```typescript
audio.fadeOut(music, { toEnd: true });
audio.fadeTo(ambience, { to: 0.3, durationMs: 800 });
```

**Crossfade / two tracks** — `crossfade(outgoing, incoming, opts)` is **stateless sugar** that starts `incoming` and links a fade-out of `outgoing`, **both anchored to the incoming voice's real start `t0`**. When incoming `startVoice` fires it lays the incoming fade-in over `[t0, t0+durationMs]` _and_ the outgoing fade-out over the same authored window, so there is no premature gap. Until incoming starts, outgoing plays at full volume. Whether the two `equalPower` curves are also **constant-power** across the pair is a separate question with two preconditions — see immediately below; the shared anchor alone does not supply them.

The shared **anchor** is unconditional. Constant **power** across the pair is narrower, and needs two things the verb supplies neither of by force:

1. **One shared window.** `durationMs` is what each half authors; each then clamps its own end against its own voice's `scheduledStopAt`. The crossfade neither reads across nor equalises the two, because doing so would override a `to`/`toEnd` bound authored on one voice because of the other. When one clamps, the sum dips over the difference: an outgoing voice bounded before `t0+durationMs` reaches silence early, and an incoming one bounded there truncates below `volume` while the fade-out runs on.
2. **Equal distances.** `equalPower` traces `V·sin θ` against `G·cos θ`, whose squares sum to a constant only when `V === G` — the incoming `volume` equals the gain the outgoing voice is at when the linkage fires. A quieter incoming voice leaves both curves correctly _shaped_ while the pair sums to a slope, ending at `V²`. Scaling either to match would silently rewrite an authored `volume`.

Both hold by default — two full-volume voices that outlive the fade — which is the case the curve is chosen for. Neither is enforced, because enforcing either means overriding something the caller asked for.

```typescript
const next = audio.crossfade(currentMusic, battleThemeRef, {
    durationMs: 2000,
    bus: 'music',
    loop: true,
});
```

Failure behaviour is fail-soft, and every branch keeps something audible: incoming decode fails → outgoing keeps playing **unfaded** (never silence-with-nothing-incoming); outgoing already invalid → incoming still fades in; outgoing still loading when the linkage fires → it parks a release and never becomes audible; a saturated pool that reclaims the outgoing voice to host the incoming one → no linkage is parked at all, so nothing fires onto a record that has left the pool; a second crossfade re-targeting the same outgoing cancel-and-reanchors its in-flight ramp click-free.

None of those is diagnosed a second time by `crossfade` itself. The returned handle's `valid` is the report, and `play` owns the diagnosis of _why_ it declined — a cue rejection already warns, and adding an outcome message beside it would put two warnings on one defect (Invariant #118).

> A higher-level **MusicDirector** (named slots, phase-locked stems, in-flight retarget) is an explicit **future optional layer** built on these primitives — not part of the core `AudioManager` surface.

### Lifecycle

**Three gain stages (graph unchanged):** `source → voiceGain (1) → [panner] → busGain (2) → masterGain (3) → destination`. **Every fade/crossfade/cue op writes only stage 1.** Bus volume / settings / mute / `duck` write only stage 2; master is settings-only. They compose multiplicatively and never contend — a duck during a crossfade attenuates both tracks together; a settings change mid-fade survives (Invariant #116).

- **Handle validity across ramps.** A scheduled fade-out keeps the voice in the pool with `handle.valid === true` (phase `'fading-out'`, `scheduledStopAt` set, still re-targetable). `valid` flips false exactly once, inside `releaseVoice`, guarded by `voices.delete(id)` (Invariant #119).
- **One termination path, no timers.** `fadeOut` schedules `source.stop(rampEnd)` **first** and lays the ramp down only once that release exists; the existing `source.onended` handler drives the sole `releaseVoice`. An explicit `stop` mid-fade releases immediately — `releaseVoice` nulls `onended`, calls a bare `source.stop()` inside try/catch, and disconnects — so the fade's own scheduled stop is superseded rather than left to fire, and nothing double-releases. A second `fadeOut` recomputes and reschedules (last `stop()` wins). A platform that **refuses** the scheduled stop would leave a silent, unreleased voice holding a pool slot, so the fade is dropped, the voice stopped at once, and the cut warned about.
- **Native-duration precedence.** A play-to-cue voice's native end sets `scheduledStopAt`; a later fade clamps `rampEnd` to `min(scheduledStopAt, rampEnd)` — the authored bound is authoritative and never extended. `fadeOut` writes its own ramp end back through the same clamp and then floors it at `now`, so a re-fade can only ever **shorten** a voice's remaining life, even though a bare `source.stop()` would accept a later time. (The floor is why the claim is about what REMAINS: a voice whose stop has elapsed without its `onended` having been delivered records `now`, later than the stop it replaces, extending nothing audible.) `crossfade` **deliberately inherits this**: re-targeting an outgoing voice with a longer fade than the one already in flight is clamped to the shorter one, cutting its tail early rather than promising a tail the scheduled stop would cut anyway. Lifting it would need `VoiceRecord` to tell a fade-SCHEDULED stop (re-issuable — the last `stop()` wins) apart from a natural end (not), which is a separate change; the row for a second crossfade in the table below specifies the clamped behaviour as it stands.
- **Overlapping-ramp safety.** Every new stage-1 ramp first cancel-and-reanchors (`cancelAndHoldAtTime(now)` in try/catch, else `cancelScheduledValues + setValueAtTime(held)`) — the pattern `AudioBus.duck` already uses. `held` falls back to `param.value`, which reports the **previous render quantum** and so cannot see a gain written this turn (an unrendered `GainNode` reports 1), so a caller that knows better supplies it: the fade-in passes the curve floor it just wrote at `t0`, and a fade-out passes a bound derived from the voice's own record (`fadeOutDeparture`) — a stale read names a gain the voice cannot be at. This matters because `equalPower` derives every waypoint from `held` JS-side and the fallback path writes it as an explicit anchor; a misread inverts a fade instead of softening it (Invariant #120).
- **Fade before the source exists (async load).** `play()` returns before `startVoice` runs, so ops arriving during `'loading'` are stored on the `VoiceRecord` and applied atomically at `t0` in fixed precedence: `releaseOnStart` (source never created) → `pendingFadeIn` → `pendingFadeTo` → `linkedFadeOut`. No ramp is ever scheduled against a null source (Invariant #121).
- **Preemption (rank, not hard-exempt).** `reserveVoiceSlot` reclaims worst-standing-first on four lexicographic terms: `'fading-out'` voices, then lower priority, then — at equal priority only — a looping voice before a non-looping one, then older sequence. The loop term sits **below** priority, which is what makes `MUSIC_PRIORITY` the mechanism the invariant says it is; above it, no priority could lift a bed clear of a one-shot. Equivalently, and as #123 originally put it — but only **within** one side of the `'fading-out'` split, which outranks both terms: a looping voice goes before an equal-or-higher-priority non-looping one, while a lower-priority non-looping voice still goes first. The scan is unfiltered, so no class is exempt and a saturated pool never deadlocks a higher-priority request. See [Voice Pool](#voice-pool) for the authoring rule. Documented consequence: an SFX burst during a long music crossfade can reclaim the dying tail — incoming continuity is preserved, only the tail is cut (Invariant #123).
- **Cleanup.** `stop`/`stopAll` null `onended`, stop the source, and disconnect it along with the voice's own gain and panner. Pending stage-1 automation is deliberately **not** cancelled: disconnecting takes the gain out of the graph, so anything still scheduled on it is inaudible and dies with the node — cancelling would write to a param nothing can hear. A pending `source.stop` likewise reaches a source that has been stopped and unhooked. `dispose()` → `stopAll()` → dispose buses → `audioContext.close()`. Because fades use no timers, nothing dangles past close.

### Edge cases (selected)

| Input / situation                                           | Defined behaviour                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load-bearing `{ name }` unresolvable (`from`, non-loop)     | Abandon that play → invalid handle + one warning. Raw seconds still work with no sheet.                                                                                                                                                                                                                                                                                                           |
| End-point cue unresolvable / `> duration` (`to`, `loopEnd`) | Dynamic tier: clamp to `duration`, or drop window and continue + warn.                                                                                                                                                                                                                                                                                                                            |
| `to ≤ from`, both bounds synchronously finite               | Static reject at `play()` → invalid handle, no voice reserved.                                                                                                                                                                                                                                                                                                                                    |
| `from` at/beyond loop window (looping voice)                | Folded into the loop: `entryOffset = loopStart + ((from − loopStart) mod (loopEnd − loopStart))`.                                                                                                                                                                                                                                                                                                 |
| `fadeIn.durationMs` longer than a bounded play window       | Ramp end clamped to `min(t0+durationMs, scheduledStopAt)`; window never extended; target truncated along the authored curve, so it may not reach `volume`.                                                                                                                                                                                                                                        |
| `fadeOut{toCue}` where cue already passed                   | `setValueAtTime(0)` + `stop` at the ramp's own start + warn — no ramp into the past.                                                                                                                                                                                                                                                                                                              |
| `fadeOut{toCue}` the playhead never reaches again           | Same path: a cue outside the loop window (or past a non-loop entry) is the same defect as one that has gone by — silence + `stop` at the ramp's own start + warn.                                                                                                                                                                                                                                 |
| `fadeOut{toCue}` at the loop **end**                        | Reached: the window is closed at `loopEnd`, since that is where the playhead wraps. `{ toCue: 'end' }` on a whole-buffer loop fades over the current pass.                                                                                                                                                                                                                                        |
| `fadeOut{overMs}` non-positive or non-finite                | Names no window, so it is no fade: silence + `stop` at the ramp's own start. Resolved **before** the clamp, so `+Infinity` cannot become a bounded voice's full-length fade.                                                                                                                                                                                                                      |
| `fadeOut{toEnd}` on a voice with no scheduled end           | No end to ramp to → 250 ms ramp + warn. Reached by an unbounded loop and by a bounded loop whose stop the platform refused, so the warning names the fact, not a cause — and it is held until the substituted stop is accepted, because that second cause refuses this stop too and cancels the fade the message promises.                                                                        |
| `fadeOut{toCue: { name }}` unresolvable                     | End-point rules: degrades to the buffer end with no warning of its own, so on a non-looping voice or a whole-buffer loop a typo is a **silent** full-length fade. Only a shorter loop window puts it past `loopEnd` and onto the unreachable path above.                                                                                                                                          |
| `fadeOut` whose `source.stop(rampEnd)` is refused           | Fade dropped, voice released immediately + warn — never a silent voice holding a pool slot.                                                                                                                                                                                                                                                                                                       |
| Later fade whose `rampEnd` would pass a native end          | Clamped to `min(scheduledStopAt, rampEnd)` — native end authoritative.                                                                                                                                                                                                                                                                                                                            |
| `fadeTo{ to: 0, curve: 'exponential' }`                     | Exponential ramp to the `1e-4` epsilon then `setValueAtTime(0)`; ceiling becomes 0. Linear fallback only when the _departure_ is legitimately 0 (Invariant #120).                                                                                                                                                                                                                                 |
| `fadeTo{ durationMs }` non-positive or non-finite           | Names no window, so it is no fade: the clamped target is applied instantly and becomes the ceiling. Resolved **before** the clamp, so `+Infinity` cannot become a bounded voice's full-length fade.                                                                                                                                                                                               |
| `fadeTo` on a voice already `'fading-out'`                  | Re-targeted, not refused (#119): the gain ramps and the ceiling moves, but `phase` and `scheduledStopAt` do not. The window clamps to the stop, so the ramp is **compressed** into it and reaches the full `to` there — `{ to: 1 }` peaks at full gain on the sample the voice stops.                                                                                                             |
| Second fade issued while any ramp is still travelling       | Departs from the real gain, not the settled ceiling: every voice ramp — `fadeIn`, `fadeOut`, `fadeTo` — records the window it travels in, bounded by the higher of its two endpoints. Expires against `currentTime`, never a timer.                                                                                                                                                               |
| Second fade issued in the SAME quantum as an instant one    | An instant application moves the gain arbitrarily far in zero time, so `param.value` is too LOW to cap and a bound cannot repair it. It records its exact landed value instead, which later departures take outright; otherwise that one stale read would freeze into the bound and outrank every truthful read for the following ramp.                                                           |
| `fadeIn` plus a pre-start `fadeTo`                          | The `fadeTo` **supersedes** it — both anchor at the same `t0`, so its cancel-and-reanchor wipes the fade-in's curve and the fade-in survives only as the gain it departs from. A 2000 ms `fadeIn` then a 100 ms `fadeTo` is a 100 ms ramp from silence, not an interrupted 2000 ms one.                                                                                                           |
| Fade requested during async load (`source === null`)        | Stored as pending intent, applied in precedence order at `startVoice`; a pre-start `fadeOut` sets `releaseOnStart`, a pre-start `fadeTo` fills `pendingFadeTo` (one slot, last write wins). A pre-start `stop` reaches the same outcome by a different route — it releases the record out of the pool at once, and the load continuation's own guard is what keeps the source from being created. |
| Crossfade, incoming decode never resolves / fails           | Outgoing keeps playing **unfaded**; no warning is added beside whatever `play` already said. Never silent-then-stuck. A decode that **fails** releases the incoming voice, so its handle goes invalid; one that **never settles** leaves it in the pool at phase `'loading'` with a still-valid handle, and the linkage simply never fires.                                                       |
| Crossfade, **outgoing** bounded before `t0+durationMs`      | Its fade-out clamps to its own end and reaches silence early. A **dip**, not a gap — the incoming voice is audible and still rising across the difference, and the crossfade still resolves to it.                                                                                                                                                                                                |
| Crossfade, **incoming** bounded before `t0+durationMs`      | Its fade-in truncates below `volume` **and its source ends there**, so it is released mid-fade while the fade-out runs on: the crossfade finishes on the outgoing tail and then on silence. The one shape where the "never silence-with-nothing-incoming" promise above does not hold — an incoming clip shorter than `durationMs` is the cause to look for.                                      |
| Crossfade whose two halves travel different distances       | Constant power also needs the incoming `volume` to equal the outgoing voice's gain at `t0`, since `equalPower` is `V·sin` against `G·cos`. Mismatched, both curves keep their shape but the pair sums to a slope ending at `V²`. Not corrected — scaling either would rewrite an authored `volume`.                                                                                               |
| Second crossfade / `fadeOut` on the same outgoing           | Later op cancel-and-reanchors the in-flight ramp at the held value and reschedules the stop, shortening the voice's remaining life but never extending it; each incoming fades independently.                                                                                                                                                                                                     |
| `dispose()` mid-fade/crossfade                              | `stopAll` stops and disconnects every voice before `close()`, so a scheduled ramp or pending `source.stop` reaches a node already out of the graph; no timers dangle.                                                                                                                                                                                                                             |

### Invariants introduced by this design (#116–#126)

> The canonical text for these lives in [`architecture-invariants.md`](../executive-architecture/architecture-invariants.md) among the numbered rules; they **graduated** into the enforced/roll-called set in #923, taking the total from 115 to 126. The table below is a local summary and the **Enforcement** column is the tier each actually holds, mirroring the [invariant roll-call](../executive-architecture/invariant-roll-call.md). Two reduce to a standing mechanical guard — #125 (`validate-assets` cue-sheet gate) and #124 (the sim→renderer import ban, `check-invariants` Checks 2/13) — and the other nine are code-verified, because what they assert is runtime automation no grep or lint rule can observe. One row has since moved: #122 acquired its playback-rate clause when F86 amended it, minting no new number, so the summary below is the amended text rather than what this design authored — see [Playback Rate](#playback-rate).

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Enforcement                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| #116 | Every fade / crossfade / fade-in / cue op writes **exclusively** to a voice's own stage-1 `GainNode`; bus and master gains are never written by them, so the stages compose purely multiplicatively.                                                                                                                                                                                                                                                                                                                                                 | code-verified (spy)           |
| #117 | Provenance-scoped two-tier cue validation: static synchronous reject at `play()` **only** when both bounds are synchronously finite and already out of order; otherwise dynamic resolve-clamp-drop at `startVoice`. `loopRegion` implies `loop = true`. For a looping voice `to` bounds **elapsed play duration**, not a buffer wrap.                                                                                                                                                                                                                | code-verified                 |
| #118 | Cue resolution is **fail-soft** — never throws into a caller. Load-bearing unresolvable cues abandon the play (invalid handle + warn); end-point cues clamp; post-clamp-collapsed windows drop and playback continues; `parseAudioCueSheet` returns `null` for malformed metadata.                                                                                                                                                                                                                                                                   | code-verified                 |
| #119 | Fade-out-then-stop is realised **only** by `source.stop(rampEnd)` → native `onended` → the sole `releaseVoice`; no wall-clock timer schedules a release; the handle stays valid across the ramp and `valid` flips false exactly once (guarded by `voices.delete`).                                                                                                                                                                                                                                                                                   | code-verified                 |
| #120 | Every new stage-1 ramp first cancels prior automation and re-anchors at the held value; exponential ramps clamp **both** endpoints to a `1e-4` epsilon (terminal `setValueAtTime(0)` when the target is 0; linear fallback when the **departure** is legitimately 0); `equalPower` is piecewise-linear waypoints (never `setValueCurveAtTime`); no curve can hard-fail — `exponential` degrades to linear when its method is missing or throws, and `equalPower` needs only `linearRampToValueAtTime`.                                               | code-verified                 |
| #121 | Ops requested before `startVoice` are stored on the `VoiceRecord` and applied atomically at `t0` in the order `releaseOnStart → pendingFadeIn → pendingFadeTo → linkedFadeOut`; no ramp is ever scheduled against a null source.                                                                                                                                                                                                                                                                                                                     | code-verified                 |
| #122 | Cue-relative fade timing is computed from `startedAtContextTime`, `startOffsetSeconds`, the decoded buffer duration, the effective loop window and the voice's own recorded playback rate, against `AudioContext.currentTime` — never `setTimeout` — so a fade completes at the intended sample position regardless of main-thread jitter. The rate is normalised at `play()` and immutable for the life of the voice, which is what keeps each buffer-seconds-to-wall-clock conversion a single division rather than an integral of rate over time. | code-verified                 |
| #123 | Preemption reclaims worst-standing-first: `'fading-out'` voices, then lower priority, then — at equal priority only — a looping voice before a non-looping one (read from the **effective** loop window), then older sequence. A strict total order over four keys. No class is hard-exempt (the scan is unfiltered); music continuity is achieved solely via a high `MUSIC_PRIORITY`.                                                                                                                                                               | code-verified                 |
| #124 | Cue sheets exist only as `AudioClipMetadata` inside an `'audio-clip'` entry's `metadata` and are **opaque to `simulation/`/`ai/`** (extends #20): `metadata` is typed `unknown` sim-side, `AudioCueName`/`AudioClipMetadata` are defined sim-side and consumed by renderer (never the reverse), and only `renderer/audio` parses them.                                                                                                                                                                                                               | enforced-by (Checks 2/13)     |
| #125 | `validate-assets` validates every `'audio-clip'` cue sheet at build time: each cue second finite, `≥ 0`, `≤ durationSeconds`; `defaultLoopRegion` names exist with `end > start`; a sheet declaring `cues` **or** `defaultLoopRegion` without `durationSeconds` **fails**; malformed sheets fail CI, as does anything the check cannot read — entry, sheet or `cues` — so sheets are authored inline, on an object-literal entry or through `audioClipEntry`.                                                                                        | enforced-by (validate-assets) |
| #126 | The public `AudioHandle` gains no fields; all start-time / offset / phase / schedule context lives on the internal `VoiceRecord`; the handle is never spread-built.                                                                                                                                                                                                                                                                                                                                                                                  | code-verified                 |

### Landing this design (complete)

Landed: `Cue.ts`, `audioCueSheet.ts`, `AssetManager.getManifestMetadata`, the stage-1 gain-ramp primitive, the sim-side cue-sheet types and `audioClipEntry` builder, `PlayOptions.from`/`to`/`loopRegion` with two-tier validation, the `useSound` keys for those three, `PlayOptions.fadeIn` with the `VoiceRecord` phase/intent fields and their atomic `t0` application, `AudioManager.fadeOut` with its timer-free single-release scheduling (#119/#122), `AudioManager.fadeTo` with the mutable voice ceiling its departure bound rests on, and `AudioManager.crossfade`, which writes the last intent slot to have had no production writer — `linkedFadeOut`, a crossfade's linkage held as a thunk so the record owns only _when_ it fires, while the verb owns what it does. All four slots now have one: `releaseOnStart`, `pendingFadeIn`, `pendingFadeTo` and `linkedFadeOut` are written by `fadeOut`, `PlayOptions.fadeIn`, `fadeTo` and `crossfade` respectively. Last of `AudioManager`'s own runtime behaviour, the **voice-preemption ranking** and `MUSIC_PRIORITY` (#123), which also disambiguated the design's one under-specified claim: #123's original term _listing_ admitted two non-equivalent readings of its "equal-or-higher-priority" qualifier, and the invariant now states the tier order and its direction outright (see the [Preemption bullet](#lifecycle)). Last of the renderer surface, the **hooks**: `useSound` now keys the whole of `PlayOptions`, `fadeIn` included — two scalar keys rather than one, since a fade is a duration and a curve and keying only their presence hands back a callback that plays the previous fade. A typed table in the hook's tests names every field, so another cannot be added without a case that reds until it is keyed. The live-handle verbs got `useMusicTrack`, whose control object narrows the manager to them and carries nothing else it holds; it takes no argument and needs no null-handle semantics, since each verb's own handle names the voice. Last of the tooling, the **`validate-assets` cue-sheet gate** (#125) — the design's only mechanical guard, and the one place a cue sheet meets a hard failure rather than a fail-soft degrade. Building it settled a question the design had left open: what to do with a sheet the gate cannot read. It **fails**, which makes inline literals the authoring form. The cost of that answer is that it has to hold at every level and for every unreadable shape at once — a spread and a computed key hide a property equally well, and hiding one at any level hides the sheet below it — so one predicate serves the entry, the sheet and its `cues` alike. Uniformity is what makes it hold: a rule applied one level or one shape short does not merely leave that shape open, it lets two individually-caught defects compose into a pass, since each guard reads the other's hidden member as an absence. Only a readable, non-audio `kind` rules a cue sheet out. It stops at exactly one place: an `entries` element the walker cannot unwrap at all is still skipped, as it always was for `ref` and `kind`, so the gate is stronger than it was rather than total. Building it also exposed that the walker had never seen `audioClipEntry({...})` at all, skipping the sanctioned builder as a call expression; peeling it returns those entries to the ref-existence and manifest-coverage checks that had been quietly passing over them. Last of all, the **feature-review gate** (#923), which closed the three items this list used to carry.

What the gate settled is worth recording, because only one of the three was bookkeeping. The **overview §4.25 line** and the **invariant roll-call** were: #116–#126 moved out of their held-apart design-stage section into the numbered set, taking the roll-call from 115 to 126 — and the enforced-by share DOWN, from 40% to 38%, which is the honest shape of a feature whose rules are runtime automation rather than anything a grep can see. Only #124 and #125 reduce to a standing guard, and `check-invariants` gained fixture cases pinning #124's half of that (the roll-call records which).

**Hook reachability** was the real decision, and this design had recorded neither answer. It took the first: a sixth public barrel, `@chimera-engine/renderer/audio`, exporting `useSound`, `useMusicTrack`, `useAudioManager`, an `AudioManagerProvider`, and the option types — which moved Invariant #96, mechanical check 17, the `no-game-renderer-internals` rule, and `package-exports-contract.test.ts` together. The provider is the part the barrel would have been unusable without: a game may call a hook, but its component tests then have to MOUNT something that satisfies it, and without a provider the only thing that does is the internal context. It is a curated re-export throughout — `audio/AudioManager.js` is still a violation, and the manager class, the ramp primitive and the cue-sheet parser stay behind it.

**Adoption** then stopped being hypothetical. **Tactics** carries two loop-cued ambience beds authored through `audioClipEntry`, with `audio-smoke.spec.ts` decoding both clips through the real `chimera://` protocol and comparing the decoded duration against the `durationSeconds` their sheets author — the one claim `validate-assets` structurally cannot make, since it range-checks each cue against that same authored number. That adoption also gave #125's gate its first production input: no in-repo manifest carried `metadata` before, so the check had been running vacuously.

---

## Spatial Audio

The spatial layer (F84) turns the panner stub into an authored surface: an explicit
listener pose, an authored distance falloff, and moving sources. `panningModel` is
pinned to `'equalpower'` and is not authorable; HRTF, source cones, occlusion, reverb
and doppler are non-goals.

### The listener is not the camera

The engine never derives the listener pose from a camera, and that is the load-bearing
decision rather than an omission: a top-down camera hangs many world units above the
action, so a listener bound to it would put every sound that far away and pan the whole
scene through a near-vertical axis. The pose is always supplied by the game — what the
player is _listening from_ (the focused unit, the board centre, the cursor) as distinct
from what the camera is _looking at from_. There is exactly **one** listener per app,
shared by every canvas; an overlay canvas must not move it. The default pose is the Web
Audio default — origin, forward `-Z`, up `+Y` — so a game that sets nothing keeps
exactly the platform's own behaviour. `setListener` writes a feature-detected
`AudioParam` path (falling back to the deprecated `setPosition`/`setOrientation`),
ramps over a short anti-zipper window unless `{ immediate: true }`, and degrades a
non-finite component to its default component with one warning.

### Distance mapping

`SpatialOptions` maps onto the panner's own vocabulary with no arithmetic of the
engine's own:

| Authored (`SpatialOptions`) | Panner attribute | Default                                                       |
| --------------------------- | ---------------- | ------------------------------------------------------------- |
| `fullVolumeDistance`        | `refDistance`    | `1` (the platform's)                                          |
| `falloffDistance`           | `maxDistance`    | `10000` (the platform's)                                      |
| `falloff`                   | `distanceModel`  | **`'linear'` — the engine's, not the platform's `'inverse'`** |
| `rolloffFactor`             | `rolloffFactor`  | `1` (the platform's)                                          |

**The `'linear'` default deliberately diverges from the Web Audio default of
`'inverse'`.** Only the linear model reaches zero at `maxDistance`; `'inverse'` and
`'exponential'` clamp the _distance_ there and hold a non-zero gain at every distance
beyond it. Shipping the platform default would make `falloffDistance` name a radius
that silences nothing. The other two models stay selectable, asymptotic behaviour and
all.

### The static distance tier

Distances need no decode, so — by the same provenance rule Invariant #117 applies to
cues — an already-invalid spec rejects **synchronously inside `play()`**: an invalid
handle and one warning, before any voice slot is reserved and before any load starts.
Validation runs on the RESOLVED pair, so a bound left to its platform default
participates, and the warning prints the resolved values.

### Edge cases

| Input                                            | Outcome                                                                                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `falloffDistance < fullVolumeDistance`           | Static reject: invalid handle, one warning, no slot reserved                                                                                                                                    |
| `falloffDistance === fullVolumeDistance`         | Authored hard cutoff, realised as the narrowest expressible band via a named power-of-two epsilon — a CUTOFF only under `'linear'`; the asymptotic models hold their clamped gain past the band |
| `fullVolumeDistance: 0`                          | Accepted — attenuation begins at the source                                                                                                                                                     |
| Negative or non-finite distance/rolloffFactor    | Static reject (no dynamic tier to defer to — nothing a decode reveals makes `NaN` a radius)                                                                                                     |
| Non-finite position component in `play()`        | Static reject                                                                                                                                                                                   |
| Non-finite listener/`setVoicePosition` component | Listener: degrades to the default component, one warning. Voice move: dropped whole, one warning — the panner's current position is its own state                                               |
| `setVoicePosition` on a `'loading'` voice        | Parked on the record, applied at `t0`, last write wins (Invariant #121's pending discipline)                                                                                                    |
| `setVoicePosition` on a non-spatial voice        | No-op with one warning — a panner cannot be inserted into a running chain                                                                                                                       |
| `setVoicePosition` on a released handle          | Silent no-op, matching `stop`/`fadeTo`                                                                                                                                                          |

Spatial attenuation is the panner's own gain, sitting between stage 1 and stage 2 of
the voice chain: no spatial code path writes any gain stage, so ducking, bus volume and
every fade behave identically with a panner in the chain (Invariant #116 re-verified,
not amended; the spatial rules are Invariant #134).

---

## Cue Observation & Cue-Aligned Transitions

Two mechanisms, and the split between them is the whole design: **observe to decide,
schedule to execute.**

| Question                                 | Mechanism                        | Clock                                                                  |
| ---------------------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| _Where is this voice now?_               | `observeCues` / `useAudioCues`   | Sampled from `AudioContext.currentTime`, once per frame while observed |
| _How long until it reaches that cue?_    | `secondsUntilCue`                | One read of `AudioContext.currentTime` per call — nothing is scheduled |
| _Make this transition land on that cue._ | `crossfadeAtCue`, `fadeOutAtCue` | Booked against `AudioContext.currentTime`, natively                    |

**Why one is not built out of the other.** A cue emission is a report that the playhead
has **already** crossed the cue: the sampler runs on `requestAnimationFrame`, so the
report is at best a frame late and at worst as late as the frame budget slipped. Starting
a crossfade from an `onCue` handler therefore lands the swap a frame or more past the beat
— exactly the jitter `crossfadeAtCue` exists to remove, and it reappears silently, because
nothing about the code looks wrong. The arming verbs never sample: they resolve the
arrival arithmetically from the voice's own timeline and hand it to `source.start(when)` /
`source.stop(when)`, which are honoured on the sample. Invariant #135 holds the observation
side, #136 the scheduling side.

**So a game uses the callback to DECIDE, never to act on the audio clock.** Moving a
marker, advancing a UI beat counter, choosing which clip to arm next — all fine. What must
not happen is `onCue: () => audio.crossfade(...)`, which is the shape this section exists
to warn about.

**Observation costs nothing when unused.** The sampler is one `requestAnimationFrame`
chain owned by `AudioManager`, started by the first observation and cancelled by the last,
so a game that never observes a cue pays no per-frame cost at all. It is deliberately not
`useFrame`: the audio barrel is not r3f-bound, and cue observation has to work on a menu
screen with no `<Canvas>` mounted. The frame callback declares **no parameter**, so the
`performance.now()` timestamp `requestAnimationFrame` supplies is not even reachable from
it — the only clock a cue can be derived from is the audio one (Invariant #122).

**The handler surface carries no dispatcher.** `CueHandlers` and each event it delivers
name no `SendAction`, `PlayerId`, `EngineAction` or tick, so a handler has nothing to reach
authoritative state with. That is enforcement by absent parameter rather than by review,
the same discipline the clip marks of [§4.40](animation-system.md) use, and it is the reading direction Invariant #63
does not cover — #63 bars the simulation from reaching audio, never the reverse.

### Edge cases

| Input                                                        | Outcome                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crossfadeAtCue`, incoming clip decodes AFTER the cue        | The arrival is read when the buffer is in hand, so the swap takes the NEXT pass rather than an instant already gone. Whether there IS a next pass is the row below's question                                                                                           |
| `crossfadeAtCue`, cue the outgoing voice never reaches again | One warning, then an immediate swap — past `loopEnd`, already gone on a non-looping voice, or beyond that voice's own scheduled end, which is treated as unreachable because nothing would be there to hear it                                                          |
| `crossfadeAtCue`, outgoing handle invalid or still loading   | Immediate swap, silently — a stale handle is an ordinary thing for a caller to hold, and a voice with no timeline yet has no arrival to resolve                                                                                                                         |
| `fadeOutAtCue`, unreachable `atCue`                          | One warning, then the fade runs from `now` — what a bare `fadeOut` would have done. The voice is `'fading-out'` from the call either way                                                                                                                                |
| `fadeOutAtCue`, unreachable cue inside `spec.fade`           | The ramp is skipped and the voice stops, as the same unreachable cue does through `fadeOut({ toCue })`                                                                                                                                                                  |
| `fadeOutAtCue` on a loading voice / invalid handle           | Loading: a release is parked and applied at `t0` (#121). Invalid: silent no-op, matching `stop` and `fadeTo`                                                                                                                                                            |
| Armed, then the caller unmounts before the cue               | Nothing in the engine cancels it: the incoming voice is already scheduled and will start at the cue. The **caller** owns this — a swap hands back only the incoming handle, so a component must keep it and `stop()` it on teardown                                     |
| `observeCues` on a voice still loading                       | Accepted; the scheduler is seated where the voice starts from rather than at zero, so cues behind its entry point are not replayed                                                                                                                                      |
| `observeCues` on an invalid handle                           | A callable no-op unsubscribe; nothing is observed and nothing warns                                                                                                                                                                                                     |
| Whatever ends the voice                                      | One final `end` to every observer, once, however it ended — natural finish, `stop`, preemption, or a sample reaching its scheduled stop. `dispose()` instead cancels the chain and emits none: the graph is going away under the observers, which is not the same event |
| A handler throws                                             | Contained, the event dropped, the voice still observed — the chain re-arms inside its own callback, so an escaping throw would end cue observation for every voice permanently. Reported once per subscription, not once per frame                                      |

**A marker driven from a cue is not a claim about what is audible.** Two reasons, both
worth stating because an adopter will hit them: through a crossfade's window BOTH voices
sound, and because the arrival is resolved at decode, an arm placed close to a wrap can be
booked for the next arrival while the observer settles on the imminent one. `apps/tactics`'
ambience component records both limits at its own use site.

---

## Playback Rate

`PlayOptions.rate` **resamples** the voice, so speed and pitch move together: `2` is an octave up and half the duration, `0.5` an octave down and twice it. The option is spelled `rate` rather than `pitch` exactly so the type promises nothing a phase vocoder would be needed for — there is no time-stretch here and no independent pitch shift. `rateFromSemitones(n)` is the musical spelling of the same number (`2 ** (n / 12)`), exported from `@chimera-engine/renderer/audio` so a game authors intervals rather than ratios. It is pure, total, and deliberately **not** a normaliser: normalising the interval there would turn a bad one into a playable rate the manager then has no reason to warn about at all.

**The rate is immutable for the life of the voice.** It is normalised once at `play()`, written to the `VoiceRecord`, and no verb rewrites it — there is no `setVoiceRate`. That immutability is the precondition Invariant #122 rests on rather than a rule of its own: at a constant rate every buffer-seconds-to-wall-clock quantity is a single division, while a rate that could move mid-flight would make the same quantity an integral of rate over time, and the cached anchors on the record would no longer determine when the playhead reaches anything. Both directions are named functions in `voicePlayhead.ts` — `bufferSecondsToContextSeconds` and `contextSecondsToBufferSeconds` — rather than an inline `/ rate`, because applying the wrong one is a **squared** error that reads like an ordinary arithmetic slip.

**Which quantities the rate moves, and which it must not.** Anything read off the BUFFER converts through the rate: the `to` window, a non-looping voice's implicit end, the arrival of a cue (`secondsUntilCue`, `fadeOut{toCue}`, the arming verbs), and the playhead the cue sampler reports. Anything authored in WALL CLOCK is already on the context axis and is never divided: `fadeIn.durationMs`, `fadeOut{overMs}`, `fadeTo`'s window and a crossfade's duration. Mixing the two axes is the defect this feature most plausibly introduces, which is why the wall-clock half is asserted on its own: a fade authored in milliseconds keeps its length whatever the rate is.

**The write happens once, at the voice's real `t0`.** `startVoice` calls `source.playbackRate.setValueAtTime(record.rate, startedAt)` — the same instant the gain floor is written, never `now` — and only when the rate differs from `1`. `AudioBufferSourceNode.playbackRate` already holds `1`, so a voice at the default rate makes the exact call sequence it made before the option existed rather than an equivalent one.

**A rate-shifted bounded play is bounded by `source.stop`, not by `start()`'s third argument.** That argument is buffer-relative, and nothing in the Web Audio spec settles whether a resampled voice's duration is counted before or after the resample. The looping branch already refuses to rely on the analogous meaning, so a rate-shifted voice is the second case with no portable reading: it is bounded by `source.stop(startedAtContextTime + durationSec / rate)`, an absolute context time that means one thing everywhere. The native `onended` still fires, so this rides the single release path of Invariant #119 — the same one path a fade-out uses — and the handle still invalidates exactly once. The unit suite runs against a Web Audio double that **cannot observe** the ambiguity at all, so the rule is held by the code shape and by a test asserting that a rate-shifted bounded play passes no third argument, never by an assertion about a duration the double would satisfy either way.

**Normalisation warns, and falls back to the default rather than to an extreme.** A non-positive or non-finite rate plays at `1` with one warning naming the value: `0` parks the playhead forever, a negative rate asks for a reversal nothing on this path models, and `Infinity` is not a speed, so no extreme is a sane reading of the intent. Unlike `normalizePriority`, which is silent, this one speaks — an out-of-range priority still plays the voice and only reorders preemption, while a bad rate is the difference between a clip the caller pitched and one that never advances. It is resolved **after** every synchronous branch that declines the play (disposed manager, static cue rejection, rejected spatial spec, saturated pool), so a refusal is never narrated as a complaint about a rate that was never going to be used.

**The engine supplies no per-play jitter.** Randomising a rate is the game's to author, from the game's own seeded stream — `apps/tactics` draws a per-turn interval band and converts it with `rateFromSemitones` at its call site — so nothing non-deterministic enters engine code and a replay stays the game's to reproduce.

### Edge cases

| Input / situation                                                 | Defined behaviour                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rate` non-positive or non-finite (`0`, `-1`, `NaN`, `±Infinity`) | Plays at `1` with one warning naming the value. Never a nearest-legal clamp — the default is the only rate the rest of the manager is already correct for.                                                                                 |
| `rate` omitted, or given explicitly as `1`                        | Nothing is written to `playbackRate` at all, and a bounded non-looping play still rides `start()`'s duration argument — the rate-1 call sequence is unchanged, not merely equivalent.                                                      |
| `rate` on a play a synchronous branch already declined            | No rate warning: the normalisation sits below those branches, so a saturated pool or a rejected cue window reports itself rather than the rate.                                                                                            |
| Bounded (`to`) non-looping play at any rate other than `1`        | Realised by `source.stop(startedAtContextTime + durationSec / rate)` with no third argument to `start()`, because that argument's reading under a resample is not portable. `onended` still drives the single release (#119).              |
| That scheduled stop refused by the platform                       | Non-looping: the bound drops onto the clip's natural end, `startedAtContextTime + (duration − offset) / rate`, and warns. Looping: there is no fallback end, so `scheduledStopAt` stays `null` and the warning says the bound was dropped. |
| Fade windows on a rate-shifted voice                              | Unchanged. `fadeIn.durationMs`, `fadeOut{overMs}`, `fadeTo` and a crossfade's duration are wall-clock milliseconds and are never divided by the rate.                                                                                      |
| A cue on a rate-shifted voice                                     | Reached in `1 / r` of the wall clock a rate-1 voice would take, entry pass and loop period alike — one division, because the rate cannot move (#122).                                                                                      |
| A live rate change mid-voice                                      | Not offered. The rate is resolved once, inside `play()`, and never rewritten; every timeline anchor on the record assumes it constant.                                                                                                     |

---

## Invariants

The engine-wide rules this section is governed by — **#63** (the simulation never
produces audio) and **#64** (`AudioManager` lifecycle ownership) — the
cue/fade/crossfade rules **#116–#126**, the spatial rule **#134**, and the cue-observation
and cue-scheduling rules **#135** and **#136** live in
[`architecture-invariants.md`](../executive-architecture/architecture-invariants.md).

---

## Cross-References

- [Settings System](settings-system.md) — `EngineSettings.audio.*` bus volumes
- [Asset Reference System](asset-reference-system.md) — `AssetRef<AudioClipAsset>` resolution
- [Renderer State Stores](renderer-state-stores.md) — `gameStore.events` observed by `<EventAudioPlayer>`
- [Renderer Contexts](gameshell-ui-design-system.md#434-renderer-contexts--core-service-injection) — `AudioManagerContext` / `useAudioManager()`, the sole source for `useSound` and `useMusicTrack`
