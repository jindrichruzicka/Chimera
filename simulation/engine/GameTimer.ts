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
 *   #44/#75 — a timer payload holds JSON-persistable values whose numbers are
 *          integers, never a FixedPoint; TimerManager.create() refuses a FixedPoint
 *          and a float at the write, naming the field.
 *
 * Module boundary: MUST NOT import from electron/, renderer/, networking/, or DOM.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Opaque identifier for a timer. Must be deterministic (entity-id + action-type derived). */
export type TimerId = string & { readonly __brand: 'TimerId' };

/**
 * A value a timer payload may carry.
 *
 * The payload sits inside `GameSnapshot.timers` and re-enters the pipeline as
 * the fired action's `EngineAction.payload`, so it is serialised into every
 * save through bare `JSON.stringify`, checksummed and replayed. A `number` is
 * therefore an integer — a fractional quantity is a scaled integer in a
 * declared unit (Invariants #44/#75) — and a `FixedPoint`, a `bigint`, never
 * appears at any depth, because `JSON.stringify` throws on one. Strings,
 * booleans, `null`, arrays and plain objects nest freely, so an entity id or a
 * nested target rides along as the fired action needs it.
 */
export type TimerPayloadValue =
    | string
    | number
    | boolean
    | null
    | readonly TimerPayloadValue[]
    | { readonly [field: string]: TimerPayloadValue };

/**
 * The payload a timer carries and its fired action re-enters with.
 *
 * `TimerManager.create` refuses a non-integer `number` (Invariant #44) and a
 * `bigint` at any depth, naming the field; see the refusal cases in
 * `GameTimer.test.ts`.
 */
export type TimerPayload = Readonly<Record<string, TimerPayloadValue>>;

/** A single tick-driven timer stored in GameSnapshot.timers. */
export interface GameTimer {
    readonly id: TimerId;
    /**
     * Ticks remaining until next fire.
     * Decremented by TimerManager.advance() once per BEAT — one outer
     * engine:tick — never by wall-clock time, and never by a snapshot.tick
     * difference, which counts actions rather than beats.
     */
    readonly remainingTicks: number;
    /**
     * 0 = one-shot: fires once when remainingTicks reaches 0 and is then removed
     *     from the registry by `TimerManager.advance()`.
     * N = interval: resets remainingTicks to N after each fire.
     */
    readonly intervalTicks: number;
    readonly actionType: string;
    /** What the fired action re-enters the pipeline with. See {@link TimerPayload}. */
    readonly payload: TimerPayload;
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
    readonly payload: TimerPayload;
}

/**
 * Shared frozen empty array for the all-inactive fast path.
 * Reused on every call where no timers are active, eliminating O(n) allocation.
 */
const EMPTY_FIRED: readonly FiredTimerAction[] = Object.freeze([]);

// ─── Payload guard ───────────────────────────────────────────────────────────

/**
 * What `TimerManager.create` refuses in a payload, and why.
 *
 * A float survives a save unchanged and is refused because floating-point is
 * forbidden in simulation state (Invariant #44). `JsonSaveSerializer` is bare
 * `JSON.stringify`, which throws on a `bigint` — what a `FixedPoint` is — and
 * silently rewrites the rest: `NaN` and `Infinity` become `null`; an
 * `undefined`, a function or a symbol drops its key; an object that is
 * neither a plain object nor an array — a `Date`, a `Map`, a class instance —
 * comes back from the save as something else. Each is refused at the write,
 * where the offending field is still known (Invariant #75).
 */
function assertPersistablePayload(payload: TimerPayload, id: TimerId): void {
    for (const [field, value] of Object.entries(payload)) {
        assertPersistableValue(value, field, id);
    }
}

function assertPersistableValue(value: unknown, path: string, id: TimerId): void {
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
            throw refusal(path, id, value);
        }
        return;
    }
    if (typeof value === 'string' || typeof value === 'boolean' || value === null) {
        return;
    }
    if (Array.isArray(value)) {
        const items: readonly unknown[] = value;
        for (const [index, item] of items.entries()) {
            assertPersistableValue(item, `${path}[${String(index)}]`, id);
        }
        return;
    }
    if (isPlainObject(value)) {
        for (const [field, nested] of Object.entries(value)) {
            assertPersistableValue(nested, `${path}.${field}`, id);
        }
        return;
    }
    throw refusal(path, id, value);
}

/** A plain object, or `Object.create(null)`. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Render a refused value for the error; only the shapes the guard refuses reach it. */
function renderValue(value: unknown): string {
    switch (typeof value) {
        case 'bigint':
            return `${String(value)}n`;
        case 'number':
        case 'undefined':
            return String(value);
        case 'symbol':
            return value.toString();
        case 'function':
            return 'a function';
        default:
            return Object.prototype.toString.call(value);
    }
}

function refusal(path: string, id: TimerId, value: unknown): RangeError {
    return new RangeError(
        `TimerManager.create: payload field "${path}" of timer "${id}" is ${renderValue(value)} — a timer payload carries JSON-persistable values with integer numbers only (Invariants #44/#75), because the registry is saved through JSON.stringify and replayed.`,
    );
}

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
     *
     * @throws RangeError when a payload value is a non-integer `number` or a
     *         `bigint`, at any depth. See {@link TimerPayloadValue} and the
     *         refusal cases in `GameTimer.test.ts`.
     */
    create(registry: TimerRegistry, timer: Omit<GameTimer, 'active'>): TimerRegistry {
        assertPersistablePayload(timer.payload, timer.id);
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
     * Advance all active timers by ONE BEAT — one outer `engine:tick`.
     *
     * For each active timer:
     *   - Decrements remainingTicks by 1.
     *   - When remainingTicks reaches 0:
     *     - Adds the timer's action to the fired list.
     *     - One-shot (intervalTicks === 0): removes the timer from the registry.
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

                // A fired one-shot is REMOVED, not rewritten inactive: the registry
                // is snapshot-resident, so a tombstone would sit in every later save
                // checkpoint and under every later beat's walk above for the rest
                // of the session. Entries that were already inactive are passed
                // through above, untouched.
                if (timer.intervalTicks !== 0) {
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
