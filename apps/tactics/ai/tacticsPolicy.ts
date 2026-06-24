/**
 * apps/tactics/ai/tacticsPolicy.ts
 *
 * Tactics AI policy (issue #725). A game-owned policy: it lives in the tactics
 * game package and is built on the game-agnostic `ai/` framework. It reads the
 * viewer-safe `PlayerSnapshot` and emits the same `tactics:move_unit` /
 * `tactics:attack` / `engine:end_turn` EngineActions a human would, through the
 * normal command-dispatch path.
 *
 * Behaviour, on the AI player's turn (one action per idle tick):
 *   - Act with a single owned unit — the lowest entity id. The shipping tactics
 *     content seats exactly one unit per player, so this is the unit; a future
 *     multi-unit build would extend this to cycle units by remaining stamina.
 *   - Attack a visible enemy on an adjacent (different) tile.
 *   - If the AI's unit shares the enemy's tile, vacate to an adjacent tile first
 *     (which makes the unit adjacent), then attack next idle tick.
 *   - Otherwise step toward the nearest visible enemy, reducing Manhattan distance.
 *   - With no visible enemy, wander to a legal adjacent tile.
 *   - Spend stamina like a human (1 per action); close the turn at 0 stamina or
 *     when no useful action remains — via `engine:end_turn` in sequential mode,
 *     or `tactics:commit` in commitment (simultaneous) mode (see
 *     {@link finishTurnAction}). The turn mode is read off the projected
 *     `setup.matchSettings`, so the decision stays a pure function of the snapshot.
 *
 * Honest vs omniscient (Invariant #17): the policy is built for the honest,
 * projected snapshot (the only shipping path — `omniscient` is opt-in and off by
 * default). It also reads correctly under an omniscient (projection-bypassed)
 * snapshot: enemy `visibleTo` membership is honoured (so it never targets a
 * unit the engine would reject as not-visible) and stamina falls back to the raw
 * ledger — so it self-ends its turn in either mode.
 *
 * Determinism (no `Math.random`): decisions are a pure function of the projected
 * snapshot. The only "random" choice — which way to wander — is derived from
 * `snapshot.tick`, a deterministic engine input, preserving replay guarantees.
 *
 * Boundaries (§3): a game package module — it imports its own game's constants
 * (`apps/tactics/constants.ts`: action strings, board extents, stamina), the
 * game-agnostic `ai/` framework (contract types via the `@chimera/ai` barrel),
 * and `simulation/` types only.
 * The pure `ai/` framework holds zero tactics-specific code (Invariants #106/#107).
 *
 * Invariants upheld:
 *   #16 — only emits EngineActions (dispatched through ActionPipeline); no direct
 *          state mutation.
 *   #17 — operates on the honest projected snapshot by default; omniscient mode
 *          is opt-in and handled (see above).
 */

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_BOARD_MAX_X,
    TACTICS_BOARD_MAX_Y,
    TACTICS_BOARD_MIN_X,
    TACTICS_BOARD_MIN_Y,
    TACTICS_COMMIT_ACTION,
    TACTICS_MAX_STAMINA,
    TACTICS_MOVE_UNIT_ACTION,
    readTacticsTurnMode,
} from '@chimera/tactics/constants.js';
import type { EngineAction, EntityId, PlayerId } from '@chimera/simulation/engine/types.js';
import type { AIState, PlayerSnapshot } from '@chimera/ai';

const ENGINE_END_TURN_ACTION = 'engine:end_turn';
const TACTICS_AI_STATE_NAME = 'tactics:auto-play';

/** Cardinal neighbours in a fixed order — the only source of "direction". */
const DIRECTIONS: readonly { readonly dx: number; readonly dy: number }[] = [
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
];

/** The tactics-relevant fields read off a projected (generic) entity. */
interface TacticsUnitView {
    readonly id: EntityId;
    readonly ownerId: PlayerId;
    readonly x: number;
    readonly y: number;
    readonly hp: number;
    readonly visibleTo?: readonly PlayerId[];
}

interface Tile {
    readonly x: number;
    readonly y: number;
}

/**
 * Narrow a projected entity to a tactics unit, reading only generic fields so
 * this policy needs no `apps/tactics` import. Mirrors the shape check in
 * `apps/tactics/actions.ts`.
 */
function asTacticsUnit(entity: unknown): TacticsUnitView | null {
    const candidate = entity as {
        readonly id?: unknown;
        readonly kind?: unknown;
        readonly ownerId?: unknown;
        readonly x?: unknown;
        readonly y?: unknown;
        readonly hp?: unknown;
        readonly visibleTo?: unknown;
    };
    if (
        candidate.kind === 'unit' &&
        typeof candidate.id === 'string' &&
        typeof candidate.ownerId === 'string' &&
        Number.isInteger(candidate.x) &&
        Number.isInteger(candidate.y) &&
        Number.isInteger(candidate.hp)
    ) {
        return candidate as TacticsUnitView;
    }
    return null;
}

/**
 * The viewer's own remaining stamina.
 *
 * Honest (projected) snapshots attach the viewer's stamina to its player state
 * (`maskPlayerState`), so that is the primary source. Omniscient snapshots bypass
 * projection — the viewer's player state is then the raw `{ id }` with no stamina
 * — so fall back to the raw `playerStamina` ledger, replicating the start-of-turn
 * refresh in `apps/tactics/stamina.ts` `readStamina`: an absent entry, or the
 * first read of the viewer's new turn (`turnNumber > refreshedTurn`), reads as
 * full. Absent everywhere ⇒ start-of-game default (full).
 */
function readViewerStamina(snapshot: PlayerSnapshot, viewerId: PlayerId): number {
    const projected = (
        snapshot.players[viewerId] as
            | { readonly stamina?: { readonly current?: unknown } | null }
            | undefined
    )?.stamina?.current;
    if (typeof projected === 'number') {
        return projected;
    }

    const raw = snapshot as unknown as {
        readonly playerStamina?: Readonly<
            Record<
                string,
                { readonly current: number; readonly max: number; readonly refreshedTurn: number }
            >
        >;
        readonly turnNumber?: number;
        readonly turnClock?: { readonly activePlayerId?: unknown };
    };
    const entry = raw.playerStamina?.[viewerId];
    if (entry === undefined) {
        return TACTICS_MAX_STAMINA;
    }
    const turnRefreshed =
        raw.turnClock?.activePlayerId === viewerId &&
        typeof raw.turnNumber === 'number' &&
        raw.turnNumber > entry.refreshedTurn;
    return turnRefreshed ? entry.max : entry.current;
}

/**
 * Whether an enemy unit is visible to the viewer. A projected snapshot only
 * contains visible enemies (and strips `visibleTo`), so an absent list means
 * visible; when present (omniscient mode) membership is honoured so the AI never
 * tries to attack a unit the engine would reject as not-visible.
 */
function isVisibleToViewer(unit: TacticsUnitView, viewerId: PlayerId): boolean {
    if (unit.ownerId === viewerId) {
        return true;
    }
    return unit.visibleTo === undefined || unit.visibleTo.includes(viewerId);
}

function inBounds(tile: Tile): boolean {
    return (
        tile.x >= TACTICS_BOARD_MIN_X &&
        tile.x <= TACTICS_BOARD_MAX_X &&
        tile.y >= TACTICS_BOARD_MIN_Y &&
        tile.y <= TACTICS_BOARD_MAX_Y
    );
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** In-bounds cardinal neighbours of (x, y), in `DIRECTIONS` order. */
function legalAdjacentTiles(x: number, y: number): readonly Tile[] {
    return DIRECTIONS.map((d) => ({ x: x + d.dx, y: y + d.dy })).filter(inBounds);
}

function byEntityId(a: TacticsUnitView, b: TacticsUnitView): number {
    if (a.id < b.id) {
        return -1;
    }
    return a.id > b.id ? 1 : 0;
}

function moveAction(viewerId: PlayerId, tick: number, unitId: EntityId, tile: Tile): EngineAction {
    return {
        type: TACTICS_MOVE_UNIT_ACTION,
        playerId: viewerId,
        tick,
        payload: { unitId, x: tile.x, y: tile.y },
    };
}

function attackAction(
    viewerId: PlayerId,
    tick: number,
    attackerId: EntityId,
    defenderId: EntityId,
): EngineAction {
    return {
        type: TACTICS_ATTACK_ACTION,
        playerId: viewerId,
        tick,
        payload: { attackerId, defenderId },
    };
}

function endTurnAction(viewerId: PlayerId, tick: number): EngineAction {
    return { type: ENGINE_END_TURN_ACTION, playerId: viewerId, tick, payload: {} };
}

function commitAction(viewerId: PlayerId, tick: number): EngineAction {
    return { type: TACTICS_COMMIT_ACTION, playerId: viewerId, tick, payload: {} };
}

/**
 * The action that closes the AI's turn for the current turn mode.
 *
 * Sequential mode ends the turn directly (`engine:end_turn`). Commitment
 * (simultaneous) mode instead emits `tactics:commit`: there `engine:end_turn` is
 * the reveal trigger gated until every seat has committed, so a non-committing AI
 * would deadlock the turn. The host auto-synthesises the reveal End Turn once the
 * commit set completes (`tacticsCommitmentOrchestration.shouldAutoEndTurn`), and
 * after committing the AI's projected `isMyTurn` flips false — so it stops acting
 * and never double-commits. The mode is read from the projected
 * `setup.matchSettings` (projected verbatim by the StateProjector), keeping this a
 * pure `shared/`-only decision with no host-local field.
 */
function finishTurnAction(
    snapshot: PlayerSnapshot,
    viewerId: PlayerId,
    tick: number,
): EngineAction {
    return readTacticsTurnMode(snapshot.setup?.matchSettings) === 'commitment'
        ? commitAction(viewerId, tick)
        : endTurnAction(viewerId, tick);
}

/**
 * Decide the AI's next single action for the tactics game, or `null` when it is
 * not the AI's turn (nothing to do). Pure and deterministic given the snapshot.
 */
export function decideTacticsAction(
    snapshot: PlayerSnapshot,
    viewerId: PlayerId,
): EngineAction | null {
    if (!snapshot.isMyTurn) {
        return null;
    }

    const tick = snapshot.tick;
    if (readViewerStamina(snapshot, viewerId) <= 0) {
        return finishTurnAction(snapshot, viewerId, tick);
    }

    const units: TacticsUnitView[] = [];
    for (const entity of Object.values(snapshot.entities)) {
        const unit = asTacticsUnit(entity);
        if (unit !== null) {
            units.push(unit);
        }
    }

    const actingUnit = units.filter((unit) => unit.ownerId === viewerId).sort(byEntityId)[0];
    if (actingUnit === undefined) {
        return finishTurnAction(snapshot, viewerId, tick);
    }

    const target = units
        .filter((unit) => unit.ownerId !== viewerId && isVisibleToViewer(unit, viewerId))
        .sort((a, b) => {
            const da = manhattan(actingUnit.x, actingUnit.y, a.x, a.y);
            const db = manhattan(actingUnit.x, actingUnit.y, b.x, b.y);
            return da !== db ? da - db : byEntityId(a, b);
        })[0];

    const adjacentTiles = legalAdjacentTiles(actingUnit.x, actingUnit.y);

    if (target !== undefined) {
        const distance = manhattan(actingUnit.x, actingUnit.y, target.x, target.y);

        // Adjacent on a different tile → attack.
        if (distance === 1) {
            return attackAction(viewerId, tick, actingUnit.id, target.id);
        }

        // Sharing the target's tile → vacate first; any neighbour is then adjacent.
        if (distance === 0) {
            const tile = adjacentTiles[0];
            return tile !== undefined
                ? moveAction(viewerId, tick, actingUnit.id, tile)
                : finishTurnAction(snapshot, viewerId, tick);
        }

        // Distant → step toward the target, reducing Manhattan distance.
        const approach = adjacentTiles
            .filter((tile) => manhattan(tile.x, tile.y, target.x, target.y) < distance)
            .sort(
                (a, b) =>
                    manhattan(a.x, a.y, target.x, target.y) -
                    manhattan(b.x, b.y, target.x, target.y),
            )[0];
        if (approach !== undefined) {
            return moveAction(viewerId, tick, actingUnit.id, approach);
        }
    }

    // No visible enemy (or no legal approach) → wander deterministically.
    if (adjacentTiles.length > 0) {
        const tile = adjacentTiles[tick % adjacentTiles.length];
        if (tile !== undefined) {
            return moveAction(viewerId, tick, actingUnit.id, tile);
        }
    }

    return finishTurnAction(snapshot, viewerId, tick);
}

/**
 * Build the tactics AI state. Its `onIdle` planning hook computes one action via
 * {@link decideTacticsAction} and dispatches it through the command context.
 * Mirrors `createAutoEndTurnState` — no commands/scheduler needed; one action per
 * idle tick lets the brain spend its whole turn across successive ticks.
 */
export function createTacticsAIState(viewerId: PlayerId): AIState {
    return {
        name: TACTICS_AI_STATE_NAME,
        onEnter: () => undefined,
        onTick: () => undefined,
        onIdle: (snapshot, _tick, _params, _scheduler, context) => {
            const action = decideTacticsAction(snapshot, viewerId);
            if (action !== null) {
                context.dispatch(action);
            }
        },
        onExit: () => undefined,
    };
}
