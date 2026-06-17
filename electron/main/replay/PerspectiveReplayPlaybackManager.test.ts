/**
 * electron/main/replay/PerspectiveReplayPlaybackManager.test.ts
 *
 * Unit tests for PerspectiveReplayPlaybackManager (§4.28, ADR F44b, F44b / T6,
 * #672). Tests written first (RED before implementation).
 *
 * Perspective playback is *verbatim*: it walks the stored, already-projected
 * `PlayerSnapshot` frames for a single locked `viewerId` and never re-runs the
 * simulation (invariant #98). Fixtures are produced by recording through a real
 * `PerspectiveReplayManager` (T4) backed by an in-memory repository, then handing
 * the manager to the playback manager as its loader port — so the test exercises
 * the same load + engineVersion guard the production wiring uses.
 *
 * Also asserts the import boundary (invariant #70 carve-out): perspective playback
 * imports none of `ActionRegistry`, `ActionPipeline`, `StateProjector`, or
 * `buildHostSessionPipeline`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InMemoryPerspectiveReplayRepository } from '@chimera/simulation/replay/index.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import { playerId as toPlayerId, gamePhase } from '@chimera/simulation/engine/types.js';
import { createLogger, createMemorySink } from '../logging/logger.js';
import type { MemorySink } from '../logging/logger.js';
import { PerspectiveReplayManager } from './PerspectiveReplayManager.js';
import type { PerspectiveReplayStartHeader } from './PerspectiveReplayManager.js';
import { PerspectiveReplayPlaybackManager } from './PerspectiveReplayPlaybackManager.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const VIEWER = toPlayerId('p1');
const ENGINE_VERSION = '0.1.0';

function makeSnapshot(tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId: VIEWER,
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
        engineVersion: ENGINE_VERSION,
        gameId: 'tactics',
        gameVersion: '0.1.0',
        viewerId: VIEWER,
        recordedAt: '2026-06-02T10:00:00.000Z',
        players: [{ playerId: VIEWER, displayName: 'Player One' }],
        ...overrides,
    };
}

function makeLogger(): { logger: ReturnType<typeof createLogger>; sink: MemorySink } {
    const sink = createMemorySink();
    const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
    return { logger, sink };
}

/**
 * Record a perspective replay with the given frame ticks through a real
 * `PerspectiveReplayManager`, returning the saved path and a playback manager
 * wired to that manager as its loader port.
 */
async function seedPlayback(
    ticks: readonly number[],
    headerOverrides: Partial<PerspectiveReplayStartHeader> = {},
): Promise<{
    playback: PerspectiveReplayPlaybackManager;
    path: string;
    /** Sink of the logger injected into the returned playback manager. */
    sink: MemorySink;
}> {
    const repo = new InMemoryPerspectiveReplayRepository();
    const recorder = new PerspectiveReplayManager(
        repo,
        { engineVersion: ENGINE_VERSION },
        makeLogger().logger,
    );
    recorder.start(makeStartHeader(headerOverrides));
    for (const tick of ticks) {
        recorder.recordSnapshot({ tick, snapshot: makeSnapshot(tick) });
    }
    const path = await recorder.finalise();

    const { logger, sink } = makeLogger();
    const playback = new PerspectiveReplayPlaybackManager(recorder, logger);
    return { playback, path, sink };
}

// ── open ─────────────────────────────────────────────────────────────────────

describe('PerspectiveReplayPlaybackManager — open', () => {
    it('returns gameId, totalTicks, and the locked viewerId (no playerIds list)', async () => {
        const { playback, path } = await seedPlayback([0, 1, 5]);

        const info = await playback.open(path);

        expect(info.gameId).toBe('tactics');
        expect(info.totalTicks).toBe(5);
        expect(info.viewerId).toBe(VIEWER);
        expect((info as unknown as Record<string, unknown>)['playerIds']).toBeUndefined();
    });

    it('opening a new replay replaces the previous session', async () => {
        // One recorder/repo so a single playback manager can load both paths.
        const repo = new InMemoryPerspectiveReplayRepository();
        const recorder = new PerspectiveReplayManager(
            repo,
            { engineVersion: ENGINE_VERSION },
            makeLogger().logger,
        );
        recorder.start(makeStartHeader());
        for (const tick of [0, 1, 2])
            recorder.recordSnapshot({ tick, snapshot: makeSnapshot(tick) });
        const firstPath = await recorder.finalise();
        recorder.start(makeStartHeader({ recordedAt: '2026-06-03T10:00:00.000Z' }));
        for (const tick of [0, 1]) recorder.recordSnapshot({ tick, snapshot: makeSnapshot(tick) });
        const secondPath = await recorder.finalise();

        const playback = new PerspectiveReplayPlaybackManager(recorder, makeLogger().logger);
        await playback.open(firstPath);
        const info = await playback.open(secondPath);

        expect(info.totalTicks).toBe(1);
    });

    it('propagates the engineVersion guard from the loader', async () => {
        const { playback, path } = await seedPlayback([0], { engineVersion: '0.0.9' });

        await expect(playback.open(path)).rejects.toThrow();
    });
});

// ── snapshotAt (floor lookup) ────────────────────────────────────────────────

describe('PerspectiveReplayPlaybackManager — snapshotAt', () => {
    it('returns the exact stored snapshot for a matching tick', async () => {
        const { playback, path } = await seedPlayback([0, 1, 5]);
        await playback.open(path);

        expect(playback.snapshotAt(0).tick).toBe(0);
        expect(playback.snapshotAt(1).tick).toBe(1);
        expect(playback.snapshotAt(5).tick).toBe(5);
    });

    it('floor-returns the most recent frame at or before a gap tick', async () => {
        const { playback, path } = await seedPlayback([0, 1, 5]);
        await playback.open(path);

        expect(playback.snapshotAt(3).tick).toBe(1);
        expect(playback.snapshotAt(4).tick).toBe(1);
        expect(playback.snapshotAt(9).tick).toBe(5);
    });

    it('holds the earliest frame for a tick before the first recorded frame', async () => {
        // A joined client's perspective need not begin at tick 0, so the player
        // can open at tick 0 and must still get a frame (the earliest recorded
        // one) rather than an error.
        const { playback, path } = await seedPlayback([2, 3]);
        await playback.open(path);

        expect(playback.snapshotAt(0).tick).toBe(2);
        expect(playback.snapshotAt(1).tick).toBe(2);
    });

    it('throws when no session is open', () => {
        const { logger } = makeLogger();
        const playback = new PerspectiveReplayPlaybackManager(
            { load: () => Promise.reject(new Error('unused')) },
            logger,
        );

        expect(() => playback.snapshotAt(0)).toThrow(/no .*playback/i);
    });
});

// ── snapshotRange ────────────────────────────────────────────────────────────

describe('PerspectiveReplayPlaybackManager — snapshotRange', () => {
    it('returns exactly the stored frames whose tick falls within [from, to]', async () => {
        const { playback, path } = await seedPlayback([0, 1, 5, 8]);
        await playback.open(path);

        const range = playback.snapshotRange(1, 5);
        expect(range.map((s) => s.tick)).toStrictEqual([1, 5]);
    });

    it('returns an empty array when no stored frame falls in range', async () => {
        const { playback, path } = await seedPlayback([0, 1, 8]);
        await playback.open(path);

        expect(playback.snapshotRange(2, 7)).toStrictEqual([]);
    });

    it('includes frames from the first stored tick when `from` precedes it', async () => {
        const { playback, path } = await seedPlayback([2, 3, 5]);
        await playback.open(path);

        expect(playback.snapshotRange(0, 3).map((s) => s.tick)).toStrictEqual([2, 3]);
    });

    it('walks to the last stored frame when `to` exceeds the final tick', async () => {
        const { playback, path } = await seedPlayback([0, 1, 5, 8]);
        await playback.open(path);

        expect(playback.snapshotRange(3, 100).map((s) => s.tick)).toStrictEqual([5, 8]);
    });

    it('returns an empty array when the range is entirely after the last frame', async () => {
        const { playback, path } = await seedPlayback([0, 1, 5]);
        await playback.open(path);

        expect(playback.snapshotRange(6, 10)).toStrictEqual([]);
    });

    it('throws when from > to', async () => {
        const { playback, path } = await seedPlayback([0, 1]);
        await playback.open(path);

        expect(() => playback.snapshotRange(5, 1)).toThrow();
    });

    it('throws when no session is open', () => {
        const { logger } = makeLogger();
        const playback = new PerspectiveReplayPlaybackManager(
            { load: () => Promise.reject(new Error('unused')) },
            logger,
        );

        expect(() => playback.snapshotRange(0, 1)).toThrow(/no .*playback/i);
    });
});

// ── close ────────────────────────────────────────────────────────────────────

describe('PerspectiveReplayPlaybackManager — close', () => {
    it('releases the active session (a subsequent snapshotAt throws)', async () => {
        const { playback, path } = await seedPlayback([0, 1]);
        await playback.open(path);

        playback.close();

        expect(() => playback.snapshotAt(0)).toThrow(/no .*playback/i);
    });

    it('is a no-op when no session is open', () => {
        const { logger } = makeLogger();
        const playback = new PerspectiveReplayPlaybackManager(
            { load: () => Promise.reject(new Error('unused')) },
            logger,
        );

        expect(() => playback.close()).not.toThrow();
    });
});

// ── Logging (invariant #67) ──────────────────────────────────────────────────

describe('PerspectiveReplayPlaybackManager — logging', () => {
    it('logs at debug under the perspective-replay-playback-manager module', async () => {
        const { playback, path, sink } = await seedPlayback([0]);
        await playback.open(path);
        playback.close();

        const debugFromManager = sink.entries.filter(
            (e) => e.level === 'debug' && e.source.module === 'perspective-replay-playback-manager',
        );
        expect(debugFromManager.length).toBeGreaterThan(0);
        expect(debugFromManager.map((e) => e.message)).toContain('open');
    });
});

// ── Import boundary (invariant #70 carve-out, invariant #98) ──────────────────

describe('PerspectiveReplayPlaybackManager — import boundary', () => {
    it('imports none of ActionRegistry, ActionPipeline, StateProjector, buildHostSessionPipeline', () => {
        const sourcePath = fileURLToPath(
            new URL('./PerspectiveReplayPlaybackManager.ts', import.meta.url),
        );
        // Strip comments so the doc-block's mentions of the forbidden symbols
        // don't trip the check — perspective playback never references these
        // simulation/pipeline modules in code (invariant #70 carve-out, #98).
        const code = readFileSync(sourcePath, 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');

        for (const forbidden of [
            'ActionRegistry',
            'ActionPipeline',
            'StateProjector',
            'buildHostSessionPipeline',
        ]) {
            expect(code).not.toContain(forbidden);
        }
    });
});
