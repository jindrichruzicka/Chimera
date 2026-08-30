// The pre-match picks, as a pure transform over the F87 quick-start draft.
//
// The `/select` page and the live shell background share the two selection
// rings, and they share them through ONE piece of state: `shellStateStore`'s
// `draft` — the single field the game barrel lets a game write (Invariant #139).
// No module-local store sits beside it, which is why this file holds no state
// at all: it reads a draft and returns the PATCH to write, and the two React
// surfaces do the reading and the writing.
//
// Why a patch and not a whole draft: `setShellDraft` merges per key, so a patch
// naming only `hostAttributes` leaves a sibling's `gameParams` alone. `null`
// means "nothing to write" — the pick is already there, or the rule refuses it
// — so a caller writes only when something actually changed and the store
// notifies only subscribers that have something new to see.
//
// EXCLUSIVITY is the one rule with teeth. Two seats naming one primitive is a
// state the simulation resolves by falling back (`assignActionPrimitiveOwners`),
// which silently ignores one player's pick — so the picker refuses it here
// rather than letting the match quietly disagree with the screen.
//
// Pure and boundary-clean: `@chimera-engine/simulation` contracts and this
// app's own constants only. It is a plain `.ts` under `shell/`, which
// `chimera/no-game-renderer-internals` does NOT treat as a renderer surface —
// the renderer types stay out by rule, not by taste.

import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';

import {
    ACTION_CONTROL_ATTRIBUTE,
    ACTION_PRIMITIVE_ATTRIBUTE,
    ACTION_PRIMITIVE_SHAPES,
    ACTION_WASD_CONTROL,
    isActionPrimitiveShape,
    type ActionPrimitiveShape,
} from '../simulation/constants.js';

/** Which of the two local seats a pick belongs to. */
export type ActionShellSeat = 'host' | 'second';

/** The rings the background draws: one per seat that has a pick. */
export interface ActionShellPicks {
    readonly host: ActionPrimitiveShape;
    /** The pass-and-play seat's pick, or `null` while the seat is closed. */
    readonly second: ActionPrimitiveShape | null;
}

/**
 * The pick a draft that names none falls back to.
 *
 * The FIRST seeded shape, so a player who never touches the picker starts the
 * match on the primitive the seat-order fallback would have given them anyway.
 */
const DEFAULT_HOST_SHAPE: ActionPrimitiveShape = ACTION_PRIMITIVE_SHAPES[0];

/** The shape `attributes` names, or `null` when it names nothing readable. */
function readPick(
    attributes: Readonly<Record<string, string>> | undefined,
): ActionPrimitiveShape | null {
    const value = attributes?.[ACTION_PRIMITIVE_ATTRIBUTE];
    return isActionPrimitiveShape(value) ? value : null;
}

/** Both seats' picks, as the background and the page read them. */
export function readActionShellPicks(draft: QuickStartConfig): ActionShellPicks {
    return {
        host: readPick(draft.hostAttributes) ?? DEFAULT_HOST_SHAPE,
        second: readPick(draft.localSeats?.[0]?.attributes),
    };
}

/** The host-attributes patch putting the host seat on `shape`. */
function hostPatch(draft: QuickStartConfig, shape: ActionPrimitiveShape): QuickStartConfig {
    return {
        hostAttributes: { ...draft.hostAttributes, [ACTION_PRIMITIVE_ATTRIBUTE]: shape },
    };
}

/**
 * The local-seat patch putting the pass-and-play seat on `shape`.
 *
 * The `control` marker is re-stated on every write rather than merged from
 * whatever was there: the seat list is REPLACED wholesale by `setShellDraft`
 * (a positional merge would invent seats), so a patch that dropped the marker
 * would leave the match with a second seat nobody can move.
 */
function secondSeatPatch(shape: ActionPrimitiveShape): QuickStartConfig {
    return {
        localSeats: [
            {
                attributes: {
                    [ACTION_PRIMITIVE_ATTRIBUTE]: shape,
                    [ACTION_CONTROL_ATTRIBUTE]: ACTION_WASD_CONTROL,
                },
            },
        ],
    };
}

/**
 * Fill in the host pick when the draft carries none — the write a `/select`
 * page makes on mount, so the ring the player sees is a pick the match will
 * actually receive.
 *
 * `null` when the draft already names a readable shape, which is what keeps a
 * return trip through Settings from resetting the picker.
 */
export function ensureActionHostPick(draft: QuickStartConfig): QuickStartConfig | null {
    if (readPick(draft.hostAttributes) !== null) {
        return null;
    }
    return hostPatch(draft, DEFAULT_HOST_SHAPE);
}

/**
 * Put `seat` on `shape`, or refuse.
 *
 * Refusals (all `null`): the seat already holds it, the OTHER seat holds it, or
 * `'second'` was asked for while the pass-and-play seat is closed.
 */
export function selectActionPick(
    draft: QuickStartConfig,
    seat: ActionShellSeat,
    shape: ActionPrimitiveShape,
): QuickStartConfig | null {
    const picks = readActionShellPicks(draft);

    if (seat === 'host') {
        if (picks.host === shape || picks.second === shape) {
            return null;
        }
        return hostPatch(draft, shape);
    }

    if (picks.second === null || picks.second === shape || picks.host === shape) {
        return null;
    }
    return secondSeatPatch(shape);
}

/**
 * Open or close the pass-and-play seat.
 *
 * Opening lands it on the first shape the host is not holding. Closing writes
 * an EMPTY seat list rather than omitting the key: `setShellDraft` merges per
 * key, so an omitted `localSeats` would leave the seat the player just turned
 * off still in the draft and still in the match.
 */
export function setActionSecondPlayer(
    draft: QuickStartConfig,
    enabled: boolean,
): QuickStartConfig | null {
    const picks = readActionShellPicks(draft);
    if (enabled === (picks.second !== null)) {
        return null;
    }
    if (!enabled) {
        return { localSeats: [] };
    }

    const opening = ACTION_PRIMITIVE_SHAPES.find((shape) => shape !== picks.host);
    // Unreachable while there is more than one shape; kept as a refusal rather
    // than a non-null assertion so a shrunken seed list cannot seat two players
    // on one primitive.
    return opening === undefined ? null : secondSeatPatch(opening);
}

/**
 * Step `seat`'s pick `delta` shapes along the seeded row, wrapping, skipping
 * whatever the other seat holds.
 *
 * `delta` is the horizontal component of a movement key, so the vertical keys
 * arrive as `0` and are a no-op: the three primitives sit in one row, and there
 * is no second axis for them to move on.
 */
export function stepActionPick(
    draft: QuickStartConfig,
    seat: ActionShellSeat,
    delta: number,
): QuickStartConfig | null {
    if (delta === 0) {
        return null;
    }

    const picks = readActionShellPicks(draft);
    const current = seat === 'host' ? picks.host : picks.second;
    if (current === null) {
        return null;
    }
    const taken = seat === 'host' ? picks.second : picks.host;

    const count = ACTION_PRIMITIVE_SHAPES.length;
    const from = ACTION_PRIMITIVE_SHAPES.indexOf(current);
    const step = delta > 0 ? 1 : -1;
    // Walk at most one full lap: with every other shape taken there is nothing
    // to land on, and a bare `while` would spin.
    for (let moved = 1; moved < count; moved += 1) {
        const candidate =
            ACTION_PRIMITIVE_SHAPES[(((from + step * moved) % count) + count) % count];
        if (candidate !== undefined && candidate !== taken) {
            return selectActionPick(draft, seat, candidate);
        }
    }
    return null;
}
