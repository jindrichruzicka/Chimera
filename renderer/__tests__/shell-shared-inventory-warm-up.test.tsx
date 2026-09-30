// @vitest-environment jsdom
// renderer/__tests__/shell-shared-inventory-warm-up.test.tsx
//
// What a game pays for forwarding ONE shell inventory to both shell payload
// fields, measured as the loads each session makes rather than read off the
// code.
//
// Each field opens its own session over its own manager, and each session runs
// its own critical warm-up. What the two warm between them is what this file
// holds.
//
// Integration rather than unit: the duplicate is a property of the two sessions
// mounted together, which neither session's own tests can see.

import { act, cleanup, render, waitFor } from '@testing-library/react';
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
import { useAssetManager } from '../assets/AssetManagerContext.js';
import {
    SetGameAssetManagerContext,
    type GameAssetManagerBinding,
} from '../assets/SetGameAssetManagerContext';
import { AudioManagerContext } from '../audio/AudioManagerContext.js';
import { createAudioManagerSpy } from '../audio/__test-support__/AudioManagerStubs';
import { ShellAudioSession } from '../components/shell/ShellAudioSession';
import { ShellBackgroundHost } from '../components/shell/ShellBackgroundHost';
import type { LoadedRendererGameShell } from '../game/rendererGameRegistry';
import { _resetShellStateForTest, setShellRoute } from '../shell/shellStateStore';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

const BED_REF = 'demo/audio/music/menu-bed.wav' as AssetRef<AudioClipAsset>;
const MODEL_REF = 'demo/models/mirror-ball.glb' as AssetRef<GLTFModelAsset>;
const DEFERRED_REF = 'demo/models/backdrop.glb' as AssetRef<GLTFModelAsset>;

/** The one inventory both fields are handed: a critical clip, a critical model, a deferred model. */
const SHARED_INVENTORY: AssetManifest = {
    gameId: 'demo',
    entries: [
        { ref: BED_REF, kind: 'audio-clip', priority: 'critical' },
        { ref: MODEL_REF, kind: 'gltf-model', priority: 'critical' },
        { ref: DEFERRED_REF, kind: 'gltf-model', priority: 'deferred' },
    ],
};

/** The manager the background session published, read from inside its subtree. */
let backgroundManager: AssetManager | null;

function Background(): null {
    backgroundManager = useAssetManager();
    return null;
}

/** The manager the audio session registered as the app-level delegate. */
let audioSessionManager: AssetManager | null;

const binding: GameAssetManagerBinding = {
    set: (manager) => {
        audioSessionManager = manager;
    },
    release: () => undefined,
};

/** Every ref each manager was asked to load, keyed by the manager. */
let loadsByManager: Map<AssetManager, string[]>;

beforeEach(() => {
    _resetShellStateForTest();
    backgroundManager = null;
    audioSessionManager = null;
    loadsByManager = new Map();
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({
        shellBackground: Background,
        shellAudioAssets: SHARED_INVENTORY,
        shellBackgroundAssets: SHARED_INVENTORY,
    } satisfies LoadedRendererGameShell);

    // `load` replaced rather than delegated to: the real one reaches network
    // loaders jsdom cannot serve, and the ref ASKED for, on WHICH manager, is
    // what the case asserts.
    const createReal = assetManagerModule.createAssetManager;
    vi.spyOn(assetManagerModule, 'createAssetManager').mockImplementation((...args) => {
        const manager = createReal(...args);
        const loads: string[] = [];
        loadsByManager.set(manager, loads);
        manager.load = async (ref): Promise<never> => {
            loads.push(String(ref));
            return { id: String(ref) } as never;
        };
        return manager;
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function loadsBy(manager: AssetManager | null): string[] {
    if (manager === null) {
        throw new Error('expected the session to have built a manager');
    }
    const loads = loadsByManager.get(manager);
    if (loads === undefined) {
        throw new Error('expected a manager built through createAssetManager');
    }
    return loads;
}

/**
 * Drains both sessions' create-effects and the sequential warm-ups they start.
 * A macrotask boundary empties the microtask queue each `preloadCritical` chain
 * lives on.
 */
async function settleSessions(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
    });
}

describe('one shell inventory forwarded to both shell payload fields', () => {
    it('is warmed by both sessions, except the clip, which only the audio session warms', async () => {
        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'demo' });
        });

        render(
            <SetGameAssetManagerContext.Provider value={binding}>
                <AudioManagerContext.Provider value={createAudioManagerSpy()}>
                    <ShellAudioSession />
                    <ShellBackgroundHost />
                </AudioManagerContext.Provider>
            </SetGameAssetManagerContext.Provider>,
        );
        await waitFor(() => {
            expect(audioSessionManager).not.toBeNull();
            expect(backgroundManager).not.toBeNull();
        });
        await settleSessions();

        // Two sessions, two managers: sharing one would make a single owner of
        // both lifetimes, which Invariant #21 enumerates separately.
        expect(loadsByManager.size).toBe(2);
        expect(backgroundManager).not.toBe(audioSessionManager);

        // The audio session warms every critical entry. The background session
        // warms the model a second time and leaves the clip, which is §4.10's
        // rule (Where the critical preload runs).
        expect(loadsBy(audioSessionManager)).toEqual([BED_REF, MODEL_REF]);
        expect(loadsBy(backgroundManager)).toEqual([MODEL_REF]);
    });
});
