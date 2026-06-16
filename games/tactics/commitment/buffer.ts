/**
 * games/tactics/commitment/buffer.ts
 *
 * Pure kernel for the per-instance local action buffer of the tactics
 * commitment-scheme battle mode (T8 / #728). In commitment mode a player's
 * move/attack/reveal selections are NOT dispatched to the host — they are
 * appended to a {@link LocalActionBuffer} and applied to an optimistic local
 * view (spending local stamina) until the player commits.
 *
 * Single source of truth for the rules: this module reuses the EXISTING
 * `tacticsMoveUnitDefinition` / `tacticsAttackDefinition` /
 * `tacticsRevealTileDefinition` validate+reduce — it never re-derives a second
 * copy of move/attack/reveal logic or the stamina spend. Undo therefore needs
 * no hand-rolled refund: popping the buffer and re-applying the shorter buffer
 * to the unchanged base replays one fewer `consumeStamina`, so the refund is
 * exact and the cap/floor are inherited from `readStamina`/`consumeStamina`.
 *
 * Pure: no IPC, no clock, no `Math.random()`. The `GameReduceContext` is a
 * deterministic RNG seeded from `(seed, tick)` like the host pipeline (the three
 * tactics reducers do not read `ctx.rng`, but the contract requires one).
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md §2, §6
 */

import { createRng } from '@chimera/simulation/engine/DeterministicRng.js';
import type {
    BaseGameSnapshot,
    GameReduceContext,
    PlayerId,
    ValidationResult,
} from '@chimera/simulation/engine/types.js';

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_REVEAL_TILE_ACTION,
    tacticsAttackDefinition,
    tacticsMoveUnitDefinition,
    tacticsRevealTileDefinition,
} from '../actions.js';
import type { TacticsSnapshot } from '../stamina.js';
import type { BufferedTacticsAction, LocalActionBuffer } from './contract.js';

function reduceContext(state: Readonly<BaseGameSnapshot>): GameReduceContext {
    return { rng: createRng(state.seed, state.tick), dispatchDepth: 0 };
}

/**
 * Reduce one buffered action through its existing `ActionDefinition` — the same
 * reducer the host runs on reveal, so the optimistic view matches the eventual
 * authoritative apply. The switch only dispatches; it copies no rules. Narrowing
 * on `action.type` gives each definition its correctly-typed payload.
 */
function reduceBuffered(
    view: Readonly<BaseGameSnapshot>,
    action: BufferedTacticsAction,
    playerId: PlayerId,
): BaseGameSnapshot {
    const ctx = reduceContext(view);
    switch (action.type) {
        case TACTICS_MOVE_UNIT_ACTION:
            return tacticsMoveUnitDefinition.reduce(view, action.payload, playerId, ctx);
        case TACTICS_ATTACK_ACTION:
            return tacticsAttackDefinition.reduce(view, action.payload, playerId, ctx);
        case TACTICS_REVEAL_TILE_ACTION:
            return tacticsRevealTileDefinition.reduce(view, action.payload, playerId, ctx);
    }
}

/** Validate one buffered action against `view` through its existing definition. */
function validateBuffered(
    view: Readonly<BaseGameSnapshot>,
    action: BufferedTacticsAction,
    playerId: PlayerId,
): ValidationResult {
    const ctx = reduceContext(view);
    switch (action.type) {
        case TACTICS_MOVE_UNIT_ACTION:
            return tacticsMoveUnitDefinition.validate(action.payload, view, playerId, ctx);
        case TACTICS_ATTACK_ACTION:
            return tacticsAttackDefinition.validate(action.payload, view, playerId, ctx);
        case TACTICS_REVEAL_TILE_ACTION:
            return tacticsRevealTileDefinition.validate(action.payload, view, playerId, ctx);
    }
}

/**
 * Apply every buffered action to `base`, in buffer order, reusing each action's
 * existing `reduce`. The result is the optimistic local view (with local stamina
 * spent for move/attack). Pure — `base` is never mutated.
 */
export function applyBuffer(
    base: Readonly<TacticsSnapshot>,
    buffer: LocalActionBuffer,
    playerId: PlayerId,
): TacticsSnapshot {
    let view: BaseGameSnapshot = base;
    for (const action of buffer) {
        view = reduceBuffered(view, action, playerId);
    }
    return view;
}

/**
 * Validate `action` against the CURRENT optimistic view (`base` + `buffer`) and,
 * if legal, return the extended buffer. Validating against the optimistic view —
 * not `base` — is what makes local stamina real: the 4th move is rejected
 * because the view already shows `current <= 0`, exactly as the host would
 * reject it on reveal. Never mutates inputs.
 */
export function appendToBuffer(
    base: Readonly<TacticsSnapshot>,
    buffer: LocalActionBuffer,
    action: BufferedTacticsAction,
    playerId: PlayerId,
): { ok: true; buffer: LocalActionBuffer } | { ok: false; reason: string } {
    const view = applyBuffer(base, buffer, playerId);
    const validation = validateBuffered(view, action, playerId);
    if (!validation.ok) {
        return { ok: false, reason: validation.reason ?? 'rejected' };
    }
    return { ok: true, buffer: [...buffer, action] };
}

/**
 * Undo the last buffered action: return the buffer minus its final entry (or the
 * same empty buffer when there is nothing to undo). Stamina refund is implicit —
 * re-applying the shorter buffer to the same base replays one fewer spend.
 */
export function popBuffer(buffer: LocalActionBuffer): LocalActionBuffer {
    return buffer.length === 0 ? buffer : buffer.slice(0, -1);
}

/** Local can-undo for the in-turn Undo control: buffer length only (design §6). */
export function bufferCanUndo(buffer: LocalActionBuffer): boolean {
    return buffer.length > 0;
}
