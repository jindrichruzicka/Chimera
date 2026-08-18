/**
 * simulation/engine/AnimationWindow.ts
 *
 * Host-only vocabulary for beat-owned gameplay windows — the simulation half of
 * an animation. A game authors a clip passage twice: once as clip-relative
 * positions the renderer plays, and once as the beat span the simulation opens
 * (`simulation/content/animationWindows.ts` verifies the two agree at content
 * load). This module declares what the opened span looks like while it lives on
 * `BaseGameSnapshot.animationWindows`.
 *
 * The registry is HOST-ONLY: `StateProjector.project()` uses an explicit field
 * allowlist and does not project it, so it never crosses a boundary
 * (Invariants #1/#3).
 *
 * `AnimationWindowManager` at the bottom writes the registry. Every verb is
 * pure: none installs a `GameTimer`, dispatches an `EngineAction` or reads a
 * clock (Invariants #2/#42/#43).
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 */

import type { EntityId } from '../foundation/engine-contract.js';
import type { FixedPoint } from './FixedPoint.js';
import type { BaseGameSnapshot } from './types.js';

/**
 * Opaque identifier for one OPEN window instance.
 *
 * Distinct from the authoring-time `AnimationWindowName` in
 * `simulation/foundation/animation-clip-sheet.js`: several entities may hold
 * their own open instance of the same authored window at the same beat, so the
 * runtime id has to separate them. Must be deterministic — nothing in a
 * snapshot may come from a clock or an RNG the replay cannot reproduce.
 */
export type AnimationWindowId = string & { readonly __brand: 'AnimationWindowId' };

/**
 * Snapshot-resident payload a window carries for the beat sweep that reads it.
 *
 * Values are INTEGERS or {@link FixedPoint} only (Invariants #44/#75): this
 * object lives inside `GameSnapshot`, is serialised into saves and is replayed,
 * so a float would make two machines disagree. Renderer-side quantities —
 * seconds, phase, playback rate — belong to the clip, never here.
 */
export type AnimationWindowPayload = Readonly<Record<string, number | FixedPoint>>;

/** One open beat-owned gameplay window stored in `GameSnapshot.animationWindows`. */
export interface AnimationWindowRecord {
    readonly id: AnimationWindowId;
    /** The entity the window belongs to. */
    readonly ownerId: EntityId;
    /** Beats the window still has left. Always an integer (Invariant #44). */
    readonly remainingBeats: number;
    /** Integer/`FixedPoint` state carried alongside the window while it is open. */
    readonly payload: AnimationWindowPayload;
}

/** All windows open at the current beat, keyed by window instance id. */
export type AnimationWindowRegistry = Record<AnimationWindowId, AnimationWindowRecord>;

/**
 * Why a window stopped being open.
 *
 * - `expired`     — the beat countdown reached its end; the ordinary close.
 * - `owner-gone`  — `ownerId` is no longer an entity in the snapshot.
 * - `replaced`    — the same window id was opened again.
 * - `interrupted` — game logic closed it early (a stagger, a cancel, a death).
 */
export type WindowCloseReason = 'expired' | 'owner-gone' | 'replaced' | 'interrupted';

/**
 * The report of one window that closed: what it was, and why.
 *
 * Carries no `remainingBeats` — a closed window has none left to report.
 */
export interface ClosedAnimationWindow {
    readonly id: AnimationWindowId;
    readonly ownerId: EntityId;
    readonly payload: AnimationWindowPayload;
    readonly reason: WindowCloseReason;
}

// ─── Verb inputs and outputs ─────────────────────────────────────────────────

/** What a game reducer hands {@link AnimationWindowManager.open}. */
export interface OpenAnimationWindowRequest {
    readonly id: AnimationWindowId;
    readonly ownerId: EntityId;
    /** How many beats the window stays open. A positive integer. */
    readonly durationBeats: number;
    /** Defaults to an empty payload. */
    readonly payload?: AnimationWindowPayload;
}

/** The result of a window write that takes and returns a whole snapshot. */
export interface AnimationWindowStateChange<TState extends BaseGameSnapshot> {
    readonly next: TState;
    readonly closed: readonly ClosedAnimationWindow[];
}

/** The result of the per-beat sweep, which takes and returns a bare registry. */
export interface AnimationWindowSweep {
    readonly next: AnimationWindowRegistry;
    readonly closed: readonly ClosedAnimationWindow[];
}

// ─── Shared frozen constants ─────────────────────────────────────────────────

/**
 * Shared frozen empty closed-list for every path that reports no closure,
 * mirroring `EMPTY_FIRED` in `GameTimer.ts`.
 */
const EMPTY_CLOSED: readonly ClosedAnimationWindow[] = Object.freeze([]);

/** Shared frozen empty payload for a request that names none. */
const EMPTY_PAYLOAD: AnimationWindowPayload = Object.freeze({});

// ─── Internal helpers ────────────────────────────────────────────────────────

function toClosed(record: AnimationWindowRecord, reason: WindowCloseReason): ClosedAnimationWindow {
    return { id: record.id, ownerId: record.ownerId, payload: record.payload, reason };
}

/** Reject a duration that is not a positive integer (Invariant #44). */
function assertPositiveIntegerBeats(durationBeats: number, id: AnimationWindowId): void {
    if (!Number.isInteger(durationBeats) || durationBeats <= 0) {
        throw new RangeError(
            `AnimationWindowManager.open: durationBeats for window "${id}" is ${String(durationBeats)} — it must be a positive integer (Invariant #44).`,
        );
    }
}

/**
 * Reject a payload value that is a non-integer `number`.
 *
 * The payload lives inside `GameSnapshot`, so it is serialised into saves and
 * replayed: a float would let two machines disagree (Invariants #44/#75). A
 * `FixedPoint` is a `bigint` and so is integral by construction.
 */
function assertIntegerPayload(payload: AnimationWindowPayload, id: AnimationWindowId): void {
    for (const [field, value] of Object.entries(payload)) {
        if (typeof value === 'number' && !Number.isInteger(value)) {
            throw new RangeError(
                `AnimationWindowManager.open: payload field "${field}" of window "${id}" is ${String(value)} — window payloads carry integers or FixedPoint only (Invariants #44/#75).`,
            );
        }
    }
}

function withoutWindow(
    registry: AnimationWindowRegistry,
    id: AnimationWindowId,
): AnimationWindowRegistry {
    const kept: [AnimationWindowId, AnimationWindowRecord][] = [];
    for (const [key, record] of Object.entries(registry)) {
        // safe: keys of AnimationWindowRegistry are always AnimationWindowId values
        const windowId = key as AnimationWindowId;
        if (windowId !== id) {
            kept.push([windowId, record]);
        }
    }
    return Object.fromEntries(kept);
}

// ─── AnimationWindowManager ──────────────────────────────────────────────────

/**
 * Pure operations on the animation-window ledger.
 *
 * Every removal path reports the record it removed, so a game that turned a
 * flag on when a window opened always gets the one event that turns it back
 * off. There are exactly four: `expired` and `owner-gone` from
 * {@link AnimationWindowManager.advance}, `replaced` from
 * {@link AnimationWindowManager.open} and `interrupted` from
 * {@link AnimationWindowManager.interrupt}.
 *
 * `open` and `interrupt` take and return the whole snapshot because a game
 * reducer holds one and `animationWindows` is optional — the verbs absorb the
 * "no registry yet" case rather than making every call site write it. `advance`
 * takes a bare registry, mirroring `TimerManager.advance(registry)`.
 */
export const AnimationWindowManager = Object.freeze({
    /**
     * Open a window, REPLACING any window already open under the same id.
     *
     * The replaced record is reported in `closed` with `reason: 'replaced'`, so
     * re-opening never loses the close event for the instance it displaced.
     * Replacing rather than rejecting is the `TimerManager.create` idiom: a
     * second swing overwrites the first swing's window instead of failing.
     *
     * @throws RangeError when `durationBeats` is not a positive integer, or when
     *         the payload carries a non-integer `number`.
     */
    open<TState extends BaseGameSnapshot>(
        state: TState,
        request: OpenAnimationWindowRequest,
    ): AnimationWindowStateChange<TState> {
        const { id, ownerId, durationBeats, payload = EMPTY_PAYLOAD } = request;

        assertPositiveIntegerBeats(durationBeats, id);
        assertIntegerPayload(payload, id);

        const registry = state.animationWindows ?? {};
        const replaced = registry[id];
        const record: AnimationWindowRecord = {
            id,
            ownerId,
            remainingBeats: durationBeats,
            payload,
        };

        return {
            next: { ...state, animationWindows: { ...registry, [id]: record } },
            closed: replaced === undefined ? EMPTY_CLOSED : [toClosed(replaced, 'replaced')],
        };
    },

    /**
     * Close a window early — a stagger, a cancel, a death.
     *
     * Callable from ANY game reducer: it is an ordinary pure state write, not a
     * privileged engine path. When the id is not open the input state reference
     * comes straight back with no closure reported.
     */
    interrupt<TState extends BaseGameSnapshot>(
        state: TState,
        id: AnimationWindowId,
    ): AnimationWindowStateChange<TState> {
        const registry = state.animationWindows;
        const existing = registry?.[id];
        if (registry === undefined || existing === undefined) {
            return { next: state, closed: EMPTY_CLOSED };
        }

        return {
            next: { ...state, animationWindows: withoutWindow(registry, id) },
            closed: [toClosed(existing, 'interrupted')],
        };
    },

    /**
     * Decrement every open window by one beat and sweep the ones that end.
     *
     * A window whose owner is no longer live closes as `owner-gone` regardless
     * of its countdown — the owner check runs first, because "the entity this
     * belonged to is gone" is the truthful reason even on the beat the count
     * would also have run out.
     *
     * Otherwise a window whose count has already reached zero closes as
     * `expired`, and every other window loses one beat. A window opened for N
     * beats is therefore present on exactly N consecutive results and reported
     * `expired` on the next one.
     *
     * Pure. This is the per-beat sweep.
     *
     * Fast path: an empty registry returns the input reference and the shared
     * frozen empty closed-list, allocating nothing.
     */
    advance(
        registry: AnimationWindowRegistry,
        liveEntityIds: ReadonlySet<EntityId>,
    ): AnimationWindowSweep {
        const entries = Object.entries(registry);
        if (entries.length === 0) {
            return { next: registry, closed: EMPTY_CLOSED };
        }

        const kept: [AnimationWindowId, AnimationWindowRecord][] = [];
        const closed: ClosedAnimationWindow[] = [];

        for (const [key, record] of entries) {
            // safe: keys of AnimationWindowRegistry are always AnimationWindowId values
            const windowId = key as AnimationWindowId;

            if (!liveEntityIds.has(record.ownerId)) {
                closed.push(toClosed(record, 'owner-gone'));
                continue;
            }

            if (record.remainingBeats <= 0) {
                closed.push(toClosed(record, 'expired'));
                continue;
            }

            kept.push([windowId, { ...record, remainingBeats: record.remainingBeats - 1 }]);
        }

        return { next: Object.fromEntries(kept), closed };
    },
} as const);
