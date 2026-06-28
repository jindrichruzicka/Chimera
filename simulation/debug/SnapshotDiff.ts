/**
 * simulation/debug/SnapshotDiff.ts
 *
 * Pure structural differ over two GameSnapshots backing the Debug Inspector
 * Diff View (§4.12 — Runtime Debug Layer).
 *
 * Invariant #31: lives in the debug-only module graph, loaded exclusively
 * under `IS_DEBUG_MODE` via the `@chimera-engine/simulation/debug` subpath barrel.
 * Pure and deterministic — no I/O, no clock, no randomness, no imports
 * outside `simulation/`.
 *
 * Diff semantics:
 * - Snapshots are assumed JSON-plain (no Map/Date/class instances) — the
 *   immutability contract every pipeline state already satisfies.
 * - A key present with value `undefined` is treated as absent (JSON-path
 *   semantics, matching the snapshot's optional fields): `undefined → value`
 *   is `added`, `value → undefined` is `removed`. `null` is a real value.
 * - A wholly added/removed subtree emits ONE entry at the subtree root with
 *   the whole value as `after`/`before` (§10.1: "added entity → one `added`
 *   entry"), never per-leaf entries.
 * - A shape mismatch (record vs array vs primitive vs `null`) emits one
 *   `changed` entry with the whole values; no recursion across shapes.
 * - Arrays diff index-wise; extra trailing indices are `added`/`removed` at
 *   `path.<index>`. A head insertion therefore reports each shifted index as
 *   `changed` plus one trailing `added` — acceptable for a debug differ.
 * - Leaves compare with `Object.is` (NaN-stable). Shared references and
 *   equal primitives short-circuit, so structurally-shared subtrees are O(1).
 * - The `tick` field diffs like any other field; a differing tick yields a
 *   `changed` entry alongside the `fromTick`/`toTick` header fields.
 * - Paths are display-oriented: segments join with `.` and are not escaped
 *   (snapshot keys and branded IDs contain no dots).
 * - Entry order is deterministic: depth-first, `from`'s key insertion order,
 *   then `to`-only keys in `to`'s order.
 *
 * Values in entries are shared by reference (never cloned): snapshots are
 * immutable, so sharing is safe and the differ never copies state.
 */

import type { BaseGameSnapshot } from '../engine/types.js';

/** One structural difference at a dot-delimited JSON path. */
export interface DiffEntry {
    path: string; // Dot-delimited JSON path: 'entities.unit-1.hp'
    kind: 'added' | 'removed' | 'changed';
    before?: unknown;
    after?: unknown;
}

/** Flat structural diff between the snapshots at two ticks. */
export interface SnapshotDiff {
    fromTick: number;
    toTick: number;
    entries: DiffEntry[];
    summary: { added: number; removed: number; changed: number };
}

// `before`/`after` are OMITTED (not set to `undefined`) when absent so the
// debug bridge's JSON serialization stays unambiguous: `added` carries only
// `after`, `removed` only `before`.
const added = (path: string, after: unknown): DiffEntry => ({ path, kind: 'added', after });
const removed = (path: string, before: unknown): DiffEntry => ({ path, kind: 'removed', before });
const changed = (path: string, before: unknown, after: unknown): DiffEntry => ({
    path,
    kind: 'changed',
    before,
    after,
});

/** Plain record: non-null object that is not an array. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** `from`'s own keys in insertion order, then `to`-only keys in `to`'s order. */
const unionKeys = (
    from: Readonly<Record<string, unknown>>,
    to: Readonly<Record<string, unknown>>,
): string[] => {
    const keys = Object.keys(from);
    const seen = new Set(keys);
    for (const key of Object.keys(to)) {
        if (!seen.has(key)) {
            keys.push(key);
        }
    }
    return keys;
};

const walk = (path: string, from: unknown, to: unknown, entries: DiffEntry[]): void => {
    if (Object.is(from, to)) {
        return;
    }
    if (isRecord(from) && isRecord(to)) {
        walkRecord(path, from, to, entries);
    } else if (Array.isArray(from) && Array.isArray(to)) {
        walkArray(path, from, to, entries);
    } else {
        entries.push(changed(path, from, to));
    }
};

const walkRecord = (
    prefix: string,
    from: Readonly<Record<string, unknown>>,
    to: Readonly<Record<string, unknown>>,
    entries: DiffEntry[],
): void => {
    for (const key of unionKeys(from, to)) {
        const before = from[key];
        const after = to[key];
        const path = prefix === '' ? key : `${prefix}.${key}`;
        if (Object.is(before, after)) {
            continue; // also covers both-absent / both-undefined
        }
        if (before === undefined) {
            entries.push(added(path, after));
        } else if (after === undefined) {
            entries.push(removed(path, before));
        } else {
            walk(path, before, after, entries);
        }
    }
};

const walkArray = (
    prefix: string,
    from: readonly unknown[],
    to: readonly unknown[],
    entries: DiffEntry[],
): void => {
    const length = Math.max(from.length, to.length);
    for (let index = 0; index < length; index++) {
        const path = `${prefix}.${index}`;
        if (index >= from.length) {
            entries.push(added(path, to[index]));
        } else if (index >= to.length) {
            entries.push(removed(path, from[index]));
        } else {
            walk(path, from[index], to[index], entries);
        }
    }
};

/**
 * Structurally diff two snapshots into a flat `DiffEntry[]` plus per-kind
 * summary counts. `fromTick`/`toTick` come from the snapshots themselves —
 * the snapshot's own `tick` field is the single source of truth.
 */
export function diffSnapshots<TState extends BaseGameSnapshot>(
    from: Readonly<TState>,
    to: Readonly<TState>,
): SnapshotDiff {
    const entries: DiffEntry[] = [];
    walk('', from, to, entries);
    const summary = { added: 0, removed: 0, changed: 0 };
    for (const entry of entries) {
        summary[entry.kind] += 1;
    }
    return { fromTick: from.tick, toTick: to.tick, entries, summary };
}
