/**
 * simulation/engine/TimeScale.ts
 *
 * The pure state layer for authoritative time dilation — the simulation half of
 * a slow-motion hit. A game reducer calls {@link applyTimeScale} directly.
 *
 * There is ONE dilation field on the snapshot (`timeScalePermille`) and ONE
 * countdown beside it (`timeScaleRestoreBeats`), so two overlapping requests are
 * last-write-wins: there is no second scale for one to hide behind and nothing
 * stacks.
 *
 * Every verb here is pure. None installs a `GameTimer`, dispatches an
 * `EngineAction` or reads a clock (Invariants #2/#42/#43): the restore is a
 * countdown this module decrements, not a timer that fires an action.
 *
 * An authored permille is normalised by `clampTimeScalePermille` from
 * `simulation/foundation/time-scale.js`; the restore paths write that module's
 * `NORMAL_TIME_SCALE_PERMILLE` directly. This module names no bound of its own,
 * which `TimeScale.test.ts` pins by scanning the source.
 *
 * Module boundary: MUST NOT import from electron/, renderer/, networking/, ai/,
 * or DOM.
 */

import { NORMAL_TIME_SCALE_PERMILLE, clampTimeScalePermille } from '../foundation/time-scale.js';

import type { BaseGameSnapshot } from './types.js';

/** What a game reducer hands {@link applyTimeScale}. */
export interface TimeScaleRequest {
    /**
     * The requested scale in permille. Normalised through
     * `clampTimeScalePermille`, so an out-of-range or fractional value is
     * corrected rather than rejected.
     */
    readonly permille: number;
    /**
     * Beats to hold the scale for before real time is restored. Omit for a
     * dilation that runs until {@link clearTimeScale} ends it. A positive
     * integer when present.
     */
    readonly durationBeats?: number;
}

/**
 * Whether the snapshot is running at real time with nothing pending.
 *
 * Absence and the real-time permille are the same state — `clampTimeScalePermille`
 * maps an absent scale onto real time — so both count as undilated.
 */
function isRealTime(state: BaseGameSnapshot): boolean {
    return (
        state.timeScaleRestoreBeats === undefined &&
        (state.timeScalePermille === undefined ||
            state.timeScalePermille === NORMAL_TIME_SCALE_PERMILLE)
    );
}

/**
 * Drop the restore countdown, keeping the concrete snapshot type.
 *
 * The countdown must be REMOVED rather than set to a falsy value:
 * `timeScaleRestoreBeats` is declared optional, and under
 * `exactOptionalPropertyTypes` a present-but-`undefined` key is not the same
 * thing as an absent one at either the type layer or the wire.
 */
function withoutRestoreBeats<TState extends BaseGameSnapshot>(state: TState): TState {
    if (!Object.hasOwn(state, 'timeScaleRestoreBeats')) {
        return state;
    }
    const { timeScaleRestoreBeats: _dropped, ...rest } = state;
    // safe: the removed key is declared optional on BaseGameSnapshot, so a
    // state without it still satisfies TState.
    return rest as TState;
}

/**
 * Dilate the simulation, replacing whatever scale was already running.
 *
 * Last-write-wins in both fields: the returned snapshot carries this request's
 * scale and this request's countdown, and an earlier request's countdown is
 * dropped when this one names none. Nothing accumulates.
 *
 * @throws RangeError when `durationBeats` is present and is not a positive
 *         integer (Invariants #42/#44).
 */
export function applyTimeScale<TState extends BaseGameSnapshot>(
    state: TState,
    request: TimeScaleRequest,
): TState {
    const { durationBeats } = request;

    if (durationBeats !== undefined && (!Number.isInteger(durationBeats) || durationBeats <= 0)) {
        throw new RangeError(
            `applyTimeScale: durationBeats is ${String(durationBeats)} — it must be a positive integer (Invariants #42/#44).`,
        );
    }

    const dilated: TState = {
        ...state,
        timeScalePermille: clampTimeScalePermille(request.permille),
    };

    return durationBeats === undefined
        ? withoutRestoreBeats(dilated)
        : { ...dilated, timeScaleRestoreBeats: durationBeats };
}

/**
 * End a dilation immediately, whether or not a countdown was pending.
 *
 * Returns the input reference when the snapshot is already undilated, so a
 * reducer that clears unconditionally allocates nothing on the common path.
 */
export function clearTimeScale<TState extends BaseGameSnapshot>(state: TState): TState {
    if (isRealTime(state)) {
        return state;
    }
    return withoutRestoreBeats({ ...state, timeScalePermille: NORMAL_TIME_SCALE_PERMILLE });
}

/**
 * Advance the restore countdown by one beat.
 *
 * Remove the countdown and restore real time when it has already reached its
 * end; otherwise decrement it. A dilation requested for N beats therefore
 * survives N calls and is restored on the next one.
 *
 * A snapshot with no countdown pending — including an open-ended dilation — is
 * returned unchanged by reference. Deliberately NOT re-exported from
 * `simulation/engine/index.ts`.
 */
export function advanceTimeScale<TState extends BaseGameSnapshot>(state: TState): TState {
    const remaining = state.timeScaleRestoreBeats;

    if (remaining === undefined) {
        return state;
    }
    if (remaining <= 0) {
        return clearTimeScale(state);
    }
    return { ...state, timeScaleRestoreBeats: remaining - 1 };
}
