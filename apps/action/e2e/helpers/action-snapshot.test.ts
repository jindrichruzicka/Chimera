import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { readUndoProjection } from './action-snapshot';

/**
 * The runner-side half of `readUndoProjection` — the narrowing it applies to
 * whatever `page.evaluate` hands back, which is untyped JSON by the time it
 * crosses out of the page.
 *
 * Worth its own cases because the spec that consumes it asserts a REFUSAL
 * (`canUndo: false`). A reader that answered `false` for a reason of its own —
 * a coarsened field, a swallowed malformed record read as "not eligible" —
 * would make that spec pass on a build with undo armed, which is the exact
 * failure `no-undo.spec.ts` exists to rule out. So the eligible reading has a
 * case here, not only the ineligible one.
 */

/** A `Page` that answers `page.evaluate` with `value`, ignoring the callback. */
function pageAnswering(value: unknown): Page {
    return { evaluate: async () => Promise.resolve(value) } as unknown as Page;
}

describe('readUndoProjection', () => {
    it('reads the pair and the tick off a well-formed projection', async () => {
        await expect(
            readUndoProjection(
                pageAnswering({ tick: 42, undoMeta: { canUndo: true, canRedo: false } }),
            ),
        ).resolves.toStrictEqual({ projectedTick: 42, canUndo: true, canRedo: false });
    });

    it('carries an ELIGIBLE reading through unchanged, so a refusal is the app’s and not this reader’s', async () => {
        await expect(
            readUndoProjection(
                pageAnswering({ tick: 7, undoMeta: { canUndo: true, canRedo: true } }),
            ),
        ).resolves.toStrictEqual({ projectedTick: 7, canUndo: true, canRedo: true });
    });

    it('is null while the bridge or the session is absent', async () => {
        await expect(readUndoProjection(pageAnswering(null))).resolves.toBeNull();
    });

    it('is null when the projection carries no numeric tick, so the pair cannot be dated', async () => {
        await expect(
            readUndoProjection(pageAnswering({ undoMeta: { canUndo: false, canRedo: false } })),
        ).resolves.toBeNull();
    });

    it('is null when the projection carries no undoMeta object', async () => {
        await expect(readUndoProjection(pageAnswering({ tick: 3 }))).resolves.toBeNull();
        await expect(
            readUndoProjection(pageAnswering({ tick: 3, undoMeta: null })),
        ).resolves.toBeNull();
    });

    it('is null when either flag is not a boolean, rather than coercing it to a refusal', async () => {
        await expect(
            readUndoProjection(pageAnswering({ tick: 3, undoMeta: { canRedo: false } })),
        ).resolves.toBeNull();
        await expect(
            readUndoProjection(
                pageAnswering({ tick: 3, undoMeta: { canUndo: false, canRedo: 'no' } }),
            ),
        ).resolves.toBeNull();
    });
});
