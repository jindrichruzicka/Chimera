/**
 * apps/tactics/content/tacticsAnimations.test.ts
 *
 * The content-load verification of the showcase clips' beat windows.
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

import {
    tacticsAssetManifest,
    tacticsModelRefs,
    tacticsShowcaseLeanClip,
    tacticsShowcaseWaveClip,
} from '../asset-manifest.js';
import { TACTICS_SHOWCASE_WINDOWS } from './tacticsAnimations.js';
import * as tacticsContent from './tacticsContent.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Both windowed clips, each with the mirror of its own sheet. */
const CLIPS = [
    { name: tacticsShowcaseWaveClip.name, mirror: tacticsShowcaseWaveClip },
    { name: tacticsShowcaseLeanClip.name, mirror: tacticsShowcaseLeanClip },
] as const;

/**
 * The shipped sheet, rebuilt from the mirrors so a mutation cannot touch it.
 *
 * `beatWindows` overrides one clip's authored window by name, which is what lets
 * a case shift EITHER clip and see the refusal land on that clip alone.
 */
function authoredSheet(beatWindows: Readonly<Record<string, readonly [number, number]>> = {}) {
    return {
        clips: {
            [tacticsShowcaseWaveClip.name]: {
                durationSeconds: tacticsShowcaseWaveClip.durationSeconds,
                loop: 'loop' as const,
                notifies: {
                    [tacticsShowcaseWaveClip.notifyName]: {
                        at: { seconds: tacticsShowcaseWaveClip.notifySeconds },
                    },
                },
                passages: {
                    [tacticsShowcaseWaveClip.passageName]: {
                        from: tacticsShowcaseWaveClip.passageFromPhase,
                        to: tacticsShowcaseWaveClip.passageToPhase,
                        beatWindow:
                            beatWindows[tacticsShowcaseWaveClip.name] ??
                            tacticsShowcaseWaveClip.passageBeatWindow,
                        window: tacticsShowcaseWaveClip.windowName,
                    },
                },
            },
            [tacticsShowcaseLeanClip.name]: {
                durationSeconds: tacticsShowcaseLeanClip.durationSeconds,
                loop: 'loop' as const,
                blendInSeconds: tacticsShowcaseLeanClip.blendInSeconds,
                passages: {
                    [tacticsShowcaseLeanClip.passageName]: {
                        from: tacticsShowcaseLeanClip.passageFromPhase,
                        to: tacticsShowcaseLeanClip.passageToPhase,
                        beatWindow:
                            beatWindows[tacticsShowcaseLeanClip.name] ??
                            tacticsShowcaseLeanClip.passageBeatWindow,
                        window: tacticsShowcaseLeanClip.windowName,
                    },
                },
            },
        },
    };
}

/** The clip sheets the SHIPPED manifest entry carries, keyed by clip name. */
function shippedClipSheets(): Readonly<Record<string, unknown>> {
    const entry = tacticsAssetManifest.entries.find(
        (candidate) => candidate.ref === tacticsModelRefs.showcaseRigAnimated,
    );
    return (entry?.metadata as { clips?: Record<string, unknown> })?.clips ?? {};
}

describe('tactics animation content load', () => {
    it('verifies every clip the shipped sheet declares, not a subset named by hand', () => {
        // The keys, against the sheet's own — which is what makes the case below
        // a statement about the sheet rather than about two names this file and
        // the module happen to share. A module that listed its clips itself would
        // pass every value assertion here and silently stop covering the next
        // clip the manifest grows.
        expect(Object.keys(TACTICS_SHOWCASE_WINDOWS).sort()).toEqual(
            Object.keys(shippedClipSheets()).sort(),
        );
        // …and there is more than one, so "every" is not one clip in disguise.
        expect(Object.keys(TACTICS_SHOWCASE_WINDOWS).length).toBeGreaterThan(1);
    });

    it('compiles each showcase clip to the window its own sheet authored', () => {
        // Importing this module IS the check: the value below is what the
        // module-scope calls produced while this file was being loaded.
        //
        // Keyed by clip, not flattened: a flat list of windows cannot say which
        // clip each came from, so a module that verified one clip twice and the
        // other never would satisfy a count and a membership check alike.
        expect(TACTICS_SHOWCASE_WINDOWS).toEqual({
            [tacticsShowcaseWaveClip.name]: [
                {
                    passageName: tacticsShowcaseWaveClip.passageName,
                    window: tacticsShowcaseWaveClip.windowName,
                    beatWindow: tacticsShowcaseWaveClip.passageBeatWindow,
                },
            ],
            [tacticsShowcaseLeanClip.name]: [
                {
                    passageName: tacticsShowcaseLeanClip.passageName,
                    window: tacticsShowcaseLeanClip.windowName,
                    beatWindow: tacticsShowcaseLeanClip.passageBeatWindow,
                },
            ],
        });
    });

    it.each(CLIPS)(
        'REFUSES a $name beat window that disagrees with the phases it is paired with',
        ({ name, mirror }) => {
            // The negative control. Without it the assertion above is satisfied
            // by a verifier that derives the window instead of checking it —
            // which is the exact defect the whole two-unit authoring scheme
            // exists to prevent. Once per clip, because the verification is once
            // per clip: a second clip added to the sheet and to nothing else
            // would leave this green if the shift only ever landed on the first.
            const shifted: readonly [number, number] = [
                mirror.passageBeatWindow[0] + 1,
                mirror.passageBeatWindow[1],
            ];

            expect(() =>
                compileAnimationWindows(
                    authoredSheet({ [name]: shifted }),
                    name,
                    DEFAULT_TICK_RATE_MS,
                ),
            ).toThrow(AnimationWindowMismatchError);
        },
    );

    it.each(CLIPS)(
        'accepts the shipped $name pair at the same tick rate the module passes',
        ({ name }) => {
            // The positive half of the same probe: the refusal above is about the
            // MUTATION, not about the fixture builder disagreeing with the
            // manifest.
            expect(compileAnimationWindows(authoredSheet(), name, DEFAULT_TICK_RATE_MS)).toEqual(
                TACTICS_SHOWCASE_WINDOWS[name],
            );
        },
    );

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
