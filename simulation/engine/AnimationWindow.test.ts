/**
 * simulation/engine/AnimationWindow.test.ts
 *
 * Type-level and runtime unit tests for the host-only animation-window
 * vocabulary: `AnimationWindowId`, `AnimationWindowRecord`,
 * `AnimationWindowRegistry`, `WindowCloseReason` and `ClosedAnimationWindow`.
 * These are the shapes `BaseGameSnapshot.animationWindows` is built from.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   `AnimationWindowId` is a BRANDED string: a bare `string` is not assignable
 *     to it, so a raw literal cannot silently become a window id.
 *   `WindowCloseReason` is exactly the four reasons — a fifth is rejected.
 *   `AnimationWindowRegistry` is keyed by `AnimationWindowId`.
 *   The module is PURE TYPE DECLARATIONS: the esbuild pin at the bottom asserts
 *     it bundles to the empty string, so no runtime value can enter it.
 *
 * Written test-first: for a type-only module the meaningful red is at the type
 * layer, not the runtime one. The `expectTypeOf`/`@ts-expect-error` assertions
 * below fail `tsc -p simulation/tsconfig.json` when the source types are missing
 * or wrong; vitest alone cannot see them, because `import type` is erased and
 * `expectTypeOf(...)` is a runtime no-op.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
    AnimationWindowId,
    AnimationWindowRecord,
    AnimationWindowRegistry,
    ClosedAnimationWindow,
    WindowCloseReason,
} from './AnimationWindow.js';
import type { EntityId } from './types.js';
import { entityId } from './types.js';
import type { FixedPoint } from './FixedPoint.js';
import { fromInt } from './FixedPoint.js';

const WINDOW_ID = 'sword-hit#1' as AnimationWindowId;
const OWNER = entityId('unit-7');

// ─── AnimationWindowId ────────────────────────────────────────────────────────

describe('AnimationWindowId', () => {
    it('is a branded string — a bare string is not assignable', () => {
        expectTypeOf<AnimationWindowId>().toExtend<string>();

        // @ts-expect-error a raw string literal must not become a window id
        //                  without passing through an explicit cast site.
        const unbranded: AnimationWindowId = 'sword-hit#1';

        expect(unbranded).toBe(WINDOW_ID);
    });
});

// ─── AnimationWindowRecord ────────────────────────────────────────────────────

describe('AnimationWindowRecord', () => {
    it('carries the id, the owning entity, the beat countdown and the payload', () => {
        const record: AnimationWindowRecord = {
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 3,
            payload: { damage: 12 },
        };

        expectTypeOf<AnimationWindowRecord['id']>().toEqualTypeOf<AnimationWindowId>();
        expectTypeOf<AnimationWindowRecord['ownerId']>().toEqualTypeOf<EntityId>();
        expectTypeOf<AnimationWindowRecord['remainingBeats']>().toEqualTypeOf<number>();

        expect(record.remainingBeats).toBe(3);
    });

    it('accepts a FixedPoint payload value alongside an integer one', () => {
        const reach: FixedPoint = fromInt(2);
        const record: AnimationWindowRecord = {
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 1,
            payload: { damage: 12, reach },
        };

        expect(record.payload['reach']).toBe(reach);
    });

    it('rejects a string payload value — the payload is numeric only', () => {
        const record: AnimationWindowRecord = {
            id: WINDOW_ID,
            ownerId: OWNER,
            remainingBeats: 1,
            // @ts-expect-error payload values are integers or FixedPoint (#44/#75);
            //                  a string is not snapshot-resident numeric state.
            payload: { damageType: 'slashing' },
        };

        expect(record.payload['damageType']).toBe('slashing');
    });
});

// ─── AnimationWindowRegistry ──────────────────────────────────────────────────

describe('AnimationWindowRegistry', () => {
    it('is a record keyed by window id, mirroring TimerRegistry', () => {
        const registry: AnimationWindowRegistry = {
            [WINDOW_ID]: { id: WINDOW_ID, ownerId: OWNER, remainingBeats: 2, payload: {} },
        };

        expectTypeOf<AnimationWindowRegistry>().toEqualTypeOf<
            Record<AnimationWindowId, AnimationWindowRecord>
        >();

        expect(Object.keys(registry)).toEqual([WINDOW_ID]);
    });
});

// ─── WindowCloseReason ────────────────────────────────────────────────────────

describe('WindowCloseReason', () => {
    it('pins exactly the four close reasons', () => {
        expectTypeOf<WindowCloseReason>().toEqualTypeOf<
            'expired' | 'owner-gone' | 'replaced' | 'interrupted'
        >();

        const reasons: readonly WindowCloseReason[] = [
            'expired',
            'owner-gone',
            'replaced',
            'interrupted',
        ];

        expect(reasons).toHaveLength(4);
    });

    it('rejects a reason outside the four', () => {
        // @ts-expect-error 'cancelled' is not one of the four close reasons.
        const reason: WindowCloseReason = 'cancelled';

        expect(reason).toBe('cancelled');
    });
});

// ─── ClosedAnimationWindow ────────────────────────────────────────────────────

describe('ClosedAnimationWindow', () => {
    it('reports the closed record together with why it closed', () => {
        const closed: ClosedAnimationWindow = {
            id: WINDOW_ID,
            ownerId: OWNER,
            payload: { damage: 12 },
            reason: 'expired',
        };

        expectTypeOf<ClosedAnimationWindow['reason']>().toEqualTypeOf<WindowCloseReason>();
        expectTypeOf<ClosedAnimationWindow['payload']>().toEqualTypeOf<
            AnimationWindowRecord['payload']
        >();

        expect(closed.reason).toBe('expired');
    });

    it('carries no beat countdown — a closed window has none left to report', () => {
        const closed: ClosedAnimationWindow = {
            id: WINDOW_ID,
            ownerId: OWNER,
            payload: {},
            // @ts-expect-error a closed window reports no remaining beats.
            remainingBeats: 0,
            reason: 'owner-gone',
        };

        expect(closed.reason).toBe('owner-gone');
    });
});

// ─── The module carries zero runtime ──────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bundle a module with esbuild (bundle + tree-shake) and return its emitted
 * JavaScript with comments and whitespace removed. A side-effect-free, type-only
 * module erases to the empty string.
 */
async function bundleAndStrip(absoluteEntry: string): Promise<string> {
    const result = await build({
        entryPoints: [absoluteEntry],
        bundle: true,
        treeShaking: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        logLevel: 'silent',
    });
    const code = result.outputFiles[0]?.text ?? '';
    return code
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, '');
}

describe('AnimationWindow.ts is PURE TYPE DECLARATIONS', () => {
    it('bundles to the empty string — it evaluates no runtime module', async () => {
        // Mutation control: adding `export const ANY = 1;` to the source module
        // reds this assertion.
        expect(await bundleAndStrip(resolve(__dirname, 'AnimationWindow.ts'))).toBe('');
    });

    it('the control bundles non-empty — the pin above is not vacuous', async () => {
        // Opposite polarity: a sibling module that DOES carry runtime values
        // must not erase, or the assertion above would pass for any input.
        expect(await bundleAndStrip(resolve(__dirname, 'FixedPoint.ts'))).not.toBe('');
    });
});
