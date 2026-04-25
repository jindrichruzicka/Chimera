---
title: 'Replay System'
description: 'ReplayFile schema (formatVersion/seed/actions/metadata), RecordedAction, ReplayPlayer (initialize/step/seek/play), ReplayManager (startRecording/recordAction/finaliseRecording), ReplayAPI IPC, and cross-version compatibility via ReplayMigrator.'
tags: [replay, determinism, action-history, export, ipc]
---

# Replay System

> §4.28 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Save / Load Persistence](save-load-persistence.md) · [Electron Shell](electron-shell-ipc-bridge.md)

---

## Overview

Given `seed + ActionHistory`, a Chimera simulation replays bit-identically (invariants #42–44). Replays are a thin packaging + playback layer on top of existing determinism guarantees — marginal cost is low, value (bug reports, post-match review, highlights) is high.

---

## ReplayFile Schema

```typescript
// simulation/replay/ReplayFile.ts

export interface ReplayFile {
    readonly formatVersion: 1;
    readonly engineVersion: string; // app.getVersion()
    readonly gameId: string;
    readonly gameVersion: string; // from games/<name>/package.json
    readonly matchConfig: Readonly<Record<string, unknown>>;
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
        private readonly registry: ActionRegistry,
    ) {}

    initialize(): GameSnapshot; // seed + matchConfig → initial state
    step(): GameSnapshot; // apply next recorded action
    seek(tick: number): GameSnapshot; // fast-forward or jump
    play(speedMultiplier: number, onFrame: (s: GameSnapshot) => void): StopFn;
}
```

Replay playback reuses the **exact same `ActionPipeline`** as a live match — no separate replay reducer codepath. A divergence is a determinism bug, not an acceptable simplification.

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
        matchConfig: Readonly<Record<string, unknown>>,
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

## Cross-Version Compatibility

Replays are tied to the `(engineVersion, gameId, gameVersion)` triple at record time. `ReplayManager.load()` refuses to play a replay whose versions differ unless a `ReplayMigrator` is supplied — same pattern as `SaveMigrator` (§4.11). For 1.0.0 no migration is provided; replays from previous engine versions must be played on an archived build.

---

## Invariants

| #   | Rule                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #70 | `ReplayPlayer` uses the same `ActionPipeline` instance as live play. Any "replay-only" shortcut codepath is forbidden — a replay divergence is a determinism bug.                                            |
| #71 | Replay files contain full `EngineAction` payloads — never projected `PlayerSnapshot`s. Playback starts from seed + matchConfig. A replay file without `seed` or `actions` is malformed and rejected at load. |

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ActionPipeline`, determinism invariants #42–44
- [Save / Load Persistence](save-load-persistence.md) — `SaveMigrator` pattern mirrored in `ReplayMigrator`
- [Electron Shell](electron-shell-ipc-bridge.md) — `ReplayAPI` IPC namespace
