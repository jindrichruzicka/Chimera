// @vitest-environment jsdom
// renderer/components/shell/GameShell.test.tsx

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gamePhase, playerId, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';
import type { AssetManager } from '../../assets/AssetManager';
import { useAssetManager } from '../../assets/AssetManagerContext.js';
import { SetMatchAssetManagerContext } from '../../assets/SetMatchAssetManagerContext';
import { AudioManagerContext, useAudioManager } from '../../audio/AudioManagerContext.js';
import { createAudioManagerSpy } from '../../audio/__test-support__/AudioManagerStubs.js';
import {
    GameShell,
    type GameHudProps,
    type GameScreenProps,
    type MatchResultBannerProps,
} from './GameShell';

const eventAudioPlayerSpy = vi.fn(
    (_props: { readonly binding: Readonly<Record<string, unknown>> }) => null,
);

vi.mock('../audio/EventAudioPlayer.js', () => ({
    EventAudioPlayer: (props: { readonly binding: Readonly<Record<string, unknown>> }) => {
        eventAudioPlayerSpy(props);
        return null;
    },
}));

const TEST_AUDIO_REF = 'tactics/audio/sfx/test-hit.ogg' as AssetRef<AudioClipAsset>;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    eventAudioPlayerSpy.mockReset();
});

describe('GameShell page object locators', () => {
    it('mounts EventAudioPlayer when registry mode provides an event audio binding', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });

        renderWithAudio(
            <GameShell
                registry={{
                    board: () => <div data-testid="registry-board">Registry board</div>,
                    eventAudioBinding: {
                        'combat:hit': { ref: TEST_AUDIO_REF, bus: 'sfx', volume: 0.5 },
                    },
                }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        expect(eventAudioPlayerSpy).toHaveBeenCalledWith({
            binding: {
                'combat:hit': { ref: TEST_AUDIO_REF, bus: 'sfx', volume: 0.5 },
            },
        });
    });

    it('provides the app AudioManagerContext to registry screens', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });
        const audioManager = createAudioManagerSpy();

        function Board(_props: GameScreenProps): React.ReactElement {
            const injectedAudioManager = useAudioManager();
            return (
                <div
                    data-testid="audio-context-board"
                    data-audio-manager={
                        injectedAudioManager === audioManager ? 'provided' : 'wrong'
                    }
                />
            );
        }

        renderWithAudio(
            <GameShell
                registry={{
                    board: Board,
                    eventAudioBinding: {
                        'combat:hit': { ref: TEST_AUDIO_REF, bus: 'sfx', volume: 0.5 },
                    },
                }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
            audioManager,
        );

        expect(
            (await screen.findByTestId('audio-context-board')).getAttribute('data-audio-manager'),
        ).toBe('provided');
    });

    it('stops all audio when the registry match phase ends', () => {
        const audioManager = createAudioManagerSpy();
        const registry = { board: () => <div data-testid="registry-board">Registry board</div> };
        const sendAction = vi.fn();
        const localPlayerId = playerId('p1');
        const playingSnapshot = makePlayerSnapshot({
            sceneId: makeSceneId('engine:match'),
            phase: gamePhase('playing'),
        });
        const endedSnapshot = makePlayerSnapshot({
            sceneId: makeSceneId('engine:match'),
            phase: gamePhase('ended'),
        });

        const { rerender } = renderWithAudio(
            <GameShell
                registry={registry}
                snapshot={playingSnapshot}
                sendAction={sendAction}
                localPlayerId={localPlayerId}
            />,
            audioManager,
        );

        expect(audioManager.stopAll).not.toHaveBeenCalled();

        rerender(
            wrapWithAudio(
                <GameShell
                    registry={registry}
                    snapshot={endedSnapshot}
                    sendAction={sendAction}
                    localPlayerId={localPlayerId}
                />,
                audioManager,
            ),
        );

        expect(audioManager.stopAll).toHaveBeenCalledOnce();
        expect(audioManager.stopAll).toHaveBeenCalledWith();
    });

    it('does not dispose the context AudioManager on registry shell unmount — lifecycle owned by Providers', () => {
        const audioManager = createAudioManagerSpy();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });

        const { unmount } = renderWithAudio(
            <GameShell
                registry={{ board: () => <div data-testid="registry-board">Registry board</div> }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
            audioManager,
        );

        unmount();

        expect(audioManager.dispose).not.toHaveBeenCalled();
    });

    it('does not dispose the context AudioManager when GameShell remounts under the same Providers instance', () => {
        const audioManager = createAudioManagerSpy();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });
        const registry = { board: () => <div data-testid="registry-board">Registry board</div> };

        const { unmount } = renderWithAudio(
            <GameShell
                registry={registry}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
            audioManager,
        );

        unmount();
        expect(audioManager.dispose).not.toHaveBeenCalled();

        renderWithAudio(
            <GameShell
                registry={registry}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
            audioManager,
        );

        expect(audioManager.dispose).not.toHaveBeenCalled();
    });

    it('provides AssetManagerContext in registry mode and disposes it on unmount', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });
        const assetManager = createAssetManagerStub();

        function Board(_props: GameScreenProps): React.ReactElement {
            const injectedAssetManager = useAssetManager();
            return (
                <div
                    data-testid="asset-context-board"
                    data-asset-manager={
                        injectedAssetManager === assetManager ? 'provided' : 'wrong'
                    }
                />
            );
        }

        const { unmount } = renderWithAudio(
            <GameShell
                registry={{ board: Board }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={assetManager}
            />,
        );

        expect(
            (await screen.findByTestId('asset-context-board')).getAttribute('data-asset-manager'),
        ).toBe('provided');

        unmount();
        expect(assetManager.dispose).toHaveBeenCalledOnce();
    });

    it('renders a GameScreenRegistry board through registry mode', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });
        const Board = React.lazy(() =>
            Promise.resolve({
                default: () => <div data-testid="registry-board">Registry board</div>,
            }),
        );

        renderWithAudio(
            <GameShell
                registry={{ board: Board }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        expect(await screen.findByTestId('registry-board')).toBeTruthy();
        expect(screen.getByTestId('match-canvas').textContent).toContain('Registry board');
    });

    it('renders the §13.6 match HUD locator surface', () => {
        render(
            <GameShell tick={42} canUndo={true} canRedo={false} isGameOver={true}>
                <div>Board slot</div>
            </GameShell>,
        );

        expect(screen.getByTestId('match-canvas').textContent).toContain('Board slot');
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
        expect(screen.getByTestId('match-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('unknown');
        expect(screen.queryByTestId('game-over-banner')).toBeNull();
        expect(screen.getByTestId('hud-tick').textContent).toBe('42');
    });

    it('keeps shell root layout structure while using tokenized font family', () => {
        render(<GameShell tick={1} canUndo={false} canRedo={false} />);

        const shellRoot = screen.getByLabelText('Match');
        const style = shellRoot.getAttribute('style') ?? '';

        expect(style).toContain('grid-template-rows: 1fr auto');
        expect(style).toContain('min-height: 100vh');
        expect(style).toContain('font-family: var(--ch-font-ui)');
    });

    it('wires HUD controls through game-agnostic callbacks', () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onEndTurn = vi.fn();

        render(
            <GameShell
                tick={7}
                canUndo={true}
                canRedo={true}
                onUndo={onUndo}
                onRedo={onRedo}
                onEndTurn={onEndTurn}
            />,
        );

        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));
        fireEvent.click(screen.getByTestId('end-turn'));

        expect(onUndo).toHaveBeenCalledOnce();
        expect(onRedo).toHaveBeenCalledOnce();
        expect(onEndTurn).toHaveBeenCalledOnce();
    });

    it('delegates HUD rendering to a game-provided component with engine-owned controls', () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onEndTurn = vi.fn();
        const snapshot = makePlayerSnapshot({
            tick: 9,
            undoMeta: { canUndo: true, canRedo: false },
        });
        let receivedProps: GameHudProps | null = null;

        function GameHud(props: GameHudProps): React.ReactElement {
            receivedProps = props;
            return (
                <footer aria-label="Custom HUD">
                    <output data-testid="custom-hud-tick">{props.tick}</output>
                    <button data-testid="custom-undo" type="button" onClick={props.handleUndo}>
                        Undo
                    </button>
                    <button
                        data-testid="custom-redo"
                        type="button"
                        disabled={props.redoDisabled}
                        onClick={props.handleRedo}
                    >
                        Redo
                    </button>
                    <button
                        data-testid="custom-end-turn"
                        type="button"
                        onClick={props.handleEndTurn}
                    >
                        End Turn
                    </button>
                </footer>
            );
        }

        render(
            <GameShell
                tick={9}
                canUndo={true}
                canRedo={false}
                snapshot={snapshot}
                sendAction={vi.fn()}
                hud={GameHud}
                localPlayerId={playerId('p1')}
                onUndo={onUndo}
                onRedo={onRedo}
                onEndTurn={onEndTurn}
            />,
        );

        expect(screen.queryByTestId('undo')).toBeNull();
        expect(screen.getByTestId('custom-hud-tick').textContent).toBe('9');
        expect(receivedProps).toMatchObject({
            snapshot,
            localPlayerId: playerId('p1'),
            tick: 9,
            undoDisabled: false,
            redoDisabled: true,
            endTurnDisabled: false,
        });

        fireEvent.click(screen.getByTestId('custom-undo'));
        fireEvent.click(screen.getByTestId('custom-redo'));
        fireEvent.click(screen.getByTestId('custom-end-turn'));

        expect(onUndo).toHaveBeenCalledOnce();
        expect(onRedo).not.toHaveBeenCalled();
        expect(onEndTurn).toHaveBeenCalledOnce();
    });

    it('disables end-turn button when canEndTurn is false', () => {
        const onEndTurn = vi.fn();

        render(
            <GameShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={false}
                onEndTurn={onEndTurn}
            />,
        );

        const endTurnButton = screen.getByTestId('end-turn');
        expect(endTurnButton.hasAttribute('disabled')).toBe(true);

        fireEvent.click(endTurnButton);
        expect(onEndTurn).not.toHaveBeenCalled();
    });

    it('enables end-turn button when canEndTurn is true (or not specified)', () => {
        const onEndTurn = vi.fn();

        render(
            <GameShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={true}
                onEndTurn={onEndTurn}
            />,
        );

        const endTurnButton = screen.getByTestId('end-turn');
        expect(endTurnButton.hasAttribute('disabled')).toBe(false);

        fireEvent.click(endTurnButton);
        expect(onEndTurn).toHaveBeenCalledOnce();
    });

    it('shows You won when the local player is a winner', () => {
        const localPlayerId = playerId('p1');

        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={localPlayerId}
                matchResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('match-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('win');
        expect(screen.getByTestId('match-result-text').textContent).toBe('You won');
    });

    it('delegates resolved match result rendering to a game-provided banner', () => {
        const localPlayerId = playerId('p1');
        const matchResult = { winnerIds: [localPlayerId] };
        let receivedProps: MatchResultBannerProps | null = null;

        function GameResultBanner(props: MatchResultBannerProps): React.ReactElement {
            receivedProps = props;
            return (
                <div data-testid="match-result-banner" role="status">
                    <span data-testid="match-result-text">Custom tactics victory</span>
                </div>
            );
        }

        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={localPlayerId}
                matchResult={matchResult}
                matchResultBanner={GameResultBanner}
            />,
        );

        expect(receivedProps).toEqual({ matchResult, localPlayerId });
        expect(screen.getByTestId('match-result-text').textContent).toBe('Custom tactics victory');
    });

    it('shows You lose when the local player is not a winner', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={playerId('p1')}
                matchResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('You lose');
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('loss');
    });

    it('shows Draw when matchResult has no winners', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={playerId('p1')}
                matchResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('Draw');
        expect(
            screen.getByTestId('match-result-banner').getAttribute('data-match-result-outcome'),
        ).toBe('draw');
    });

    it('shows neutral message when localPlayerId is undefined (unknown viewer)', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                matchResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('match-result-text').textContent).toBe('Match ended');
    });

    it('engine fallback banner uses design tokens for spacing and font size', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                matchResult={{ winnerIds: [] }}
            />,
        );

        const banner = screen.getByTestId('match-result-banner');
        const style = banner.getAttribute('style') ?? '';
        expect(style).toContain('var(--ch-space-md)');
        expect(style).toContain('var(--ch-font-size-lg)');
    });

    it('engine fallback game-over banner uses design tokens for spacing and font size', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                gameOverMessage="Game Over"
            />,
        );

        const banner = screen.getByTestId('match-result-banner');
        const style = banner.getAttribute('style') ?? '';
        expect(style).toContain('var(--ch-space-md)');
        expect(style).toContain('var(--ch-font-size-lg)');
    });
});

function makePlayerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 1,
        viewerId: id,
        players: { [id]: { id } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        matchResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

function renderWithAudio(
    element: React.ReactElement,
    audioManager = createAudioManagerSpy(),
): ReturnType<typeof render> {
    return render(wrapWithAudio(element, audioManager));
}

function wrapWithAudio(
    element: React.ReactElement,
    audioManager = createAudioManagerSpy(),
): React.ReactElement {
    return (
        <AudioManagerContext.Provider value={audioManager}>{element}</AudioManagerContext.Provider>
    );
}

describe('SetMatchAssetManagerContext delegation wiring', () => {
    it('registers the match AssetManager with the app-level delegate on mount and clears it on unmount', () => {
        const assetManager = createAssetManagerStub();
        const setMatchAssetManager = vi.fn();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });

        const { unmount } = render(
            <SetMatchAssetManagerContext.Provider value={setMatchAssetManager}>
                <AudioManagerContext.Provider value={createAudioManagerSpy()}>
                    <GameShell
                        registry={{ board: () => <div /> }}
                        snapshot={snapshot}
                        sendAction={vi.fn()}
                        localPlayerId={playerId('p1')}
                        assetManager={assetManager}
                    />
                </AudioManagerContext.Provider>
            </SetMatchAssetManagerContext.Provider>,
        );

        expect(setMatchAssetManager).toHaveBeenCalledWith(assetManager);

        unmount();

        expect(setMatchAssetManager).toHaveBeenLastCalledWith(null);
    });

    it('silently skips delegation wiring when SetMatchAssetManagerContext is not provided', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:match') });

        // Should not throw even when the context is absent (tests / non-Providers trees)
        expect(() =>
            render(
                wrapWithAudio(
                    <GameShell
                        registry={{ board: () => <div /> }}
                        snapshot={snapshot}
                        sendAction={vi.fn()}
                        localPlayerId={playerId('p1')}
                    />,
                ),
            ),
        ).not.toThrow();
    });
});

function createAssetManagerStub(): AssetManager {
    return {
        registerManifest: vi.fn(),
        async preloadCritical(): Promise<void> {},
        get(): null {
            return null;
        },
        async load(): Promise<never> {
            throw new Error('unused asset manager stub');
        },
        dispose: vi.fn(),
    };
}
