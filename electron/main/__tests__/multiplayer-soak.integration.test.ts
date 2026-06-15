/**
 * electron/main/__tests__/multiplayer-soak.integration.test.ts
 *
 * F48 — Multiplayer Soak & Obfuscation Soak (in-process, 4 clients) `§10`.
 *
 * Exercises the production host fan-out path end-to-end with FOUR clients over
 * a 1 000-tick run, wiring the real ActionPipeline (via buildHostSessionPipeline)
 * → DefaultStateProjector → StateBroadcaster → InMemoryMultiplayerProvider. The
 * authoritative GameSnapshot never leaves this process; only the per-viewer
 * PlayerSnapshot reaches each client (Invariants #3 / #8).
 *
 * Covers F48 bullet 1 — "1 000-tick, 4-client soak with checksum convergence at
 * every step" — through two assertions:
 *   - Delivery + obfuscation: every one of the 4 × 1 000 delivered snapshots is
 *     leak-free (`assertNoLeakedFields`), the time-series multiplayer flavour of
 *     the obfuscation soak (§10.1 "Obfuscation soak: 1000 ticks").
 *   - Convergence at every step: two independent runs with an identical seed and
 *     action stream produce byte-identical per-viewer checksum sequences across
 *     all 1 000 steps (§10.1 "Determinism soak: identical checksum at every step").
 *
 * F48 bullets 2 (10 000-snapshot obfuscation) and 3 (commitment anti-tamper) are
 * already covered by simulation/projection/__tests__/StateProjector.property.test.ts
 * and simulation/projection/CommitmentScheme.test.ts respectively.
 *
 * Determinism note: a fresh InMemoryMultiplayerProvider assigns its client ids
 * from a per-instance counter, so two runs with the same host+join sequence
 * yield the SAME viewer ids — making cross-run checksum comparison valid.
 *
 * Module boundary: electron/main/ may import simulation/ + networking/. No
 * Electron APIs are touched, so this runs in vitest's node environment like the
 * neighbouring obfuscation.integration.test.ts.
 */

import { describe, expect, it } from 'vitest';

import type {
    ActionDefinition,
    BaseEntityState,
    BaseGameSnapshot,
    BasePlayerState,
    EntityId,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import {
    entityId as toEntityId,
    gamePhase,
    playerId as toPlayerId,
} from '@chimera/simulation/engine/types.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import { DefaultStateProjector } from '@chimera/simulation/projection/StateProjector.js';
import type { PlayerSnapshot } from '@chimera/simulation/projection/StateProjector.js';
import {
    assertNoLeakedFields,
    ObfuscationAssertionError,
} from '@chimera/simulation/projection/assertNoLeakedFields.js';
import type { VisibilityRules } from '@chimera/simulation/projection/types.js';
import { InMemoryMultiplayerProvider } from '@chimera/networking/provider/InMemoryMultiplayerProvider.js';
import type { PlayerSnapshot as WirePlayerSnapshot } from '@chimera/networking/provider/MultiplayerProvider.js';

import { createNoopLogger } from '../logging/logger.js';
import { StateBroadcaster } from '../runtime/StateBroadcaster.js';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';

// ── Soak parameters ──────────────────────────────────────────────────────────

const SOAK_TICKS = 1_000;
const CLIENT_COUNT = 4;
const SOAK_ADVANCE = 'soak:advance';

// ── Game state shapes ────────────────────────────────────────────────────────

/** Each player carries a public score and an owner-only `secret`. */
interface SoakPlayerState extends BasePlayerState {
    readonly score: number;
    readonly secret: { readonly plan: string };
}

/** Masked player as projected to a viewer: secret is marked for the owner, null otherwise. */
interface SoakObservedPlayer extends BasePlayerState {
    readonly score: number;
    readonly secret: { readonly __visibility: 'owner-only'; readonly plan: string } | null;
}

/** Units are fog-hidden from non-owners; terrain is public. */
interface SoakEntityState extends BaseEntityState {
    readonly ownerId: PlayerId;
    readonly kind: 'unit' | 'terrain';
    readonly hp: number;
}

interface SoakSnapshot extends BaseGameSnapshot {
    readonly players: Record<PlayerId, SoakPlayerState>;
    readonly entities: Record<EntityId, SoakEntityState>;
}

// ── Visibility rules ─────────────────────────────────────────────────────────

const soakRules: VisibilityRules<
    SoakSnapshot,
    SoakEntityState,
    SoakPlayerState,
    SoakEntityState,
    SoakObservedPlayer
> = {
    // Fog of war: units visible only to their owner; terrain visible to all.
    isEntityVisible(entity, viewer) {
        return entity.kind === 'terrain' || entity.ownerId === viewer;
    },
    // Surviving entities (own units / terrain) carry no owner-only markers.
    maskEntity(entity) {
        return entity;
    },
    maskPlayerState(player, viewer): SoakObservedPlayer {
        if (player.id === viewer) {
            return {
                id: player.id,
                score: player.score,
                secret: { __visibility: 'owner-only', plan: player.secret.plan },
            };
        }
        return { id: player.id, score: player.score, secret: null };
    },
    filterEvents(events) {
        return events;
    },
};

// ── soak:advance — a deterministic, state-mutating driver ────────────────────
//
// soak:advance mutates every player's owner-only data via ctx.rng (seeded from
// (seed, tick)) so each step produces a distinct, fully-projected PlayerSnapshot
// for all viewers — giving the projector real masking work and the convergence
// check changing checksums.
//
// This soak deliberately drives with soak:advance, never a bare engine:tick: a
// bare tick is "clock-only" (ActionPipeline #isClockOnlyTick) and broadcasts only
// a tick number, not a full snapshot — which would starve the obfuscation and
// convergence assertions below. That clock-only routing is NOT exercised here; it
// is covered on its own by ActionPipeline.test.ts ("routes idle engine:tick
// through broadcastTick without full broadcast") and StateBroadcaster.test.ts
// ("broadcastTick sends only the tick without projecting or sending a full
// snapshot").

const soakAdvanceDefinition: ActionDefinition<Record<string, never>> = {
    type: SOAK_ADVANCE,
    parsePayload: () => ({}),
    validate: () => ({ ok: true }),
    reduce: (state, _payload, _playerId, ctx) => {
        const soak = state as SoakSnapshot;
        const players = Object.create(null) as Record<PlayerId, SoakPlayerState>;
        for (const [pid, player] of Object.entries(soak.players)) {
            const bump = ctx.rng.int(1, 6);
            players[pid as PlayerId] = {
                ...player,
                score: player.score + bump,
                secret: { plan: `plan-${state.tick}-${bump}` },
            };
        }
        return { ...state, tick: state.tick + 1, players };
    },
};

// ── Snapshot factory ─────────────────────────────────────────────────────────

function makeInitialSnapshot(seed: number, ids: readonly PlayerId[]): SoakSnapshot {
    const players = Object.create(null) as Record<PlayerId, SoakPlayerState>;
    const entities = Object.create(null) as Record<EntityId, SoakEntityState>;

    const terrain = toEntityId('terrain-0');
    entities[terrain] = { id: terrain, ownerId: ids[0]!, kind: 'terrain', hp: 100 };

    ids.forEach((pid, idx) => {
        players[pid] = { id: pid, score: 0, secret: { plan: `init-${idx}` } };
        const unit = toEntityId(`unit-${idx}`);
        entities[unit] = { id: unit, ownerId: pid, kind: 'unit', hp: 10 };
    });

    return {
        tick: 0,
        seed,
        players,
        entities,
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

// ── Soak runner ──────────────────────────────────────────────────────────────

interface ClientFrame {
    readonly tick: number;
    readonly checksum: number;
    // The wire-typed snapshot a client actually received. At runtime it is the
    // simulation projection; we re-assert the projection contract on it below.
    readonly snapshot: WirePlayerSnapshot;
}

interface ClientCapture {
    readonly id: PlayerId;
    readonly frames: ClientFrame[];
}

/**
 * Run the full host fan-out: host a lobby, join CLIENT_COUNT clients, then drive
 * `ticks` soak:advance actions through the real pipeline + broadcaster, recording
 * every snapshot (with the transport-computed CRC32) each client receives.
 */
async function runSoak(seed: number, ticks: number): Promise<ClientCapture[]> {
    const provider = new InMemoryMultiplayerProvider();
    const host = await provider.hostLobby({ gameId: 'soak', maxPlayers: CLIENT_COUNT });

    const captures: ClientCapture[] = [];
    for (let i = 0; i < CLIENT_COUNT; i++) {
        const joined = await provider.joinLobby({ address: host.lobbyCode });
        const frames: ClientFrame[] = [];
        joined.transport.onSnapshotReceived((snapshot, checksum) => {
            frames.push({ tick: snapshot.tick, checksum, snapshot });
        });
        captures.push({ id: joined.localPlayerId, frames });
    }

    const projector = new DefaultStateProjector(soakRules);
    const broadcaster = new StateBroadcaster(host.transport, projector, createNoopLogger());

    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registry.register(soakAdvanceDefinition);

    const { processAction } = buildHostSessionPipeline(
        registry,
        broadcaster.broadcast.bind(broadcaster),
        broadcaster.broadcastTick.bind(broadcaster),
    );

    let state: BaseGameSnapshot = makeInitialSnapshot(
        seed,
        captures.map((c) => c.id),
    );
    const driver = captures[0]!.id;
    for (let i = 0; i < ticks; i++) {
        state = processAction(state, {
            type: SOAK_ADVANCE,
            playerId: driver,
            tick: state.tick,
            payload: {},
        });
    }

    broadcaster.dispose();
    provider.dispose();
    return captures;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('F48 — multiplayer & obfuscation soak (4 clients, 1000 ticks)', () => {
    it('delivers 1000 contiguous snapshots to each of 4 clients with zero owner-only leaks', async () => {
        const captures = await runSoak(20_260_615, SOAK_TICKS);

        expect(captures).toHaveLength(CLIENT_COUNT);
        const allIds = captures.map((c) => c.id);

        for (const capture of captures) {
            expect(capture.frames).toHaveLength(SOAK_TICKS);
            capture.frames.forEach((frame, index) => {
                // Clock advanced exactly once per step: ticks run 1..1000 in order.
                expect(frame.tick).toBe(index + 1);
                expect(frame.snapshot.viewerId).toBe(capture.id);
                // Obfuscation soak: no owner-only / hidden field reaches a non-owner.
                assertNoLeakedFields(frame.snapshot as PlayerSnapshot, capture.id, allIds);
            });
        }
    }, 60_000);

    it('produces byte-identical per-viewer checksum sequences across two independent runs (convergence at every step)', async () => {
        const runA = await runSoak(777, SOAK_TICKS);
        const runB = await runSoak(777, SOAK_TICKS);

        // Fresh providers replay the same id-assignment sequence → same viewer ids.
        expect(runA.map((c) => c.id)).toEqual(runB.map((c) => c.id));

        for (let i = 0; i < CLIENT_COUNT; i++) {
            const a = runA[i]!.frames.map((f) => f.checksum);
            const b = runB[i]!.frames.map((f) => f.checksum);
            expect(a).toHaveLength(SOAK_TICKS);
            // Checksums vary per step (mutating state) yet match across runs.
            expect(new Set(a).size).toBeGreaterThan(1);
            expect(a).toEqual(b);
        }
    }, 60_000);

    it('obfuscation guard has teeth: a leaky projection is rejected', () => {
        // Negative control — a rule that marks every player's secret owner-only
        // regardless of viewer must trip assertNoLeakedFields for a non-owner.
        const leakyRules: typeof soakRules = {
            ...soakRules,
            maskPlayerState: (player): SoakObservedPlayer => ({
                id: player.id,
                score: player.score,
                secret: { __visibility: 'owner-only', plan: player.secret.plan },
            }),
        };
        const projector = new DefaultStateProjector(leakyRules);
        const ids = [toPlayerId('p1'), toPlayerId('p2')];
        const projected = projector.project(makeInitialSnapshot(1, ids), ids[1]!);

        expect(() => assertNoLeakedFields(projected, ids[1]!, ids)).toThrow(
            ObfuscationAssertionError,
        );
    });
});
