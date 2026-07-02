/**
 * electron/main/__tests__/replay-wiring.integration.test.ts
 *
 * Integration tests for live-match replay recording wired into
 * `buildHostSessionPipeline` via the additive `ReplayPort` (F44 / T4, #658).
 *
 * Tests written FIRST (red); implementation in
 * `electron/main/runtime/HostSessionPipeline.ts` and `replay-manager.ts`.
 *
 * Invariants verified:
 *   #3/#71 — only the `EngineAction` payload is recorded; never a GameSnapshot.
 *   #42    — the recorded tick is the action's tick at the time it was applied.
 *   #25 (spirit) — a replay failure never propagates to the live pipeline.
 */

import { mkdtemp, rm, readdir } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutoSavePort, ReplayPort } from '../runtime/HostSessionPipeline.js';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    ActionDefinition,
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import { JsonReplaySerializer, ReplayMigrator } from '@chimera-engine/simulation/replay/index.js';
import type { ReplayHeader } from '@chimera-engine/simulation/replay/index.js';
import { FileReplayRepository } from '../replay/FileReplayRepository.js';
import { ReplayManager } from '../replay/replay-manager.js';
import type { ReplayEngineIdentity } from '../replay/replay-manager.js';
import { createLogger, createMemorySink } from '../logging/logger.js';

// ── Player IDs ─────────────────────────────────────────────────────────────────

const P1 = toPlayerId('player-1');

// ── Snapshot + envelope helpers ──────────────────────────────────────────────

function makeBaseSnapshot(tick = 0, playerIds: readonly PlayerId[] = [P1]): BaseGameSnapshot {
    return {
        tick,
        seed: 42,
        players: Object.fromEntries(playerIds.map((id) => [id, { id }])),
        entities: {},
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

const advanceEnvelope = (tick: number): ActionEnvelope => ({
    type: 'game:advance',
    playerId: P1,
    tick,
    payload: {},
});

const advanceDef: ActionDefinition<Record<string, never>> = {
    type: 'game:advance',
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state) => ({ ...state, tick: state.tick + 1 }),
};

function makeRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(advanceDef);
    return registry;
}

/** Registry whose game resolves once `tick >= threshold` (drives match-end). */
function makeRegistryResolvingAt(threshold: number): ActionRegistry {
    const registry = makeRegistry();
    registry.registerGame('tactics', {
        resolveGameResult: (snapshot) => (snapshot.tick >= threshold ? { winnerIds: [P1] } : null),
    });
    return registry;
}

const noopSavePort: AutoSavePort = { autoSave: () => Promise.resolve() };

function makeFakeReplayPort(): {
    port: ReplayPort;
    startRecording: ReturnType<typeof vi.fn>;
    recordAction: ReturnType<typeof vi.fn>;
} {
    const startRecording = vi.fn();
    const recordAction = vi.fn();
    return {
        port: { startRecording, recordAction },
        startRecording,
        recordAction,
    };
}

// ── AC2: every successful action is recorded ──────────────────────────────────

describe('buildHostSessionPipeline — replay recording (AC2)', () => {
    it('records each successfully applied action with its tick, playerId, and payload', () => {
        const { port, recordAction } = makeFakeReplayPort();
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort: port,
        });

        const s0 = makeBaseSnapshot(0, [P1]);
        const s1 = processAction(s0, advanceEnvelope(0));
        const s2 = processAction(s1, advanceEnvelope(1));
        processAction(s2, advanceEnvelope(2));

        expect(recordAction).toHaveBeenCalledTimes(3);
        expect(recordAction.mock.calls.map((c) => c[0].tick)).toStrictEqual([0, 1, 2]);
        expect(recordAction.mock.calls[0]?.[0]).toMatchObject({
            tick: 0,
            playerId: P1,
            action: { type: 'game:advance', playerId: P1, tick: 0 },
        });
    });

    it('records only the EngineAction payload — never a snapshot (invariant #3/#71)', () => {
        const { port, recordAction } = makeFakeReplayPort();
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort: port,
        });

        processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(0));

        const entry = recordAction.mock.calls[0]?.[0];
        expect(Object.keys(entry)).toStrictEqual(['tick', 'playerId', 'action']);
        expect(entry.action).not.toHaveProperty('entities');
        expect(entry.action).not.toHaveProperty('players');
    });

    it('does not record when the pipeline rejects the action', () => {
        const { port, recordAction } = makeFakeReplayPort();
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort: port,
        });

        // Stale tick (action.tick !== snapshot.tick) → pipeline throws.
        expect(() => processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(5))).toThrow();
        expect(recordAction).not.toHaveBeenCalled();
    });
});

// ── AC3: match end retains the recording, but never persists it ───────────────
// The match is no longer written at game-over; the recording is retained in
// memory and persisted only on an explicit save (ReplayManager.exportCurrentMatch),
// so no finished match silently accumulates a replay file. The pipeline's
// `ReplayPort` therefore exposes no persistence hook at all.

describe('buildHostSessionPipeline — match end retains, does not persist (AC3)', () => {
    it('captures the resolving action but the pipeline exposes no persistence hook', () => {
        const { port, recordAction } = makeFakeReplayPort();
        const { processAction } = buildHostSessionPipeline(makeRegistryResolvingAt(1), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort: port,
        });

        // advance 0 → 1 resolves the match.
        processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(0));

        // The resolving action is still recorded…
        expect(recordAction).toHaveBeenCalledTimes(1);
        // …but there is no `finaliseRecording` on the port — persistence is gated on
        // an explicit save, never driven by the pipeline at game-over.
        expect(port).not.toHaveProperty('finaliseRecording');
    });
});

// ── AC4: nothing recorded after resolution / side-channel excluded ────────────

describe('buildHostSessionPipeline — replay scope (AC4)', () => {
    it('does not record actions applied after the match has resolved', () => {
        const { port, recordAction } = makeFakeReplayPort();
        const { processAction } = buildHostSessionPipeline(makeRegistryResolvingAt(1), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort: port,
        });

        const s1 = processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(0)); // resolves
        recordAction.mockClear();

        // The pipeline rejects ordinary gameplay actions on a resolved match, and
        // the `!wasResolved` guard ensures any action still allowed afterwards is
        // not appended to the retained recording either.
        expect(() => processAction(s1, advanceEnvelope(s1.tick))).toThrow(/match_already_resolved/);
        expect(recordAction).not.toHaveBeenCalled();
        // NOTE (AC4 — side channels): chat / profile / toast traffic never reaches
        // `processAction` (it travels on separate IPC channels), so it is excluded
        // from recordings by construction; there is no pipeline path to assert.
    });
});

// ── Robustness: replay failure never breaks the live pipeline (invariant #25) ─

describe('buildHostSessionPipeline — replay robustness', () => {
    it('a throwing recordAction does not break processAction', () => {
        const port: ReplayPort = {
            startRecording: vi.fn(),
            recordAction: vi.fn(() => {
                throw new Error('record boom');
            }),
        };
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort: port,
        });

        let result: BaseGameSnapshot | undefined;
        expect(() => {
            result = processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(0));
        }).not.toThrow();
        expect(result?.tick).toBe(1);
    });

    it('works without a replayPort (the hook is purely additive)', () => {
        const { processAction } = buildHostSessionPipeline(makeRegistry(), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
        });

        expect(() => processAction(makeBaseSnapshot(0, [P1]), advanceEnvelope(0))).not.toThrow();
    });
});

// ── End-to-end: real ReplayManager + FileReplayRepository ─────────────────────

describe('replay wiring — end-to-end persistence', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await mkdtemp(path.join(os.tmpdir(), 'chimera-replay-wiring-test-'));
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    const IDENTITY: ReplayEngineIdentity = {
        engineVersion: '0.1.0',
        gameVersions: new Map([['tactics', '0.1.0']]),
    };

    function makeHeader(): ReplayHeader {
        return {
            engineVersion: '0.1.0',
            gameId: 'tactics',
            gameVersion: '0.1.0',
            gameConfig: { playerIds: [P1], phase: 'playing' },
            seed: 42,
            recordedAt: '2026-06-02T10:00:00.000Z',
            players: [{ playerId: P1, displayName: 'Player One' }],
        };
    }

    it('a resolved 3-action match writes NOTHING until an explicit save, then one .chimera-replay (3 actions, no .tmp)', async () => {
        const sink = createMemorySink();
        const logger = createLogger({ source: { process: 'main', module: 'test' }, sink });
        const manager = new ReplayManager(
            new FileReplayRepository(new JsonReplaySerializer(), tmpDir),
            new ReplayMigrator(),
            IDENTITY,
            logger,
        );
        const replayPort: ReplayPort = {
            startRecording: (header) => manager.startRecording(header),
            recordAction: (entry) => manager.recordAction(entry),
        };

        const { processAction } = buildHostSessionPipeline(makeRegistryResolvingAt(3), vi.fn(), {
            gameId: 'tactics',
            savePort: noopSavePort,
            replayPort,
        });

        replayPort.startRecording(makeHeader());
        const s0 = makeBaseSnapshot(0, [P1]);
        const s1 = processAction(s0, advanceEnvelope(0));
        const s2 = processAction(s1, advanceEnvelope(1));
        processAction(s2, advanceEnvelope(2)); // tick → 3 resolves — but nothing is written

        // Game-over does NOT persist: the disk stays empty and the recording is
        // retained in memory (the preview player can still read it via
        // getCurrentMatchFile).
        expect(await manager.list('tactics')).toHaveLength(0);
        expect(manager.getCurrentMatchFile().actions).toHaveLength(3);

        // The explicit save (player's save icon → exportCurrentMatch) writes the
        // single file.
        await manager.exportCurrentMatch();

        const paths = await manager.list('tactics');
        expect(paths).toHaveLength(1);
        const loaded = await manager.load(paths[0]!);
        expect(loaded.actions).toHaveLength(3);
        expect(loaded.actions.map((a) => a.tick)).toStrictEqual([0, 1, 2]);
        expect(loaded.seed).toBe(42);

        const entries = await readdir(path.join(tmpDir, 'tactics'));
        expect(entries.filter((n) => n.endsWith('.chimera-replay'))).toHaveLength(1);
        expect(entries.filter((n) => n.endsWith('.tmp'))).toHaveLength(0);
    });
});
