// @vitest-environment jsdom
// renderer/assets/__tests__/scene-declared-ref-failure-arms.test.tsx
//
// What a LIVE match logs and fetches when a ref a scene declares fails to load.
// Three arms can load that ref, each reporting the refs IT loaded:
//
//   * `startCriticalAssetPreload` — the match-level run over the BASE manifest,
//     under `asset-preload`; it never sees `requiredAssets`, so it covers a
//     declared ref only where the base manifest already prices it `critical`;
//   * `startScenePreload` — the transition run over the ENTERING scene's
//     declaration, under `scene-preload`;
//   * `useCriticalAssetPreloadGate` — the route-entry gate over the COMMITTED
//     scene's declaration, under `asset-preload-gate`.
//
// Which of them cover a given ref, and what that costs, is what each case below
// measures — as NUMBERS rather than reasoned about, because the decision to
// accept the redundancy rather than introduce cross-arm state rests on how large
// it actually is. The rule in `asset-reference-system.md` states what these cases
// measure and points back here.
//
// A unit case for each arm lives beside that arm. What only a composition can
// show is the TOTAL, which is why this is an integration test.

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import {
    buildAssetRef,
    type AssetRef,
    type TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import { startScenePreload } from '../../components/scene/scenePreload.js';
import { createRecordingLogsApi } from '../../logging/__test-support__/RecordingLogsApi.js';
import { createAssetLoaderRegistry, type AssetLoadRequest } from '../AssetLoaderRegistry.js';
import { DefaultAssetManager, type AssetManager, type ResolvedAsset } from '../AssetManager.js';
import { startCriticalAssetPreload, useCriticalAssetPreloadGate } from '../criticalAssetPreload.js';

const BASE_CRITICAL_REF = buildAssetRef<TextureAsset>('demo', 'textures/bed.webp');
const DEFERRED_REF = buildAssetRef<TextureAsset>('demo', 'textures/decoration.webp');
/** Declared by the scene, absent from the manifest — the class the pair rule does not cover. */
const UNMANIFESTED_REF = buildAssetRef<TextureAsset>('demo', 'textures/absent.webp');

/** One base-critical entry and one deferred, so the two pairs below differ only in WHICH ref fails. */
function manifest(): AssetManifest {
    return {
        gameId: 'demo',
        entries: [
            { ref: BASE_CRITICAL_REF, kind: 'texture', priority: 'critical' },
            { ref: DEFERRED_REF, kind: 'texture', priority: 'deferred' },
        ],
    };
}

interface ManagerHarness {
    readonly assetManager: AssetManager;
    /** Every load ATTEMPT, in order — the count a rejected ref accumulates. */
    readonly loadedRefs: string[];
}

/**
 * A real `DefaultAssetManager` behind a recording loader whose `failingRef`
 * always rejects.
 *
 * Real, and not a spy on `load`: the manager's own cache and in-flight dedupe
 * are exactly what these cases measure, and a rejected load's eviction from
 * `inFlightLoads` is the mechanism the counts below are about.
 */
function createManager(failingRef: AssetRef): ManagerHarness {
    const loadedRefs: string[] = [];
    const load = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
        loadedRefs.push(String(request.ref));
        if (String(request.ref) === String(failingRef)) {
            throw new Error('texture 404');
        }
        return { id: request.url };
    });

    return {
        assetManager: new DefaultAssetManager(
            { resolve: (ref): string => `resolved://${ref}` },
            createAssetLoaderRegistry([{ kind: 'texture', load }]),
        ),
        loadedRefs,
    };
}

interface GateProbeProps {
    readonly assetManager: AssetManager;
    readonly assetManifest: AssetManifest;
    /** What `BaseGameSnapshot.sceneRequiredAssets` carries — the COMMITTED scene's. */
    readonly sceneRequiredAssets: readonly AssetRef[];
}

function GateProbe({
    assetManager,
    assetManifest,
    sceneRequiredAssets,
}: GateProbeProps): React.ReactElement {
    useCriticalAssetPreloadGate(assetManager, assetManifest, sceneRequiredAssets);
    return <div data-testid="gate" />;
}

/**
 * Drains every arm to completion.
 *
 * A macrotask boundary rather than a fixed number of microtask ticks: the gate
 * chains its promoted settle-all after a `preloadCritical` that awaits its
 * entries in SEQUENCE, so a tick count settles a different amount of work per
 * manifest. Neither arm's chain contains a timer at these budgets, so one
 * boundary is the whole run.
 */
async function drain(): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

/** How many times the loader was ASKED for `ref`, rejections included. */
function loadCount(loadedRefs: readonly string[], ref: AssetRef): number {
    return loadedRefs.filter((loaded) => loaded === String(ref)).length;
}

function installLogs(): ReturnType<typeof createRecordingLogsApi> {
    const logs = createRecordingLogsApi();
    (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
    return logs;
}

/** The modules that reported, in the order they reported. */
function reportedModules(logs: ReturnType<typeof createRecordingLogsApi>): string[] {
    return logs.emitCalls.map((call) => call.source.module);
}

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, '__chimera');
    vi.restoreAllMocks();
});

describe('a scene-declared ref that fails, across every arm that loads it', () => {
    it('a DEFERRED one is reported by the transition arm, then again by the gate at the commit', async () => {
        // The ordinary `/game` path, in the order a live match produces it: the
        // route is mounted on a scene declaring nothing, a transition runs the
        // ENTERING scene's declaration, and the commit writes that same
        // declaration onto the snapshot — which re-arms the gate over refs the
        // transition arm has already settled. `useFadeTransition` awaits
        // `run.settled` before dispatching `engine:scene_ready` and the commit
        // follows the barrier, so the run below is settled before the re-arm,
        // exactly as in production.
        const logs = installLogs();
        const { assetManager, loadedRefs } = createManager(DEFERRED_REF);
        const base = manifest();

        const view = render(
            <GateProbe assetManager={assetManager} assetManifest={base} sceneRequiredAssets={[]} />,
        );
        await drain();
        // The baseline both arms are measured against: nothing has touched the
        // scene's ref yet, so every count below belongs to the transition and
        // the commit.
        expect(loadedRefs).toEqual([String(BASE_CRITICAL_REF)]);
        expect(logs.emitCalls).toEqual([]);

        const run = startScenePreload({
            assetManager,
            assetManifest: base,
            requiredAssets: [DEFERRED_REF],
        });
        expect(await run.settled).toBe('failed');
        await drain();
        // One entry so far, and it is the transition arm's — which is what makes
        // the second entry below attributable to the commit alone.
        expect(reportedModules(logs)).toEqual(['scene-preload']);

        view.rerender(
            <GateProbe
                assetManager={assetManager}
                assetManifest={base}
                sceneRequiredAssets={[DEFERRED_REF]}
            />,
        );
        await drain();

        // TWO entries for ONE broken declaration. Neither is false — the
        // entering scene's preload did fail, and the committed scene's gate did
        // too — and the module is what tells them apart. The pair is accepted
        // rather than suppressed: the alternative needs cross-arm state, and it
        // would still leave the second pair below standing.
        expect(reportedModules(logs)).toEqual(['scene-preload', 'asset-preload-gate']);

        // THREE loads of the one failing ref, not two: the transition arm's, the
        // gate's `preloadCritical` over the promoted manifest, and the gate's
        // promoted settle-all chained after it. A failed load is never cached
        // and is evicted from `inFlightLoads`, so each attempt is a fresh fetch.
        expect(loadCount(loadedRefs, DEFERRED_REF)).toBe(3);
        // And the ref that LOADS is fetched once for the whole path, so the
        // redundancy is the failure's and not the composition's.
        expect(loadCount(loadedRefs, BASE_CRITICAL_REF)).toBe(1);
    });

    it('a BASE-CRITICAL one is reported by the match-level arm, then again by the transition arm', async () => {
        // The second pair, and the reason making the gate defer to the
        // transition arm closes nothing: a ref the base manifest ALREADY
        // calls critical is reported by `startCriticalAssetPreload` at mount and
        // again by the transition arm when a scene declares it too. Suppressing
        // the gate would leave this pair untouched, so no arrangement of two
        // arms makes "one bad ref yields one entry" true.
        const logs = installLogs();
        const { assetManager, loadedRefs } = createManager(BASE_CRITICAL_REF);
        const base = manifest();

        startCriticalAssetPreload(assetManager, base);
        await drain();
        expect(reportedModules(logs)).toEqual(['asset-preload']);

        const run = startScenePreload({
            assetManager,
            assetManifest: base,
            requiredAssets: [BASE_CRITICAL_REF],
        });
        expect(await run.settled).toBe('failed');
        await drain();

        expect(reportedModules(logs)).toEqual(['asset-preload', 'scene-preload']);
        expect(loadCount(loadedRefs, BASE_CRITICAL_REF)).toBe(2);
    });

    it('an UNMANIFESTED one is reported by the transition arm alone, and never fetched', async () => {
        // The third class, and the one the pair rule does NOT cover: a ref a
        // scene declares that the manifest does not carry at all. `load`
        // rejects it with `UnknownAssetManifestEntryError` before reaching a
        // loader, the promotion adds no entry so `preloadCritical` never sees
        // it, and `promotedCriticalRefs` excludes it — so one entry, no fetch.
        // `validate-assets` owns this case statically (Invariant #52); it is
        // measured here so the doc's "two entries" is stated over the domain it
        // actually holds on.
        const logs = installLogs();
        // The harness's `failingRef` never fires on this path — the manager
        // rejects before a loader is chosen, which is what the zero below says.
        const { assetManager, loadedRefs } = createManager(UNMANIFESTED_REF);
        const base = manifest();

        const view = render(
            <GateProbe assetManager={assetManager} assetManifest={base} sceneRequiredAssets={[]} />,
        );
        await drain();
        startCriticalAssetPreload(assetManager, base);
        await drain();
        const run = startScenePreload({
            assetManager,
            assetManifest: base,
            requiredAssets: [UNMANIFESTED_REF],
        });
        expect(await run.settled).toBe('failed');
        await drain();

        view.rerender(
            <GateProbe
                assetManager={assetManager}
                assetManifest={base}
                sceneRequiredAssets={[UNMANIFESTED_REF]}
            />,
        );
        await drain();

        expect(reportedModules(logs)).toEqual(['scene-preload']);
        expect(loadCount(loadedRefs, UNMANIFESTED_REF)).toBe(0);
    });

    it('the gate stays out of that second pair: the commit adds a load, never a third entry', async () => {
        // The gate's own split, measured HERE as a total rather than in
        // isolation. `promotedCriticalRefs` excludes a ref the base manifest
        // already calls critical — pinned by `leaves a base-critical failure to
        // the GameShell arm even when the scene declares it too` — so the commit
        // that re-arms the gate over such a ref runs it through
        // `preloadCritical` and reports nothing. The count is what the exclusion
        // does NOT buy, and it is stated rather than assumed.
        const logs = installLogs();
        const { assetManager, loadedRefs } = createManager(BASE_CRITICAL_REF);
        const base = manifest();

        const view = render(
            <GateProbe assetManager={assetManager} assetManifest={base} sceneRequiredAssets={[]} />,
        );
        await drain();
        startCriticalAssetPreload(assetManager, base);
        await drain();
        const run = startScenePreload({
            assetManager,
            assetManifest: base,
            requiredAssets: [BASE_CRITICAL_REF],
        });
        await run.settled;
        await drain();
        const loadsBeforeCommit = loadCount(loadedRefs, BASE_CRITICAL_REF);

        view.rerender(
            <GateProbe
                assetManager={assetManager}
                assetManifest={base}
                sceneRequiredAssets={[BASE_CRITICAL_REF]}
            />,
        );
        await drain();

        expect(reportedModules(logs)).toEqual(['asset-preload', 'scene-preload']);
        expect(loadCount(loadedRefs, BASE_CRITICAL_REF)).toBe(loadsBeforeCommit + 1);
    });
});
