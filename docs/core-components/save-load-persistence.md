---
title: 'Save / Load Persistence'
description: 'SaveFile schema (v6: session manifest + matchId), SaveSerializer strategies (JSON/Compressed), SaveRepository interface, FileSaveRepository atomic write, SaveMigrator chain, SessionRestoreCoordinator menu-load restore, multiplayer save constraints, and saveStore.'
tags: [save-load, persistence, memento, repository, migration, restore]
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
    readonly playerNames: readonly string[];
    readonly thumbnailDataUrl?: string; // Base64 PNG (optional)
    readonly checksum?: string; // SHA-256 of the body {checkpoint, deltaActions, pendingCommitments}; verified on load
}

interface SaveSeat {
    readonly playerId: PlayerId; // raw id exactly as in checkpoint.players
    readonly control: 'host' | 'local' | 'remote' | 'ai';
    readonly slotIndex: number;
    readonly omniscient?: boolean; // AI-only
}

interface SaveSessionManifest {
    readonly matchId: string; // stable match identity, mirrors checkpoint.matchId
    readonly maxPlayers: number; // lobby capacity (migrated backfills record a floor)
    readonly seats: readonly SaveSeat[];
}

interface SaveFile {
    readonly header: SaveFileHeader;
    readonly checkpoint: BaseGameSnapshot; // Full snapshot at save time — O(1) restore
    readonly deltaActions: readonly EngineAction[]; // Empty at normal END_TURN saves
    readonly pendingCommitments: Record<CommitmentId, CommitmentEnvelope>; // Anti-cheat continuity
    readonly stagedReveals: StagedReveals; // {value, nonce} per pending envelope — moves as a unit with pendingCommitments
    readonly session: SaveSessionManifest; // F68 #820 — session composition for restore
}
```

> **Invariant #26** — `SaveFile.pendingCommitments` must be restored into `CommitmentScheme` on load, together with `stagedReveals` — the two move as a unit, so a save taken mid-commit can still reveal after load.
> **Invariant #108** — `SaveFile.session` is session-composition metadata: never projected, never read by reducers, never sent over IPC as an object (the slim, schema-validated restore-status projection is the one sanctioned derived surface). Clients learn the `matchId` only via their projected snapshots.

---

## SaveSerializer — Strategy Pattern

Both methods are **async** so implementations can use non-blocking transforms
(e.g. async gzip); synchronous implementations return a resolved Promise.
`deserialize` validates the parsed value against the save-file Zod schema —
legacy-optional fields (`stagedReveals`, `session`) parse as absent and are
backfilled by the migrator.

```typescript
export interface SaveSerializer {
    serialize(file: SaveFile): Promise<string | Buffer>;
    deserialize(raw: string | Buffer): Promise<SaveFile>;
}

// Default: pretty JSON (human-readable, debuggable)
export class JsonSaveSerializer implements SaveSerializer { ... }

// Gzip wrapper — for large-state games
export class CompressedSaveSerializer implements SaveSerializer { ... }
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
> **Invariant #24** — `SessionRuntime.applyRestoredFile()` is the only entry point for replacing the live `GameSnapshot` from a file. The two-step load flow is (1) `SaveManager.restoreFromSave(slotId)` reads and migrates the file, then (2) `SessionRuntime.applyRestoredFile(file)` replaces the live snapshot. Its two callers — the in-session same-match load branch and the `SessionRestoreCoordinator` menu-restore flow — both funnel through the composition root's single apply helper.
> **Invariant #25** — `engine:save` and `engine:load` are validated `EngineAction` types — only the designated host player may dispatch them.

---

## SaveMigrator — Chain of Responsibility

```typescript
export const CURRENT_SCHEMA_VERSION = 6;

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

`createDefaultMigrator()` returns a migrator with every built-in migration
pre-registered — use it everywhere (wiring point and tests) instead of
registering migrations by hand. The shipped chain:

| Step  | Migration                       | Backfills                                                                                                                                      |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| v1→v2 | `checkpointTurnNumberMigration` | `checkpoint.turnNumber: 0`                                                                                                                     |
| v2→v3 | `checkpointTimersMigration`     | `checkpoint.timers: {}` (Invariant #54)                                                                                                        |
| v3→v4 | `checkpointGameResultMigration` | `checkpoint.gameResult: null` (§4.38)                                                                                                          |
| v4→v5 | `stagedRevealsMigration`        | top-level `stagedReveals: {}` (F54, Invariant #26)                                                                                             |
| v5→v6 | `sessionManifestMigration`      | top-level `session` via `deriveSessionManifest(checkpoint)` — control kinds from id heuristics, `maxPlayers` = seat-count floor, fresh matchId |

---

## Save / Load Flows

```
─── SAVE ──────────────────────────────────────────────────────────────────
[Renderer] window.__chimera.saves.save({ slotId: 'slot-1' })
  → IPC → [SavesIpcAdapter]
  1. activeSession.captureSaveFile(request)   ← SessionRuntime stamps the
     header (CURRENT_SCHEMA_VERSION, engine/game versions), captures
     checkpoint + pendingCommitments + stagedReveals, and records the live
     session manifest (matchId, maxPlayers, per-seat control kinds)
  2. SaveManager.save(file) → SaveRepository.save(file)   ← atomic .tmp rename
  3. Push refreshed SaveSlotMeta[] → renderer (chimera:saves:slot-update)

─── AUTO-SAVE ─────────────────────────────────────────────────────────────
[HostSessionPipeline: engine:end_turn accepted]
  → fire-and-forget savePort.autoSave(gameId, snapshot)
  → SaveManager.autoSave forces slotId = 'autosave'

─── LOAD (in-session, same match) ─────────────────────────────────────────
[Renderer] window.__chimera.saves.load('<game>/slot-1')
  → IPC → [SavesIpcAdapter.restoreSession]
  1. SaveManager.restoreFromSave(slotId)   ← reads + auto-migrates to v6
  2. Guard: file.header.gameId matches the hosted game AND
     file.session.matchId === the active session's matchId
     (a different match rejects renderer-friendly: return to the menu first)
  3. applyRestoredFileToActiveSession(file)   ← the ONE Invariant #24 helper:
       a. SessionRuntime.applyRestoredFile(file)
          — replace live snapshot with file.checkpoint
          — restore pendingCommitments + stagedReveals as a unit (Inv #26)
       b. currentMatchId = file.session.matchId
       c. Re-project the restored snapshot to the host renderer

─── LOAD (menu, no active session) — SessionRestoreCoordinator (F68 #823) ─
[Renderer] window.__chimera.saves.load('<game>/slot-1') from the main menu
  → IPC → [SavesIpcAdapter.restoreSession] → coordinator.restoreSession(file)
  1. sanitizeRestoreManifest(file.session)   ← rejects corrupt manifests;
     pins maxPlayers to the seat count; exactly one host seat
  2. hostLobby({ maxPlayers, restore: { matchId, hostPlayerId, humanSeats } })
     — the provider seeds restored seats for join-time reclaim (#821) and the
       composition root raises the start-suppression gate so tryStartGame
       cannot fire on the pre-restore lobby snapshot
  3. applyRestoredFile(file)                 ← same Invariant #24 helper
  4. seatRestoredRoster(file.session.seats)  ← registers agents at their SAVED
     slot indexes over the restored checkpoint; host/local/AI seats activate,
     missing remote seats keep the start gate closed; releases the gate
  5. All-local roster → coordinator status 'complete' (game starts
     immediately at the saved tick). Remote seats outstanding → coordinator
     status 'waiting-for-players' { lobbyCode, missingSeats } — projected by
     toRestoreStatusEvent onto the slim wire event
     { state: 'waiting', lobbyCode, pendingSeats } and pushed to the renderer
     over chimera:saves:restore-status (#826); 'complete' projects to 'ready'
  6. Returning clients rejoin with their remembered {matchId, playerId}
     JOIN claims (SessionTicketStore, #822); claimless joins fill open
     restored seats in slot order. The LAST reclaimed human seat opens the
     tryStartGame gate → onGameStart fires over the restored snapshot and
     reconnecting peers are re-synced with a fresh PlayerSnapshot
  7. chimera:saves:cancel-restore (#826) aborts a pending restore: the lobby
     is fully unwound; the coordinator status flips to 'aborted', pushed to
     the renderer as the 'cancelled' wire event
```

---

## Multiplayer Save Constraints

| Scenario                          | Behaviour                                                                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host saves mid-match              | `engine:save` dispatched; clients receive `SAVE_NOTIFY` (informational)                                                                                                |
| Client requests save              | Rejected by `validate()` — clients cannot trigger `engine:save`                                                                                                        |
| Load during active session        | Same-match saves (`file.session.matchId === currentMatchId`) live-apply via the Invariant #24 helper; a different match rejects renderer-friendly — return to the menu |
| Load while joined to another host | Rejected — only the host may restore (Invariant #25); leave the session first                                                                                          |
| Load from the main menu           | `SessionRestoreCoordinator` hosts a restored session from `SaveFile.session` and waits for saved remote seats (F68 #823; flow above)                                   |
| Rejoin a restored session         | Saved seat reclaimed via `{matchId, playerId}` JOIN claims (#822) or the claimless slot-order fallback (#821); reconnecting peers get a fresh full `PlayerSnapshot`    |
| Mid-commitment save               | `pendingCommitments` + `stagedReveals` restore as a unit (Invariant #26): committed players stay committed; the reveal fires once the rest commit                      |

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
- [Electron Shell](electron-shell-ipc-bridge.md) — `SavesAPI` IPC namespace incl. `chimera:saves:restore-status` / `chimera:saves:cancel-restore` (#826)
- [Multiplayer Provider](multiplayer-provider-websocket.md) — `hostLobby({ restore })`, JOIN seat claims, `resolveRestoredSeat` (#821/#822)
- [Renderer State Stores](renderer-state-stores.md) — `saveStore` (`SaveSlotMeta[]` mirror)
- [Replay System](replay-system.md) — `ReplayFile` shares the same `ActionHistory` concept
