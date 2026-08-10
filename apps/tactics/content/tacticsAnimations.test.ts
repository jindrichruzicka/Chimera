/**
 * apps/tactics/content/tacticsAnimations.test.ts
 *
 * The content-load verification of the showcase clip's beat window.
 *
 * Two independent properties, because each fails silently without the other:
 *
 *   1. the check RUNS — the compiled windows exist at import, and they are the
 *      ones the manifest authored;
 *   2. the check REFUSES — an authored `beatWindow` that disagrees with the span
 *      its phases imply throws, rather than being quietly recomputed. Asserted
 *      by mutating a COPY of the shipped sheet and calling the same verifier the
 *      module calls, which is as close to the real failure as a test can get
 *      without a second, deliberately-broken manifest in the tree.
 *
 * And one structural property: the verification is reachable from a module the
 * app actually loads. A module-scope check in a module nothing imports runs
 * never, and reads exactly like one that runs always.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    AnimationWindowMismatchError,
    compileAnimationWindows,
} from '@chimera-engine/simulation/content/animationWindows.js';
import { DEFAULT_TICK_RATE_MS } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { tacticsShowcaseClip } from '../asset-manifest.js';
import { TACTICS_SHOWCASE_WINDOWS } from './tacticsAnimations.js';
import * as tacticsContent from './tacticsContent.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The shipped sheet, rebuilt from the mirror so a mutation cannot touch it. */
function authoredSheet(beatWindow: readonly [number, number]) {
    return {
        clips: {
            [tacticsShowcaseClip.name]: {
                durationSeconds: tacticsShowcaseClip.durationSeconds,
                loop: 'loop' as const,
                notifies: {
                    [tacticsShowcaseClip.notifyName]: {
                        at: { seconds: tacticsShowcaseClip.notifySeconds },
                    },
                },
                passages: {
                    [tacticsShowcaseClip.passageName]: {
                        from: tacticsShowcaseClip.passageFromPhase,
                        to: tacticsShowcaseClip.passageToPhase,
                        beatWindow,
                        window: tacticsShowcaseClip.windowName,
                    },
                },
            },
        },
    };
}

describe('tactics animation content load', () => {
    it('compiles the showcase clip to the window the manifest authored', () => {
        // Importing this module IS the check: the value below is what the
        // module-scope call produced while this file was being loaded.
        expect(TACTICS_SHOWCASE_WINDOWS).toEqual([
            {
                passageName: tacticsShowcaseClip.passageName,
                window: tacticsShowcaseClip.windowName,
                beatWindow: tacticsShowcaseClip.passageBeatWindow,
            },
        ]);
    });

    it('REFUSES a beat window that disagrees with the phases it is paired with', () => {
        // The negative control. Without it the assertion above is satisfied by a
        // verifier that derives the window instead of checking it — which is the
        // exact defect the whole two-unit authoring scheme exists to prevent.
        const shifted: readonly [number, number] = [
            tacticsShowcaseClip.passageBeatWindow[0] + 1,
            tacticsShowcaseClip.passageBeatWindow[1],
        ];

        expect(() =>
            compileAnimationWindows(
                authoredSheet(shifted),
                tacticsShowcaseClip.name,
                DEFAULT_TICK_RATE_MS,
            ),
        ).toThrow(AnimationWindowMismatchError);
    });

    it('accepts the shipped pair at the same tick rate the module passes', () => {
        // The positive half of the same probe: the refusal above is about the
        // MUTATION, not about the fixture builder disagreeing with the manifest.
        expect(
            compileAnimationWindows(
                authoredSheet(tacticsShowcaseClip.passageBeatWindow),
                tacticsShowcaseClip.name,
                DEFAULT_TICK_RATE_MS,
            ),
        ).toEqual(TACTICS_SHOWCASE_WINDOWS);
    });

    it('is reachable from the content adapter the composition root imports', () => {
        // The structural half, and the reason it is three assertions rather than
        // one: the claim "this check runs at startup" is a CHAIN, and each link
        // is silent when it breaks.
        //
        // Link 1 — the adapter really re-exports the binding.
        expect(tacticsContent.TACTICS_SHOWCASE_WINDOWS).toBe(TACTICS_SHOWCASE_WINDOWS);

        // Link 2 — the composition root really imports the adapter, as a VALUE.
        // A type-only import erases at compile time and evaluates nothing.
        const compositionRoot = readFileSync(path.join(here, '..', 'electron', 'main.ts'), 'utf8');
        const adapterImport =
            /import (type )?\{([^}]*)\}\s*from\s*'@chimera-engine\/tactics\/content\/tacticsContent\.js'/u.exec(
                compositionRoot,
            );
        expect(adapterImport).not.toBeNull();
        // Neither erasing form: not `import type { … }`, and not a per-specifier
        // `{ type X }`. Both compile away, and both leave every other assertion
        // in this case green.
        expect(adapterImport?.[1]).toBeUndefined();
        expect(adapterImport?.[2]).not.toMatch(/\btype\s/u);

        // Link 3 — nothing tells a bundler the module is droppable. MEASURED
        // with this repo's esbuild: a module-scope call survives bundling and
        // minification, but a `"sideEffects": false` on the package erases the
        // module entirely, and every test here — including the two above —
        // stays green while the startup check silently stops running.
        const appPackage = JSON.parse(
            readFileSync(path.join(here, '..', 'package.json'), 'utf8'),
        ) as { sideEffects?: unknown };
        expect(appPackage.sideEffects).toBeUndefined();
    });
});
