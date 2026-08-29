// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type {
    AssetRef,
    AudioClipAsset,
    GLTFModelAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager } from '../assets/AssetManager';
import * as assetManagerModule from '../assets/AssetManager';
import { UnknownAssetManifestEntryError } from '../assets/AssetManager';
import { useAssetManager } from '../assets/AssetManagerContext.js';
import * as assetResolverModule from '../assets/AssetResolver';
import { SetGameAssetManagerContext } from '../assets/SetGameAssetManagerContext';
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi.js';
import { GameAssetSession, useRendererGameAssetManager } from './gameAssetSession.js';

const DECLARED_REF = 'demo/models/rig.glb' as AssetRef<GLTFModelAsset>;
const UNDECLARED_REF = 'demo/models/absent.glb' as AssetRef<GLTFModelAsset>;
const DECLARED_METADATA = { probe: 'declared-entry-metadata' } as const;

function manifestWith(gameId: string): AssetManifest {
    return {
        gameId,
        entries: [
            {
                ref: DECLARED_REF,
                kind: 'gltf-model',
                priority: 'deferred',
                metadata: DECLARED_METADATA,
            },
        ],
    };
}

const CRITICAL_REF = 'demo/audio/music/bed.wav' as AssetRef<AudioClipAsset>;

/** One critical entry alongside the deferred one, so the priority filter is falsifiable. */
function manifestWithCriticalEntry(gameId: string): AssetManifest {
    const base = manifestWith(gameId);
    return {
        gameId: base.gameId,
        entries: [{ ref: CRITICAL_REF, kind: 'audio-clip', priority: 'critical' }, ...base.entries],
    };
}

/** The slice of a `LoadedRendererGame` the hook reads. */
function gameWith(gameId: string): { readonly assetManifest: AssetManifest } {
    return { assetManifest: manifestWith(gameId) };
}

/**
 * Narrows the hook's `AssetManager | null` for a case that has already
 * established a manager is expected. Failing loudly here beats optional
 * chaining, which would quietly turn a null manager into a confusing
 * assertion failure two lines later.
 */
function expectManager(value: AssetManager | null): AssetManager {
    if (value === null) throw new Error('expected the hook to return an AssetManager');
    return value;
}

beforeEach(() => {
    vi.restoreAllMocks();
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(globalThis, '__chimera');
});

describe('useRendererGameAssetManager', () => {
    it('returns null for a null game, so a page can render before its game loads', () => {
        const { result } = renderHook(() => useRendererGameAssetManager(null));

        expect(result.current).toBeNull();
    });

    it('registers the manifest at construction, so a declared ref is known immediately', () => {
        const { result } = renderHook(() => useRendererGameAssetManager(gameWith('demo')));

        expect(expectManager(result.current).getManifestMetadata(DECLARED_REF)).toEqual(
            DECLARED_METADATA,
        );
    });

    it('still builds a manager for a loaded game that declares NO manifest', async () => {
        // `LoadedRendererGame.assetManifest` is optional. "Game with no
        // manifest" is not "no game": collapsing the two to null leaves the
        // route with no manager at all, and /game and /replays/player both
        // render nothing without one.
        const { result } = renderHook(() => useRendererGameAssetManager({}));

        expect(result.current).not.toBeNull();
        await expect(expectManager(result.current).load(DECLARED_REF)).rejects.toBeInstanceOf(
            UnknownAssetManifestEntryError,
        );
    });

    it('rejects an undeclared ref rather than resolving it', async () => {
        const { result } = renderHook(() => useRendererGameAssetManager(gameWith('demo')));

        await expect(expectManager(result.current).load(UNDECLARED_REF)).rejects.toBeInstanceOf(
            UnknownAssetManifestEntryError,
        );
    });

    it('resolves loads through the game-asset resolver, not the renderer-asset one', async () => {
        const resolve = vi.fn((ref: AssetRef) => `probe://game-assets/${String(ref)}`);
        const gameResolver = vi
            .spyOn(assetResolverModule, 'createRendererGameAssetResolver')
            .mockReturnValue({ resolve });
        const rendererResolver = vi.spyOn(
            assetResolverModule,
            'createRendererProtocolAssetResolver',
        );

        const { result } = renderHook(() => useRendererGameAssetManager(gameWith('demo')));
        // The load reaches a real GLTF loader and fails there (no network in
        // jsdom); the resolver call is what this asserts, so the rejection is
        // swallowed deliberately.
        await expectManager(result.current)
            .load(DECLARED_REF)
            .catch(() => undefined);

        expect(gameResolver).toHaveBeenCalled();
        expect(rendererResolver).not.toHaveBeenCalled();
        expect(resolve).toHaveBeenCalledWith(DECLARED_REF);
    });

    it('keeps one manager across re-renders with the same game identity', () => {
        const game = gameWith('demo');
        const { result, rerender } = renderHook(() => useRendererGameAssetManager(game));
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });

    it('rebuilds when the loaded game identity changes', () => {
        let game = gameWith('demo');
        const { result, rerender } = renderHook(() => useRendererGameAssetManager(game));
        const first = result.current;

        game = gameWith('other');
        rerender();

        expect(result.current).not.toBe(first);
    });

    it('never disposes the manager it built — the injectee owns that', () => {
        const game = gameWith('demo');
        const { result, unmount } = renderHook(() => useRendererGameAssetManager(game));
        const manager = result.current;
        if (manager === null) throw new Error('expected a manager');
        const dispose = vi.spyOn(manager, 'dispose');

        unmount();

        expect(dispose).not.toHaveBeenCalled();
    });
});

describe('GameAssetSession', () => {
    it('publishes a manifest-registered manager to useAssetManager() consumers', async () => {
        const capture = captureManager();

        render(
            <GameAssetSession assetManifest={manifestWith('demo')}>
                <capture.Probe />
            </GameAssetSession>,
        );

        await waitFor(() => {
            expect(capture.current()).not.toBeNull();
        });
        expect(capture.manager().getManifestMetadata(DECLARED_REF)).toEqual(DECLARED_METADATA);
    });

    it('disposes every manager it allocates under StrictMode, orphaning none', async () => {
        // The manager must be allocated in a commit-phase effect, never in
        // render: StrictMode double-invokes render-phase factories and DISCARDS
        // one result, and a discarded render runs no cleanup — that orphan is
        // unreachable by any dispose path (cf. useModelInstance). Counting
        // allocations against disposals is what catches the orphan; a
        // render-phase allocation leaves the two counts unequal.
        const allocated: AssetManager[] = [];
        const disposed: AssetManager[] = [];
        const createAssetManager = assetManagerModule.createAssetManager;
        vi.spyOn(assetManagerModule, 'createAssetManager').mockImplementation((...args) => {
            const manager = createAssetManager(...args);
            const dispose = manager.dispose.bind(manager);
            manager.dispose = (): void => {
                disposed.push(manager);
                dispose();
            };
            allocated.push(manager);
            return manager;
        });

        const { unmount } = render(
            <React.StrictMode>
                <GameAssetSession assetManifest={manifestWith('demo')}>
                    <span data-testid="child" />
                </GameAssetSession>
            </React.StrictMode>,
        );
        await waitFor(() => {
            expect(allocated.length).toBeGreaterThan(1);
        });

        unmount();

        expect(new Set(disposed)).toEqual(new Set(allocated));
    });

    it('never registers itself as the app-level AudioManager delegate', async () => {
        // Invariant #21: this session is not a competing owner of the
        // match-level manager. `SetGameAssetManagerContext` binds what the
        // app-level `AudioManager` resolves a clip against, and a subtree
        // publication is not that: a session that registered here would
        // redirect every engine sound lookup at its own manifest, whichever
        // registrant — a match or the shell audio session — was bound.
        const binding = { set: vi.fn(), release: vi.fn() };
        const capture = captureManager();

        render(
            <SetGameAssetManagerContext.Provider value={binding}>
                <GameAssetSession assetManifest={manifestWith('demo')}>
                    <capture.Probe />
                </GameAssetSession>
            </SetGameAssetManagerContext.Provider>,
        );

        await waitFor(() => {
            expect(capture.current()).not.toBeNull();
        });
        expect(binding.set).not.toHaveBeenCalled();
        expect(binding.release).not.toHaveBeenCalled();
    });

    it('renders its children once the manager is committed', async () => {
        const { container } = render(
            <GameAssetSession assetManifest={manifestWith('demo')}>
                <span data-testid="child" />
            </GameAssetSession>,
        );

        await waitFor(() => {
            expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
        });
    });

    it('disposes the manager it owns on unmount', async () => {
        const capture = captureManager();
        const { unmount } = render(
            <GameAssetSession assetManifest={manifestWith('demo')}>
                <capture.Probe />
            </GameAssetSession>,
        );
        await waitFor(() => {
            expect(capture.current()).not.toBeNull();
        });
        const dispose = vi.spyOn(capture.manager(), 'dispose');

        unmount();

        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('preloads its own manifest’s critical entries and leaves the deferred ones on demand', async () => {
        // A route outside a match owns its manager end to end, so nothing else
        // would ever act on `priority: 'critical'` here.
        const { loadedRefs } = instrumentAssetManagers();

        render(
            <GameAssetSession assetManifest={manifestWithCriticalEntry('demo')}>
                <span data-testid="child" />
            </GameAssetSession>,
        );
        // Drained to completion, not merely awaited: `preloadCritical` reaches
        // its first `load()` synchronously, so a `waitFor` that samples once
        // sees the critical ref whether or not the priority filter ran — the
        // deferred load it must NOT make would land a microtask later.
        await settleSession();

        expect(loadedRefs).toEqual([CRITICAL_REF]);
    });

    it('never loads into a manager it has already disposed when the manifest identity changes', async () => {
        // The manager lives in state, so a naive preload effect reads the
        // PREVIOUS manager on the render that changes the manifest — after this
        // component's own cleanup has disposed it. Anything cached into a
        // disposed manager is unreachable by every dispose path there is: this
        // surface's cleanup has already run for it (Invariant #21).
        const { events, loadsIntoDisposedManagers } = instrumentAssetManagers();

        const { rerender } = render(
            <GameAssetSession assetManifest={manifestWithCriticalEntry('demo')}>
                <span data-testid="child" />
            </GameAssetSession>,
        );
        await settleSession();
        rerender(
            <GameAssetSession assetManifest={manifestWithCriticalEntry('other')}>
                <span data-testid="child" />
            </GameAssetSession>,
        );
        await settleSession();

        expect(loadsIntoDisposedManagers()).toEqual([]);
        // Non-vacuous: the second manifest must actually have been preloaded,
        // so an implementation that simply stopped preloading cannot pass.
        expect(events.filter((event) => event.endsWith(`load:${CRITICAL_REF}`))).toHaveLength(2);
    });

    it('reports nothing when its own teardown fails a preload still in flight', async () => {
        // Tearing this session down disposes the manager it owns, and every
        // load still in flight rejects with that. A teardown is not a failure,
        // so the session must abandon its preload's REPORT in the same cleanup;
        // without that, an ordinary unmount mid-bed logs an `asset-preload`
        // error.
        //
        // TWO sessions failed by one stimulus, differing in one thing — only
        // the first tears down. The second is the control leg, and it is what
        // makes the silence mean something: an assertion that nothing was
        // logged is satisfied just as well by a rejection that never arrived,
        // so the control fails this case if the held loads ever stop reaching
        // the report at all.
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
        const { loadedRefs, failHeldLoads } = instrumentAssetManagers({ holdLoads: true });

        const tornDown = render(
            <GameAssetSession assetManifest={manifestWithCriticalEntry('torn-down')}>
                <span data-testid="child" />
            </GameAssetSession>,
        );
        render(
            <GameAssetSession assetManifest={manifestWithCriticalEntry('still-mounted')}>
                <span data-testid="child" />
            </GameAssetSession>,
        );
        await settleSession();
        expect(loadedRefs).toEqual([CRITICAL_REF, CRITICAL_REF]);

        tornDown.unmount();
        failHeldLoads(new Error('Asset load was superseded by dispose.'));
        await settleSession();

        expect(logs.emitCalls.map((entry) => entry.context?.['gameId'])).toEqual(['still-mounted']);
    });

    it('disposes the previous manager when the manifest identity changes', async () => {
        const capture = captureManager();
        const { rerender } = render(
            <GameAssetSession assetManifest={manifestWith('demo')}>
                <capture.Probe />
            </GameAssetSession>,
        );
        await waitFor(() => {
            expect(capture.current()).not.toBeNull();
        });
        const first = capture.manager();
        const dispose = vi.spyOn(first, 'dispose');

        rerender(
            <GameAssetSession assetManifest={manifestWith('other')}>
                <capture.Probe />
            </GameAssetSession>,
        );

        await waitFor(() => {
            expect(dispose).toHaveBeenCalledTimes(1);
        });
        expect(capture.manager()).not.toBe(first);
    });
});

/**
 * Drains a session's create-effect, its state commit, and the preload it
 * starts. A macrotask boundary empties the microtask queue the sequential
 * `preloadCritical` chain lives on; `act` keeps the React work inside it.
 */
async function settleSession(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
    });
}

/**
 * Records every manager the session builds, and every `load`/`dispose` on it,
 * in one ordered log.
 *
 * `load` is replaced rather than delegated to: the real one reaches a network
 * loader jsdom cannot serve, and the ref that was ASKED for — on WHICH manager,
 * and whether that manager was already disposed — is what the cases assert.
 */
function instrumentAssetManagers(options: { readonly holdLoads?: boolean } = {}): {
    readonly events: string[];
    readonly loadedRefs: string[];
    readonly loadsIntoDisposedManagers: () => string[];
    readonly failHeldLoads: (error: Error) => void;
} {
    const events: string[] = [];
    const loadedRefs: string[] = [];
    const heldLoads: ((error: Error) => void)[] = [];
    const createReal = assetManagerModule.createAssetManager;
    let built = 0;

    vi.spyOn(assetManagerModule, 'createAssetManager').mockImplementation((...args) => {
        const manager = createReal(...args);
        const name = `manager-${built++}`;
        const disposeReal = manager.dispose.bind(manager);
        manager.dispose = (): void => {
            events.push(`${name}:dispose`);
            disposeReal();
        };
        manager.load = async (ref): Promise<never> => {
            events.push(`${name}:load:${String(ref)}`);
            loadedRefs.push(String(ref));
            if (options.holdLoads === true) {
                // Never settles on its own — the load stays IN FLIGHT, which is
                // the only state in which a teardown can produce a rejection.
                return new Promise<never>((_resolve, reject) => {
                    heldLoads.push(reject);
                });
            }
            return { id: String(ref) } as never;
        };
        return manager;
    });

    return {
        events,
        loadedRefs,
        loadsIntoDisposedManagers: (): string[] => {
            const disposed = new Set<string>();
            const offenders: string[] = [];
            for (const event of events) {
                const [name, verb] = event.split(':');
                if (verb === 'dispose') {
                    disposed.add(String(name));
                } else if (disposed.has(String(name))) {
                    offenders.push(event);
                }
            }
            return offenders;
        },
        failHeldLoads: (error: Error): void => {
            for (const reject of heldLoads.splice(0)) {
                reject(error);
            }
        },
    };
}

/** Reads the published manager out of the session subtree. */
function captureManager(): {
    readonly Probe: () => null;
    readonly current: () => AssetManager | null;
    readonly manager: () => AssetManager;
} {
    let captured: AssetManager | null = null;

    function Probe(): null {
        captured = useAssetManager();
        return null;
    }

    return {
        Probe,
        current: () => captured,
        manager: () => {
            if (captured === null) throw new Error('expected a published AssetManager');
            return captured;
        },
    };
}
