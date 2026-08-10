/**
 * apps/tactics/content/tacticsAnimations.ts
 *
 * Content-load verification of the tactics clip sheets.
 *
 * The `wave` clip's gameplay passage is authored TWICE — once as clip-relative
 * phases (`from`/`to`, what the renderer plays) and once as beat integers
 * (`beatWindow`, what the simulation would open). `compileAnimationWindows`
 * RECOMPUTES the second from the first and compares; it never derives one from
 * the other, because deriving would make the length of a gameplay window a
 * function of the host pacing knob `tickRateMs`.
 *
 * The call is at MODULE SCOPE, which is the whole point: a disagreement throws
 * while this module is being imported, so the game refuses to start rather than
 * running with a marker that lands somewhere the author never wrote. Calling it
 * from a reducer would be the opposite failure and is banned by lint
 * (`chimera/no-animation-derivation-in-reduce`).
 *
 * `DEFAULT_TICK_RATE_MS` is passed explicitly rather than read from the game
 * manifest: `tacticsManifest` is `realtime: false` and declares no
 * `tickRateMs`, and `resolveTickerHz` answers `null` for such a manifest before
 * it ever reads the field. So for tactics this call verifies AUTHORING
 * SELF-CONSISTENCY only — it reconciles nothing at runtime, because no beat ever
 * elapses. A realtime game passes its own resolved rate and gets a live
 * reconciliation from the same call.
 *
 * Module boundary (§3): workspace imports are simulation/ and own files only.
 */

import { compileAnimationWindows } from '@chimera-engine/simulation/content/animationWindows.js';
import type { CompiledAnimationWindow } from '@chimera-engine/simulation/content/animationWindows.js';
import { DEFAULT_TICK_RATE_MS } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import type { ModelAnimationMetadata } from '@chimera-engine/simulation/content/animationManifest.js';

import { tacticsAssetManifest, tacticsModelRefs, tacticsShowcaseClip } from '../asset-manifest.js';

/**
 * The showcase clip's sheet, read back out of the manifest rather than
 * re-authored here.
 *
 * Reading it back is what makes the verification below bind the sheet the game
 * actually ships: a second copy authored in this file would keep agreeing with
 * itself after the manifest changed.
 */
function showcaseAnimationMetadata(): ModelAnimationMetadata {
    const entry = tacticsAssetManifest.entries.find(
        (candidate) => candidate.ref === tacticsModelRefs.showcaseRigAnimated,
    );
    if (entry === undefined) {
        throw new Error(
            `tacticsAssetManifest declares no entry for ${tacticsModelRefs.showcaseRigAnimated}; ` +
                'the animated showcase clip cannot be verified',
        );
    }
    // `AssetManifestEntry.metadata` is typed `unknown` by contract — the sim
    // layer stores clip sheets opaquely and never parses them (Invariant #124).
    // No cast is needed and none is written: `ModelAnimationMetadata`'s every
    // field is optional, so the empty fallback satisfies it, and the verifier
    // below reads only fields it re-checks. A cast here would be the game
    // asserting a shape rather than the verifier proving one.
    return entry.metadata ?? {};
}

/**
 * The compiled `[startBeat, endBeat]` windows the showcase clip declares.
 *
 * Evaluated at import. A `beatWindow` that disagrees with the span its phases
 * imply raises `AnimationWindowMismatchError` HERE, before any screen mounts.
 */
export const TACTICS_SHOWCASE_WINDOWS: readonly CompiledAnimationWindow[] = compileAnimationWindows(
    showcaseAnimationMetadata(),
    tacticsShowcaseClip.name,
    DEFAULT_TICK_RATE_MS,
);
