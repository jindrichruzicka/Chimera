// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, GLTFModelAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager } from '../assets/AssetManager';
import * as assetManagerModule from '../assets/AssetManager';
import { UnknownAssetManifestEntryError } from '../assets/AssetManager';
import { useAssetManager } from '../assets/AssetManagerContext.js';
import * as assetResolverModule from '../assets/AssetResolver';
import { SetGameAssetManagerContext } from '../assets/SetGameAssetManagerContext';
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
        // match-level manager. `SetGameAssetManagerContext` exists so the
        // app-level AudioManager can reach a MATCH's assets; a session outside
        // a match that registered here would silently redirect every engine
        // sound lookup at its own manifest.
        const setGameAssetManager = vi.fn();
        const capture = captureManager();

        render(
            <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
                <GameAssetSession assetManifest={manifestWith('demo')}>
                    <capture.Probe />
                </GameAssetSession>
            </SetGameAssetManagerContext.Provider>,
        );

        await waitFor(() => {
            expect(capture.current()).not.toBeNull();
        });
        expect(setGameAssetManager).not.toHaveBeenCalled();
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
