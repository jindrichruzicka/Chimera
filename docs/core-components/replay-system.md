---
title: 'Replay System'
description: 'ReplayFile schema (formatVersion/seed/actions/metadata), RecordedAction, ReplaySerializer variants, ReplayPlayer (initialize/step/seek/play), ReplayManager (startRecording/recordAction/finaliseRecording/exportCurrentMatch), path-traversal-guarded ReplayAPI IPC, game post-game and main-menu UX integration, the globalThis bridge-contract access pattern, cross-version compatibility via ReplayMigrator, and the coexisting privacy-preserving PerspectiveReplayFile (kind: perspective; projected, fog-safe PlayerSnapshot frames for one locked viewerId).'
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
        readonly name?: string; // user-entered at export (save icon); absent = unnamed
    };
}

export interface RecordedAction {
    readonly tick: number;
    readonly playerId: PlayerId;
    readonly action: EngineAction;
}
```

`ReplayHeader` is the static (non-action) portion supplied to `ReplayManager.startRecording()` — every `ReplayFile` field except `formatVersion` (constant `1`), `actions` (accumulated during recording), and `metadata.durationTicks` (computed at finalise). Its `recordedAt` is captured by the caller at recording start so the simulation layer never reads a wall clock (invariant #43).

**Serializer strategies** (interface `ReplaySerializer`, `simulation/replay/ReplaySerializer.ts`):

- `JsonReplaySerializer` (`simulation/replay/ReplaySerializer.ts`) — plain, human-readable JSON; wraps the pure `serializeReplay()` / `deserializeReplay()` functions.
- `CompressedReplaySerializer` (`electron/main/replay/CompressedReplaySerializer.ts`) — async gzip; used when storage size matters.

Both are async and round-trip stable. `parseReplayFile()` validates required fields and rejects malformed input with `ReplayParseError`; the JSON reviver (`safeReviver`) rejects `__proto__` (prototype-pollution defence, OWASP A08). Extension: `.chimera-replay`. Location: `userData/replays/<game-id>/`.

---

## ReplayPlayer

```typescript
// simulation/replay/ReplayPlayer.ts

export class ReplayPlayer<TState extends BaseGameSnapshot = BaseGameSnapshot> {
    constructor(
        file: ReplayFile,
        pipeline: ActionPipeline<TState>, // the live pipeline instance — never constructed here (#70)
        initialSnapshotFactory: ReplayInitialSnapshotFactory<TState>,
        logger: Logger = NOOP_LOGGER,
    ) {}

    initialize(): TState; // reset to seed + gameConfig → initial state, cursor = 0
    step(): TState | null; // apply next recorded action; null when complete
    seek(tick: number): TState; // replay from 0 up to `tick`
    play(speedMultiplier: number, onFrame: ReplayFrameCallback<TState>): ReplayStopFn;
    playSync(): TState; // batch playback to the end (tests/tools)
}
```

Replay playback reuses the **exact same `ActionPipeline`** as a live match — no separate replay reducer codepath. A divergence is a determinism bug, not an acceptable simplification. `ActionRegistry` remains encapsulated by the injected live pipeline.

**Determinism guarantees & errors:**

- `step()` throws `DeterminismError` if `pipeline.process()` does not advance the tick by exactly +1 (invariants #42/#70).
- `seek(tick)` throws `ReplaySeekError` when `tick` is not a non-negative integer or is beyond the final recorded tick.
- The recorded `tick`/`playerId` envelope is cross-checked against the embedded `action`; a mismatch throws `ReplayEnvelopeMismatchError`.
- `play()` rejects a non-positive or non-finite `speedMultiplier` (`RangeError`); the multiplier is reserved for caller-side scheduling — simulation playback stays tick-driven.
- The free function `assertReplayDeterministic(first, second)` replays two players in lockstep and throws `DeterminismError` on any divergence (used by tests/soak).

The `initialSnapshotFactory` reconstructs the concrete game snapshot type from `seed + gameConfig`. The engine provides `createBaseReplayInitialSnapshot()` for base fields; games compose on top of it to add required game-specific fields without unsafe casts. The simulation-layer `play()` API invokes `onFrame` for each produced snapshot and passes a stop handle that can end playback before the next action while preserving pure, tick-driven replay; UI timing/scheduling lives outside `simulation/`.

---

## ReplayManager

```typescript
// electron/main/replay/replay-manager.ts

export class ReplayManager {
    constructor(
        repository: ReplayRepository, // I/O delegate; atomic .tmp + rename write
        migrator: ReplayMigrator, // cross-version compatibility guard, applied on load()
        identity: ReplayEngineIdentity, // running { engineVersion, gameVersions }
        logger: Logger, // injected child logger (#67)
    ) {}

    // ── Recording lifecycle ──
    isRecording(): boolean; // whether a match recording is in progress (co-save gate)
    startRecording(header: ReplayHeader): void; // throws if already recording
    recordAction(entry: RecordedAction): void; // throws if no recording in progress
    finaliseRecording(name?: string): Promise<string>; // assemble ReplayFile + atomic write; returns path
    exportCurrentMatch(name?: string): Promise<string>; // idempotent: finalise (stamps name) OR return last saved path
    abortRecording(): void; // discard in-progress recording (idempotent teardown)

    // ── Persistence ──
    load(filePath: string): Promise<ReplayFile>; // enforces compatibility guard
    list(gameId: string): Promise<string[]>; // paths, newest-first
    listItems(gameId: string): Promise<ReplayListItem[]>; // projected metadata (no guard)
    delete(filePath: string): Promise<void>;
}
```

The manager owns only the `ReplayFile` / repository / migrator contracts — no concrete repository, serializer, or `ReplayPlayer` is imported (invariant #71). Dependencies are injected (DIP).

**Lifecycle.** `startRecording(header)` → repeated `recordAction(entry)` → `finaliseRecording()`. Finalise assembles the complete `ReplayFile` (`formatVersion: 1`, header fields, accumulated `actions`, and `metadata.durationTicks` computed as the max recorded tick), then writes it. Recording state is cleared in a `finally` block, so a failed write leaves no stale state.

**`exportCurrentMatch()`** is the idempotent "ensure this match's replay is on disk and give me its path". The match is **not** finalised at game-over — the recording is retained in memory and this method performs the first (and, being idempotent, only) write when the player's save icon is pressed: if a recording is still in progress it finalises; if the match was already saved it returns the remembered `lastSavedPath` (no second file is written); if nothing was recorded it throws. `abortRecording()` discards an in-progress recording without persisting and is a safe no-op at session teardown. `isRecording()` reports whether a recording is in progress — the post-game co-save helper reads it to skip the deterministic write when there is nothing to save.

**Atomic write.** `FileReplayRepository.save()` writes to `<dest>.tmp`, `fsync`s, then `rename`s atomically. Each file gets a fresh UUID, so an existing replay is never overwritten; a crash between write and rename leaves only a `.tmp` artefact, never a half-written `.chimera-replay`.

**Version-compatibility guard.** `load()` calls `migrator.ensureCompatible(file, { engineVersion, gameVersion })`; it throws `ReplayVersionError` when the file's `(engineVersion, gameId, gameVersion)` triple mismatches the running engine and no registered migration covers it. `listItems()` deliberately **skips** the guard so a replay the current engine can no longer play still appears in the browser for deletion — and it projects only non-gameplay scalars, so neither a `GameSnapshot` nor the action log leaves the main process (invariants #3/#71).

---

## ReplayAPI IPC

The four core `window.__chimera.replay` methods (bridge factory in `electron/preload/apis/replay-api.ts`):

```typescript
// window.__chimera.replay  — channel constants live in preload/apis/replay-api.ts (#5)

interface ReplayAPI {
    list(gameId: string): Promise<ReplayListItem[]>; // chimera:replay:list (each item carries an optional user-entered `name`)
    // intent defaults to 'save' (raises the "Replay saved" toast); 'view' suppresses it. `name` = the user-entered replay name
    exportCurrentMatch(intent?: ReplayExportIntent, name?: string): Promise<string>; // chimera:replay:export-current-match → saved path
    // saveable defaults to false; true (a just-finished match) makes the player show its save icon
    openInPlayer(path: string, saveable?: boolean): Promise<void>; // chimera:replay:open-in-player
    delete(path: string): Promise<void>; // chimera:replay:delete
}
```

Handlers are registered by `registerReplayHandlers()` in `electron/main/ipc/ipc-handlers.ts` and exposed only through the preload bridge (invariant #5). Every input is Zod-validated before any manager call. No `GameSnapshot` and no recorded action log cross these channels — `list` returns projected `ReplayListItem`s and `exportCurrentMatch` returns a file-path string (invariants #3/#71).

**Argument constraints / path-traversal guard.** `openInPlayer` and `delete` accept a file path, validated with `isInsidePath(replayDir, candidate)` (`electron/main/path-containment.ts`): both arguments are `path.resolve()`d, and the `base + path.sep` check rejects `..` escapes **and** sibling directories such as `<base>-evil`. A path escaping the replay directory throws before the manager is touched (OWASP A01). This is the single source of truth for the guard — the persistence layer (`FileReplayRepository.assertInsideBase`) re-applies the identical predicate (defence-in-depth), so the two checks cannot drift. `openInPlayer`'s optional `saveable` flag is Zod-validated separately (`ReplaySaveableFlagSchema`, fail-safe to `false`) and rides along on the navigate push.

> The live bridge also exposes (all shipped, beyond the four core methods): the one-way `onNavigate` subscription (`chimera:replay:navigate`, a main → renderer push carrying `{ path, kind, saveable }` — the navigation bridge forwards `saveable` as a `&saveable=1` query flag), the one-way `onExported` subscription (`chimera:replay:exported`, a main → renderer push carrying the saved replay path for the §4.30 replay-exported toast — **pushed only for the `'save'` export intent, never for `'view'`**), scrubbing playback methods (`openPlayback` / `snapshotAt` / `snapshotRange` / `closePlayback`, all returning projected `PlayerSnapshot`s), and a `perspective` sub-namespace mirroring these for [perspective replays](#perspective-replay-perspectivereplayfile).

---

## Renderer & Game API Access (why `GameScreenProps` was not extended)

There is **no React `ReplayApiContext`**. Two access patterns are used, each fitting its module-boundary constraints:

- **Renderer components** use the `useReplayApi()` hook (`renderer/hooks/useReplayApi.ts`) — a `useMemo`-stable wrapper that reads the bridge at call-time via `getReplayBridge()` / `requireBridge()`, so tests can mock the bridge after module load. The pattern mirrors `useSavesApi()`. A missing bridge surfaces as a rejected promise (`Error('Chimera replay API not available')`).
- **Game shell/screen modules** cannot import `renderer/*` or `electron/*` (§3 Module Boundary Table; invariants #80/#96), so `GameScreenProps` was deliberately **not** extended with a replay handle. Instead they read the bridge directly off `globalThis.__chimera.replay`, typed against the small structural contracts in `shared/replay-bridge-contract.ts`:
    - `ReplayExportBridge` (`exportCurrentMatch`, `openInPlayer`) — for game **screens** (post-game summary).
    - `PerspectiveReplayListBridge` (`list`) — for game **shell** modules (main-menu gating).

The canonical preload `ReplayAPI extends ReplayExportBridge` and `PerspectiveReplayAPI extends PerspectiveReplayListBridge`, so any signature divergence from the shared slice is a compile error in the preload layer — not a silent runtime drift.

---

## Game UX Integration

**Post-game summary button** — a game's `PostGameReplayActions` (e.g. in `games/<game>/screens/PostGameSummary.tsx`) renders a single **Replay** (primary `<Button>`), mounted only when `snapshot.gameResult !== null`:

- _Replay_ → `exportCurrentMatch('view')` then `openInPlayer(path, true)` — the `'view'` intent exports only to obtain a stable on-disk path (the main handler suppresses the `chimera:replay:exported` push so no misleading "Replay saved" toast fires); `saveable = true` rides along so the player surfaces its save icon for this just-finished match.

The button is disabled while the request is in flight, with inline error feedback. The bridge is read off `globalThis.__chimera.replay` as a `ReplayExportBridge` — no `electron/*` / `renderer/*` import (invariants #92/#96).

**Replay player save icon** — saving is no longer a summary button. The replay player (`renderer/app/replays/player/page.tsx`) renders a compact save `IconButton` (the `SaveReplayButton`, `renderer/components/replay/`) at the far left of `ReplayControls`, shown **only** for a just-finished match (`?saveable=1`, threaded from the post-game **Replay** action through the navigate push) — never for a replay opened from the Replays library, which is already on disk and whose session-gated current-match export would not apply. Clicking it opens a name dialog (mirroring the save-game flow); confirming calls `exportCurrentMatch('save', name)` (deterministic) or `perspective.exportCurrent(name)` (perspective) with the entered name (bounded to `MAX_SAVE_LABEL_LENGTH`; blank persists an unnamed replay), then disables so the same replay cannot be re-saved. The deterministic save raises the "Replay saved" toast (§4.30), while the perspective save's confirmation is the disabled icon state. The Replays browser lists both kinds by that name (a localized "Untitled replay" fallback when absent), keeping the neutral "Deterministic" badge on deterministic rows.

**Main-menu Replays button** — a game's `gameMainMenuDefinition` (e.g. in `games/<game>/shell/main-menu.ts`) contributes a **Replays** button (navigates to `/replays`). Its `disabled` predicate is async and **fail-safe**: it resolves to `true` (disabled) when `replay.perspective.list('<game>')` is empty _or_ the bridge is unavailable. The definition is contributed through the renderer game registry (not a shell-page import) and uses token-mapped layout (invariants #80/#91/#94).

**Deterministic replays are debug-only, and never written in a packaged build** — the replay browser always lists **perspective** replays (the player's own point of view). Deterministic replays are a debug artifact: because they reconstruct the full global state from `seed + actions` (every seat's hidden information — e.g. an opponent's whole deck in a CCG), the trusted main process **records and writes them only in a non-packaged build, never in the packaged production app** — the recorder's `replayPort` is `undefined` when `app.isPackaged`, so nothing is ever recorded or persisted there (privacy; Invariants #71/#98, which constrain the file _format_ but do not mandate that the file be written). In a non-packaged build a single post-game save co-saves the deterministic copy alongside the player's perspective (`exportPerspectiveWithDeterministicCoSave`). The renderer's matching browser-surfacing guard is `renderer/app/replays/deterministicReplayGate.ts` — `areDeterministicReplaysVisible()` returns `false` when `NEXT_PUBLIC_CHIMERA_PACKAGED === '1'` (set only by the `package:tactics*` scripts, mirroring the component-gallery gate). When hidden, the page skips the `replay.list()` IPC entirely; and in a packaged build there is nothing on disk to list anyway.

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
    readonly name?: string; // user-entered at export (save icon); absent = unnamed
}
```

The `name` lives on the file (not the `PerspectiveReplayHeader`) because it is supplied at **export** — the player's save icon — not at recording start. It is validated as a string when present but is optional. Surfacing it at list time is compatible with Invariant #98: a name is user metadata, not projected state, so it carries no per-frame snapshot or `viewerId` — those are still read only when the replay is opened.

`parsePerspectiveReplayFile()` is pure (zero I/O, no `Date.now()`) and rejects a file as **malformed** when (Invariant #98):

- `viewerId` or `frames` is missing;
- any `frame.snapshot.viewerId` differs from the file's locked `viewerId`;
- any `frame.tick` disagrees with its embedded `frame.snapshot.tick`;
- frame ticks are not strictly increasing (playback walks `frames` in order, so duplicate or out-of-order ticks are rejected).

`viewerId` is locked and immutable for the lifetime of the file; every frame must be projected for that exact viewer.

---

## Cross-Version Compatibility

Replays are tied to the `(engineVersion, gameId, gameVersion)` triple at record time. `ReplayManager.load()` calls `ReplayMigrator.ensureCompatible(file, identity)` against the injected `ReplayEngineIdentity` (`{ engineVersion, gameVersions }`) and throws `ReplayVersionError` when the triple mismatches and no registered migration covers the file — same pattern as `SaveMigrator` (§4.11). Migrations are registered before first use and frozen thereafter; the input file is never mutated. For 1.0.0 **no migration is registered** (see [Non-Goals](#non-goals)); replays from previous engine versions must be played on an archived build.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1  | `simulation/replay/*` (schema, serializer, `ReplayPlayer`, migrator) has zero runtime dependency on React, DOM, Electron, or networking; gzip/I/O live in `electron/main/replay/*`.                                                                                                                                                                                                                                                                                                            |
| #3  | Only `PlayerSnapshot` crosses a process/network boundary. Replay IPC returns projected `ReplayListItem`s, file-path strings, and (for playback) `PlayerSnapshot`s — never a host-internal `GameSnapshot`.                                                                                                                                                                                                                                                                                      |
| #5  | Replay IPC handlers are registered in `ipc-handlers.ts` (`registerReplayHandlers`) and exposed only through the preload bridge; channel constants live in `preload/apis/replay-api.ts` (no parallel list to drift).                                                                                                                                                                                                                                                                            |
| #42 | Each recorded action advances the snapshot by exactly +1 tick. `ReplayPlayer.step()` throws `DeterminismError` if `pipeline.process()` advances by any other amount.                                                                                                                                                                                                                                                                                                                           |
| #43 | Playback `validate()`/`reduce()` stay pure; serializer and `ReplayPlayer` perform no wall-clock reads or I/O. `recordedAt` is captured by the caller and stored in the `ReplayHeader`.                                                                                                                                                                                                                                                                                                         |
| #67 | `ReplayManager` is constructed with an injected `Logger` child; every public method logs at debug level — no raw `console.*`.                                                                                                                                                                                                                                                                                                                                                                  |
| #70 | `ReplayPlayer` uses the same `ActionPipeline` instance as live play. Any "replay-only" shortcut codepath is forbidden — a replay divergence is a determinism bug. Governs **deterministic playback only**; perspective replays (#98) are never re-simulated, so this rule does not apply to them.                                                                                                                                                                                              |
| #71 | Deterministic replay files (`ReplayFile`, no `kind`) contain full `EngineAction` payloads — never projected `PlayerSnapshot`s. Playback starts from seed + gameConfig. A replay file without `seed` or `actions` is malformed and rejected at load.                                                                                                                                                                                                                                            |
| #80 | The engine shell never imports `games/*`; a game's main-menu **Replays** button is contributed as data through the registry, not via a shell-page import.                                                                                                                                                                                                                                                                                                                                      |
| #91 | Shell pages reference `var(--ch-*)` tokens only — a game's menu definition uses token-mapped layout (`gap: 16` → `--ch-space-md`), no hardcoded colour/spacing/radius.                                                                                                                                                                                                                                                                                                                         |
| #92 | Shell/game UI uses `<Button>`/`<IconButton>` from the renderer UI barrel for actions — the post-game **Replay** button, the replay player's save `IconButton`, and the menu **Replays** button.                                                                                                                                                                                                                                                                                                |
| #94 | Engine shell pages do not import `games/*`; game contributions flow through the registry and shared contracts.                                                                                                                                                                                                                                                                                                                                                                                 |
| #96 | Game surfaces import renderer UI only through the public `@chimera-engine/renderer/components/ui` barrel and read IPC bridges off `globalThis` via shared contracts (`shared/replay-bridge-contract.ts`) — never `renderer/*` or `electron/*` internals.                                                                                                                                                                                                                                       |
| #98 | A _perspective_ replay (`PerspectiveReplayFile`, `kind: 'perspective'`) carries only projected `PlayerSnapshot` frames for a single locked, immutable `viewerId` — no `seed`/`gameConfig`/`actions`. Malformed (rejected at parse) if `viewerId`/`frames` is missing, if any `frame.snapshot.viewerId` differs from the locked `viewerId`, if any `frame.tick` disagrees with its `frame.snapshot.tick`, or if frame ticks are not strictly increasing. Both kinds coexist on disk (ADR F44b). |

---

## Non-Goals

The 1.0.0 replay system is intentionally local and self-contained. Explicitly **deferred to post-1.0**:

- **Cloud replay sharing** — no upload, hosting, or share-link service; replays live only under the local `userData/replays/`.
- **Video / GIF capture** — no rendered-video export; replays are data (action log or projected snapshots), played back in-engine.
- **Cross-version replay migration** — the `ReplayMigrator` extension point exists, but **no migration is registered** for 1.0.0. A replay recorded by a different engine/game version is rejected at load (`ReplayVersionError`) and must be played on an archived build.

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ActionPipeline`, determinism invariants #42–44
- [Save / Load Persistence](save-load-persistence.md) — `SaveMigrator` pattern mirrored in `ReplayMigrator`
- [Electron Shell](electron-shell-ipc-bridge.md) — `ReplayAPI` IPC namespace
- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — `<Button>` / token / registry rules behind a game's replay buttons (invariants #80/#91/#92/#94)
- [State Obfuscation & Fog of War](../security-trust/fog-of-war-cryptographic-commitment.md) — why `PerspectiveReplayFile` frames are post-projection and information-safe
