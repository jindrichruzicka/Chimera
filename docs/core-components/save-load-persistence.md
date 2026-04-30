---
title: 'Save / Load Persistence'
description: 'SaveFile schema, SaveSerializer strategies (JSON/Compressed), SaveRepository interface, FileSaveRepository atomic write, SaveMigrator chain, crash recovery, multiplayer save constraints, and saveStore.'
tags: [save-load, persistence, memento, repository, migration, crash-recovery]
---

# Save / Load Persistence

> §4.11 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Electron Shell](electron-shell-ipc-bridge.md) · [Renderer State Stores](renderer-state-stores.md)

---

## Four Design Patterns

| Pattern                                 | Role                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Memento**                             | `SaveFile` captures `GameSnapshot` + `ActionHistory` delta into a named, versioned envelope |
| **Repository**                          | `SaveRepository` interface + `FileSaveRepository` isolates all filesystem I/O               |
| **Strategy**                            | `SaveSerializer` interface with JSON and Compressed implementations                         |
| **Chain of Responsibility (Migration)** | `SaveMigrator` upgrades old saves forward; never rejects them outright                      |

---

## SaveFile Schema

```typescript
// simulation/persistence/SaveFile.ts

interface SaveFileHeader {
    readonly schemaVersion: number; // Incremented on every breaking change
    readonly engineVersion: string; // Chimera semver
    readonly gameId: string;
    readonly gameVersion: string;
    readonly slotId: string; // plain string in simulation/; toSlotId() converts at SavesIpcAdapter boundary
    readonly savedAt: number; // Unix ms timestamp
    readonly turnNumber: number;
    readonly playerNames: string[];
    readonly thumbnailDataUrl?: string; // Base64 PNG (optional)
}

interface SaveFile {
    readonly header: SaveFileHeader;
    readonly checkpoint: GameSnapshot; // Full snapshot at save time — O(1) restore
    readonly deltaActions: readonly EngineAction[]; // Empty at normal END_TURN saves
    readonly pendingCommitments: Record<CommitmentId, CommitmentEnvelope>; // Anti-cheat continuity
}
```

> **Invariant #26** — `SaveFile.pendingCommitments` must be restored into `CommitmentScheme` on load.

---

## SaveSerializer — Strategy Pattern

```typescript
export interface SaveSerializer {
    serialize(file: SaveFile): string | Buffer;
    deserialize(raw: string | Buffer): SaveFile;
}

// Default: pretty JSON (human-readable, debuggable)
export class JsonSaveSerializer implements SaveSerializer {
    serialize(file: SaveFile): string {
        return JSON.stringify(file, null, 2);
    }
    deserialize(raw: string | Buffer): SaveFile {
        return JSON.parse(raw.toString()) as SaveFile;
    }
}

// Gzip wrapper — for large-state games
export class CompressedSaveSerializer implements SaveSerializer {
    private readonly inner = new JsonSaveSerializer();
    serialize(file: SaveFile): Buffer {
        return gzipSync(Buffer.from(this.inner.serialize(file)));
    }
    deserialize(raw: Buffer): SaveFile {
        return this.inner.deserialize(gunzipSync(raw).toString());
    }
}
```

---

## SaveRepository — Repository Pattern

```typescript
export interface SaveSlotMeta {
    readonly slotId: string; // plain string in simulation/; toSlotId() converts at SavesIpcAdapter boundary
    readonly gameId: string;
    readonly savedAt: number;
    readonly turnNumber: number;
    readonly playerNames: string[];
    readonly thumbnailDataUrl?: string;
    readonly schemaVersion: number;
    readonly sizeBytes: number;
}

export interface SaveRepository {
    list(gameId: string): Promise<SaveSlotMeta[]>;
    load(slotId: string): Promise<SaveFile>; // throws SaveNotFoundError; auto-migrates
    save(file: SaveFile): Promise<void>; // atomic: .tmp rename
    delete(slotId: string): Promise<void>; // throws SaveNotFoundError
    has(slotId: string): Promise<boolean>;
}
```

### FileSaveRepository

Stores files at `userData/saves/<gameId>/<slotId>.chimera`. All writes use a `.tmp` file + atomic rename to prevent corruption on crash.

> **Invariant #23** — `FileSaveRepository.save()` always writes to a `.tmp` file and renames atomically.
> **Invariant #24** — `SimulationHost.restoreFromSave()` is the only entry point for replacing live `GameSnapshot` from a file.
> **Invariant #25** — `engine:save` and `engine:load` are validated `EngineAction` types — only the designated host player may dispatch them.

---

## SaveMigrator — Chain of Responsibility

```typescript
export const CURRENT_SCHEMA_VERSION = 1;

export interface SaveMigration {
    readonly fromVersion: number;
    apply(file: SaveFile): SaveFile;
}

export class SaveMigrator {
    register(migration: SaveMigration): void {
        /* sorted by fromVersion */
    }
    // Upgrades file step-by-step; throws SaveSchemaTooNewError if file > current
    migrate(file: SaveFile): SaveFile {
        /* chain application */
    }
}
```

---

## Save / Load Flows

```
─── SAVE ──────────────────────────────────────────────────────────────────
[Renderer] window.__chimera.saves.save({ slotId: 'slot-1' })
  → IPC → [SaveManager]
  1. Read GameSnapshot + ActionHistory from simulation-host
  2. Build SaveFile { header, checkpoint, deltaActions, pendingCommitments }
  3. SaveRepository.save(file)   ← atomic .tmp rename
  4. Broadcast updated SaveSlotMeta[] → renderer

─── AUTO-SAVE ─────────────────────────────────────────────────────────────
[ActionPipeline step 6: engine:end_turn detected]
  → simulation-host calls save-manager.autoSave()
  → slotId = '<gameId>/autosave'

─── LOAD ──────────────────────────────────────────────────────────────────
[Renderer] window.__chimera.saves.load('tactics/slot-1')
  → IPC → [SaveManager]
  1. SaveRepository.load(slotId)   ← auto-migrates if needed
  2. Validate header (gameId, gameVersion compatibility)
  3. simulation-host.restoreFromSave(file)
       a. Stop tick loop
       b. Replace GameSnapshot with file.checkpoint
       c. Replay deltaActions onto checkpoint (if non-empty)
       d. Restore pendingCommitments into CommitmentScheme
       e. Restart tick loop
  4. Broadcast fresh PlayerSnapshot to all clients (standard reconnect path)
  5. Renderer navigates to match screen
```

---

## Crash Recovery

On startup, `save-manager.ts` checks for `lastCleanExit.flag` in `userData`. If absent (crash) and an `autosave` exists, the renderer is offered "Resume last session". The flag is written on clean `app.before-quit`.

---

## Multiplayer Save Constraints

| Scenario                        | Behaviour                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| Host saves mid-match            | `engine:save` dispatched; clients receive `SAVE_NOTIFY` (informational) |
| Client requests save            | Rejected by `validate()` — clients cannot trigger `engine:save`         |
| Load during active session      | Blocked; `engine:load` only valid in `PREGAME` or `ENDED` lobby state   |
| Rejoin after host loaded a save | Host broadcasts fresh full `PlayerSnapshot`; standard reconnect path    |

---

## Repository Implementations

| Implementation             | Storage                   | Use case              |
| -------------------------- | ------------------------- | --------------------- |
| `FileSaveRepository`       | `userData/saves/` on disk | Default — local saves |
| `InMemorySaveRepository`   | In-process `Map`          | Tests + E2E fixtures  |
| `SteamCloudSaveRepository` | Steam Remote Storage      | Future placeholder    |

> **Invariant #37** — `SaveManager` is constructed with an injected `SaveRepository`. No code inside `save-manager.ts` imports `FileSaveRepository` by name.
> **Invariant #41** — `InMemorySaveRepository` must pass the identical contract test suite as `FileSaveRepository`.

---

## Error Types

```typescript
class SaveNotFoundError extends Error {
    constructor(public readonly slotId: string) {
        super(`Save slot '${slotId}' not found`);
    }
}

class SaveSchemaTooNewError extends Error {
    constructor(
        public readonly fileVersion: number,
        public readonly engineVersion: number,
    ) {
        super(`Save file schema v${fileVersion} is newer than engine v${engineVersion}`);
    }
}
```

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `GameSnapshot`, `ActionHistory`, `TurnMemento`
- [Electron Shell](electron-shell-ipc-bridge.md) — `SavesAPI` IPC namespace
- [Renderer State Stores](renderer-state-stores.md) — `saveStore` (`SaveSlotMeta[]` mirror)
- [Replay System](replay-system.md) — `ReplayFile` shares the same `ActionHistory` concept
