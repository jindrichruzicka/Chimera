// @vitest-environment jsdom
// renderer/assets/criticalAssetPreload.test.tsx

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import {
    buildAssetRef,
    type AssetRef,
    type TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi.js';
import { createAssetLoaderRegistry, type AssetLoadRequest } from './AssetLoaderRegistry';
import { DefaultAssetManager, type AssetManager, type ResolvedAsset } from './AssetManager';
import type { AssetResolver } from './AssetResolver';
import { startCriticalAssetPreload, useCriticalAssetPreload } from './criticalAssetPreload.js';

const CRITICAL_REF = buildAssetRef<TextureAsset>('demo', 'textures/bed.webp');
const SECOND_CRITICAL_REF = buildAssetRef<TextureAsset>('demo', 'textures/backdrop.webp');
const DEFERRED_REF = buildAssetRef<TextureAsset>('demo', 'textures/decoration.webp');

function createResolver(): AssetResolver {
    return { resolve: (ref): string => `resolved://${ref}` };
}

function textureEntry(
    ref: AssetRef<TextureAsset>,
    priority: 'critical' | 'deferred',
): AssetManifest['entries'][number] {
    return { ref, kind: 'texture', priority };
}

function manifestWith(entries: AssetManifest['entries']): AssetManifest {
    return { gameId: 'demo', entries };
}

/** One critical entry and one deferred, so "loads only the critical" is falsifiable. */
function mixedManifest(): AssetManifest {
    return manifestWith([
        textureEntry(CRITICAL_REF, 'critical'),
        textureEntry(DEFERRED_REF, 'deferred'),
    ]);
}

interface RecordingManagerHarness {
    readonly assetManager: AssetManager;
    readonly loadedRefs: string[];
    readonly load: ReturnType<typeof vi.fn>;
}

/**
 * A REAL `DefaultAssetManager` behind a recording loader, rather than a
 * `preloadCritical` spy: the manager's own filter (`priority === 'critical'`)
 * and its in-flight/cached dedupe are precisely what the cases below assert,
 * and a spy on the method would assert only that the hook called something.
 */
function createRecordingManager(
    load: (request: AssetLoadRequest) => Promise<ResolvedAsset> = async (request) => ({
        id: request.url,
    }),
): RecordingManagerHarness {
    const loadedRefs: string[] = [];
    const recordingLoad = vi.fn(async (request: AssetLoadRequest): Promise<ResolvedAsset> => {
        loadedRefs.push(String(request.ref));
        return load(request);
    });

    return {
        assetManager: new DefaultAssetManager(
            createResolver(),
            createAssetLoaderRegistry([{ kind: 'texture', load: recordingLoad }]),
        ),
        loadedRefs,
        load: recordingLoad,
    };
}

interface ProbeProps {
    readonly assetManager: AssetManager | null;
    readonly assetManifest: AssetManifest | undefined;
}

function Probe({ assetManager, assetManifest }: ProbeProps): React.ReactElement {
    useCriticalAssetPreload(assetManager, assetManifest);
    return <div data-testid="probe" />;
}

/**
 * Drains the preload to completion.
 *
 * `preloadCritical` awaits its entries in SEQUENCE and each `load` threads the
 * result through `.then().finally()`, so a fixed number of `await
 * Promise.resolve()` ticks settles a different amount of work per manifest —
 * which silently under-counts a two-entry preload. A macrotask boundary drains
 * the whole microtask queue instead, and the chain contains no timer, so one
 * boundary is the whole run.
 */
async function settlePreload(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
    });
}

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, '__chimera');
    vi.restoreAllMocks();
});

describe('startCriticalAssetPreload', () => {
    it('preloads the critical entries and hands back a callback that abandons the report', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        let rejectLoad: ((error: Error) => void) | undefined;
        const { assetManager, loadedRefs } = createRecordingManager(
            () =>
                new Promise<ResolvedAsset>((_resolve, reject) => {
                    rejectLoad = reject;
                }),
        );

        const abandon = startCriticalAssetPreload(assetManager, mixedManifest());
        await settlePreload();
        expect(loadedRefs).toEqual([CRITICAL_REF]);

        // The dispose is what makes the in-flight load reject, and a teardown is
        // not a failure to report.
        abandon();
        rejectLoad?.(new Error('Asset load was superseded by dispose.'));
        await settlePreload();

        expect(logs.emitCalls).toEqual([]);
    });

    it('reports a failure that lands before the run is abandoned', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async () => {
            throw new Error('texture 404');
        });

        startCriticalAssetPreload(assetManager, mixedManifest());
        await settlePreload();

        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.source.module).toBe('asset-preload');
    });
});

describe('useCriticalAssetPreload', () => {
    it('preloads the manifest entries marked critical and leaves the deferred ones alone', async () => {
        const { assetManager, loadedRefs } = createRecordingManager();

        render(<Probe assetManager={assetManager} assetManifest={mixedManifest()} />);
        await settlePreload();

        expect(loadedRefs).toEqual([CRITICAL_REF]);
        expect(assetManager.get(CRITICAL_REF)).not.toBeNull();
        expect(assetManager.get(DEFERRED_REF)).toBeNull();
    });

    it('loads nothing for a manifest whose every entry is deferred', async () => {
        const { assetManager, loadedRefs } = createRecordingManager();

        render(
            <Probe
                assetManager={assetManager}
                assetManifest={manifestWith([textureEntry(DEFERRED_REF, 'deferred')])}
            />,
        );
        await settlePreload();

        expect(loadedRefs).toEqual([]);
    });

    it('is inert without a manager or without a manifest', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager, loadedRefs } = createRecordingManager();
        const preloadCritical = vi.spyOn(assetManager, 'preloadCritical');

        const view = render(<Probe assetManager={null} assetManifest={mixedManifest()} />);
        await settlePreload();
        view.rerender(<Probe assetManager={assetManager} assetManifest={undefined} />);
        await settlePreload();

        // Not merely "loaded nothing": a manager called with an absent manifest
        // would also load nothing — it would throw inside `preloadCritical` and
        // be reported as a failure. A blank is a no-op, not an error.
        expect(preloadCritical).not.toHaveBeenCalled();
        expect(loadedRefs).toEqual([]);
        expect(logs.emitCalls).toEqual([]);
    });

    it('starts the preload in a commit-phase effect, never during render', async () => {
        const { assetManager, loadedRefs } = createRecordingManager();
        const preloadCritical = vi.spyOn(assetManager, 'preloadCritical');
        const manifest = mixedManifest();
        const preloadsStartedDuringRender: number[] = [];

        // Measures the SPAN of the hook call itself rather than a count at some
        // moment: a count sampled once cannot tell a preload this render started
        // from one the previous COMMIT already finished. `preloadCritical`
        // reaches its first `load()` synchronously, so a render-phase
        // implementation moves this delta to 1 while a commit-phase one leaves
        // it at 0 on every render.
        function RenderPhaseProbe(): React.ReactElement {
            const before = preloadCritical.mock.calls.length;
            useCriticalAssetPreload(assetManager, manifest);
            preloadsStartedDuringRender.push(preloadCritical.mock.calls.length - before);
            return <div data-testid="probe" />;
        }

        const view = render(<RenderPhaseProbe />);
        await settlePreload();
        view.rerender(<RenderPhaseProbe />);
        await settlePreload();

        expect(preloadsStartedDuringRender).toEqual([0, 0]);
        expect(preloadCritical).toHaveBeenCalledTimes(1);
        expect(loadedRefs).toEqual([CRITICAL_REF]);
    });

    it("loads each critical ref exactly once across StrictMode's double mount", async () => {
        const { assetManager, loadedRefs } = createRecordingManager();
        const preloadCritical = vi.spyOn(assetManager, 'preloadCritical');
        const manifest = manifestWith([
            textureEntry(CRITICAL_REF, 'critical'),
            textureEntry(SECOND_CRITICAL_REF, 'critical'),
        ]);

        // <StrictMode> must be the element handed to render() — a wrapper that
        // renders it one level down produces a single mount.
        render(
            <React.StrictMode>
                <Probe assetManager={assetManager} assetManifest={manifest} />
            </React.StrictMode>,
        );
        await settlePreload();

        // Two preload runs, two loads: the effect IS double-invoked (asserting
        // that keeps the case from passing as a single mount wearing a
        // double-mount name), and the manager's in-flight/cached dedupe is what
        // makes the second run free.
        expect(preloadCritical).toHaveBeenCalledTimes(2);
        expect(loadedRefs).toEqual([CRITICAL_REF, SECOND_CRITICAL_REF]);
    });

    it('preloads the new manifest when the manifest identity changes', async () => {
        const { assetManager, loadedRefs } = createRecordingManager();

        const view = render(
            <Probe
                assetManager={assetManager}
                assetManifest={manifestWith([textureEntry(CRITICAL_REF, 'critical')])}
            />,
        );
        await settlePreload();
        view.rerender(
            <Probe
                assetManager={assetManager}
                assetManifest={manifestWith([
                    textureEntry(CRITICAL_REF, 'critical'),
                    textureEntry(SECOND_CRITICAL_REF, 'critical'),
                ])}
            />,
        );
        await settlePreload();

        expect(loadedRefs).toEqual([CRITICAL_REF, SECOND_CRITICAL_REF]);
    });

    it('reports a failed critical load through the renderer logger and keeps the tree mounted', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async () => {
            throw new Error('texture 404');
        });

        const view = render(<Probe assetManager={assetManager} assetManifest={mixedManifest()} />);
        await settlePreload();

        expect(view.getByTestId('probe')).toBeTruthy();
        expect(logs.emitCalls).toHaveLength(1);
        const entry = logs.emitCalls[0]!;
        expect(entry.level).toBe('error');
        expect(entry.source.module).toBe('asset-preload');
        expect(entry.source.module).not.toBe('global');
        expect(entry.error?.message).toContain('texture 404');
        expect(entry.error?.stack).toBeDefined();
    });

    it('reports nothing when the preload rejects after the surface unmounted', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        let rejectLoad: ((error: Error) => void) | undefined;
        const { assetManager } = createRecordingManager(
            () =>
                new Promise<ResolvedAsset>((_resolve, reject) => {
                    rejectLoad = reject;
                }),
        );

        const view = render(<Probe assetManager={assetManager} assetManifest={mixedManifest()} />);
        await settlePreload();
        view.unmount();
        // The shape a real teardown produces: GameShell disposes the manager it
        // owns (Invariant #21), and every load still in flight rejects.
        rejectLoad?.(new Error('Asset load was superseded by dispose.'));
        await settlePreload();

        expect(logs.emitCalls).toEqual([]);
    });
});
