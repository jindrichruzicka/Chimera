// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    gamePhase,
    playerId,
    type LobbyState,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager } from '../../assets/AssetManager';
import { I18nProvider } from '../../i18n/I18nProvider';
import GamePage from './page';

const audioRefs = vi.hoisted(() => ({
    step: 'tactics/audio/sfx/step.wav' as AssetRef<AudioClipAsset>,
    hit: 'tactics/audio/sfx/sword-hit.wav' as AssetRef<AudioClipAsset>,
    reveal: 'tactics/audio/sfx/reveal.wav' as AssetRef<AudioClipAsset>,
}));

const testTacticsManifest = vi.hoisted<AssetManifest>(() => ({
    gameId: 'tactics',
    entries: [
        { ref: audioRefs.step, kind: 'audio-clip', priority: 'deferred' },
        { ref: audioRefs.hit, kind: 'audio-clip', priority: 'deferred' },
        { ref: audioRefs.reveal, kind: 'audio-clip', priority: 'deferred' },
    ],
}));

const gameShellSpy = vi.hoisted(() => vi.fn());
const loadRendererGameMock = vi.hoisted(() => vi.fn());

let mockSnapshot: PlayerSnapshot | null = null;
let mockCurrentTick: number | undefined = undefined;
let mockLobbyState: LobbyState | null = null;
let mockHasLoadedInitialLobbyState = true;

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('../../state/gameStore', () => ({
    useGameStore: (
        selector: (state: {
            readonly snapshot: PlayerSnapshot | null;
            readonly currentTick: number | undefined;
        }) => unknown,
    ) => selector({ snapshot: mockSnapshot, currentTick: mockCurrentTick }),
}));

vi.mock('../../state/lobbyStore', () => ({
    useLobbyStore: (
        selector: (state: {
            readonly lobbyState: unknown;
            readonly hasLoadedInitialState: boolean;
        }) => unknown,
    ) =>
        selector({
            lobbyState: mockLobbyState,
            hasLoadedInitialState: mockHasLoadedInitialLobbyState,
        }),
}));

vi.mock('../../bridge/useSendAction', () => ({
    useSendAction: () => vi.fn(),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGame: loadRendererGameMock,
}));

vi.mock('../../input/useInputAction.js', () => ({
    useInputAction: () => undefined,
}));

vi.mock('../../components/shell/GameShell', async () => {
    const react = await import('react');
    return {
        GameShell: (props: unknown) => {
            gameShellSpy(props);
            return react.createElement('div', { 'data-testid': 'mock-game-shell' });
        },
    };
});

beforeEach(() => {
    mockSnapshot = makeSnapshot();
    mockCurrentTick = undefined;
    mockLobbyState = makeLobbyState();
    mockHasLoadedInitialLobbyState = true;
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue({
        registry: {
            board: () => null,
            eventAudioBinding: {
                'tactics:move_unit': { ref: audioRefs.step, bus: 'sfx', volume: 0.45 },
                'tactics:attack': { ref: audioRefs.hit, bus: 'sfx', volume: 0.65 },
                'tactics:reveal_tile': { ref: audioRefs.reveal, bus: 'sfx', volume: 0.4 },
            },
        },
        assetManifest: testTacticsManifest,
    });
    gameShellSpy.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('GamePage asset wiring', () => {
    it('passes a manifest-backed AssetManager from the active game loader into GameShell', async () => {
        render(
            <I18nProvider>
                <GamePage />
            </I18nProvider>,
        );

        expect(await screen.findByTestId('mock-game-shell')).toBeInTheDocument();
        expect(loadRendererGameMock).toHaveBeenCalledWith('tactics');
        const props = gameShellSpy.mock.calls[0]?.[0] as {
            readonly assetManager?: AssetManager;
            readonly assetManifest?: AssetManifest;
        };

        expect(props.assetManifest).toBe(testTacticsManifest);
        expect(props.assetManager).toEqual(
            expect.objectContaining({
                registerManifest: expect.any(Function),
                load: expect.any(Function),
                dispose: expect.any(Function),
            }),
        );
        expect(props.assetManifest?.entries.map((entry) => entry.ref)).toEqual([
            audioRefs.step,
            audioRefs.hit,
            audioRefs.reveal,
        ]);
    });
});

function makeSnapshot(): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 5,
        viewerId: id,
        players: { [id]: { id } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeLobbyState(): LobbyState {
    return {
        info: {
            sessionId: 'session-1',
            hostId: 'p1',
            gameId: 'tactics',
        },
        players: [
            {
                playerId: 'p1',
                displayName: 'Player One',
                ready: true,
            },
        ],
    };
}
