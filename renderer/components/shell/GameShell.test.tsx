// @vitest-environment jsdom
// renderer/components/shell/GameShell.test.tsx

import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManager } from '../../assets/AssetManager';
import { useAssetManager } from '../../assets/AssetManagerContext.js';
import { SetGameAssetManagerContext } from '../../assets/SetGameAssetManagerContext';
import { AudioManagerContext, useAudioManager } from '../../audio/AudioManagerContext.js';
import { createAudioManagerSpy } from '../../audio/__test-support__/AudioManagerStubs.js';
import { createInputActionRegistry } from '../../input/InputActionRegistry.js';
import { InputActionRegistryContext } from '../../input/InputActionRegistryContext.js';
import { useUiStore } from '../../state/uiStore.js';
import {
    GameShell,
    type GameHudProps,
    type GameScreenProps,
    type GameResultBannerProps,
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

// Mock PerfHud to avoid requiring InputManagerContext in GameShell unit tests.
// Verifies the component is mounted while keeping tests hermetic.
vi.mock('./perf/PerfHud.js', () => ({
    PerfHud: () => <div data-testid="perf-hud-mock" />,
}));

// Mock SpectatorHud for the same reason — it subscribes via useInputAction and
// reads the input manager for the switch-hotkey binding.
vi.mock('./SpectatorHud.js', () => ({
    SpectatorHud: () => <div data-testid="spectator-hud-mock" />,
}));

// Mock DebugInspectorToggle for the same reason — it subscribes via useInputAction.
vi.mock('./debug/DebugInspectorToggle.js', () => ({
    DebugInspectorToggle: () => <div data-testid="debug-inspector-toggle-mock" />,
}));

const inGameMenuHostSpy = vi.fn((_props: Record<string, unknown>) => null);

// Mock InGameMenuHost — it subscribes via useInputAction and registers an
// Escape-stack layer, both needing app-level providers. Mocking keeps these unit
// tests hermetic while letting us assert RegistryGameShell forwards the slot.
vi.mock('./InGameMenuHost.js', () => ({
    InGameMenuHost: (props: Record<string, unknown>) => {
        inGameMenuHostSpy(props);
        return null;
    },
}));

const TEST_AUDIO_REF = 'tactics/audio/sfx/test-hit.ogg' as AssetRef<AudioClipAsset>;

// GameShell and its DefaultGameHud call useTranslate() for the landmark
// accessible names; the inert I18nProvider resolves engine English so the
// existing aria-label locators hold. renderWithAudio delegates here, so both
// entry points sit inside the provider.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    eventAudioPlayerSpy.mockReset();
    inGameMenuHostSpy.mockReset();
    // uiStore is a module singleton; restore the default 'board' screen so the
    // banner-visibility tests are independent of execution order.
    useUiStore.getState().resetScreenNavigation();
});

describe('GameShell page object locators', () => {
    it('mounts EventAudioPlayer when registry mode provides an event audio binding', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

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
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
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

    it('mounts InGameMenuHost and forwards the inGameMenu slot, isHost, and localPlayerId', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const InGameMenu = (): React.ReactElement => <div />;

        renderWithAudio(
            <GameShell
                registry={{
                    board: () => <div data-testid="registry-board">Registry board</div>,
                    inGameMenu: InGameMenu,
                }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                isHost
            />,
        );

        expect(inGameMenuHostSpy).toHaveBeenCalledWith({
            inGameMenu: InGameMenu,
            isHost: true,
            localPlayerId: playerId('p1'),
        });
    });

    it('omits the inGameMenu prop so the host shows the engine default when the slot is absent', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

        renderWithAudio(
            <GameShell
                registry={{ board: () => <div data-testid="registry-board" /> }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        expect(inGameMenuHostSpy).toHaveBeenCalledTimes(1);
        const props = inGameMenuHostSpy.mock.calls[0]?.[0] ?? {};
        expect(props).not.toHaveProperty('inGameMenu');
        expect(props).not.toHaveProperty('isHost');
        expect(props['localPlayerId']).toBe(playerId('p1'));
    });

    it('stops all audio when the registry match phase ends', () => {
        const audioManager = createAudioManagerSpy();
        const registry = { board: () => <div data-testid="registry-board">Registry board</div> };
        const sendAction = vi.fn();
        const localPlayerId = playerId('p1');
        const playingSnapshot = makePlayerSnapshot({
            sceneId: makeSceneId('engine:game'),
            phase: gamePhase('playing'),
        });
        const endedSnapshot = makePlayerSnapshot({
            sceneId: makeSceneId('engine:game'),
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

    it('registers game-owned input actions through the app input registry', () => {
        const inputRegistry = createInputActionRegistry();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

        render(
            <InputActionRegistryContext.Provider value={inputRegistry}>
                {wrapWithAudio(
                    <GameShell
                        registry={{
                            board: () => <div data-testid="registry-board">Registry board</div>,
                        }}
                        inputActions={[
                            {
                                id: 'game:end-turn',
                                description: 'End current turn',
                                category: 'Game',
                                oneShot: true,
                            },
                        ]}
                        snapshot={snapshot}
                        sendAction={vi.fn()}
                        localPlayerId={playerId('p1')}
                    />,
                )}
            </InputActionRegistryContext.Provider>,
        );

        expect(inputRegistry.get('game:end-turn')).toEqual({
            id: 'game:end-turn',
            description: 'End current turn',
            category: 'Game',
            oneShot: true,
        });
    });

    it('does not dispose the context AudioManager on registry shell unmount — lifecycle owned by Providers', () => {
        const audioManager = createAudioManagerSpy();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

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
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
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
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
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
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
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
        expect(screen.getByTestId('game-canvas').textContent).toContain('Registry board');
    });

    it('renders the §13.6 game HUD locator surface', () => {
        render(
            <GameShell tick={42} canUndo={true} canRedo={false} isGameOver={true}>
                <div>Board slot</div>
            </GameShell>,
        );

        expect(screen.getByTestId('game-canvas').textContent).toContain('Board slot');
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
        expect(screen.getByTestId('game-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('unknown');
        expect(screen.queryByTestId('game-over-banner')).toBeNull();
        expect(screen.getByTestId('hud-tick').textContent).toBe('42');
    });

    it('resolves the landmark accessible names through the active-locale translator', () => {
        baseRender(
            <I18nProvider
                gameOverride={{
                    'engine.gameShell.mainAriaLabel': 'Play area',
                    'engine.gameShell.canvasAriaLabel': 'Board',
                    'engine.gameShell.hudAriaLabel': 'Controls',
                }}
            >
                <GameShell tick={1} canUndo={false} canRedo={false} />
            </I18nProvider>,
        );

        expect(screen.getByLabelText('Play area')).toBeTruthy();
        expect(screen.getByLabelText('Board')).toBeTruthy();
        expect(screen.getByLabelText('Controls')).toBeTruthy();
    });

    it('resolves the default HUD scaffold labels through engine.hud.* tokens (game override wins)', () => {
        baseRender(
            <I18nProvider
                gameOverride={{
                    'engine.hud.tick': 'Turn',
                    'engine.hud.undo': 'Back',
                    'engine.hud.redo': 'Forward',
                    'engine.hud.endTurn': 'Finish',
                }}
            >
                <GameShell tick={3} canUndo canRedo />
            </I18nProvider>,
        );

        expect(screen.getByTestId('undo').textContent).toBe('Back');
        expect(screen.getByTestId('redo').textContent).toBe('Forward');
        expect(screen.getByTestId('end-turn').textContent).toBe('Finish');
        // The tick readout keeps its numeric <output>; only the label re-keys.
        expect(screen.getByTestId('hud-tick').closest('div')?.textContent).toBe('Turn 3');
    });

    it('keeps shell root layout structure while using tokenized font family', () => {
        render(<GameShell tick={1} canUndo={false} canRedo={false} />);

        const shellRoot = screen.getByLabelText('Game');
        const style = shellRoot.getAttribute('style') ?? '';

        expect(style).toContain('grid-template-rows: 1fr auto');
        expect(style).toContain('min-height: 100vh');
        expect(style).toContain('font-family: var(--ch-font-ui)');
    });

    it('renders the fallback HUD controls through the shared Button primitive', () => {
        render(<GameShell tick={1} canUndo canRedo />);

        for (const testId of ['undo', 'redo', 'end-turn']) {
            const control = screen.getByTestId(testId);
            expect(control.tagName).toBe('BUTTON');
            expect(control.getAttribute('data-ch-button-variant')).toBe('secondary');
            expect(control.getAttribute('data-ch-button-size')).toBe('sm');
        }
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

    it('disables all action controls for a spectator (Invariant #92/#114)', () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onEndTurn = vi.fn();

        render(
            <GameShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={true}
                onUndo={onUndo}
                onRedo={onRedo}
                onEndTurn={onEndTurn}
                isSpectator={true}
            />,
        );

        for (const testId of ['undo', 'redo', 'end-turn']) {
            expect(screen.getByTestId(testId).hasAttribute('disabled')).toBe(true);
        }

        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));
        fireEvent.click(screen.getByTestId('end-turn'));

        expect(onUndo).not.toHaveBeenCalled();
        expect(onRedo).not.toHaveBeenCalled();
        expect(onEndTurn).not.toHaveBeenCalled();
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

    it('disables all engine controls after a match result is resolved', () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onEndTurn = vi.fn();
        const localPlayerId = playerId('p1');

        render(
            <GameShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={true}
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
                onUndo={onUndo}
                onRedo={onRedo}
                onEndTurn={onEndTurn}
            />,
        );

        const undoButton = screen.getByTestId('undo');
        const redoButton = screen.getByTestId('redo');
        const endTurnButton = screen.getByTestId('end-turn');

        expect(undoButton.hasAttribute('disabled')).toBe(true);
        expect(redoButton.hasAttribute('disabled')).toBe(true);
        expect(endTurnButton.hasAttribute('disabled')).toBe(true);

        fireEvent.click(undoButton);
        fireEvent.click(redoButton);
        fireEvent.click(endTurnButton);

        expect(onUndo).not.toHaveBeenCalled();
        expect(onRedo).not.toHaveBeenCalled();
        expect(onEndTurn).not.toHaveBeenCalled();
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
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('game-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('win');
        expect(screen.getByTestId('game-result-text').textContent).toBe('You won');
    });

    it('resolves the default result-banner copy through engine.gameResult.* tokens (game override wins)', () => {
        const localPlayerId = playerId('p1');

        baseRender(
            <I18nProvider gameOverride={{ 'engine.gameResult.won': 'Victory!' }}>
                <GameShell
                    tick={7}
                    canUndo={false}
                    canRedo={false}
                    isGameOver={true}
                    localPlayerId={localPlayerId}
                    gameResult={{ winnerIds: [localPlayerId] }}
                />
            </I18nProvider>,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Victory!');
    });

    it('resolves the game-over fallback message through the engine.gameResult.gameOver token', () => {
        baseRender(
            <I18nProvider gameOverride={{ 'engine.gameResult.gameOver': 'Match complete' }}>
                <GameShell tick={7} canUndo={false} canRedo={false} isGameOver={true} />
            </I18nProvider>,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Match complete');
    });

    it('delegates resolved match result rendering to a game-provided banner', () => {
        const localPlayerId = playerId('p1');
        const gameResult = { winnerIds: [localPlayerId] };
        let receivedProps: GameResultBannerProps | null = null;

        function GameResultBanner(props: GameResultBannerProps): React.ReactElement {
            receivedProps = props;
            return (
                <div data-testid="game-result-banner" role="status">
                    <span data-testid="game-result-text">Custom tactics victory</span>
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
                gameResult={gameResult}
                gameResultBanner={GameResultBanner}
            />,
        );

        expect(receivedProps).toEqual({ gameResult, localPlayerId });
        expect(screen.getByTestId('game-result-text').textContent).toBe('Custom tactics victory');
    });

    it('shows You lose when the local player is not a winner', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('You lose');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('loss');
    });

    it('shows Draw when gameResult has no winners', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={playerId('p1')}
                gameResult={{ winnerIds: [] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Draw');
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('draw');
    });

    it('shows neutral message when localPlayerId is undefined (unknown viewer)', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                gameResult={{ winnerIds: [playerId('p2')] }}
            />,
        );

        expect(screen.getByTestId('game-result-text').textContent).toBe('Game ended');
    });

    it('engine fallback banner uses design tokens for spacing and font size', () => {
        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                gameResult={{ winnerIds: [] }}
            />,
        );

        const banner = screen.getByTestId('game-result-banner');
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

        const banner = screen.getByTestId('game-result-banner');
        const style = banner.getAttribute('style') ?? '';
        expect(style).toContain('var(--ch-space-md)');
        expect(style).toContain('var(--ch-font-size-lg)');
    });

    it('mounts PerfHud inside the game shell frame', () => {
        render(<GameShell tick={1} canUndo={false} canRedo={false} />);
        expect(screen.getByTestId('perf-hud-mock')).toBeTruthy();
    });

    it('mounts DebugInspectorToggle inside the game shell frame', () => {
        render(<GameShell tick={1} canUndo={false} canRedo={false} />);
        expect(screen.getByTestId('debug-inspector-toggle-mock')).toBeTruthy();
    });

    it('mounts SpectatorHud inside the game shell frame', () => {
        render(<GameShell tick={1} canUndo={false} canRedo={false} />);
        expect(screen.getByTestId('spectator-hud-mock')).toBeTruthy();
    });

    it('shows the resolved result banner while the active screen is the board', () => {
        useUiStore.getState().resetScreenNavigation();
        const localPlayerId = playerId('p1');

        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.getByTestId('game-result-banner')).toBeTruthy();
    });

    it('hides the resolved result banner once the active screen is no longer the board', () => {
        useUiStore.getState().navigateToScreen('summary');
        const localPlayerId = playerId('p1');

        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                localPlayerId={localPlayerId}
                gameResult={{ winnerIds: [localPlayerId] }}
            />,
        );

        expect(screen.queryByTestId('game-result-banner')).toBeNull();
    });

    it('hides the fallback game-over banner once the active screen is no longer the board', () => {
        useUiStore.getState().navigateToScreen('summary');

        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                isGameOver={true}
                gameOverMessage="Game Over"
            />,
        );

        expect(screen.queryByTestId('game-result-banner')).toBeNull();
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
        gameResult: null,
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

describe('SetGameAssetManagerContext delegation wiring', () => {
    it('registers the game AssetManager with the app-level delegate on mount and clears it on unmount', () => {
        const assetManager = createAssetManagerStub();
        const setGameAssetManager = vi.fn();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

        const { unmount } = render(
            <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
                <AudioManagerContext.Provider value={createAudioManagerSpy()}>
                    <GameShell
                        registry={{ board: () => <div /> }}
                        snapshot={snapshot}
                        sendAction={vi.fn()}
                        localPlayerId={playerId('p1')}
                        assetManager={assetManager}
                    />
                </AudioManagerContext.Provider>
            </SetGameAssetManagerContext.Provider>,
        );

        expect(setGameAssetManager).toHaveBeenCalledWith(assetManager);

        unmount();

        expect(setGameAssetManager).toHaveBeenLastCalledWith(null);
    });

    it('silently skips delegation wiring when SetGameAssetManagerContext is not provided', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

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

describe('GameShell saveGame capability threading (#825)', () => {
    // The capability deliberately departs from the *Disabled/handle* pair pattern:
    // absence of the `saveGame` prop IS the withholding mechanism (Invariant #25),
    // so these tests assert prop presence, never a disabled flag.
    function renderRegistryHud(options: {
        readonly snapshot?: PlayerSnapshot;
        readonly isHost?: boolean;
        readonly onSaveGame?: (label: string) => void;
    }): { readonly hudProps: () => GameHudProps } {
        let receivedProps: GameHudProps | null = null;

        function HudSpy(props: GameHudProps): React.ReactElement {
            receivedProps = props;
            return <footer aria-label="Spy HUD" />;
        }

        renderWithAudio(
            <GameShell
                registry={{
                    board: () => <div data-testid="registry-board" />,
                    hud: HudSpy,
                }}
                snapshot={
                    options.snapshot ?? makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })
                }
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                {...(options.isHost === undefined ? {} : { isHost: options.isHost })}
                {...(options.onSaveGame === undefined ? {} : { onSaveGame: options.onSaveGame })}
            />,
        );

        return {
            hudProps: (): GameHudProps => {
                if (receivedProps === null) {
                    throw new Error('registry HUD was never rendered');
                }
                return receivedProps;
            },
        };
    }

    it('forwards isHost and a saveGame callback that delegates the label to onSaveGame', () => {
        const onSaveGame = vi.fn();

        const { hudProps } = renderRegistryHud({ isHost: true, onSaveGame });

        expect(hudProps().isHost).toBe(true);
        expect(typeof hudProps().saveGame).toBe('function');

        hudProps().saveGame?.('Alpha');

        expect(onSaveGame).toHaveBeenCalledTimes(1);
        expect(onSaveGame).toHaveBeenCalledWith('Alpha');
    });

    it('withholds saveGame from the HUD when no onSaveGame is wired', () => {
        const { hudProps } = renderRegistryHud({ isHost: true });

        expect(hudProps()).not.toHaveProperty('saveGame');
    });

    it('withholds saveGame when the shell knows the viewer is not the host', () => {
        // Defense in depth for Invariant #25: even a caller that wrongly wires
        // onSaveGame for a joined client never exposes the capability.
        const { hudProps } = renderRegistryHud({ isHost: false, onSaveGame: vi.fn() });

        expect(hudProps()).not.toHaveProperty('saveGame');
    });

    it('withholds saveGame while controls are locked by a resolved match result', () => {
        const onSaveGame = vi.fn();
        const snapshot = makePlayerSnapshot({
            sceneId: makeSceneId('engine:game'),
            gameResult: { winnerIds: [playerId('p1')] },
        });

        const { hudProps } = renderRegistryHud({ snapshot, isHost: true, onSaveGame });

        expect(hudProps()).not.toHaveProperty('saveGame');
    });

    it('withholds saveGame while controls are locked by a game-over phase', () => {
        const onSaveGame = vi.fn();
        const snapshot = makePlayerSnapshot({
            sceneId: makeSceneId('engine:game'),
            phase: gamePhase('ended'),
        });

        const { hudProps } = renderRegistryHud({ snapshot, isHost: true, onSaveGame });

        expect(hudProps()).not.toHaveProperty('saveGame');
    });

    it('omits isHost from the HUD props and keeps saveGame when the shell does not receive it', () => {
        // An absent isHost means "role unknown — treat as host" (GameScreenProps
        // contract), so only an explicit false withholds the capability.
        const { hudProps } = renderRegistryHud({ onSaveGame: vi.fn() });

        expect(hudProps()).not.toHaveProperty('isHost');
        expect(typeof hudProps().saveGame).toBe('function');
    });
});
