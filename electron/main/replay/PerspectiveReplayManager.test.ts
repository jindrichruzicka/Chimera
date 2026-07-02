/**
 * electron/main/replay/PerspectiveReplayManager.test.ts
 *
 * Unit tests for PerspectiveReplayManager (§4.28, ADR F44b, F44b / T4, #670).
 * Tests written first (RED before implementation).
 *
 * Injects InMemoryPerspectiveReplayRepository + a memory-sink Logger — no real
 * disk I/O, and the concrete Logger is never imported (invariant #67).
 */

import { describe, expect, it } from 'vitest';
import { InMemoryPerspectiveReplayRepository } from '@chimera-engine/simulation/replay/index.js';
import { ReplayVersionError } from '@chimera-engine/simulation/replay/index.js';
import type {
    PerspectiveReplayFrame,
    PerspectiveReplayRepository,
} from '@chimera-engine/simulation/replay/index.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import { playerId as toPlayerId, gamePhase } from '@chimera-engine/simulation/engine/types.js';
import { createLogger, createMemorySink } from '../logging/logger.js';
import type { MemorySink } from '../logging/logger.js';
import { PerspectiveReplayManager } from './PerspectiveReplayManager.js';
import type {
    PerspectiveReplayEngineIdentity,
    PerspectiveReplayStartHeader,
} from './PerspectiveReplayManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const VIEWER = toPlayerId('p1');
const OTHER_VIEWER = toPlayerId('p2');

const IDENTITY: PerspectiveReplayEngineIdentity = { engineVersion: '0.1.0' };

function makeSnapshot(viewerId: ReturnType<typeof toPlayerId>, tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId,
        phase: gamePhase('playing'),
        players: {},
        entities: {},
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: tick % 2 === 0,
    };
}

function makeStartHeader(
    overrides: Partial<PerspectiveReplayStartHeader> = {},
): PerspectiveReplayStartHeader {
    return {
        formatVersion: 1,
        kind: 'perspective',
        engineVersion: '0.1.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        viewerId: VIEWER,
        recordedAt: '2026-06-02T10:00:00.000Z',
        players: [{ playerId: VIEWER, displayName: 'Player One' }],
        ...overrides,
    };
}

function frame(viewerId: ReturnType<typeof toPlayerId>, tick: number): PerspectiveReplayFrame {
    return { tick, snapshot: makeSnapshot(viewerId, tick) };
}

function makeManager(
    repo: PerspectiveReplayRepository = new InMemoryPerspectiveReplayRepository(),
    identity: PerspectiveReplayEngineIdentity = IDENTITY,
): { manager: PerspectiveReplayManager; repo: PerspectiveReplayRepository; sink: MemorySink } {
    const sink = createMemorySink();
    const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
    return { manager: new PerspectiveReplayManager(repo, identity, logger), repo, sink };
}

// ── Recording round-trip ─────────────────────────────────────────────────────

describe('PerspectiveReplayManager — recording', () => {
    it('start → recordSnapshot ×N → finalise writes a loadable PerspectiveReplayFile', async () => {
        const { manager } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(VIEWER, 1));
        manager.recordSnapshot(frame(VIEWER, 5));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.formatVersion).toBe(1);
        expect(loaded.kind).toBe('perspective');
        expect(loaded.gameId).toBe('tactics');
        expect(loaded.viewerId).toBe(VIEWER);
        expect(loaded.recordedAt).toBe('2026-06-02T10:00:00.000Z');
        expect(loaded.players).toHaveLength(1);
        expect(loaded.frames).toHaveLength(3);
        expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 1, 5]);
    });

    it('finalise computes durationTicks as the highest recorded tick', async () => {
        const { manager, repo } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 2));
        manager.recordSnapshot(frame(VIEWER, 9));
        const savedPath = await manager.finalise();

        const loaded = await repo.load(savedPath);
        expect(loaded.durationTicks).toBe(9);
    });

    it('finalise of a frameless recording yields durationTicks 0', async () => {
        const { manager, repo } = makeManager();

        manager.start(makeStartHeader());
        const savedPath = await manager.finalise();

        const loaded = await repo.load(savedPath);
        expect(loaded.durationTicks).toBe(0);
        expect(loaded.frames).toStrictEqual([]);
    });

    it('recordSnapshot before start throws', () => {
        const { manager } = makeManager();

        expect(() => manager.recordSnapshot(frame(VIEWER, 0))).toThrow(/no recording/);
    });

    it('start while already recording throws', () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());

        expect(() => manager.start(makeStartHeader())).toThrow(/already in progress/);
    });

    it('finalise without a recording throws', async () => {
        const { manager } = makeManager();

        await expect(manager.finalise()).rejects.toThrow(/no recording/);
    });

    it('finalise clears state on success (a second finalise throws)', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        await manager.finalise();

        await expect(manager.finalise()).rejects.toThrow(/no recording/);
    });

    it('finalise clears state on failure (recording can restart afterwards)', async () => {
        const failingRepo: PerspectiveReplayRepository = {
            save: () => Promise.reject(new Error('disk full')),
            load: () => Promise.reject(new Error('n/a')),
            list: () => Promise.resolve([]),
            delete: () => Promise.resolve(),
        };
        const { manager } = makeManager(failingRepo);

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        await expect(manager.finalise()).rejects.toThrow('disk full');

        // State was cleared in `finally` — a fresh recording can begin.
        expect(() => manager.start(makeStartHeader())).not.toThrow();
    });
});

// ── Lock-to-initial-seat (invariant #98) ─────────────────────────────────────

describe('PerspectiveReplayManager — lock-to-initial-seat (#98)', () => {
    it('skips a frame whose snapshot.viewerId differs from the locked viewerId', async () => {
        const { manager, sink } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(OTHER_VIEWER, 1)); // foreign seat — must be skipped
        manager.recordSnapshot(frame(VIEWER, 2));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        // The foreign-viewer frame is never appended.
        expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 2]);
        for (const f of loaded.frames) {
            expect(f.snapshot.viewerId).toBe(VIEWER);
        }
        // The rejection is surfaced as a warning, not a throw.
        const warns = sink.entries.filter(
            (e) => e.level === 'warn' && e.source.module === 'perspective-replay-manager',
        );
        expect(warns.length).toBeGreaterThan(0);
    });

    it('does not throw when a foreign-viewer frame is recorded', () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());

        expect(() => manager.recordSnapshot(frame(OTHER_VIEWER, 0))).not.toThrow();
    });
});

// ── Record-time tick validation (invariant #98) ──────────────────────────────

describe('PerspectiveReplayManager — record-time tick validation (#98)', () => {
    it('skips a frame whose tick is not strictly greater than the previous appended tick', async () => {
        const { manager, sink } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(VIEWER, 5));
        manager.recordSnapshot(frame(VIEWER, 3)); // out of order — must be skipped
        manager.recordSnapshot(frame(VIEWER, 6));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 5, 6]);
        const warns = sink.entries.filter(
            (e) => e.level === 'warn' && e.source.module === 'perspective-replay-manager',
        );
        expect(warns.length).toBeGreaterThan(0);
    });

    it('skips a frame whose tick duplicates the previous appended tick', async () => {
        const { manager } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(VIEWER, 0)); // duplicate — must be skipped
        manager.recordSnapshot(frame(VIEWER, 1));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 1]);
    });

    it('measures ordering against the last appended tick, not a skipped frame', async () => {
        const { manager } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(OTHER_VIEWER, 9)); // foreign seat — skipped, must not raise the bar
        manager.recordSnapshot(frame(VIEWER, 1));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 1]);
    });

    it('skips a frame whose snapshot.tick disagrees with frame.tick', async () => {
        const { manager, sink } = makeManager();
        const mismatched: PerspectiveReplayFrame = {
            tick: 5,
            snapshot: makeSnapshot(VIEWER, 4),
        };

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(mismatched); // outer/inner tick disagree — must be skipped
        manager.recordSnapshot(frame(VIEWER, 6));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 6]);
        const warns = sink.entries.filter(
            (e) => e.level === 'warn' && e.source.module === 'perspective-replay-manager',
        );
        expect(warns.length).toBeGreaterThan(0);
    });

    it('does not throw on an out-of-order or mismatched frame', () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 5));

        expect(() => manager.recordSnapshot(frame(VIEWER, 2))).not.toThrow();
        expect(() =>
            manager.recordSnapshot({ tick: 9, snapshot: makeSnapshot(VIEWER, 8) }),
        ).not.toThrow();
    });
});

// ── Abort (mid-match session close) ──────────────────────────────────────────

// ── exportCurrent (idempotent post-game export) ──────────────────────────────

describe('PerspectiveReplayManager — exportCurrent', () => {
    it('finalises the active recording and returns a loadable path', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(VIEWER, 3));

        const savedPath = await manager.exportCurrent();

        const loaded = await manager.load(savedPath);
        expect(loaded.frames).toHaveLength(2);
    });

    it('returns the already-saved path when the recording was finalised at game-over', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        const autoSaved = await manager.finalise();

        await expect(manager.exportCurrent()).resolves.toBe(autoSaved);
        expect(await manager.list('tactics')).toStrictEqual([autoSaved]);
    });

    it('is repeatable — twice returns the same path and writes one file', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));

        const first = await manager.exportCurrent();
        const second = await manager.exportCurrent();

        expect(second).toBe(first);
        expect(await manager.list('tactics')).toStrictEqual([first]);
    });

    it('rejects when nothing has ever been recorded', async () => {
        const { manager } = makeManager();
        await expect(manager.exportCurrent()).rejects.toThrow(/no recording|no saved replay/i);
    });

    it('does not leak a previous match path after a new recording starts', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        await manager.finalise();

        manager.start(makeStartHeader());
        manager.abort();

        await expect(manager.exportCurrent()).rejects.toThrow(/no recording|no saved replay/i);
    });
});

// ── getCurrentFile (in-memory preview, no write) ─────────────────────────────

describe('PerspectiveReplayManager — getCurrentFile', () => {
    it('assembles the in-progress recording as a PerspectiveReplayFile without writing or clearing', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        manager.recordSnapshot(frame(VIEWER, 4));

        const file = manager.getCurrentFile();

        expect(file.kind).toBe('perspective');
        expect(file.viewerId).toBe(VIEWER);
        expect(file.frames.map((f) => f.tick)).toStrictEqual([0, 4]);
        expect(file.durationTicks).toBe(4);
        // Nothing persisted…
        expect(await manager.list('tactics')).toStrictEqual([]);
        // …and the recording survives for a later explicit save.
        await expect(manager.finalise()).resolves.toBeTruthy();
    });

    it('returns a defensively-copied frames array (mutation cannot corrupt the pending save)', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));

        const file = manager.getCurrentFile();
        (file.frames as unknown[]).push(frame(VIEWER, 99));

        const savedPath = await manager.finalise();
        const loaded = await manager.load(savedPath);
        expect(loaded.frames).toHaveLength(1);
    });

    it('throws when no recording is in progress', () => {
        const { manager } = makeManager();
        expect(() => manager.getCurrentFile()).toThrow(/no recording/);
    });
});

// ── abort (mid-match session close) ──────────────────────────────────────────

describe('PerspectiveReplayManager — abort', () => {
    it('discards the in-progress recording without persisting', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));

        manager.abort();

        expect(await manager.list('tactics')).toStrictEqual([]);
        await expect(manager.finalise()).rejects.toThrow(/no recording/);
    });

    it('lets a fresh recording start afterwards without leaking frames', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 7));
        manager.abort();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.frames).toHaveLength(1);
        expect(loaded.frames[0]?.tick).toBe(0);
    });

    it('is a no-op when no recording is in progress', () => {
        const { manager } = makeManager();
        expect(() => manager.abort()).not.toThrow();
    });
});

// ── isRecording (mutual-exclusion query) ─────────────────────────────────────

describe('PerspectiveReplayManager — isRecording', () => {
    it('is false before start, true while recording, false after finalise', async () => {
        const { manager } = makeManager();
        expect(manager.isRecording()).toBe(false);

        manager.start(makeStartHeader());
        expect(manager.isRecording()).toBe(true);

        manager.recordSnapshot(frame(VIEWER, 0));
        expect(manager.isRecording()).toBe(true);

        await manager.finalise();
        expect(manager.isRecording()).toBe(false);
    });

    it('is false after abort', () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        expect(manager.isRecording()).toBe(true);

        manager.abort();
        expect(manager.isRecording()).toBe(false);
    });
});

// ── Compatibility guard (engineVersion) ──────────────────────────────────────

describe('PerspectiveReplayManager — load compatibility guard', () => {
    it('load throws ReplayVersionError on an engine-version mismatch', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader({ engineVersion: '0.0.9' }));
        manager.recordSnapshot(frame(VIEWER, 0));
        const savedPath = await manager.finalise();

        await expect(manager.load(savedPath)).rejects.toBeInstanceOf(ReplayVersionError);
    });

    it('load returns the file when the engine version matches', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        const savedPath = await manager.finalise();

        const loaded = await manager.load(savedPath);
        expect(loaded.engineVersion).toBe('0.1.0');
    });
});

// ── Delegation ───────────────────────────────────────────────────────────────

describe('PerspectiveReplayManager — delegation', () => {
    it('list delegates to the repository (newest-first)', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader({ recordedAt: '2026-01-01T00:00:00.000Z' }));
        const older = await manager.finalise();
        manager.start(makeStartHeader({ recordedAt: '2026-06-01T00:00:00.000Z' }));
        const newer = await manager.finalise();

        expect(await manager.list('tactics')).toStrictEqual([newer, older]);
    });

    it('delete delegates to the repository', async () => {
        const { manager } = makeManager();
        manager.start(makeStartHeader());
        const savedPath = await manager.finalise();

        await manager.delete(savedPath);

        expect(await manager.list('tactics')).toStrictEqual([]);
    });
});

// ── Logging (invariant #67) ──────────────────────────────────────────────────

describe('PerspectiveReplayManager — logging', () => {
    it('logs at debug under the perspective-replay-manager module on public methods', async () => {
        const { manager, sink } = makeManager();

        manager.start(makeStartHeader());
        manager.recordSnapshot(frame(VIEWER, 0));
        await manager.finalise();
        await manager.list('tactics');

        const debugFromManager = sink.entries.filter(
            (e) => e.level === 'debug' && e.source.module === 'perspective-replay-manager',
        );
        expect(debugFromManager.length).toBeGreaterThan(0);
        expect(debugFromManager.map((e) => e.message)).toContain('start');
    });
});
