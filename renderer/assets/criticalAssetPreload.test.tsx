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
import {
    CRITICAL_ASSET_PRELOAD_BUDGET_MS,
    startCriticalAssetPreload,
    useCriticalAssetPreload,
    useCriticalAssetPreloadGate,
    type CriticalAssetPreloadGate,
} from './criticalAssetPreload.js';

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
    vi.useRealTimers();
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

// ── the route-entry gate ──────────────────────────────────────────────────────

interface ControlledManagerHarness extends RecordingManagerHarness {
    /** Settles the load the preload is currently awaiting for `ref`. */
    settle(ref: AssetRef, outcome: 'resolve' | 'reject'): void;
}

/**
 * A recording manager whose loads settle only when a case says so.
 *
 * `preloadCritical` awaits its entries in SEQUENCE, so the settler for the
 * second ref does not exist until the first has resolved — a case controlling
 * two refs settles the first, drains, then settles the second.
 */
function createControlledManager(): ControlledManagerHarness {
    const settlers = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    const harness = createRecordingManager(
        (request) =>
            new Promise<ResolvedAsset>((resolve, reject) => {
                settlers.set(String(request.ref), {
                    resolve: () => {
                        resolve({ id: request.url });
                    },
                    reject,
                });
            }),
    );

    return {
        ...harness,
        settle: (ref, outcome) => {
            const settler = settlers.get(String(ref));
            if (settler === undefined) {
                throw new Error(`No load in flight for ${String(ref)}`);
            }
            if (outcome === 'resolve') {
                settler.resolve();
            } else {
                settler.reject(new Error('texture 404'));
            }
        },
    };
}

interface GateProbeProps {
    readonly assetManager: AssetManager | null;
    readonly assetManifest: AssetManifest | undefined;
    readonly sceneRequiredAssets?: readonly AssetRef[] | undefined;
    readonly budgetMs?: number | undefined;
    /** Mounts the `GameShell` arm alongside the gate, as the real routes do. */
    readonly withShellArm?: boolean | undefined;
    readonly onGate: (gate: CriticalAssetPreloadGate) => void;
}

function GateProbe({
    assetManager,
    assetManifest,
    sceneRequiredAssets,
    budgetMs,
    withShellArm,
    onGate,
}: GateProbeProps): React.ReactElement {
    const gate = useCriticalAssetPreloadGate(
        assetManager,
        assetManifest,
        sceneRequiredAssets,
        budgetMs,
    );
    onGate(gate);
    return withShellArm === true ? (
        <Probe assetManager={assetManager} assetManifest={assetManifest} />
    ) : (
        <div data-testid="gate" />
    );
}

/** The gate value from the most recent render — what a route would read. */
function latest(gates: readonly CriticalAssetPreloadGate[]): CriticalAssetPreloadGate {
    const last = gates.at(-1);
    if (last === undefined) {
        throw new Error('The probe never rendered.');
    }
    return last;
}

describe('useCriticalAssetPreloadGate', () => {
    it('settles loaded once every critical entry resolves', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, loadedRefs } = createRecordingManager();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        expect(gates[0]).toEqual({ ready: false, outcome: 'pending' });
        await settlePreload();

        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
        expect(loadedRefs).toEqual([CRITICAL_REF]);
    });

    it('settles failed — and READY — when a critical entry rejects', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager } = createRecordingManager(async () => {
            throw new Error('texture 404');
        });

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();

        // The outcome, not merely `ready`: a rejection is the COMMON settle path
        // (a `.finally` here would re-throw into an unhandled rejection), and a
        // gate that reported it as 'loaded' would be indistinguishable on `ready`
        // alone while lying to every consumer that reads the outcome.
        expect(latest(gates)).toEqual({ ready: true, outcome: 'failed' });
    });

    it('settles timed-out when the budget elapses on a load that never resolves', async () => {
        vi.useFakeTimers();
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager } = createControlledManager();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                budgetMs={500}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(499);
        });
        expect(latest(gates)).toEqual({ ready: false, outcome: 'pending' });

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });

        expect(latest(gates)).toEqual({ ready: true, outcome: 'timed-out' });
    });

    it('times out on the exported budget when the caller names none', async () => {
        vi.useFakeTimers();
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager } = createControlledManager();

        // No `budgetMs` prop: the constant being the right number is a separate
        // claim from the parameter default being BOUND to it.
        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(CRITICAL_ASSET_PRELOAD_BUDGET_MS - 1);
        });
        expect(latest(gates).ready).toBe(false);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });

        expect(latest(gates)).toEqual({ ready: true, outcome: 'timed-out' });
    });

    it.each([
        ['a blank manager', null, mixedManifest()],
        ['an absent manifest', createRecordingManager().assetManager, undefined],
    ])('is ready on the FIRST render for %s', (_case, assetManager, assetManifest) => {
        const gates: CriticalAssetPreloadGate[] = [];

        // In RENDER, not in an effect: a manifest-less game would otherwise sit
        // behind a gate that no run will ever settle — a permanent black screen.
        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={assetManifest}
                onGate={(gate) => gates.push(gate)}
            />,
        );

        expect(gates[0]).toEqual({ ready: true, outcome: 'skipped' });
    });

    it('settles on the first microtask for a manifest with no critical entry', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, loadedRefs } = createRecordingManager();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifestWith([textureEntry(DEFERRED_REF, 'deferred')])}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        // Pending on the first render — 'skipped' is reserved for a blank pair,
        // and a manifest with nothing critical still runs (and settles) a preload.
        expect(gates[0]).toEqual({ ready: false, outcome: 'pending' });
        await act(async () => {
            await Promise.resolve();
        });

        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
        expect(loadedRefs).toEqual([]);
    });

    it('re-arms when the MANAGER identity changes under an identical manifest', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        // The exact production shape: `useRendererGameAssetManager` rebuilds on
        // `loadedGame` identity while `loadedGame.assetManifest` is a module-level
        // object from the dynamic import that can stay identical across a reload.
        const manifest = mixedManifest();
        const first = createRecordingManager();
        const second = createRecordingManager();

        const view = render(
            <GateProbe
                assetManager={first.assetManager}
                assetManifest={manifest}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();
        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });

        view.rerender(
            <GateProbe
                assetManager={second.assetManager}
                assetManifest={manifest}
                onGate={(gate) => gates.push(gate)}
            />,
        );

        // Keyed on the manifest ALONE this stays latched `ready: true` against a
        // manager holding no asset at all.
        expect(latest(gates)).toEqual({ ready: false, outcome: 'pending' });
        await settlePreload();
        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
        expect(second.loadedRefs).toEqual([CRITICAL_REF]);
        expect(second.assetManager.get(CRITICAL_REF)).not.toBeNull();
    });

    it('re-arms when the MANIFEST identity changes under a stable manager', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, loadedRefs } = createRecordingManager();

        const view = render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifestWith([textureEntry(CRITICAL_REF, 'critical')])}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();
        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });

        view.rerender(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifestWith([
                    textureEntry(CRITICAL_REF, 'critical'),
                    textureEntry(SECOND_CRITICAL_REF, 'critical'),
                ])}
                onGate={(gate) => gates.push(gate)}
            />,
        );

        // The other half of the pair: dropping the manifest from the settled
        // key leaves the gate open against a manifest whose new critical entry
        // has not been loaded.
        expect(latest(gates)).toEqual({ ready: false, outcome: 'pending' });
        await settlePreload();
        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
        expect(loadedRefs).toEqual([CRITICAL_REF, SECOND_CRITICAL_REF]);
    });

    it('re-arms when the scene’s declared refs CHANGE without changing in number', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, loadedRefs } = createRecordingManager();
        const registerManifest = vi.spyOn(assetManager, 'registerManifest');
        // One manifest object, held across both runs, exactly as a game's
        // module-level manifest is.
        const manifest = manifestWith([
            textureEntry(CRITICAL_REF, 'critical'),
            textureEntry(SECOND_CRITICAL_REF, 'deferred'),
            textureEntry(DEFERRED_REF, 'deferred'),
        ]);

        const view = render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifest}
                sceneRequiredAssets={[SECOND_CRITICAL_REF]}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();
        expect(loadedRefs).toEqual([CRITICAL_REF, SECOND_CRITICAL_REF]);
        const registrationsBefore = registerManifest.mock.calls.length;

        // What a scene COMMIT looks like from here: the manager, the manifest
        // object and the LENGTH of the list all stay put while its contents are
        // rewritten (`SceneManager` writes the entering descriptor's refs onto
        // every snapshot). A key derived from the list's length rather than its
        // contents does not re-run the effect at all.
        view.rerender(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifest}
                sceneRequiredAssets={[DEFERRED_REF]}
                onGate={(gate) => gates.push(gate)}
            />,
        );

        expect(latest(gates)).toEqual({ ready: false, outcome: 'pending' });
        await settlePreload();
        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
        expect(loadedRefs).toEqual([CRITICAL_REF, SECOND_CRITICAL_REF, DEFERRED_REF]);
        // The new scene's ref is the promoted one, and the previous scene's is
        // back to what the manifest declares.
        const promoted = registerManifest.mock.calls[registrationsBefore]?.[0];
        expect(promoted?.entries.map((entry) => [entry.ref, entry.priority])).toEqual([
            [CRITICAL_REF, 'critical'],
            [SECOND_CRITICAL_REF, 'deferred'],
            [DEFERRED_REF, 'critical'],
        ]);
    });

    it('converges under StrictMode as the ROOT element', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, loadedRefs } = createRecordingManager();

        render(
            <React.StrictMode>
                <GateProbe
                    assetManager={assetManager}
                    assetManifest={mixedManifest()}
                    onGate={(gate) => gates.push(gate)}
                />
            </React.StrictMode>,
        );
        await settlePreload();

        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
        expect(loadedRefs).toEqual([CRITICAL_REF]);
    });

    it('stops reporting once unmounted: no settle, and no budget warning', async () => {
        vi.useFakeTimers();
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, settle } = createControlledManager();

        const view = render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                budgetMs={500}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        const rendersBeforeUnmount = gates.length;
        view.unmount();

        // What the cleared timer buys: a torn-down surface never warns about a
        // budget nobody is waiting on any more. (The `done` flag's own
        // consequence is not visible HERE — React drops a state update aimed at
        // an unmounted component either way; the case below is where it shows.)
        settle(CRITICAL_REF, 'resolve');
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });

        expect(gates).toHaveLength(rendersBeforeUnmount);
        expect(logs.emitCalls).toEqual([]);
    });

    it('drops the settle of a run its cleanup abandoned', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const manifest = manifestWith([
            textureEntry(CRITICAL_REF, 'critical'),
            textureEntry(DEFERRED_REF, 'deferred'),
            textureEntry(SECOND_CRITICAL_REF, 'deferred'),
        ]);
        const { assetManager, settle } = createControlledManager();
        const probe = (sceneRequiredAssets: readonly AssetRef[]): React.ReactElement => (
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifest}
                sceneRequiredAssets={sceneRequiredAssets}
                onGate={(gate) => gates.push(gate)}
            />
        );

        const view = render(probe([DEFERRED_REF]));
        await settlePreload();

        // The first run is left mid-flight and abandoned by a scene commit. Its
        // promoted list ends at DEFERRED_REF; the second run's at
        // SECOND_CRITICAL_REF — so the two runs finish on refs of their own and
        // the first one's settle can be delivered on its own.
        view.rerender(probe([SECOND_CRITICAL_REF]));
        await settlePreload();
        settle(CRITICAL_REF, 'resolve');
        await settlePreload();

        const rendersBeforeStaleSettle = gates.length;
        await act(async () => {
            settle(DEFERRED_REF, 'resolve');
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        // The abandoned run has now resolved. Without the cleanup's `done` flag
        // it calls `setState` here: the gate still reads pending (the settled
        // entry is keyed on the run's own ref list), but the route re-renders
        // for a run nobody is waiting on.
        expect(gates).toHaveLength(rendersBeforeStaleSettle);
        expect(latest(gates)).toEqual({ ready: false, outcome: 'pending' });

        settle(SECOND_CRITICAL_REF, 'resolve');
        await settlePreload();

        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
    });

    it('promotes the scene’s declared refs, so a deferred one gates the reveal', async () => {
        const gates: CriticalAssetPreloadGate[] = [];
        const { assetManager, loadedRefs, settle } = createControlledManager();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                sceneRequiredAssets={[DEFERRED_REF]}
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();
        settle(CRITICAL_REF, 'resolve');
        await settlePreload();

        // Ignoring the parameter settles the gate HERE, with the scene's own ref
        // still unloaded — the pop-in this gate exists to remove.
        expect(latest(gates)).toEqual({ ready: false, outcome: 'pending' });
        expect(loadedRefs).toEqual([CRITICAL_REF, DEFERRED_REF]);

        settle(DEFERRED_REF, 'resolve');
        await settlePreload();

        expect(latest(gates)).toEqual({ ready: true, outcome: 'loaded' });
    });

    it('registers the promoted manifest built from the SAME base object', async () => {
        const { assetManager } = createRecordingManager();
        const registerManifest = vi.spyOn(assetManager, 'registerManifest');
        const manifest = mixedManifest();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifest}
                sceneRequiredAssets={[DEFERRED_REF]}
                onGate={() => undefined}
            />,
        );
        await settlePreload();

        const promoted = registerManifest.mock.calls[0]?.[0];
        expect(promoted).not.toBe(manifest);
        expect(promoted?.gameId).toBe(manifest.gameId);
        // Promoted, not filtered: `registerManifest` evicts every ref absent from
        // the manifest it is handed, so a scene-sized sub-manifest would wipe the
        // match's cache. And the untouched entry is the BASE object by identity,
        // which is what keeps entry equivalence — and the cache — intact.
        expect(promoted?.entries.map((entry) => [entry.ref, entry.priority])).toEqual([
            [CRITICAL_REF, 'critical'],
            [DEFERRED_REF, 'critical'],
        ]);
        expect(promoted?.entries[0]).toBe(manifest.entries[0]);
    });

    it.each([
        ['an empty list', []],
        ['an absent list', undefined],
    ] as const)('registers no promoted manifest for %s', async (_case, sceneRequiredAssets) => {
        const { assetManager } = createRecordingManager();
        const registerManifest = vi.spyOn(assetManager, 'registerManifest');
        const manifest = mixedManifest();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifest}
                sceneRequiredAssets={sceneRequiredAssets}
                onGate={() => undefined}
            />,
        );
        await settlePreload();

        // `preloadCritical` registers what it is handed, so "no promotion" is
        // not "no call" — it is that every call carries the base object itself.
        expect(registerManifest.mock.calls.length).toBeGreaterThan(0);
        expect(registerManifest.mock.calls.every((call) => call[0] === manifest)).toBe(true);
    });

    it('leaves the failure report to the GameShell arm — one report, not two', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async () => {
            throw new Error('texture 404');
        });
        const gates: CriticalAssetPreloadGate[] = [];

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                withShellArm
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();

        expect(latest(gates).outcome).toBe('failed');
        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.level).toBe('error');
        expect(logs.emitCalls[0]?.source.module).toBe('asset-preload');
    });

    it('reports a promoted ref that fails, which the match-level run never loads', async () => {
        // The gap this closes. A ref that is `deferred` in the manifest and
        // critical ONLY because this gate promoted it from
        // `sceneRequiredAssets` is not loaded by the GameShell arm, which runs
        // the BASE manifest, and the gate reported nothing on `'failed'` by
        // design. On a route entered with no transition running — a restore, a
        // replay — the reveal then failed open in silence: a scene missing an
        // asset the scene itself declared, with no trace in the logs.
        //
        // Only the DEFERRED ref fails here. The base-critical one loads, so the
        // GameShell arm's run resolves and reports nothing — which is what
        // makes the single entry below attributable to the gate alone.
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async (request) => {
            if (String(request.ref) === String(DEFERRED_REF)) {
                throw new Error('promoted texture 404');
            }
            return { id: request.url };
        });
        const gates: CriticalAssetPreloadGate[] = [];

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                sceneRequiredAssets={[DEFERRED_REF]}
                withShellArm
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();

        // Fail-open is unchanged: the route still reveals.
        expect(latest(gates).ready).toBe(true);
        expect(latest(gates).outcome).toBe('failed');

        expect(logs.emitCalls).toHaveLength(1);
        const entry = logs.emitCalls[0];
        expect(entry?.level).toBe('error');
        expect(entry?.source.module).toBe('asset-preload-gate');
        // The ref itself, not merely a count: `preloadCritical` rejects with the
        // first error and names nothing, so a report that omitted the ref would
        // leave a reader no better off than the silence it replaced.
        expect(entry?.context?.['refs']).toEqual([String(DEFERRED_REF)]);
        // And the CAUSE, the same way the shell arm's case pins it: an entry
        // naming the ref but carrying a manufactured error would say what broke
        // and never why.
        expect(entry?.error?.message).toContain('promoted texture 404');
    });

    it('leaves a base-critical failure to the GameShell arm even when the scene declares it too', async () => {
        // The other side of the split, and the case that pins WHICH refs the
        // gate owns. The scene declares BOTH refs, so a gate that reported
        // every declared ref rather than only the ones its promotion made
        // critical would report the base-critical failure as well — one bad ref
        // becoming two entries, which is what the split exists to prevent.
        //
        // The base-critical ref is the one that fails, so the shell arm's run
        // over the BASE manifest rejects and reports. The promoted ref loads.
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async (request) => {
            if (String(request.ref) === String(CRITICAL_REF)) {
                throw new Error('base texture 404');
            }
            return { id: request.url };
        });

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                sceneRequiredAssets={[CRITICAL_REF, DEFERRED_REF]}
                withShellArm
                onGate={() => undefined}
            />,
        );
        await settlePreload();

        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.source.module).toBe('asset-preload');
    });

    it('does not let the promoted-ref settle-all overtake the run’s load order', async () => {
        // TWO base-critical entries before the promoted one, which is what makes
        // this falsifiable: with only one, a settle-all started alongside the run
        // produces the same recorded sequence as one chained after it, because
        // there is no second base ref left for the promoted load to jump. Here a
        // concurrent settle-all yields [bed, decoration, backdrop] — the scene's
        // own ref served before a ref the manifest itself calls critical.
        const { assetManager, loadedRefs, settle } = createControlledManager();
        const manifest = manifestWith([
            textureEntry(CRITICAL_REF, 'critical'),
            textureEntry(SECOND_CRITICAL_REF, 'critical'),
            textureEntry(DEFERRED_REF, 'deferred'),
        ]);

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={manifest}
                sceneRequiredAssets={[DEFERRED_REF]}
                onGate={() => undefined}
            />,
        );
        await settlePreload();
        settle(CRITICAL_REF, 'resolve');
        await settlePreload();
        settle(SECOND_CRITICAL_REF, 'resolve');
        await settlePreload();

        expect(loadedRefs).toEqual([CRITICAL_REF, SECOND_CRITICAL_REF, DEFERRED_REF]);
    });

    it('reports a repeated declared ref once, not once per declaration', async () => {
        // `sceneRequiredAssets` is a scene's declaration copied verbatim, and a
        // descriptor may name the same ref twice — the sibling
        // `sceneRequiredAssets` carriage test in the simulation uses exactly
        // that shape. Without the de-duplication the same failure would be
        // loaded and named twice in one entry.
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async (request) => {
            if (String(request.ref) === String(DEFERRED_REF)) {
                throw new Error('promoted texture 404');
            }
            return { id: request.url };
        });

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                sceneRequiredAssets={[DEFERRED_REF, DEFERRED_REF]}
                onGate={() => undefined}
            />,
        );
        await settlePreload();

        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.context?.['refs']).toEqual([String(DEFERRED_REF)]);
    });

    it('reports no promoted failure once the surface unmounted', async () => {
        // Disposing the manager rejects every load still in flight with
        // 'Asset load was superseded by dispose.', so without the cleanup's
        // abandon flag an ordinary teardown would report a failure that is only
        // a teardown. The flag is separate from the settle flag because the
        // report has to survive `finish('failed')` — that is the outcome it
        // explains — while not surviving an unmount.
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager(async (request) => {
            if (String(request.ref) === String(DEFERRED_REF)) {
                throw new Error('promoted texture 404');
            }
            return { id: request.url };
        });

        const view = render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                sceneRequiredAssets={[DEFERRED_REF]}
                onGate={() => undefined}
            />,
        );
        view.unmount();
        await settlePreload();

        expect(logs.emitCalls).toHaveLength(0);
    });

    it('warns exactly once on the budget, and never on a load that settles', async () => {
        vi.useFakeTimers();
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createControlledManager();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                budgetMs={500}
                onGate={() => undefined}
            />,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(499);
        });
        expect(logs.emitCalls).toEqual([]);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(2000);
        });

        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.level).toBe('warn');
        expect(logs.emitCalls[0]?.source.module).toBe('asset-preload-gate');
        expect(logs.emitCalls[0]?.source.module).not.toBe('global');
    });

    it('warns nothing when the run settles inside the budget', async () => {
        vi.useFakeTimers();
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { assetManager } = createRecordingManager();

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                budgetMs={500}
                onGate={() => undefined}
            />,
        );
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });

        expect(logs.emitCalls).toEqual([]);
    });

    it('costs the second arm nothing: one load per ref, and nothing evicted', async () => {
        const { assetManager, loadedRefs } = createRecordingManager();
        const gates: CriticalAssetPreloadGate[] = [];

        render(
            <GateProbe
                assetManager={assetManager}
                assetManifest={mixedManifest()}
                sceneRequiredAssets={[DEFERRED_REF]}
                withShellArm
                onGate={(gate) => gates.push(gate)}
            />,
        );
        await settlePreload();

        expect(latest(gates).outcome).toBe('loaded');
        expect(loadedRefs).toEqual([CRITICAL_REF, DEFERRED_REF]);
        expect(assetManager.get(CRITICAL_REF)).not.toBeNull();
        expect(assetManager.get(DEFERRED_REF)).not.toBeNull();
    });
});
