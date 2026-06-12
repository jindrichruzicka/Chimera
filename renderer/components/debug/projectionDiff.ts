// renderer/components/debug/projectionDiff.ts
//
// Structural diff between the full debug-truth snapshot and a per-player
// projection, for the Inspector's Projection Explorer (§4.12, F47 T9, #698).
//
// Paths use the same dot-delimited convention as the simulation's snapshot
// differ (root `''`, array indices as numbers-as-strings). The walk is
// deliberately re-implemented here: the renderer must not import
// `simulation/debug` at runtime (Invariant #27), so sharing the simulation
// implementation is not an option.

export type ProjectionDiffKind = 'hidden' | 'masked' | 'extra';

export interface ProjectionDiff {
    /** Paths to highlight in the full-snapshot tree: `hidden` | `masked`. */
    readonly fullHighlights: ReadonlyMap<string, ProjectionDiffKind>;
    /** Paths to highlight in the projection tree: `masked` | `extra`. */
    readonly projectionHighlights: ReadonlyMap<string, ProjectionDiffKind>;
}

type Composite = Record<string, unknown> | readonly unknown[];

function isComposite(value: unknown): value is Composite {
    return typeof value === 'object' && value !== null;
}

function keysOf(value: Composite): readonly string[] {
    return Array.isArray(value) ? value.map((_, index) => String(index)) : Object.keys(value);
}

function childOf(value: Composite, key: string): unknown {
    return Array.isArray(value) ? value[Number(key)] : (value as Record<string, unknown>)[key];
}

function joinPath(path: string, key: string): string {
    return path === '' ? key : `${path}.${key}`;
}

/**
 * Compare the full debug-truth value against its projection for one player.
 *
 * - Key only in `full` → `hidden` at the subtree root (no recursion below).
 * - Key only in `projected` → `extra` (derived viewer fields).
 * - Unequal leaves, composite-vs-leaf, or array-vs-record → `masked` in both.
 */
export function computeProjectionDiff(full: unknown, projected: unknown): ProjectionDiff {
    const fullHighlights = new Map<string, ProjectionDiffKind>();
    const projectionHighlights = new Map<string, ProjectionDiffKind>();
    walk(full, projected, '', fullHighlights, projectionHighlights);
    return { fullHighlights, projectionHighlights };
}

function walk(
    full: unknown,
    projected: unknown,
    path: string,
    fullHighlights: Map<string, ProjectionDiffKind>,
    projectionHighlights: Map<string, ProjectionDiffKind>,
): void {
    if (
        isComposite(full) &&
        isComposite(projected) &&
        Array.isArray(full) === Array.isArray(projected)
    ) {
        const fullKeys = keysOf(full);
        const projectedKeys = keysOf(projected);
        const projectedKeySet = new Set(projectedKeys);
        for (const key of fullKeys) {
            const childPath = joinPath(path, key);
            if (!projectedKeySet.has(key)) {
                fullHighlights.set(childPath, 'hidden');
                continue;
            }
            walk(
                childOf(full, key),
                childOf(projected, key),
                childPath,
                fullHighlights,
                projectionHighlights,
            );
        }
        const fullKeySet = new Set(fullKeys);
        for (const key of projectedKeys) {
            if (!fullKeySet.has(key)) {
                projectionHighlights.set(joinPath(path, key), 'extra');
            }
        }
        return;
    }
    if (Object.is(full, projected)) {
        return;
    }
    fullHighlights.set(path, 'masked');
    projectionHighlights.set(path, 'masked');
}
