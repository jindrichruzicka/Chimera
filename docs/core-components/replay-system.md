---
title: 'Replay System'
description: 'ReplayFile schema (formatVersion/seed/actions/metadata), RecordedAction, ReplayPlayer (initialize/step/seek/play), ReplayManager (startRecording/recordAction/finaliseRecording), ReplayAPI IPC, cross-version compatibility via ReplayMigrator, and the coexisting privacy-preserving PerspectiveReplayFile (kind: perspective; projected, fog-safe PlayerSnapshot frames for one locked viewerId).'
tags: [replay, determinism, action-history, export, ipc, perspective-replay, fog-of-war]
---

# Replay System

> §4.28 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Save / Load Persistence](save-load-persistence.md) · [Electron Shell](electron-shell-ipc-bridge.md)

---

## Overview

Given `seed + ActionHistory`, a Chimera simulation replays bit-identically (invariants #42–44). Replays are a thin packaging + playback layer on top of existing determinism guarantees — marginal cost is low, value (bug reports, post-game review, highlights) is high.

Two replay artifacts coexist on disk, discriminated by a `kind` field. The **deterministic match replay** (`ReplayFile`, no `kind`) is host-internal: it stores `seed` + `gameConfig` + full `EngineAction` payloads and re-runs the simulation through `ActionPipeline` (Invariant #71). The **perspective replay** (`PerspectiveReplayFile`, `kind: 'perspective'`) is privacy-preserving: it stores only already-projected `PlayerSnapshot` frames for a single locked viewer and is never re-simulated (Invariant #98). See [Perspective Replay](#perspective-replay-perspectivereplayfile) below.

---

## ReplayFile Schema

```typescript
// simulation/replay/ReplayFile.ts

export interface ReplayFile {
    readonly formatVersion: 1;
    readonly engineVersion: string; // app.getVersion()
    readonly gameId: string;
    readonly gameVersion: string; // from games/<name>/package.json
    readonly gameConfig: Readonly<Record<string, unknown>>;
    readonly seed: number;
    readonly actions: ReadonlyArray<RecordedAction>;
    readonly metadata: {
        readonly recordedAt: string; // ISO-8601
        readonly durationTicks: number;
        readonly players: ReadonlyArray<{ playerId: PlayerId; displayName: string }>;
    };
}

export interface RecordedAction {
    readonly tick: number;
    readonly playerId: PlayerId;
    readonly action: EngineAction;
}
```

Stored as JSON (or gzip via `CompressedReplaySerializer`). Extension: `.chimera-replay`. Location: `userData/replays/<game-id>/`.

---

## ReplayPlayer

```typescript
// simulation/replay/ReplayPlayer.ts

export class ReplayPlayer {
    constructor(
        private readonly file: ReplayFile,
        private readonly pipeline: ActionPipeline, // same instance as live play
        private readonly initialSnapshotFactory: ReplayInitialSnapshotFactory<GameSnapshot>,
    ) {}

    initialize(): GameSnapshot; // seed + gameConfig → initial state
    step(): GameSnapshot; // apply next recorded action
    seek(tick: number): GameSnapshot; // fast-forward or jump
    play(speedMultiplier: number, onFrame: (s: GameSnapshot, stop: StopFn) => void): StopFn;
    playSync(): GameSnapshot; // deterministic batch playback for tests/tools
}
```

Replay playback reuses the **exact same `ActionPipeline`** as a live match — no separate replay reducer codepath. A divergence is a determinism bug, not an acceptable simplification. `ActionRegistry` remains encapsulated by the injected live pipeline.

The `initialSnapshotFactory` reconstructs the concrete game snapshot type from `seed + gameConfig`. The engine provides `createBaseReplayInitialSnapshot()` for base fields; games compose on top of it to add required game-specific fields without unsafe casts. The simulation-layer `play()` API invokes `onFrame` for each produced snapshot and passes a stop handle that can end playback before the next action while preserving pure, tick-driven replay; UI timing/scheduling lives outside `simulation/`.

---

## ReplayManager

```typescript
// electron/main/replay-manager.ts

export class ReplayManager {
    constructor(
        private readonly logger: Logger,
        private readonly history: ActionHistory,
        private readonly baseDir: string, // userData/replays/
    ) {}

    startRecording(
        gameId: string,
        seed: number,
        gameConfig: Readonly<Record<string, unknown>>,
    ): void;
    recordAction(playerId: PlayerId, action: EngineAction, tick: number): void;
    finaliseRecording(): Promise<string>; // atomic write; returns file path
    load(path: string): Promise<ReplayFile>;
    list(gameId: string): Promise<ReadonlyArray<ReplayMeta>>;
}
```

---

## ReplayAPI IPC

```typescript
interface ReplayAPI {
    list(gameId: string): Promise<ReadonlyArray<ReplayMeta>>;
    exportCurrentMatch(): Promise<string>; // Returns file path
    openInPlayer(path: string): Promise<void>;
    delete(path: string): Promise<void>;
}
```

---

## Perspective Replay (`PerspectiveReplayFile`)

The **perspective replay** is the privacy-preserving counterpart to the deterministic `ReplayFile`. Instead of re-running `{ seed, gameConfig, actions }` through the live pipeline, it stores a sequence of already-projected `PlayerSnapshot` frames for a single, **locked** `viewerId`. It therefore carries only what one player legitimately saw — no host-internal `seed`, `gameConfig`, or `actions` — and is never re-simulated: playback simply walks `frames` in order. Because the snapshots are post-projection (fog of war applied at record time), a perspective replay is information-safe to share (see [State Obfuscation & Fog of War](../security-trust/fog-of-war-cryptographic-commitment.md)).

The `kind: 'perspective'` literal discriminates this file from the deterministic `ReplayFile` (which has no `kind`); both kinds coexist on disk under `userData/replays/<game-id>/`.

```typescript
// simulation/replay/PerspectiveReplayFile.ts

export interface PerspectiveReplayHeader {
    readonly formatVersion: 1;
    readonly kind: 'perspective';
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
    /** The single, immutable viewer whose projection this replay captures. */
    readonly viewerId: PlayerId;
    readonly recordedAt: string; // ISO-8601 UTC, captured at recording start
    readonly durationTicks: number;
    readonly players: ReadonlyArray<ReplayPlayerMetadata>;
}

export interface PerspectiveReplayFrame {
    readonly tick: number;
    readonly snapshot: PlayerSnapshot; // already projected for `viewerId`
}

export interface PerspectiveReplayFile extends PerspectiveReplayHeader {
    readonly frames: ReadonlyArray<PerspectiveReplayFrame>;
}
```

`parsePerspectiveReplayFile()` is pure (zero I/O, no `Date.now()`) and rejects a file as **malformed** when (Invariant #98):

- `viewerId` or `frames` is missing;
- any `frame.snapshot.viewerId` differs from the file's locked `viewerId`;
- any `frame.tick` disagrees with its embedded `frame.snapshot.tick`;
- frame ticks are not strictly increasing (playback walks `frames` in order, so duplicate or out-of-order ticks are rejected).

`viewerId` is locked and immutable for the lifetime of the file; every frame must be projected for that exact viewer.

---

## Cross-Version Compatibility

Replays are tied to the `(engineVersion, gameId, gameVersion)` triple at record time. `ReplayManager.load()` refuses to play a replay whose versions differ unless a `ReplayMigrator` is supplied — same pattern as `SaveMigrator` (§4.11). For 1.0.0 no migration is provided; replays from previous engine versions must be played on an archived build.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #70 | `ReplayPlayer` uses the same `ActionPipeline` instance as live play. Any "replay-only" shortcut codepath is forbidden — a replay divergence is a determinism bug. Governs **deterministic playback only**; perspective replays (#98) are never re-simulated, so this rule does not apply to them.                                                                                                                                                                                              |
| #71 | Deterministic replay files (`ReplayFile`, no `kind`) contain full `EngineAction` payloads — never projected `PlayerSnapshot`s. Playback starts from seed + gameConfig. A replay file without `seed` or `actions` is malformed and rejected at load.                                                                                                                                                                                                                                            |
| #98 | A _perspective_ replay (`PerspectiveReplayFile`, `kind: 'perspective'`) carries only projected `PlayerSnapshot` frames for a single locked, immutable `viewerId` — no `seed`/`gameConfig`/`actions`. Malformed (rejected at parse) if `viewerId`/`frames` is missing, if any `frame.snapshot.viewerId` differs from the locked `viewerId`, if any `frame.tick` disagrees with its `frame.snapshot.tick`, or if frame ticks are not strictly increasing. Both kinds coexist on disk (ADR F44b). |

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ActionPipeline`, determinism invariants #42–44
- [Save / Load Persistence](save-load-persistence.md) — `SaveMigrator` pattern mirrored in `ReplayMigrator`
- [Electron Shell](electron-shell-ipc-bridge.md) — `ReplayAPI` IPC namespace
- [State Obfuscation & Fog of War](../security-trust/fog-of-war-cryptographic-commitment.md) — why `PerspectiveReplayFile` frames are post-projection and information-safe
