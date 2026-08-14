'use client';

// renderer/assets/criticalAssetPreload.ts
//
// Runs the §4.10 critical preload against a game-asset `AssetManager`. It is
// what gives `AssetManifestEntry.priority: 'critical'` a runtime meaning:
// without a caller, the priority is a field every game may author and no code
// reads, and a clip marked critical still decodes on first play — which is a
// fade scheduled against a buffer that is not there yet.
//
// Which surface disposes which manager is Invariant #21's, and is not restated
// here.
//
// Three entry points. The first two are split by how the caller holds that
// manager; the third is split by what the caller does with the answer:
//
//   * `startCriticalAssetPreload` is the primitive, and returns the abandon
//     callback. A caller that ALLOCATES its manager inside an effect uses this
//     one, from that same effect, so that create → preload → abandon → dispose
//     is a single cleanup-ordered unit. Split across two effects it is not:
//     React runs every cleanup before every setup, so the second effect's setup
//     would read the previous manager — the one the first effect's cleanup just
//     disposed — out of state, and load into it. `dispose()` empties the maps
//     without making the object refuse work, so those assets cache into a
//     manager no dispose path can reach any more.
//   * `useCriticalAssetPreload` wraps it as an effect, for a caller holding a
//     manager whose identity moves in the same render as the manifest (a
//     render-phase `useMemo` keyed on both, or an injected prop). There the
//     pair can never be mismatched.
//   * `useCriticalAssetPreloadGate` runs the same warm-up and REPORTS when it
//     settles, for a route that holds its reveal — the app-level fade-in, a
//     route-entry cover — until the assets are there. It holds back no MOUNT:
//     see its JSDoc for why Invariant #21 forbids that.
//
// Three properties are load-bearing, each for a reason invisible at the call
// site:
//
//   * **Commit phase, never render.** The obvious cheaper home is
//     `createAssetManager`, beside the manifest registration its JSDoc argues
//     must happen at construction. It cannot go there: StrictMode discards one
//     of the two managers `useRendererGameAssetManager` builds in `useMemo`,
//     and that orphan is only tolerable because it is inert — it holds manifest
//     entries and no asset. A preload at construction fills it with decoded
//     audio and GPU textures that no dispose path can reach.
//   * **Non-blocking.** The caller renders its subtree while this runs. A
//     child that loads the same ref through `useAsset` before the preload
//     finishes is served the SAME promise — `AssetManager.load` returns the
//     in-flight entry — so the warm-up never costs a second fetch and never
//     gates a frame.
//   * **Non-fatal.** A rejected critical load is reported and dropped. The
//     deferred on-demand path is untouched by it, so a missing asset degrades
//     one ref instead of refusing the match. (`preloadCritical` awaits its
//     entries in sequence and stops at the first rejection, so entries after
//     the failing one are not preloaded by THAT run — the gate's settle-all
//     picks up the ones in its promoted set.)
//
// Architecture reference: §4.10 Asset Reference System.

import React from 'react';

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';

import {
    emitRendererError,
    emitRendererWarning,
    readRendererLogsApi,
} from '../logging/rendererLogger.js';
import type { AssetManager } from './AssetManager';
import { AssetPreloader, markRequiredAssetsCritical } from './AssetPreloader.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'asset-preload';

/**
 * The gate's own module name, distinct from the run's.
 *
 * A budget that elapsed and a ref that failed are different diagnostics reported
 * by different arms, and the gate is the only one of the two that can report
 * while the load is still in flight — attributing both to one module would make
 * a timeout read as a second failure.
 */
const GATE_LOG_MODULE = 'asset-preload-gate';

/** Abandons the report of a preload still in flight. See {@link startCriticalAssetPreload}. */
export type AbandonCriticalAssetPreload = () => void;

/**
 * Starts preloading `assetManifest`'s `critical` entries into `assetManager`,
 * and returns the callback that abandons the REPORT of that run.
 *
 * Nothing aborts an in-flight load, so abandoning governs only the log. That is
 * what keeps a normal teardown quiet: the owner disposes the manager, every
 * load still in flight rejects with 'Asset load was superseded by dispose.',
 * and a teardown is not a failure to report.
 *
 * Call it from the same cleanup as that dispose. Not necessarily BEFORE it —
 * the rejection a dispose causes is delivered on a later microtask, so two
 * synchronous statements in one cleanup are ordered either way — but in the
 * same cleanup, so no dispose can happen with the run still reporting.
 */
export function startCriticalAssetPreload(
    assetManager: AssetManager,
    assetManifest: AssetManifest,
): AbandonCriticalAssetPreload {
    let abandoned = false;

    void new AssetPreloader(assetManager).preloadCritical(assetManifest).catch((error: unknown) => {
        if (abandoned) {
            return;
        }

        emitRendererError(
            readRendererLogsApi(),
            '[assets] critical asset preload failed; those refs load on demand instead',
            error instanceof Error ? error : new Error(String(error)),
            { gameId: assetManifest.gameId },
            LOG_MODULE,
        );
    });

    return () => {
        abandoned = true;
    };
}

/**
 * Preloads `assetManifest`'s `critical` entries into `assetManager` once the
 * mount commits, and again whenever either identity changes.
 *
 * Only for a caller whose manager and manifest move together — see the module
 * header for the mismatched-pair hazard that makes this the wrong entry point
 * for a manager allocated in an effect.
 *
 * Both parameters are nullable in the shape their callers actually hold them:
 * a route builds the manager only once its game has loaded, and
 * `LoadedRendererGame.assetManifest` is optional. Either blank makes this a
 * no-op — there is nothing to preload, which is not the same as an error.
 */
export function useCriticalAssetPreload(
    assetManager: AssetManager | null,
    assetManifest: AssetManifest | undefined,
): void {
    React.useEffect(() => {
        if (assetManager === null || assetManifest === undefined) {
            return;
        }

        return startCriticalAssetPreload(assetManager, assetManifest);
    }, [assetManager, assetManifest]);
}

/**
 * How long a route entry may hold its REVEAL waiting on the critical preload
 * before it is shown anyway.
 *
 * 8 s, and generous on purpose: this budget is a rescue, not a schedule. It is
 * the wait a player absorbs when a critical ref is missing or a decode wedges,
 * and every path that settles normally settles far below it. Nothing is
 * aborted when it fires — the loads keep warming into the manager, and the
 * scene is revealed with whatever is ready.
 */
export const CRITICAL_ASSET_PRELOAD_BUDGET_MS = 8_000;

/**
 * How a gated run ended.
 *
 * `'pending'` — still waiting; the ONLY outcome with `ready: false`.
 * `'skipped'` — no manager or no manifest, so there is nothing to wait for.
 * `'loaded'` — the preload resolved.
 * `'failed'` — the preload rejected. `preloadCritical` stops at the first
 * rejection, so this is the common shape of a broken ref, not an edge case.
 * `'timed-out'` — the budget elapsed first.
 */
export type CriticalAssetPreloadOutcome = 'pending' | 'loaded' | 'failed' | 'timed-out' | 'skipped';

export interface CriticalAssetPreloadGate {
    /** True once the caller may reveal — on EVERY settle path, failures included. */
    readonly ready: boolean;
    readonly outcome: CriticalAssetPreloadOutcome;
}

/** Stable objects so a consumer's dependency array does not churn per render. */
const PENDING_GATE: CriticalAssetPreloadGate = { ready: false, outcome: 'pending' };
const SKIPPED_GATE: CriticalAssetPreloadGate = { ready: true, outcome: 'skipped' };

/**
 * A settled run, tagged with everything that identifies the run it settled.
 *
 * Keyed on the (manager, manifest) PAIR and the scene's ref list, never on the
 * manifest alone: `useRendererGameAssetManager` rebuilds on `loadedGame`
 * identity while `loadedGame.assetManifest` is a module-level object from the
 * dynamic import that can stay identical across a reload. A manager swap under
 * a stable manifest would otherwise leave the gate latched open against a cold
 * manager holding no asset at all.
 */
interface SettledCriticalPreload {
    readonly assetManager: AssetManager;
    readonly assetManifest: AssetManifest;
    readonly requiredKey: string;
    readonly outcome: Exclude<CriticalAssetPreloadOutcome, 'pending' | 'skipped'>;
}

/**
 * The refs a scene promotion alone made critical: named in `requiredAssets` and
 * carrying a non-`critical` priority in the base manifest, so
 * `markRequiredAssetsCritical` flipped them.
 *
 * This set is exactly the difference between the manifest the gate runs and the
 * one `startCriticalAssetPreload` runs for the match. A ref already critical in
 * the base is deliberately excluded — the shell arm reports that one, and
 * reporting it here too would turn one bad ref into two entries.
 *
 * A ref named in `requiredAssets` but absent from the manifest is also excluded:
 * the promotion does not add entries, so such a ref is never loaded by this run
 * either. `validate-assets` owns that case statically (Invariant #52).
 *
 * De-duplicated, so a scene declaring the same ref twice is reported once.
 */
function promotedCriticalRefs(
    manifest: AssetManifest,
    requiredAssets: readonly AssetRef[],
): readonly AssetRef[] {
    const promotable = new Set(
        manifest.entries
            .filter((entry) => entry.priority !== 'critical')
            .map((entry) => String(entry.ref)),
    );
    const seen = new Set<string>();
    return requiredAssets.filter((ref) => {
        const key = String(ref);
        if (!promotable.has(key) || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/**
 * Runs the critical preload for a ROUTE ENTRY and reports whether the route may
 * reveal yet.
 *
 * The third entry point of this module, and the only one that answers a
 * question rather than only starting work: `GameShell`'s arm warms the same
 * manifest and reports failures, and this one exists so the surrounding route
 * can hold its reveal — the app-level fade-in, a cover — until the warm-up has
 * settled. Both arms are cheap together: every ref after the first resolves
 * through the manager's `loadedAssets`/`inFlightLoads`, and re-registering an
 * equivalent manifest evicts nothing.
 *
 * A gate withholds a REVEAL, never a MOUNT. `GameShell` is the unique disposer
 * of a page-injected manager (Invariant #21), so a caller that withheld its
 * mount while waiting here would orphan the very manager this preloads into.
 *
 * `sceneRequiredAssets` are the refs the already-committed scene declares, as
 * carried on `BaseGameSnapshot.sceneRequiredAssets`. They are promoted to
 * critical for this run (Invariant #52), which is what makes a route entered
 * mid-scene — a restore, a replay — gate on that scene's own declaration and
 * not merely on the manifest's standing `critical` set.
 *
 * Every settle path is independent, because each has its own failure mode:
 *
 *   * the preload resolving or REJECTING, through a two-argument `.then` —
 *     `.finally` would re-throw the rejection into an unhandled rejection;
 *   * `budgetMs` elapsing, so a wedged decode costs a bounded wait;
 *   * a blank manager or manifest, computed in RENDER rather than in an effect,
 *     so a manifest-less game is ready on its first render instead of waiting
 *     forever on a run that will never start.
 */
export function useCriticalAssetPreloadGate(
    assetManager: AssetManager | null,
    assetManifest: AssetManifest | undefined,
    sceneRequiredAssets: readonly AssetRef[] | undefined,
    budgetMs: number = CRITICAL_ASSET_PRELOAD_BUDGET_MS,
): CriticalAssetPreloadGate {
    const [settled, setSettled] = React.useState<SettledCriticalPreload | null>(null);
    // A VALUE-typed proxy for the ref list: a snapshot hands a fresh array on
    // every projection, so the list's identity re-arms the gate once per frame
    // while its contents re-arm it exactly when the scene's declaration changes.
    const requiredKey = (sceneRequiredAssets ?? []).join('\n');
    // The list itself reaches the effect through a ref, so it is `requiredKey`
    // alone that decides when to re-run — see above.
    const requiredAssetsRef = React.useRef(sceneRequiredAssets);
    requiredAssetsRef.current = sceneRequiredAssets;

    React.useEffect(() => {
        if (assetManager === null || assetManifest === undefined) {
            return;
        }

        const requiredAssets = requiredAssetsRef.current ?? [];
        // The FULL manifest, promoted — never a sub-manifest filtered to the
        // scene's refs: `registerManifest` evicts every ref absent from what it
        // is handed, so a filtered copy would wipe the match's whole cache. The
        // promoted copy is built from the SAME base object, so entry
        // equivalence (which ignores `priority`) keeps every cached ref.
        const manifest =
            requiredAssets.length === 0
                ? assetManifest
                : markRequiredAssetsCritical(assetManifest, requiredAssets);
        if (manifest !== assetManifest) {
            assetManager.registerManifest(manifest);
        }

        // Per-run, and set by the cleanup as well as by the winning path: the
        // cleanup must leave nothing able to `setState` on a surface that is
        // gone, and nothing able to warn about a budget nobody awaits.
        let done = false;
        // Distinct from `done`, and set by the CLEANUP ONLY. `done` is also set
        // by whichever settle path wins, and the promoted-ref report has to
        // survive `finish('failed')` — that is the very outcome it explains.
        // What it must not survive is a cleanup: disposing the manager rejects
        // every load still in flight, and that rejection is not a failure to
        // report. React runs the cleanup on every re-arm as well as on unmount,
        // so a run superseded mid-flight is dropped. What is measured is the
        // unmount half — see `reports no promoted failure once the surface
        // unmounted`.
        let abandoned = false;
        const finish = (outcome: SettledCriticalPreload['outcome']): void => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(budgetTimer);
            setSettled({ assetManager, assetManifest, requiredKey, outcome });
        };

        // Declared after `finish` only because `const` forbids otherwise;
        // `finish` reads it exclusively from asynchronous callers, so the
        // binding is always initialised by then.
        const budgetTimer = setTimeout(() => {
            // A ref that fails is left to `startCriticalAssetPreload`, which
            // runs the same manifest for the match — except for the promoted
            // set, which that arm never sees and the settle-all reports.
            emitRendererWarning(
                readRendererLogsApi(),
                '[assets] critical asset preload exceeded its budget; revealing anyway',
                { gameId: assetManifest.gameId, budgetMs },
                GATE_LOG_MODULE,
            );
            finish('timed-out');
        }, budgetMs);

        const criticalRun = new AssetPreloader(assetManager).preloadCritical(manifest);
        criticalRun.then(
            () => {
                finish('loaded');
            },
            () => {
                finish('failed');
            },
        );

        // A settle-all over the PROMOTED set, chained AFTER the run above.
        //
        // Why it is needed: `preloadCritical` stops at the first rejection and
        // its rejection value names no ref, so it can say that something failed
        // but never which. For a ref this run alone made critical that matters:
        // `startCriticalAssetPreload` runs the BASE manifest and never touches
        // it, so on a route entered with no transition running its failure
        // reached no log at all and the reveal failed open in silence. (The
        // scene-TRANSITION arm, `startScenePreload`, loads and reports the same
        // declaration under `scene-preload` — but only while a transition is
        // pending, which is the case this gate does not cover.)
        //
        // Why it is chained rather than started alongside: the run above drives
        // the load ORDER, and a concurrent `load` here would race ahead of it.
        // Chained, every ref that run reached is already cached or in flight, so
        // this costs no second fetch for them. Two cases do cost one: the ref
        // that rejected (a failed load is evicted from the in-flight map, so it
        // is attempted once more) and any promoted ref the run abandoned after
        // that rejection — which were never attempted at all, and are the reason
        // this is a settle-all rather than a second look at one error.
        const promoted = promotedCriticalRefs(assetManifest, requiredAssets);
        if (promoted.length > 0) {
            void criticalRun
                .catch(() => undefined)
                .then(async () =>
                    Promise.all(
                        promoted.map(async (ref) => {
                            try {
                                await assetManager.load(ref);
                                return null;
                            } catch (error: unknown) {
                                return { ref, error };
                            }
                        }),
                    ),
                )
                .then((results) => {
                    const failures = results.filter(
                        (result): result is { ref: AssetRef; error: unknown } => result !== null,
                    );
                    if (abandoned || failures.length === 0) {
                        return;
                    }

                    const first = failures[0]?.error;
                    emitRendererError(
                        readRendererLogsApi(),
                        '[assets] a scene-declared asset failed to preload; the scene is revealed without it',
                        first instanceof Error ? first : new Error(String(first)),
                        {
                            gameId: assetManifest.gameId,
                            refs: failures.map((failure) => String(failure.ref)),
                        },
                        GATE_LOG_MODULE,
                    );
                });
        }

        return () => {
            done = true;
            abandoned = true;
            clearTimeout(budgetTimer);
        };
    }, [assetManager, assetManifest, budgetMs, requiredKey]);

    if (assetManager === null || assetManifest === undefined) {
        return SKIPPED_GATE;
    }

    if (
        settled !== null &&
        settled.assetManager === assetManager &&
        settled.assetManifest === assetManifest &&
        settled.requiredKey === requiredKey
    ) {
        return { ready: true, outcome: settled.outcome };
    }

    return PENDING_GATE;
}
