/**
 * electron/main/replay/replay-manager.test.ts
 *
 * Unit tests for ReplayManager (§4.28, F44 / T3, #657).
 * Tests written first (RED before implementation).
 *
 * Injects InMemoryReplayRepository + a memory-sink Logger — no real disk I/O,
 * and the concrete Logger is never imported (invariant #67 / acceptance).
 */

import { describe, expect, it } from 'vitest';
import {
    InMemoryReplayRepository,
    ReplayMigrator,
    ReplayVersionError,
} from '@chimera-engine/simulation/replay/index.js';
import type { ReplayHeader, ReplayRepository } from '@chimera-engine/simulation/replay/index.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import { createLogger, createMemorySink } from '../logging/logger.js';
import type { MemorySink } from '../logging/logger.js';
import { ReplayManager } from './replay-manager.js';
import type { ReplayEngineIdentity } from './replay-manager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const IDENTITY: ReplayEngineIdentity = {
    engineVersion: '0.1.0',
    gameVersions: new Map([['tactics', '0.1.0']]),
};

function makeHeader(overrides: Partial<ReplayHeader> = {}): ReplayHeader {
    return {
        engineVersion: '0.1.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        gameConfig: { mapSize: 8 },
        seed: 123,
        recordedAt: '2026-06-02T10:00:00.000Z',
        players: [{ playerId: toPlayerId('p1'), displayName: 'Player One' }],
        ...overrides,
    };
}

function makeManager(
    repo: ReplayRepository = new InMemoryReplayRepository(),
    migrator: ReplayMigrator = new ReplayMigrator(),
    identity: ReplayEngineIdentity = IDENTITY,
): { manager: ReplayManager; repo: ReplayRepository; sink: MemorySink } {
    const sink = createMemorySink();
    const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
    return { manager: new ReplayManager(repo, migrator, identity, logger), repo, sink };
}

function recordAction(tick: number) {
    return {
        tick,
        playerId: toPlayerId('p1'),
        action: { type: 'engine:end_turn', playerId: toPlayerId('p1'), tick, payload: {} },
    };
}

// ── Recording round-trip ─────────────────────────────────────────────────────

describe('ReplayManager — recording', () => {
    it('startRecording → recordAction ×N → finaliseRecording writes a loadable ReplayFile', async () => {
        const { manager } = makeManager();

        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        manager.recordAction(recordAction(1));
        manager.recordAction(recordAction(5));
        const savedPath = await manager.finaliseRecording();

        const loaded = await manager.load(savedPath);
        expect(loaded.formatVersion).toBe(1);
        expect(loaded.gameId).toBe('tactics');
        expect(loaded.seed).toBe(123);
        expect(loaded.actions).toHaveLength(3);
        expect(loaded.metadata.recordedAt).toBe('2026-06-02T10:00:00.000Z');
        expect(loaded.metadata.players).toHaveLength(1);
    });

    it('finaliseRecording computes durationTicks as the highest recorded tick', async () => {
        const { manager, repo } = makeManager();

        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(2));
        manager.recordAction(recordAction(9));
        manager.recordAction(recordAction(4));
        const savedPath = await manager.finaliseRecording();

        const loaded = await repo.load(savedPath);
        expect(loaded.metadata.durationTicks).toBe(9);
    });

    it('recordAction before startRecording throws', () => {
        const { manager } = makeManager();

        expect(() => manager.recordAction(recordAction(0))).toThrow(/no recording/);
    });

    it('startRecording while already recording throws', () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());

        expect(() => manager.startRecording(makeHeader())).toThrow(/already in progress/);
    });

    it('finaliseRecording without a recording throws', async () => {
        const { manager } = makeManager();

        await expect(manager.finaliseRecording()).rejects.toThrow(/no recording/);
    });

    it('finaliseRecording clears state on success (a second finalise throws)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        await manager.finaliseRecording();

        await expect(manager.finaliseRecording()).rejects.toThrow(/no recording/);
    });

    it('finaliseRecording clears state on failure (recording can restart afterwards)', async () => {
        const failingRepo: ReplayRepository = {
            save: () => Promise.reject(new Error('disk full')),
            load: () => Promise.reject(new Error('n/a')),
            list: () => Promise.resolve([]),
            listItems: () => Promise.resolve([]),
            delete: () => Promise.resolve(),
        };
        const { manager } = makeManager(failingRepo);

        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        await expect(manager.finaliseRecording()).rejects.toThrow('disk full');

        // State was cleared in `finally` — a fresh recording can begin and the
        // stale action must not leak into it.
        expect(() => manager.startRecording(makeHeader())).not.toThrow();
    });
});

// ── isRecording (recording-in-progress predicate) ───────────────────────────

describe('ReplayManager — isRecording', () => {
    it('is false before any recording starts', () => {
        const { manager } = makeManager();
        expect(manager.isRecording()).toBe(false);
    });

    it('is true while a recording is in progress', () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        expect(manager.isRecording()).toBe(true);
    });

    it('is false again after the recording is finalised', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        await manager.finaliseRecording();
        expect(manager.isRecording()).toBe(false);
    });

    it('is false again after the recording is aborted', () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.abortRecording();
        expect(manager.isRecording()).toBe(false);
    });
});

// ── exportCurrentMatch (idempotent post-game export) ─────────────────────────

describe('ReplayManager — exportCurrentMatch', () => {
    it('finalises the active recording and returns a loadable path', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        manager.recordAction(recordAction(4));

        const savedPath = await manager.exportCurrentMatch();

        const loaded = await manager.load(savedPath);
        expect(loaded.actions).toHaveLength(2);
    });

    it('returns the already-saved path when the recording was finalised at game-over', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        // The host pipeline auto-finalises at game-over, clearing the in-progress
        // recording before the post-game summary can mount.
        const autoSaved = await manager.finaliseRecording();

        // The post-game Replay button / the player's save icon then call
        // exportCurrentMatch: it must resolve with the same path, not throw.
        await expect(manager.exportCurrentMatch()).resolves.toBe(autoSaved);
        // No duplicate file is written.
        expect(await manager.list('tactics')).toStrictEqual([autoSaved]);
    });

    it('is repeatable — twice returns the same path and writes one file', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const first = await manager.exportCurrentMatch();
        const second = await manager.exportCurrentMatch();

        expect(second).toBe(first);
        expect(await manager.list('tactics')).toStrictEqual([first]);
    });

    it('rejects when nothing has ever been recorded', async () => {
        const { manager } = makeManager();
        await expect(manager.exportCurrentMatch()).rejects.toThrow(/no recording|no saved replay/i);
    });

    it('does not leak a previous match path after a new recording starts', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        await manager.finaliseRecording(); // match 1 saved → remembered

        // A new match begins (clearing the remembered path), then is abandoned.
        manager.startRecording(makeHeader());
        manager.abortRecording();

        // Nothing to export — match 1's path must not be returned.
        await expect(manager.exportCurrentMatch()).rejects.toThrow(/no recording|no saved replay/i);
    });
});

// ── Naming (user-supplied replay name, stamped at export) ────────────────────

describe('ReplayManager — replay name', () => {
    it('finaliseRecording stamps a supplied name into metadata', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const savedPath = await manager.finaliseRecording('Grand Finale');

        const loaded = await manager.load(savedPath);
        expect(loaded.metadata.name).toBe('Grand Finale');
    });

    it('exportCurrentMatch forwards the name to the file it writes', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const savedPath = await manager.exportCurrentMatch('My Match');

        const loaded = await manager.load(savedPath);
        expect(loaded.metadata.name).toBe('My Match');
    });

    it('omits name entirely when none is supplied (no name key on metadata)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const savedPath = await manager.finaliseRecording();

        const loaded = await manager.load(savedPath);
        expect(loaded.metadata.name).toBeUndefined();
        expect('name' in loaded.metadata).toBe(false);
    });

    it('treats an empty-string name as unnamed (no name stamped)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const savedPath = await manager.finaliseRecording('');

        const loaded = await manager.load(savedPath);
        expect(loaded.metadata.name).toBeUndefined();
    });

    it('surfaces the stored name through listItems', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        await manager.finaliseRecording('Named Replay');

        const items = await manager.listItems('tactics');

        expect(items[0]?.name).toBe('Named Replay');
    });

    it('ignores a name on the idempotent already-saved branch (the first name wins)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const first = await manager.exportCurrentMatch('First');
        // A repeat press with a different name must neither re-save nor re-stamp:
        // the save icon disables after the first save, and the already-saved branch
        // returns the cached path without touching the file.
        const second = await manager.exportCurrentMatch('Second');

        expect(second).toBe(first);
        expect(await manager.list('tactics')).toStrictEqual([first]);
        const loaded = await manager.load(first);
        expect(loaded.metadata.name).toBe('First');
    });
});

// ── getCurrentMatchFile (in-memory preview, no write) ────────────────────────

describe('ReplayManager — getCurrentMatchFile', () => {
    it('assembles the in-progress recording as a ReplayFile without writing or clearing', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        manager.recordAction(recordAction(3));

        const file = manager.getCurrentMatchFile();

        // Matches what finaliseRecording would assemble…
        expect(file.formatVersion).toBe(1);
        expect(file.gameId).toBe('tactics');
        expect(file.seed).toBe(123);
        expect(file.actions).toHaveLength(2);
        expect(file.metadata.durationTicks).toBe(3);
        expect(file.metadata.players).toHaveLength(1);
        // …but nothing was persisted (the match is only saved on an explicit save).
        expect(await manager.list('tactics')).toStrictEqual([]);
        // …and the recording survives: a later save still succeeds.
        await expect(manager.finaliseRecording()).resolves.toBeTruthy();
    });

    it('is repeatable and leaves the recording intact for a later save', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const first = manager.getCurrentMatchFile();
        const second = manager.getCurrentMatchFile();

        expect(second.actions).toHaveLength(first.actions.length);
        const savedPath = await manager.finaliseRecording();
        const loaded = await manager.load(savedPath);
        expect(loaded.actions).toHaveLength(1);
    });

    it('returns a defensively-copied actions array (mutation cannot corrupt the pending save)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        const file = manager.getCurrentMatchFile();
        (file.actions as unknown[]).push(recordAction(99));

        const savedPath = await manager.finaliseRecording();
        const loaded = await manager.load(savedPath);
        expect(loaded.actions).toHaveLength(1);
    });

    it('throws when no recording is in progress', () => {
        const { manager } = makeManager();
        expect(() => manager.getCurrentMatchFile()).toThrow(/no recording/);
    });

    it('never stamps a name onto the preview file (naming is an export-only concern)', () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        // The preview shares assembleFile with finalise but passes no name, so the
        // in-memory preview must never carry one — a regression that threaded a
        // name into the preview assembly would surface it with no save.
        const file = manager.getCurrentMatchFile();

        expect(file.metadata.name).toBeUndefined();
        expect('name' in file.metadata).toBe(false);
    });
});

// ── Abort (mid-match session close) ──────────────────────────────────────────

describe('ReplayManager — abortRecording', () => {
    it('discards the in-progress recording without persisting', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));

        manager.abortRecording();

        // Nothing was saved.
        expect(await manager.list('tactics')).toStrictEqual([]);
        // State cleared — finalise now reports no recording.
        await expect(manager.finaliseRecording()).rejects.toThrow(/no recording/);
    });

    it('lets a fresh recording start afterwards without leaking actions', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(7));
        manager.abortRecording();

        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        const savedPath = await manager.finaliseRecording();

        const loaded = await manager.load(savedPath);
        expect(loaded.actions).toHaveLength(1);
        expect(loaded.actions[0]?.tick).toBe(0);
    });

    it('is a no-op when no recording is in progress', () => {
        const { manager } = makeManager();
        expect(() => manager.abortRecording()).not.toThrow();
    });
});

// ── Compatibility guard ──────────────────────────────────────────────────────

describe('ReplayManager — load compatibility guard', () => {
    it('load throws ReplayVersionError on an engine-version mismatch', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader({ engineVersion: '0.0.9' }));
        manager.recordAction(recordAction(0));
        const savedPath = await manager.finaliseRecording();

        await expect(manager.load(savedPath)).rejects.toBeInstanceOf(ReplayVersionError);
    });

    it('load throws ReplayVersionError when the game is not installed', async () => {
        const identity: ReplayEngineIdentity = {
            engineVersion: '0.1.0',
            gameVersions: new Map(), // tactics not installed
        };
        const { manager } = makeManager(
            new InMemoryReplayRepository(),
            new ReplayMigrator(),
            identity,
        );
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        const savedPath = await manager.finaliseRecording();

        await expect(manager.load(savedPath)).rejects.toBeInstanceOf(ReplayVersionError);
    });
});

// ── Delegation ───────────────────────────────────────────────────────────────

describe('ReplayManager — delegation', () => {
    it('list delegates to the repository (newest-first)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader({ recordedAt: '2026-01-01T00:00:00.000Z' }));
        const older = await manager.finaliseRecording();
        manager.startRecording(makeHeader({ recordedAt: '2026-06-01T00:00:00.000Z' }));
        const newer = await manager.finaliseRecording();

        expect(await manager.list('tactics')).toStrictEqual([newer, older]);
    });

    it('delete delegates to the repository', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        const savedPath = await manager.finaliseRecording();

        await manager.delete(savedPath);

        expect(await manager.list('tactics')).toStrictEqual([]);
    });
});

// ── listItems (enriched projection for the renderer browser) ─────────────────

describe('ReplayManager — listItems', () => {
    it('projects each stored replay to a ReplayListItem with path + header/metadata fields', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(3));
        manager.recordAction(recordAction(8));
        const savedPath = await manager.finaliseRecording();

        const items = await manager.listItems('tactics');

        expect(items).toHaveLength(1);
        expect(items[0]).toStrictEqual({
            path: savedPath,
            gameId: 'tactics',
            gameVersion: '0.1.0',
            engineVersion: '0.1.0',
            recordedAt: '2026-06-02T10:00:00.000Z',
            durationTicks: 8,
            playerIds: ['p1'],
        });
    });

    it('orders items newest-first (matching the repository list order)', async () => {
        const { manager } = makeManager();
        manager.startRecording(makeHeader({ recordedAt: '2026-01-01T00:00:00.000Z' }));
        const older = await manager.finaliseRecording();
        manager.startRecording(makeHeader({ recordedAt: '2026-06-01T00:00:00.000Z' }));
        const newer = await manager.finaliseRecording();

        const items = await manager.listItems('tactics');

        expect(items.map((i) => i.path)).toStrictEqual([newer, older]);
    });

    it('includes replays incompatible with the running engine (no compatibility guard)', async () => {
        // A replay whose engineVersion would make `load()` throw ReplayVersionError
        // must still appear in the browser listing so the user can see/delete it.
        const { manager } = makeManager();
        manager.startRecording(makeHeader({ engineVersion: '0.0.9' }));
        manager.recordAction(recordAction(0));
        const savedPath = await manager.finaliseRecording();

        // Guarded load rejects…
        await expect(manager.load(savedPath)).rejects.toBeInstanceOf(ReplayVersionError);
        // …but listItems surfaces it anyway.
        const items = await manager.listItems('tactics');
        expect(items).toHaveLength(1);
        expect(items[0]?.engineVersion).toBe('0.0.9');
    });

    it('returns an empty array when no replays exist for the game', async () => {
        const { manager } = makeManager();
        expect(await manager.listItems('tactics')).toStrictEqual([]);
    });
});

// ── Logging (invariant #67) ──────────────────────────────────────────────────

describe('ReplayManager — logging', () => {
    it('logs at debug under the replay-manager module on public methods', async () => {
        const { manager, sink } = makeManager();

        manager.startRecording(makeHeader());
        manager.recordAction(recordAction(0));
        await manager.finaliseRecording();
        await manager.list('tactics');

        const debugFromManager = sink.entries.filter(
            (e) => e.level === 'debug' && e.source.module === 'replay-manager',
        );
        expect(debugFromManager.length).toBeGreaterThan(0);
        expect(debugFromManager.map((e) => e.message)).toContain('startRecording');
    });
});
