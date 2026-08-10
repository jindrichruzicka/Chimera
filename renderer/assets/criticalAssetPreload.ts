'use client';

// renderer/assets/criticalAssetPreload.ts
//
// Runs the §4.10 critical preload for a surface that owns a game-asset
// `AssetManager`. It is what gives `AssetManifestEntry.priority: 'critical'` a
// runtime meaning: without a caller, the priority is a field every game may
// author and no code reads, and a clip marked critical still decodes on first
// play — which is a fade scheduled against a buffer that is not there yet.
//
// Which surfaces call it follows from Invariant #21: a surface may preload only
// into a manager whose lifetime it owns.
//
// Two entry points, split by how the caller holds that manager:
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
//     the failing one are not preloaded either.)
//
// Architecture reference: §4.10 Asset Reference System.

import React from 'react';

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import { emitRendererError, readRendererLogsApi } from '../logging/rendererLogger.js';
import type { AssetManager } from './AssetManager';
import { AssetPreloader } from './AssetPreloader.js';

/** Log module name, so the report is attributable rather than 'global'. */
const LOG_MODULE = 'asset-preload';

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
