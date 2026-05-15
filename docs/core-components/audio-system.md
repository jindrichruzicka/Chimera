---
title: 'Audio System'
description: 'AudioManager interface, AudioBusId (master/music/sfx/voice), PlayOptions, EventAudioBinding, settings integration, 32-voice pool, lifecycle ownership, and audio invariants.'
tags: [audio, sound, renderer, event-driven, bus]
---

# Audio System

> §4.25 of the Chimera architecture.
> Related: [Settings System](settings-system.md) · [Asset Reference System](asset-reference-system.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Overview

Renderer-only audio playback for music, sound effects, and voice cues. Zero coupling to the simulation — game reducers emit `GameEvent`s; the renderer's `EventAudioBinding` maps event types to `AssetRef<AudioAsset>` and plays them through `AudioManager`.

---

## Layered Architecture

```
GameEvent[] in PlayerSnapshot   ← simulation emits; renderer observes
         │
         ▼
[EventAudioBinding]             ← pure config: eventType → AssetRef<AudioAsset>
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
    play(ref: AssetRef<AudioAsset>, opts?: PlayOptions): AudioHandle;
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
        ref: AssetRef<AudioAsset>;
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

`AudioManager` is constructed once per app launch by `renderer/app/providers.tsx` and exposed via `AudioManagerContext`. `GameShell.tsx` is the **sole designated owner** of session lifecycle: it calls `AudioManager.stopAll()` on match end and `AudioManager.dispose()` on engine shutdown.

---

## Invariants

| #   | Rule                                                                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #63 | The simulation never produces audio. No reducer, validator, or `ActionDefinition` may import from `renderer/audio/`.                                                        |
| #64 | `AudioManager.dispose()` is called unconditionally at game session end. `GameShell` is the unique owner of `dispose()`. Active `AudioHandle`s become invalid after dispose. |

---

## Cross-References

- [Settings System](settings-system.md) — `EngineSettings.audio.*` bus volumes
- [Asset Reference System](asset-reference-system.md) — `AssetRef<AudioClipAsset>` resolution
- [Renderer State Stores](renderer-state-stores.md) — `gameStore.events` observed by `<EventAudioPlayer>`
- [Renderer Contexts](gameshell-ui-design-system.md#renderer-contexts) — `AudioManagerContext` / `useAudioManager()`
