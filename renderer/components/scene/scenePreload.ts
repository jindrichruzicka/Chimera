// renderer/components/scene/scenePreload.ts
//
// The scene preload run (§4.10): warms a scene's declared `requiredAssets`
// before the entering scene is revealed, on a budget, and fails open.
//
// Pure and React-free on purpose. The policy here — which refs are awaited,
// what the progress fraction is over, what each outcome means, when the budget
// releases the reveal — is the part worth testing, and none of it needs a DOM.
// The effect that owns a run's lifetime lives with its caller.
//
// It is also the first production caller of `markRequiredAssetsCritical`;
// `renderer/assets/__tests__/required-assets-producer.test.ts` pins that this
// stays the only one.
//
// Invariant #21: the manager is BORROWED. This module never constructs,
// disposes or evicts one. Which surface disposes which manager is enumerated in
// that invariant and not restated here.
//
// Invariant #52: an undeclared ref is reported and skipped, never loaded behind
// `validate-assets`' back. `AssetManager.load` rejects such a ref with
// `UnknownAssetManifestEntryError`, which this run counts as a failed ref like
// any other.

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager } from '../../assets/AssetManager.js';
import { markRequiredAssetsCritical } from '../../assets/AssetPreloader.js';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'scene-preload';

/**
 * How long a scene reveal may wait on its declared assets before the gate
 * releases it anyway.
 *
 * 5 s, and deliberately NOT the 15 s the scene-transition e2e allows the
 * barrier: a budget equal to that poll consumes the whole allowance on exactly
 * the path this fail-open exists to rescue, and CI runners are an order of
 * magnitude slower than a developer machine. `scenePreload.test.ts` asserts the
 * strict inequality, so raising this reds there rather than turning that spec
 * flaky.
 */
export const SCENE_PRELOAD_BUDGET_MS = 5_000;

/**
 * How a run ended.
 *
 * `'skipped'` — nothing to wait for, settled synchronously.
 * `'loaded'` — every declared ref resolved.
 * `'failed'` — every ref settled and at least one rejected.
 * `'timeout'` — the budget elapsed first. Nothing is aborted; the loads keep
 * warming into the borrowed manager and the reveal is released.
 */
export type ScenePreloadOutcome = 'skipped' | 'loaded' | 'timeout' | 'failed';

export interface ScenePreloadRun {
    /**
     * Resolves once — and NEVER rejects. A gate awaiting this is the thing
     * standing between the player and the scene, so a throw here would strand
     * the reveal on the very path the outcome exists to describe.
     */
    readonly settled: Promise<ScenePreloadOutcome>;
    /**
     * Abandons both the progress callback and the error report. Idempotent, and
     * a cancelled run still resolves `settled` — callers await it.
     *
     * Nothing aborts an in-flight load, so this governs only what the run says,
     * never what it does to the manager.
     */
    cancel(): void;
}

export interface StartScenePreloadOptions {
    /** Borrowed, never owned. Blank when the surface has not built one yet. */
    readonly assetManager: AssetManager | null;
    /** Blank for a game that declares no manifest. */
    readonly assetManifest: AssetManifest | undefined;
    /** The ENTERING scene's declared refs, as carried on the snapshot. */
    readonly requiredAssets: readonly AssetRef[];
    readonly timeoutMs?: number;
    /** Fraction in `[0, 1]` of the scene's own refs that have settled. */
    readonly onProgress?: (fraction: number) => void;
}

export function startScenePreload({
    assetManager,
    assetManifest,
    requiredAssets,
    timeoutMs = SCENE_PRELOAD_BUDGET_MS,
    onProgress,
}: StartScenePreloadOptions): ScenePreloadRun {
    let cancelled = false;
    // Set the moment `settled` resolves, by whichever path won. Progress
    // reported after that describes a wait the caller has already stopped
    // waiting on, so it is dropped.
    let finished = false;

    if (assetManager === null || assetManifest === undefined || requiredAssets.length === 0) {
        // Synchronous, and with NO manifest re-registration: a transition into a
        // scene that declares nothing must cost exactly what it cost before this
        // gate existed, down to the microtask.
        onProgress?.(1);
        return { settled: Promise.resolve('skipped'), cancel: () => undefined };
    }

    // The FULL manifest, promoted — never a sub-manifest filtered to the scene's
    // refs. `registerManifest` evicts every cached ref absent from the manifest
    // it is handed, so a filtered one would wipe the match's whole asset cache
    // mid-transition. Re-registering the promoted copy evicts nothing: entry
    // equivalence compares kind and metadata, and never `priority`.
    assetManager.registerManifest(markRequiredAssetsCritical(assetManifest, requiredAssets));

    const total = requiredAssets.length;
    let completed = 0;
    let failures = 0;
    let lastError: unknown;

    const report = (fraction: number): void => {
        if (cancelled || finished) {
            return;
        }
        try {
            onProgress?.(fraction);
        } catch {
            // A game's cover throwing is not a reason to hold the reveal. This
            // callback runs inside the per-ref `finally`, so an escaping throw
            // rejects the settle-all and leaves nothing to resolve the run —
            // the scene would then wait out the entire budget with its assets
            // already loaded. Swallowed here so the gate stays fail-open.
        }
    };

    // Settle-all, not stop-at-first-rejection: a run that abandons the rest of
    // the list at the first bad ref releases the reveal with every later ref
    // still unloaded, which is the pop-in this gate exists to remove.
    const everyRefSettled = Promise.all(
        requiredAssets.map(async (ref) => {
            try {
                await assetManager.load(ref);
            } catch (error: unknown) {
                failures += 1;
                lastError = error;
            } finally {
                completed += 1;
                report(completed / total);
            }
        }),
    );

    let resolveSettled: (outcome: ScenePreloadOutcome) => void = () => undefined;
    const settled = new Promise<ScenePreloadOutcome>((resolve) => {
        resolveSettled = resolve;
    });

    // First outcome wins: the budget and the last ref can settle in either
    // order, and both may call this. A second call is inert on its own terms —
    // `resolveSettled` on a settled promise and `clearTimeout` on a fired id are
    // both no-ops — so there is no first-wins guard to leave unmeasured. What
    // `finished` is for is the progress channel, which reads it above.
    const finish = (outcome: ScenePreloadOutcome): void => {
        finished = true;
        clearTimeout(budgetTimer);
        resolveSettled(outcome);
    };

    // Declared after `finish` only because `const` forbids otherwise; `finish`
    // reads it exclusively from asynchronous callers, so the binding is always
    // initialised by then.
    const budgetTimer = setTimeout(() => {
        finish('timeout');
    }, timeoutMs);

    void everyRefSettled.then(() => {
        // Reported once for the whole run, not once per bad ref: a scene whose
        // three refs are all missing is one broken declaration, not three.
        // Still reported when the budget already released the reveal — the load
        // did fail, and that is the diagnostic — but never after a cancel.
        if (failures > 0 && !cancelled) {
            emitRendererError(
                readRendererLogsApi(),
                '[assets] scene preload failed; those refs load on demand instead',
                lastError instanceof Error ? lastError : new Error(String(lastError)),
                { gameId: assetManifest.gameId },
                LOG_MODULE,
            );
        }
        finish(failures > 0 ? 'failed' : 'loaded');
    });

    return {
        settled,
        cancel: () => {
            cancelled = true;
        },
    };
}
