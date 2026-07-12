/**
 * simulation/engine/GameTimer.ts
 *
 * Tick-based deterministic timer registry and manager.
 *
 * Architecture reference: §4.20 — Game Timers
 *
 * Invariants upheld:
 *   #54 — GameTimer lives in GameSnapshot.timers; remainingTicks is tick-based,
 *          never derived from wall-clock time.
 *   #55 — TimerManager.advance() is a pure function. Only engine:tick may call it.
 *          Game action reducers may call create()/cancel() but must NOT call advance().
 *
 * Module boundary: MUST NOT import from electron/, renderer/, networking/, or DOM.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Opaque identifier for a timer. Must be deterministic (entity-id + action-type derived). */
export type TimerId = string & { readonly __brand: 'TimerId' };

/** A single tick-driven timer stored in GameSnapshot.timers. */
export interface GameTimer {
    readonly id: TimerId;
    /**
     * Ticks remaining until next fire.
     * Decremented by TimerManager.advance() — never by wall-clock time.
     */
    readonly remainingTicks: number;
    /**
     * 0 = one-shot: fires once when remainingTicks reaches 0, then marks inactive.
     * N = interval: resets remainingTicks to N after each fire.
     */
    readonly intervalTicks: number;
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
    readonly active: boolean;
}

/**
 * Registry of all timers for the current game snapshot.
 * Stored as snapshot.timers; serialises naturally in saves.
 */
export type TimerRegistry = Record<TimerId, GameTimer>;

// ─── Fired action shape ───────────────────────────────────────────────────────

export interface FiredTimerAction {
    readonly timerId: TimerId;
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
}

/**
 * Shared frozen empty array for the all-inactive fast path.
 * Reused on every call where no timers are active, eliminating O(n) allocation.
 */
const EMPTY_FIRED: readonly FiredTimerAction[] = Object.freeze([]);

// ─── TimerManager ────────────────────────────────────────────────────────────

/**
 * Pure operations on TimerRegistry.
 *
 * All methods return new registry values without mutating inputs.
 * Invariant #55: advance() is the ONLY method called by engine:tick.
 */
export const TimerManager = {
    /**
     * Add or replace a timer in the registry.
     * The created timer is always marked active.
     * Pure — returns a new registry.
     */
    create(registry: TimerRegistry, timer: Omit<GameTimer, 'active'>): TimerRegistry {
        return {
            ...registry,
            [timer.id]: { ...timer, active: true },
        };
    },

    /**
     * Mark a timer inactive.
     * If the id does not exist, returns the registry unchanged.
     * Pure — returns a new registry.
     */
    cancel(registry: TimerRegistry, id: TimerId): TimerRegistry {
        const existing = registry[id];
        if (existing === undefined) {
            return registry;
        }
        return {
            ...registry,
            [id]: { ...existing, active: false },
        };
    },

    /**
     * Advance all active timers by 1 tick.
     *
     * For each active timer:
     *   - Decrements remainingTicks by 1.
     *   - When remainingTicks reaches 0:
     *     - Adds the timer's action to the fired list.
     *     - One-shot (intervalTicks === 0): marks the timer inactive.
     *     - Interval (intervalTicks > 0): resets remainingTicks to intervalTicks, stays active.
     *
     * Inactive timers are skipped — neither decremented nor fired.
     *
     * Pure. Called ONLY by the engine:tick reducer (Invariant #55).
     *
     * Fast path: if all timers are inactive (or registry is empty), returns the
     * input registry reference unchanged and a stable EMPTY_FIRED array, avoiding
     * O(n) allocation.
     */
    advance(registry: TimerRegistry): {
        next: TimerRegistry;
        fired: readonly FiredTimerAction[];
    } {
        let hasActive = false;
        for (const timer of Object.values(registry)) {
            if (timer.active) {
                hasActive = true;
                break;
            }
        }
        if (!hasActive) {
            return { next: registry, fired: EMPTY_FIRED };
        }

        const nextEntries: [TimerId, GameTimer][] = [];
        const fired: FiredTimerAction[] = [];

        for (const [id, timer] of Object.entries(registry)) {
            // safe: keys of TimerRegistry are always TimerId values
            const timerId = id as TimerId;
            if (!timer.active) {
                nextEntries.push([timerId, timer]);
                continue;
            }

            const decremented = timer.remainingTicks - 1;

            if (decremented <= 0) {
                fired.push({ timerId, actionType: timer.actionType, payload: timer.payload });

                if (timer.intervalTicks === 0) {
                    nextEntries.push([timerId, { ...timer, remainingTicks: 0, active: false }]);
                } else {
                    nextEntries.push([
                        timerId,
                        { ...timer, remainingTicks: timer.intervalTicks, active: true },
                    ]);
                }
            } else {
                nextEntries.push([timerId, { ...timer, remainingTicks: decremented }]);
            }
        }

        return {
            next: Object.fromEntries(nextEntries),
            fired,
        };
    },
} as const;
