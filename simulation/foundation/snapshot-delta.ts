/**
 * simulation/foundation/snapshot-delta.ts
 *
 * The after-only form of a snapshot diff, and the receiver that applies one.
 * Lives in the contract leaf beside `snapshot-diff.ts`: pure helpers over two
 * snapshots, with no imports above them.
 *
 * Why a second shape rather than sending `DiffEntry` as-is: a `DiffEntry`
 * carries `before` AND `after`, which is right for an inspector showing both
 * sides and wrong for a wire format — a delta that repeats the old value can
 * be LARGER than the snapshot it replaces. The receiver already holds the
 * baseline; `before` is redundant there by construction.
 *
 * Invariant #3 / #8: nothing here reads authoritative state, and nothing here
 * projects. A delta carries exactly what the two snapshots given to
 * `diffSnapshots` carried, so diffing two projections of one viewer can
 * surface no field a full projection would not have surfaced.
 *
 * Pure and deterministic — no I/O, no clock, no randomness, no imports beyond
 * the sibling diff types.
 */

import type { DiffEntry, SnapshotDiff } from './snapshot-diff.js';

// ─── Wire types ───────────────────────────────────────────────────────────────

/**
 * One change at a dot-delimited JSON path, carrying only the value the
 * receiver needs to arrive at the new snapshot.
 *
 * `kind` keeps the differ's full vocabulary rather than collapsing to a bare
 * set/unset pair: `added` and `changed` apply identically, but a projection
 * ADDS an entity that came into view and REMOVES one that left, and a receiver
 * that can only be told "this key now holds X" could never be told an entity
 * is gone. A fog-hidden entity is ABSENT from a projection, never null.
 *
 * `after` is OMITTED (not set to `undefined`) on a `removed` entry, so the
 * serialised frame carries no dead key.
 */
export interface SnapshotDeltaEntry {
    readonly path: string;
    readonly kind: DiffEntry['kind'];
    readonly after?: unknown;
}

/** A flat set of changed paths taking a viewer from `fromTick` to `toTick`. */
export interface SnapshotDelta {
    readonly fromTick: number;
    readonly toTick: number;
    readonly entries: readonly SnapshotDeltaEntry[];
}

// ─── Producer ─────────────────────────────────────────────────────────────────

/**
 * Project a structural diff onto its after-only wire form.
 *
 * A pure strip of `before`: paths, kinds, order and the `after` values are the
 * differ's, unchanged. Keeping this a projection rather than a second differ is
 * what lets the Inspector and the wire diverge in what they CARRY without
 * diverging in what they MEAN.
 */
export function toSnapshotDelta(diff: SnapshotDiff): SnapshotDelta {
    return {
        fromTick: diff.fromTick,
        toTick: diff.toTick,
        entries: diff.entries.map((entry) =>
            entry.kind === 'removed'
                ? { path: entry.path, kind: entry.kind }
                : { path: entry.path, kind: entry.kind, after: entry.after },
        ),
    };
}

// ─── Receiver ─────────────────────────────────────────────────────────────────

type MutableRecord = Record<string, unknown>;
type Container = MutableRecord | unknown[];

/**
 * What a not-yet-finished application knows about one array it copied: how long
 * that array was before any entry touched it, and which indices `removed`
 * entries have claimed.
 *
 * Removals are collected rather than performed because `walkArray` emits one
 * `removed` entry per dropped trailing index in ASCENDING order: shortening on
 * the first would put every later index out of range and turn a well-formed
 * delta into a rejected one. {@link truncateArrays} settles them in one step.
 */
interface ArrayEdit {
    readonly originalLength: number;
    readonly removed: Set<number>;
}

const isRecord = (value: unknown): value is MutableRecord =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isContainer = (value: unknown): value is Container => Array.isArray(value) || isRecord(value);

/**
 * The one key name a path segment may never be. Assigning it on a plain object
 * retargets the PROTOTYPE instead of creating an own property, so a delta
 * naming it could not mean what every other entry means. No projected snapshot
 * carries it, so refusing it costs nothing.
 */
const PROTO_KEY = '__proto__';

/**
 * The form `String(i)` takes for an array index: one digit-run, no sign, no
 * leading zero, no point, no exponent.
 */
const CANONICAL_INDEX_RE = /^(?:0|[1-9][0-9]*)$/;

/**
 * A path segment as an array index, or `null` when it is not one.
 *
 * Deliberately strict: `'01'`, `'+1'` and `'-0'` all coerce to an index an
 * array would take while naming an element the differ never named, and `'-1'`
 * lands as a plain property, passing the append bound that no negative index
 * can fail. The fixtures are in `snapshot-delta.test.ts`.
 */
const arrayIndex = (segment: string): number | null =>
    CANONICAL_INDEX_RE.test(segment) ? Number(segment) : null;

/** The draft's own containers, with the array bookkeeping for those that are arrays. */
class Draft {
    readonly #owned = new Set<Container>();
    readonly #arrays = new Map<unknown[], ArrayEdit>();

    constructor(readonly root: MutableRecord) {
        this.#owned.add(root);
    }

    /**
     * The draft's own copy of `value`, made and recorded on first reach so a
     * later entry down the same path writes through the same object — and so the
     * source snapshot, which may be frozen, is never written to.
     */
    own(value: Container): Container {
        if (this.#owned.has(value)) {
            return value;
        }
        const copy = Array.isArray(value) ? value.slice() : { ...value };
        this.#owned.add(copy);
        if (Array.isArray(copy)) {
            this.#arrays.set(copy, { originalLength: copy.length, removed: new Set() });
        }
        return copy;
    }

    /** Claim `index` of `array` for removal; false if this delta already claimed it. */
    claimRemoval(array: unknown[], index: number): boolean {
        const edit = this.#arrays.get(array);
        if (edit === undefined || edit.removed.has(index)) {
            return false;
        }
        edit.removed.add(index);
        return true;
    }

    /**
     * Shorten every array whose removals were claimed, and answer whether each
     * claim was a TRAILING block.
     *
     * Anything else means the delta removed from the middle of an array, which
     * no diff of two snapshots produces — the receiver's baseline is not the one
     * the delta was computed against, and quietly leaving a hole (a `null` once
     * serialised) is the divergence this path exists to avoid.
     */
    truncateArrays(): boolean {
        for (const [array, edit] of this.#arrays) {
            if (edit.removed.size === 0) {
                continue;
            }
            // An array that both grew and shrank in one delta: no diff of two
            // snapshots emits that (`walkArray` adds only past `from.length`
            // and removes only past `to.length`, and one array cannot be on
            // both sides), and the truncation below would silently drop what
            // the appends just wrote — a partial application, which this
            // function's caller promises never to return.
            if (array.length !== edit.originalLength) {
                return false;
            }
            let first = edit.originalLength;
            for (const index of edit.removed) {
                first = Math.min(first, index);
            }
            if (edit.removed.size !== edit.originalLength - first) {
                return false;
            }
            array.length = first;
        }
        return true;
    }
}

/**
 * Whether `container` currently holds a defined value of its OWN at `key`.
 *
 * Own, not inherited: `container['toString'] !== undefined` is true for every
 * plain object, so an inherited key would pass the applicability check and then
 * `delete` nothing — the receiver would keep a snapshot the sender does not
 * have, which is the silent divergence this module exists to refuse. A snapshot
 * is JSON-plain, so every key a diff of two of them can name is an own key.
 */
const has = (container: Container, key: string): boolean => {
    if (!Array.isArray(container)) {
        return Object.hasOwn(container, key) && container[key] !== undefined;
    }
    const index = arrayIndex(key);
    return index !== null && index in container;
};

/**
 * The value at `key`, for walking DOWN a path.
 *
 * No own-key check here, unlike {@link has}, because none is reachable: a
 * snapshot is JSON-plain, so every inherited key it has is one of
 * `Object.prototype`'s, and every one of those is a function — which
 * {@link isContainer} rejects — except `__proto__`, which {@link PROTO_KEY}
 * refuses before this is ever called.
 */
const read = (container: Container, key: string): unknown => {
    if (!Array.isArray(container)) {
        return container[key];
    }
    const index = arrayIndex(key);
    return index === null ? undefined : container[index];
};

const write = (container: Container, key: string, value: unknown): boolean => {
    if (!Array.isArray(container)) {
        container[key] = value;
        return true;
    }
    const index = arrayIndex(key);
    if (index === null) {
        return false;
    }
    // An array only ever grows at its end in a diff (`walkArray` emits `added`
    // from `from.length` upward), so anything past the end would punch a hole
    // that JSON turns into a `null` the sender never had.
    if (index > container.length) {
        return false;
    }
    container[index] = value;
    return true;
};

const remove = (container: Container, key: string, draft: Draft): boolean => {
    if (!has(container, key)) {
        return false;
    }
    if (!Array.isArray(container)) {
        delete container[key];
        return true;
    }
    const index = arrayIndex(key);
    return index !== null && draft.claimRemoval(container, index);
};

/**
 * Apply one entry to the draft, copying each container on the way down the
 * first time it is reached.
 *
 * Returns false — never a partial write the caller might keep — when the
 * baseline cannot carry the entry, which means the receiver's baseline is not
 * the one the delta was computed against. What each rejection is, is the
 * `rejects a delta it cannot apply` block of `snapshot-delta.test.ts`.
 */
const applyEntry = (draft: Draft, entry: SnapshotDeltaEntry): boolean => {
    const segments = entry.path.split('.');
    if (segments.some((segment) => segment === '' || segment === PROTO_KEY)) {
        return false;
    }

    let container: Container = draft.root;
    for (const segment of segments.slice(0, -1)) {
        const child = read(container, segment);
        if (!isContainer(child)) {
            return false;
        }
        const owned = draft.own(child);
        if (owned !== child && !write(container, segment, owned)) {
            return false;
        }
        container = owned;
    }

    const leaf = segments[segments.length - 1]!;
    if (entry.kind === 'removed') {
        return remove(container, leaf, draft);
    }
    if (entry.kind === 'added' ? has(container, leaf) : !has(container, leaf)) {
        return false;
    }
    return write(container, leaf, entry.after);
};

/**
 * Apply `delta` to the snapshot the receiver holds, or answer `null` when it
 * cannot be applied.
 *
 * `null` is the re-sync signal: the caller must discard the delta and ask the
 * host for a full snapshot. A partially-applied delta is never returned — the
 * draft is thrown away on the first rejection, and `from` is never written to
 * at all.
 *
 * The result is always a NEW root object, with every container along a changed
 * path copied and everything else shared by reference. That structural sharing
 * is not an optimisation detail: it is what lets a memoised renderer selector
 * tell an untouched subtree from a rebuilt one.
 *
 * `delta.fromTick` must equal `from.tick`, and the applied snapshot must land
 * on `delta.toTick`. The first catches the common desync — a delta whose
 * predecessor never arrived — before any path is walked. The second refuses a
 * delta that does not carry the tick change its own header announces, which
 * would otherwise leave the receiver holding a snapshot stamped with the wrong
 * tick until the NEXT delta rejected.
 */
export function applySnapshotDelta<TState extends { readonly tick: number }>(
    from: Readonly<TState>,
    delta: SnapshotDelta,
): TState | null {
    if (from.tick !== delta.fromTick) {
        return null;
    }
    const draft = new Draft({ ...(from as Readonly<MutableRecord>) });
    for (const entry of delta.entries) {
        if (!applyEntry(draft, entry)) {
            return null;
        }
    }
    if (!draft.truncateArrays()) {
        return null;
    }
    if (draft.root['tick'] !== delta.toTick) {
        return null;
    }
    return draft.root as unknown as TState;
}
