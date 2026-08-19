// @vitest-environment jsdom
// renderer/components/shell/GameShell.test.tsx

import { act, cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    AssetRef,
    AudioClipAsset,
    TextureAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import {
    createAssetManager,
    UnknownAssetManifestEntryError,
    type AssetManager,
    type ResolvedAsset,
} from '../../assets/AssetManager';
import { createAssetLoaderRegistry } from '../../assets/AssetLoaderRegistry';
import { createDelegatingAssetManager } from '../../assets/DelegatingAssetManager';
import { createRecordingLogsApi } from '../../logging/__test-support__/RecordingLogsApi.js';
import { createStubAssetManager } from '../../assets/__test-support__/StubAssetManager.js';
import { useAssetManager } from '../../assets/AssetManagerContext.js';
import { SetGameAssetManagerContext } from '../../assets/SetGameAssetManagerContext';
import { AudioManagerContext, useAudioManager } from '../../audio/AudioManagerContext.js';
import { createAudioManagerSpy } from '../../audio/__test-support__/AudioManagerStubs.js';
import {
    createInputActionRegistry,
    type InputActionRegistry,
} from '../../input/InputActionRegistry.js';
import { InputActionRegistryContext } from '../../input/InputActionRegistryContext.js';
import { useTimeScaleStore } from '../../animation/timeScaleStore.js';
import { useUiStore } from '../../state/uiStore.js';
import {
    GameShell,
    type GameHudProps,
    type GameScreenProps,
    type GameScreenRegistry,
    type GameResultBannerProps,
} from './GameShell';
import type { GameScreenComponent } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

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
    // uiStore is a module singleton; restore the default 'playfield' screen so the
    // banner-visibility tests are independent of execution order.
    useUiStore.getState().resetScreenNavigation();
});

describe('GameShell page object locators', () => {
    it('mounts EventAudioPlayer when registry mode provides an event audio binding', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

        renderWithAudio(
            <GameShell
                registry={{
                    playfield: () => <div data-testid="registry-playfield">Registry playfield</div>,
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

        function Playfield(_props: GameScreenProps): React.ReactElement {
            const injectedAudioManager = useAudioManager();
            return (
                <div
                    data-testid="audio-context-playfield"
                    data-audio-manager={
                        injectedAudioManager === audioManager ? 'provided' : 'wrong'
                    }
                />
            );
        }

        renderWithAudio(
            <GameShell
                registry={{
                    playfield: Playfield,
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
            (await screen.findByTestId('audio-context-playfield')).getAttribute(
                'data-audio-manager',
            ),
        ).toBe('provided');
    });

    it('mounts InGameMenuHost and forwards the inGameMenu slot, isHost, and localPlayerId', () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const InGameMenu = (): React.ReactElement => <div />;

        renderWithAudio(
            <GameShell
                registry={{
                    playfield: () => <div data-testid="registry-playfield">Registry playfield</div>,
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
                registry={{ playfield: () => <div data-testid="registry-playfield" /> }}
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
        const registry = {
            playfield: () => <div data-testid="registry-playfield">Registry playfield</div>,
        };
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

        renderWithAudio(
            <GameShell
                registry={{
                    playfield: () => <div data-testid="registry-playfield">Registry playfield</div>,
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
            undefined,
            { inputRegistry },
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
                registry={{
                    playfield: () => <div data-testid="registry-playfield">Registry playfield</div>,
                }}
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
        const registry = {
            playfield: () => <div data-testid="registry-playfield">Registry playfield</div>,
        };

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

        function Playfield(_props: GameScreenProps): React.ReactElement {
            const injectedAssetManager = useAssetManager();
            return (
                <div
                    data-testid="asset-context-playfield"
                    data-asset-manager={
                        injectedAssetManager === assetManager ? 'provided' : 'wrong'
                    }
                />
            );
        }

        const { unmount } = renderWithAudio(
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={assetManager}
            />,
        );

        expect(
            (await screen.findByTestId('asset-context-playfield')).getAttribute(
                'data-asset-manager',
            ),
        ).toBe('provided');

        unmount();
        // Disposal is deferred one microtask so a StrictMode simulated remount
        // can cancel it; a real unmount has no canceller.
        await act(async () => {
            await Promise.resolve();
        });
        expect(assetManager.dispose).toHaveBeenCalledOnce();
    });

    it('renders a GameScreenRegistry playfield through registry mode', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const Playfield = React.lazy(() =>
            Promise.resolve({
                default: () => <div data-testid="registry-playfield">Registry playfield</div>,
            }),
        );

        renderWithAudio(
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        expect(await screen.findByTestId('registry-playfield')).toBeTruthy();
        expect(screen.getByTestId('game-canvas').textContent).toContain('Registry playfield');
    });

    it('gives the screen host a positioned box with a minimum-height floor', () => {
        // Both halves are contract a game screen depends on, and neither is
        // obvious from the markup:
        //
        // `position: relative` makes this section the containing block a screen's
        // `position: absolute; inset: 0` scene host resolves against. Without it
        // the host would resolve against the viewport and cover the HUD below.
        //
        // `minHeight` is the floor a screen COLLAPSES ONTO when it asks for a
        // percentage height — the `div.chimera-scene-router` between this section
        // and the screen carries no styles, so `block-size: 100%` resolves to
        // auto. That failure (a scene rendered into a short strip rather than a
        // missing one) is why the scene-host rule is spelled `inset: 0`, and the
        // GameCanvas JSDoc plus the scaffold template both cite this element for
        // it — so it is asserted here rather than described in three places.
        render(
            <GameShell tick={0} canUndo={false} canRedo={false} isGameOver={false}>
                <div>Playfield slot</div>
            </GameShell>,
        );

        const host = screen.getByTestId('game-canvas');

        expect(host.style.position).toBe('relative');
        expect(host.style.minHeight).toBe('calc(var(--ch-space-md) * 20)');
    });

    it('renders the §13.6 game HUD locator surface', () => {
        render(
            <GameShell tick={42} canUndo={true} canRedo={false} isGameOver={true}>
                <div>Playfield slot</div>
            </GameShell>,
        );

        expect(screen.getByTestId('game-canvas').textContent).toContain('Playfield slot');
        // The engine default HUD ships only End Turn; undo/redo are opt-in per game.
        expect(screen.queryByTestId('undo')).toBeNull();
        expect(screen.queryByTestId('redo')).toBeNull();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
        expect(screen.getByTestId('game-result-banner')).toBeTruthy();
        expect(
            screen.getByTestId('game-result-banner').getAttribute('data-game-result-outcome'),
        ).toBe('unknown');
        expect(screen.queryByTestId('game-over-banner')).toBeNull();
    });

    it('resolves the landmark accessible names through the active-locale translator', () => {
        baseRender(
            <I18nProvider
                gameOverride={{
                    'engine.gameShell.mainAriaLabel': 'Play area',
                    'engine.gameShell.canvasAriaLabel': 'Playfield',
                    'engine.gameShell.hudAriaLabel': 'Controls',
                }}
            >
                <GameShell tick={1} canUndo={false} canRedo={false} />
            </I18nProvider>,
        );

        expect(screen.getByLabelText('Play area')).toBeTruthy();
        expect(screen.getByLabelText('Playfield')).toBeTruthy();
        expect(screen.getByLabelText('Controls')).toBeTruthy();
    });

    it('resolves the default HUD scaffold label through the engine.hud.endTurn token (game override wins)', () => {
        baseRender(
            <I18nProvider
                gameOverride={{
                    'engine.hud.endTurn': 'Finish',
                }}
            >
                <GameShell tick={3} canUndo canRedo />
            </I18nProvider>,
        );

        expect(screen.getByTestId('end-turn').textContent).toBe('Finish');
    });

    it('keeps shell root layout structure while using tokenized font family', () => {
        render(<GameShell tick={1} canUndo={false} canRedo={false} />);

        const shellRoot = screen.getByLabelText('Game');
        const style = shellRoot.getAttribute('style') ?? '';

        expect(style).toContain('grid-template-rows: 1fr auto');
        expect(style).toContain('min-height: 100vh');
        expect(style).toContain('font-family: var(--ch-font-ui)');
    });

    it('renders the fallback HUD control through the shared Button primitive', () => {
        render(<GameShell tick={1} canUndo canRedo />);

        const control = screen.getByTestId('end-turn');
        expect(control.tagName).toBe('BUTTON');
        expect(control.getAttribute('data-ch-button-variant')).toBe('secondary');
        expect(control.getAttribute('data-ch-button-size')).toBe('sm');
    });

    it('wires the default End Turn control through a game-agnostic callback', () => {
        const onEndTurn = vi.fn();

        render(
            <GameShell
                tick={7}
                canUndo={false}
                canRedo={false}
                canEndTurn={true}
                onEndTurn={onEndTurn}
            />,
        );

        fireEvent.click(screen.getByTestId('end-turn'));

        expect(onEndTurn).toHaveBeenCalledOnce();
    });

    it('disables the default action control for a spectator (Invariant #92/#114)', () => {
        const onEndTurn = vi.fn();

        render(
            <GameShell
                tick={7}
                canUndo={true}
                canRedo={true}
                canEndTurn={true}
                onEndTurn={onEndTurn}
                isSpectator={true}
            />,
        );

        expect(screen.getByTestId('end-turn').hasAttribute('disabled')).toBe(true);

        fireEvent.click(screen.getByTestId('end-turn'));

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

    it('disables the default engine control after a match result is resolved', () => {
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
                onEndTurn={onEndTurn}
            />,
        );

        const endTurnButton = screen.getByTestId('end-turn');
        expect(endTurnButton.hasAttribute('disabled')).toBe(true);

        fireEvent.click(endTurnButton);
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

    it('shows the resolved result banner while the active screen is the playfield', () => {
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

    it('hides the resolved result banner once the active screen is no longer the playfield', () => {
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

    it('hides the fallback game-over banner once the active screen is no longer the playfield', () => {
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

interface ShellContextOverrides {
    readonly inputRegistry?: InputActionRegistry;
    readonly setGameAssetManager?: (manager: AssetManager | null) => void;
}

function renderWithAudio(
    element: React.ReactElement,
    audioManager = createAudioManagerSpy(),
    overrides: ShellContextOverrides = {},
): ReturnType<typeof render> {
    return render(wrapWithAudio(element, audioManager, overrides));
}

// Registry-mode GameShell consumes the app-level AudioManager, InputActionRegistry, and
// SetGameAssetManager contexts through throwing hooks (Invariant #83), so every registry-mode
// render mounts all three. Callers override the registry or the delegation setter when a test
// asserts against a specific instance.
function wrapWithAudio(
    element: React.ReactElement,
    audioManager = createAudioManagerSpy(),
    overrides: ShellContextOverrides = {},
): React.ReactElement {
    const inputRegistry = overrides.inputRegistry ?? createInputActionRegistry();
    const setGameAssetManager = overrides.setGameAssetManager ?? vi.fn();
    return (
        <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
            <InputActionRegistryContext.Provider value={inputRegistry}>
                <AudioManagerContext.Provider value={audioManager}>
                    {element}
                </AudioManagerContext.Provider>
            </InputActionRegistryContext.Provider>
        </SetGameAssetManagerContext.Provider>
    );
}

describe('SetGameAssetManagerContext delegation wiring', () => {
    it('registers the game AssetManager with the app-level delegate on mount and clears it on unmount', () => {
        const assetManager = createAssetManagerStub();
        const setGameAssetManager = vi.fn();
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });

        const { unmount } = renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div /> }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={assetManager}
            />,
            undefined,
            { setGameAssetManager },
        );

        expect(setGameAssetManager).toHaveBeenCalledWith(assetManager);

        unmount();

        expect(setGameAssetManager).toHaveBeenLastCalledWith(null);
    });

    it('has the delegate registered before a screen loads through it in its own mount effect', async () => {
        // A music bed is exactly this shape: `useSound` plays in a mount effect, and the
        // play resolves its clip through the APP-LEVEL delegating manager (Invariant
        // #64), not the one GameShell publishes to the subtree. React flushes passive
        // mount effects CHILDREN-FIRST, so a delegate registered in GameShell's own
        // passive effect arrives after the screen has already asked for the clip — the
        // same "provably too late" ordering `createAssetManager`'s JSDoc records for the
        // manifest. It only bites when the screen mounts in GameShell's own commit,
        // which is every mount after the first: a `React.lazy` screen suspends the
        // first time and mounts a commit late, then renders synchronously from the
        // resolved payload for the rest of the session.
        const clip = { id: 'ambience-bed' };
        const delegatingAssetManager = createDelegatingAssetManager();
        const gameAssetManager = createAssetManager(
            { resolve: (ref) => `resolved://${ref}` },
            {
                gameId: 'demo',
                entries: [{ ref: TEST_AUDIO_REF, kind: 'audio-clip', priority: 'deferred' }],
            },
            createAssetLoaderRegistry([
                { kind: 'audio-clip', load: async (): Promise<ResolvedAsset> => clip },
            ]),
        );
        const outcomes: unknown[] = [];

        function LoadingPlayfield(): React.ReactElement {
            React.useEffect(() => {
                void delegatingAssetManager.load(TEST_AUDIO_REF).then(
                    (asset) => outcomes.push(asset),
                    (error: unknown) =>
                        outcomes.push(error instanceof Error ? error.name : String(error)),
                );
            }, []);
            return <div />;
        }

        renderWithAudio(
            <GameShell
                registry={{ playfield: LoadingPlayfield }}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={gameAssetManager}
            />,
            undefined,
            { setGameAssetManager: (manager) => delegatingAssetManager.setDelegate(manager) },
        );
        await act(async () => {});

        // The clip itself, not merely "did not reject": a rejection here is
        // `NoActiveGameSessionError`, the delegating manager's honest answer to a load
        // made outside a match — so the failure mode is a correct diagnosis of the
        // wrong situation, and for audio it is silence with nothing logged at all.
        expect(outcomes).toEqual([clip]);
    });
});

function createAssetManagerStub(): AssetManager {
    return {
        registerManifest: vi.fn(),
        async preloadCritical(): Promise<void> {},
        get(): null {
            return null;
        },
        getManifestMetadata(): unknown {
            return undefined;
        },
        async load(): Promise<never> {
            throw new Error('unused asset manager stub');
        },
        dispose: vi.fn(),
    };
}

describe('GameShell saveGame capability threading', () => {
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
                    playfield: () => <div data-testid="registry-playfield" />,
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

describe('GameShell — manifest visible to first-commit loads (registry mode)', () => {
    const declaredRef = 'demo/textures/stone.webp' as AssetRef<TextureAsset>;
    const manifest: AssetManifest = {
        gameId: 'demo',
        entries: [{ ref: declaredRef, kind: 'texture', priority: 'deferred' }],
    };

    function createLoadCapturingPlayfield(): {
        readonly Playfield: (props: GameScreenProps) => React.ReactElement;
        readonly outcome: () => unknown;
    } {
        let captured: unknown = 'pending';
        function Playfield(_props: GameScreenProps): React.ReactElement {
            const manager = useAssetManager();
            React.useEffect(() => {
                manager.load(declaredRef).then(
                    (asset) => {
                        captured = { resolved: asset };
                    },
                    (error: unknown) => {
                        captured = error;
                    },
                );
            }, [manager]);
            return <div data-testid="load-capturing-playfield" />;
        }
        return { Playfield, outcome: () => captured };
    }

    it('a first-commit load with no injected manager fails on the unconfigured resolver, never on a missing manifest entry', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const { Playfield, outcome } = createLoadCapturingPlayfield();

        renderWithAudio(
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManifest={manifest}
            />,
        );
        await screen.findByTestId('load-capturing-playfield');
        await act(async () => {
            await Promise.resolve();
        });

        // React flushes passive effects children-first, so the playfield's
        // load runs before GameShell's backstop registerManifest effect. The
        // manifest must therefore already be registered at construction: the
        // fallback manager's load fails on its unconfigured resolver, which
        // proves the manifest entry check had already passed.
        expect(outcome()).toBeInstanceOf(Error);
        expect(outcome()).not.toBeInstanceOf(UnknownAssetManifestEntryError);
        expect((outcome() as Error).message).toMatch(/not configured/);
    });

    it('a first-commit load resolves through an injected manager constructed with the manifest', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const stubAsset = { id: 'stone-texture' };
        const manager = createAssetManager(
            { resolve: (ref) => `resolved://${ref}` },
            manifest,
            createAssetLoaderRegistry([
                { kind: 'texture', load: async (): Promise<ResolvedAsset> => stubAsset },
            ]),
        );
        const { Playfield, outcome } = createLoadCapturingPlayfield();

        renderWithAudio(
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={manager}
                assetManifest={manifest}
            />,
        );
        await screen.findByTestId('load-capturing-playfield');
        await act(async () => {
            await Promise.resolve();
        });

        expect(outcome()).toEqual({ resolved: stubAsset });
    });

    it('keeps a loaded asset alive when the backstop effect re-registers an equivalent manifest', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const disposeSpy = vi.fn();
        const stubAsset = { id: 'stone-texture', dispose: disposeSpy };
        const manager = createAssetManager(
            { resolve: (ref) => `resolved://${ref}` },
            manifest,
            createAssetLoaderRegistry([
                { kind: 'texture', load: async (): Promise<ResolvedAsset> => stubAsset },
            ]),
        );
        await manager.load(declaredRef);
        // A distinct-but-equivalent manifest object: the backstop effect must
        // treat it as a no-op (no eviction, no disposal).
        const equivalentManifest = JSON.parse(JSON.stringify(manifest)) as AssetManifest;

        renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div data-testid="retention-playfield" /> }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={manager}
                assetManifest={equivalentManifest}
            />,
        );
        await screen.findByTestId('retention-playfield');
        await act(async () => {
            await Promise.resolve();
        });

        expect(disposeSpy).not.toHaveBeenCalled();
        expect(manager.get(declaredRef)).toBe(stubAsset);
    });

    it('the backstop effect registers the manifest on an injected manager that was not constructed with it', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const manifestWithMetadata: AssetManifest = {
            gameId: 'demo',
            entries: [
                { ref: declaredRef, kind: 'texture', priority: 'deferred', metadata: { tag: 'a' } },
            ],
        };
        const manager = createAssetManager(
            { resolve: (ref) => `resolved://${ref}` },
            undefined,
            createAssetLoaderRegistry([
                { kind: 'texture', load: async (): Promise<ResolvedAsset> => ({ id: 'stone' }) },
            ]),
        );

        renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div data-testid="backstop-playfield" /> }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={manager}
                assetManifest={manifestWithMetadata}
            />,
        );
        await screen.findByTestId('backstop-playfield');
        await act(async () => {
            await Promise.resolve();
        });

        expect(manager.getManifestMetadata(declaredRef)).toEqual({ tag: 'a' });
    });

    it('rebuilds the fallback manager when the manifest identity changes and disposes the old one', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const observedManagers: AssetManager[] = [];
        function Playfield(_props: GameScreenProps): React.ReactElement {
            const manager = useAssetManager();
            if (observedManagers[observedManagers.length - 1] !== manager) {
                observedManagers.push(manager);
            }
            return <div data-testid="rebuild-playfield" />;
        }
        const audioManager = createAudioManagerSpy();
        const overrides = { setGameAssetManager: vi.fn() };
        const inequivalentManifest: AssetManifest = {
            gameId: 'demo',
            entries: [
                { ref: declaredRef, kind: 'texture', priority: 'deferred', metadata: { tag: 'b' } },
            ],
        };
        const shellFor = (activeManifest: AssetManifest): React.ReactElement => (
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManifest={activeManifest}
            />
        );

        const view = renderWithAudio(shellFor(manifest), audioManager, overrides);
        await screen.findByTestId('rebuild-playfield');
        const firstManager = observedManagers[0];
        if (firstManager === undefined) {
            throw new Error('Expected the fallback manager to be observed.');
        }
        const disposeSpy = vi.spyOn(firstManager, 'dispose');

        view.rerender(wrapWithAudio(shellFor(inequivalentManifest), audioManager, overrides));
        await act(async () => {
            await Promise.resolve();
        });

        const lastManager = observedManagers[observedManagers.length - 1];
        expect(observedManagers.length).toBeGreaterThan(1);
        expect(lastManager).not.toBe(firstManager);
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(lastManager?.getManifestMetadata(declaredRef)).toEqual({ tag: 'b' });
    });
});

describe('GameShell — StrictMode-root remount safety (registry mode)', () => {
    // StrictMode must be the ROOT element of the render: nested under any
    // provider it does not double-invoke effects in this environment, which
    // would leave every assertion here vacuously green — the outcome-count
    // positive controls below fail if the simulated remount stops happening.
    function renderAtStrictModeRoot(element: React.ReactElement): ReturnType<typeof baseRender> {
        return baseRender(
            <React.StrictMode>
                <I18nProvider>{wrapWithAudio(element)}</I18nProvider>
            </React.StrictMode>,
        );
    }

    const declaredRef = 'demo/textures/stone.webp' as AssetRef<TextureAsset>;
    const manifest: AssetManifest = {
        gameId: 'demo',
        entries: [{ ref: declaredRef, kind: 'texture', priority: 'deferred' }],
    };

    // Records EVERY load settlement, not only the last one: the two StrictMode
    // mounts each fire one load, and the failure mode under test is the second
    // mount's load rejecting after the between-mounts dispose emptied the
    // manifest.
    function createLoadRecordingPlayfield(): {
        readonly Playfield: (props: GameScreenProps) => React.ReactElement;
        readonly outcomes: () => readonly unknown[];
    } {
        const captured: unknown[] = [];
        function Playfield(_props: GameScreenProps): React.ReactElement {
            const manager = useAssetManager();
            React.useEffect(() => {
                manager.load(declaredRef).then(
                    (asset) => captured.push({ resolved: asset }),
                    (error: unknown) => captured.push(error),
                );
            }, [manager]);
            return <div data-testid="strict-mode-playfield" />;
        }
        return { Playfield, outcomes: () => captured };
    }

    it('never disposes an injected manager between simulated mounts, and both mount loads resolve', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const stubAsset = { id: 'stone-texture' };
        const manager = createAssetManager(
            { resolve: (ref) => `resolved://${ref}` },
            manifest,
            createAssetLoaderRegistry([
                { kind: 'texture', load: async (): Promise<ResolvedAsset> => stubAsset },
            ]),
        );
        const disposeSpy = vi.spyOn(manager, 'dispose');
        const { Playfield, outcomes } = createLoadRecordingPlayfield();

        const view = renderAtStrictModeRoot(
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={manager}
                assetManifest={manifest}
            />,
        );
        await screen.findByTestId('strict-mode-playfield');
        await act(async () => {
            await Promise.resolve();
        });

        expect(outcomes()).toHaveLength(2);
        expect(outcomes()).toEqual([{ resolved: stubAsset }, { resolved: stubAsset }]);
        expect(disposeSpy).not.toHaveBeenCalled();

        view.unmount();
        await act(async () => {
            await Promise.resolve();
        });

        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it('a second-mount load on the fallback manager still fails on the unconfigured resolver, never on a missing manifest entry', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const { Playfield, outcomes } = createLoadRecordingPlayfield();

        renderAtStrictModeRoot(
            <GameShell
                registry={{ playfield: Playfield }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManifest={manifest}
            />,
        );
        await screen.findByTestId('strict-mode-playfield');
        await act(async () => {
            await Promise.resolve();
        });

        expect(outcomes()).toHaveLength(2);
        for (const outcome of outcomes()) {
            expect(outcome).toBeInstanceOf(Error);
            expect(outcome).not.toBeInstanceOf(UnknownAssetManifestEntryError);
            expect((outcome as Error).message).toMatch(/not configured/);
        }
    });

    it('leaves the app-level delegate registered after the simulated remount', async () => {
        const snapshot = makePlayerSnapshot({ sceneId: makeSceneId('engine:game') });
        const assetManager = createAssetManagerStub();
        const registrations: (AssetManager | null)[] = [];

        baseRender(
            <React.StrictMode>
                <I18nProvider>
                    {wrapWithAudio(
                        <GameShell
                            registry={{
                                playfield: () => <div data-testid="strict-mode-playfield" />,
                            }}
                            snapshot={snapshot}
                            sendAction={vi.fn()}
                            localPlayerId={playerId('p1')}
                            assetManager={assetManager}
                        />,
                        undefined,
                        { setGameAssetManager: (manager) => registrations.push(manager) },
                    )}
                </I18nProvider>
            </React.StrictMode>,
        );
        await screen.findByTestId('strict-mode-playfield');

        // The simulated remount runs cleanup → setup with NO render between them, so
        // the render-phase registration cannot be what survives it: the positive
        // control is the `null` in the middle, which only a real double-invoke emits.
        expect(registrations).toContain(null);
        expect(registrations.at(-1)).toBe(assetManager);
    });
});

describe('GameShell — authoritative time dilation (registry mode)', () => {
    // The bridge is mounted inside the ONE `gameShell` expression both of
    // RegistryGameShell's return paths return, rather than beside
    // `<EventAudioPlayer>` in the fragment only the second path builds. The pair
    // of cases below is the mutation control for that: moving the mount into the
    // fragment reds the no-binding case and leaves the with-binding one green.
    const PLAYFIELD = (): React.ReactElement => <div data-testid="dilation-playfield" />;

    function currentTimeScale(): number {
        return useTimeScaleStore.getState().timeScale;
    }

    beforeEach(() => {
        useTimeScaleStore.getState().setAuthoritativePermille(undefined);
    });

    afterEach(() => {
        useTimeScaleStore.getState().setAuthoritativePermille(undefined);
    });

    it('propagates the dilated scale for a registry that declares NO event audio binding', () => {
        const snapshot = makePlayerSnapshot({ timeScalePermille: 250 });

        renderWithAudio(
            <GameShell
                registry={{ playfield: PLAYFIELD }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        // The blank scaffold is exactly this shape, so a bridge mounted beside
        // the audio player would leave authoritative dilation dead for it while
        // the host ticker still re-paced the match.
        expect(eventAudioPlayerSpy).not.toHaveBeenCalled();
        expect(currentTimeScale()).toBe(0.25);
    });

    it('propagates the dilated scale for a registry that DOES declare one', () => {
        const snapshot = makePlayerSnapshot({ timeScalePermille: 250 });

        renderWithAudio(
            <GameShell
                registry={{
                    playfield: PLAYFIELD,
                    eventAudioBinding: {
                        'combat:hit': { ref: TEST_AUDIO_REF, bus: 'sfx', volume: 0.5 },
                    },
                }}
                snapshot={snapshot}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        expect(eventAudioPlayerSpy).toHaveBeenCalledTimes(1);
        expect(currentTimeScale()).toBe(0.25);
    });

    it('seats real time for an undilated snapshot', () => {
        // Pre-dilated, so the assertion below distinguishes "seated real time"
        // from "never wrote at all" — the store's own default is 1.
        useTimeScaleStore.getState().setAuthoritativePermille(250);

        renderWithAudio(
            <GameShell
                registry={{ playfield: PLAYFIELD }}
                snapshot={makePlayerSnapshot()}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );

        expect(currentTimeScale()).toBe(1);
    });

    it('re-seats the scale when a later snapshot changes it', () => {
        const { rerender } = renderWithAudio(
            <GameShell
                registry={{ playfield: PLAYFIELD }}
                snapshot={makePlayerSnapshot({ timeScalePermille: 250 })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
            />,
        );
        expect(currentTimeScale()).toBe(0.25);

        rerender(
            wrapWithAudio(
                <GameShell
                    registry={{ playfield: PLAYFIELD }}
                    snapshot={makePlayerSnapshot({ tick: 2 })}
                    sendAction={vi.fn()}
                    localPlayerId={playerId('p1')}
                />,
            ),
        );

        expect(currentTimeScale()).toBe(1);
    });
});

describe('GameShell — critical asset preload (registry mode)', () => {
    const criticalRef = 'demo/audio/music/bed.wav' as AssetRef<AudioClipAsset>;
    const deferredRef = 'demo/textures/stone.webp' as AssetRef<TextureAsset>;
    const manifest: AssetManifest = {
        gameId: 'demo',
        entries: [
            { ref: criticalRef, kind: 'audio-clip', priority: 'critical' },
            { ref: deferredRef, kind: 'texture', priority: 'deferred' },
        ],
    };

    /**
     * A manager over a recording loader. Assertions read the refs the loader
     * was asked for, so "preloaded the critical entry" is a load that actually
     * reached a loader — not a `preloadCritical` call that could have filtered
     * to nothing.
     */
    function createRecordingManager(): {
        readonly assetManager: AssetManager;
        readonly loadedRefs: string[];
    } {
        const loadedRefs: string[] = [];
        const record = async (request: { readonly ref: string }): Promise<ResolvedAsset> => {
            loadedRefs.push(String(request.ref));
            return { id: request.ref };
        };
        return {
            assetManager: createAssetManager(
                { resolve: (ref) => `resolved://${ref}` },
                manifest,
                createAssetLoaderRegistry([
                    { kind: 'audio-clip', load: record },
                    { kind: 'texture', load: record },
                ]),
            ),
            loadedRefs,
        };
    }

    afterEach(() => {
        Reflect.deleteProperty(globalThis, '__chimera');
    });

    it('preloads the critical entries of the injected manifest and leaves the deferred ones on demand', async () => {
        const { assetManager, loadedRefs } = createRecordingManager();

        renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div data-testid="registry-playfield" /> }}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={assetManager}
                assetManifest={manifest}
            />,
        );
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        expect(loadedRefs).toEqual([criticalRef]);
        expect(assetManager.get(criticalRef)).not.toBeNull();
        expect(assetManager.get(deferredRef)).toBeNull();
    });

    it('loads nothing when the manifest declares no critical entry', async () => {
        const deferredOnly: AssetManifest = {
            gameId: 'demo',
            entries: [{ ref: deferredRef, kind: 'texture', priority: 'deferred' }],
        };
        const loadedRefs: string[] = [];
        const assetManager = createAssetManager(
            { resolve: (ref) => `resolved://${ref}` },
            deferredOnly,
            createAssetLoaderRegistry([
                {
                    kind: 'texture',
                    load: async (request): Promise<ResolvedAsset> => {
                        loadedRefs.push(String(request.ref));
                        return { id: request.ref };
                    },
                },
            ]),
        );

        renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div data-testid="registry-playfield" /> }}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={assetManager}
                assetManifest={deferredOnly}
            />,
        );
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        expect(loadedRefs).toEqual([]);
    });

    it('reports the unconfigured resolver when a critical manifest arrives with no injected manager', async () => {
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };

        renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div data-testid="registry-playfield" /> }}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManifest={manifest}
            />,
        );
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        // Declaring a critical asset while injecting no manager is a wiring
        // mistake nothing else surfaces — the fallback manager's resolver
        // throws for every ref, so the game's critical assets can never load.
        // The shell still renders; the report is the only trace.
        expect(screen.getByTestId('registry-playfield')).toBeTruthy();
        expect(logs.emitCalls).toHaveLength(1);
        expect(logs.emitCalls[0]?.source.module).toBe('asset-preload');
        expect(logs.emitCalls[0]?.error?.message).toMatch(/not configured/);
    });
});

describe('GameShell — scene preload manifest forwarding (registry mode)', () => {
    const sceneRef = 'demo/textures/arena.webp' as AssetRef<TextureAsset>;
    const manifest: AssetManifest = {
        gameId: 'demo',
        entries: [{ ref: sceneRef, kind: 'texture', priority: 'deferred' }],
    };

    it('forwards its assetManifest to SceneRouter, so a scene preload can run', async () => {
        const injected = createStubAssetManager({ [String(sceneRef)]: 'hang' });

        renderWithAudio(
            <GameShell
                registry={{ playfield: () => <div data-testid="registry-playfield" /> }}
                snapshot={makePlayerSnapshot({
                    sceneId: makeSceneId('engine:game'),
                    sceneTransition: {
                        toSceneId: makeSceneId('engine:post-game'),
                        phase: 'preparing',
                        startedAtTick: 1,
                        params: {},
                        playersReady: [],
                        requiredAssets: [sceneRef],
                    },
                })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                assetManager={injected}
                assetManifest={manifest}
                fadeOutMs={0}
                fadeInMs={0}
            />,
        );
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 0);
            });
        });

        // The run PROMOTES the scene's declared refs before registering, so a
        // `'critical'` entry for this ref is the fingerprint of a preload that
        // actually received a manifest — the shell's own backstop registration
        // re-registers the manifest verbatim, entry priorities untouched.
        const promoted = injected.registered.filter((registered) =>
            registered.entries.some(
                (entry) => entry.ref === sceneRef && entry.priority === 'critical',
            ),
        );
        expect(promoted).toHaveLength(1);
    });
});

describe('GameShell minimum-visible hold occlusion threading', () => {
    function makeControlledScreen(testId: string): {
        readonly Screen: React.LazyExoticComponent<React.ComponentType<GameScreenProps>>;
        resolve(): void;
    } {
        let resolveModule: (() => void) | undefined;
        const Screen = React.lazy(
            () =>
                new Promise<{ default: React.ComponentType<GameScreenProps> }>((res) => {
                    resolveModule = () => {
                        res({ default: () => <div data-testid={testId} /> });
                    };
                }),
        );
        return { Screen, resolve: () => resolveModule?.() };
    }

    function holdRegistry(Screen: GameScreenComponent<GameScreenProps>): GameScreenRegistry {
        return {
            playfield: Screen,
            loadingScreen: 'spinner',
            loadingScreenMinVisibleMs: 60_000,
        };
    }

    async function resolveAndFlush(resolve: () => void): Promise<void> {
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await new Promise((r) => {
                setTimeout(r, 0);
            });
        });
    }

    it('holds a resolved code cover when nothing above occludes it (control)', async () => {
        const { Screen, resolve } = makeControlledScreen('lazy-playfield');

        renderWithAudio(
            <GameShell
                registry={holdRegistry(Screen)}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                fadeOutMs={0}
                fadeInMs={0}
            />,
        );
        await resolveAndFlush(resolve);

        expect(screen.getByTestId('lazy-playfield')).toBeTruthy();
        expect(screen.getByTestId('scene-held-cover')).toBeTruthy();
    });

    it('forwards sceneCoverOccluded to SceneRouter, so an occluded cover holds nothing', async () => {
        const { Screen, resolve } = makeControlledScreen('lazy-playfield');

        renderWithAudio(
            <GameShell
                registry={holdRegistry(Screen)}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                fadeOutMs={0}
                fadeInMs={0}
                sceneCoverOccluded={true}
            />,
        );
        await resolveAndFlush(resolve);

        expect(screen.getByTestId('lazy-playfield')).toBeTruthy();
        expect(screen.queryByTestId('scene-held-cover')).toBeNull();
    });
});

describe('GameShell reveal seam', () => {
    function revealRegistry(): GameScreenRegistry {
        return { playfield: () => <div data-testid="seam-playfield" /> };
    }

    // Named rather than `Record<string, unknown>`: a wide spread satisfies JSX
    // where a literal would be excess-property checked, so a misspelt seam prop
    // would compile and every case below would pass while measuring nothing.
    // Spread per property for the same reason `GameShell` does it — under
    // `exactOptionalPropertyTypes` an optional cannot be handed an explicit
    // `undefined`.
    interface SeamOverrides {
        readonly hudMounted?: boolean;
        readonly revealPhase?: string;
    }

    function renderSeam(overrides: SeamOverrides = {}): ReturnType<typeof render> {
        return renderWithAudio(
            <GameShell
                registry={revealRegistry()}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                fadeOutMs={0}
                fadeInMs={0}
                {...(overrides.hudMounted === undefined
                    ? {}
                    : { hudMounted: overrides.hudMounted })}
                {...(overrides.revealPhase === undefined
                    ? {}
                    : { revealPhase: overrides.revealPhase })}
            />,
        );
    }

    it('mounts the HUD row by default, so every existing caller is unchanged', () => {
        // The control for the whole describe: without it, a seam that mounted
        // nothing would satisfy every absence assertion below.
        renderSeam();

        expect(screen.getByTestId('game-hud-slot')).toBeTruthy();
    });

    it('leaves the HUD row out of the DOM entirely while unrevealed', () => {
        // Absent, not hidden. A seam that merely made the row invisible would
        // still run its effects — timers, sounds, focus — behind the loading
        // screen, and would still take its grid row.
        renderSeam({ hudMounted: false });

        expect(screen.queryByTestId('game-hud-slot')).toBeNull();
    });

    it('keeps the scene mounted while the HUD is withheld', () => {
        // The seam defers presentation, never the mount: the canvas subtree
        // warms up under the curtain, and GameShell stays the unique disposer
        // of a page-injected AssetManager (Invariant #21).
        renderSeam({ hudMounted: false });

        expect(screen.getByTestId('seam-playfield')).toBeTruthy();
        expect(screen.getByTestId('game-canvas')).toBeTruthy();
    });

    it('keeps the diagnostics HUD mounted while the game HUD is withheld', () => {
        // PerfHud self-gates on its own setting and is what the perf specs
        // sample; deferring it with the game's HUD would make a diagnostic
        // depend on the presentation it exists to measure. The debug toggle
        // rides along for the same reason.
        renderSeam({ hudMounted: false });

        expect(screen.getByTestId('perf-hud-mock')).toBeTruthy();
        expect(screen.getByTestId('debug-inspector-toggle-mock')).toBeTruthy();
    });

    it('withholds the spectator HUD with the game HUD', () => {
        // It is part of the same row of match chrome a player would otherwise
        // watch assemble itself beside a loading screen.
        renderSeam({ hudMounted: false });

        expect(screen.queryByTestId('spectator-hud-mock')).toBeNull();
    });

    it('withholds the in-game menu host while unrevealed', () => {
        // An invisible modal under a black curtain that still captures the
        // Escape stack is worse than no menu at all. Asserted on the spy
        // rather than the DOM: the host renders null once mounted, so its
        // absence from the tree proves nothing on its own.
        inGameMenuHostSpy.mockClear();

        renderSeam({ hudMounted: false });

        expect(inGameMenuHostSpy).not.toHaveBeenCalled();
    });

    it('mounts the in-game menu host once revealed (the control for the case above)', () => {
        inGameMenuHostSpy.mockClear();

        renderSeam();

        expect(inGameMenuHostSpy).toHaveBeenCalled();
    });

    it('publishes the reveal phase for the recorded e2e timeline', () => {
        renderSeam({ revealPhase: 'loading' });

        expect(screen.getByTestId('game-shell-root').getAttribute('data-reveal-phase')).toBe(
            'loading',
        );
    });

    it('writes no reveal-phase attribute when the caller publishes none', () => {
        renderSeam();

        expect(screen.getByTestId('game-shell-root').hasAttribute('data-reveal-phase')).toBe(false);
    });

    it('republishes the reveal phase as the beat advances', () => {
        // The timeline recorder reads this attribute on mutation, so a value
        // that only ever landed on the first render would record one phase and
        // miss the sequence it exists to show.
        const { rerender } = renderSeam({ revealPhase: 'loading' });

        rerender(
            wrapWithAudio(
                <GameShell
                    registry={revealRegistry()}
                    snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                    sendAction={vi.fn()}
                    localPlayerId={playerId('p1')}
                    fadeOutMs={0}
                    fadeInMs={0}
                    revealPhase="revealed"
                />,
            ),
        );

        expect(screen.getByTestId('game-shell-root').getAttribute('data-reveal-phase')).toBe(
            'revealed',
        );
    });

    function makeSuspendingScreen(): {
        readonly Screen: React.LazyExoticComponent<React.ComponentType<GameScreenProps>>;
        resolve(): void;
    } {
        let resolveModule: (() => void) | undefined;
        const Screen = React.lazy(
            () =>
                new Promise<{ default: React.ComponentType<GameScreenProps> }>((res) => {
                    resolveModule = () => {
                        res({ default: () => <div data-testid="pending-playfield" /> });
                    };
                }),
        );
        return { Screen, resolve: () => resolveModule?.() };
    }

    async function settleChunk(resolve: () => void): Promise<void> {
        await act(async () => {
            resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await new Promise((r) => {
                setTimeout(r, 0);
            });
        });
    }

    it('reports a suspending screen chunk, and its resolution, in that order', async () => {
        // The asset gate can be ready while the screen's own chunk is still in
        // flight. A beat that revealed on the gate alone would land the player
        // on the fallback rather than on the screen, so it needs this wait too.
        //
        // The SEQUENCE is the assertion, not membership. The reporter sits
        // above the wrapper that owns the fallback's mount, so its effect runs
        // after that wrapper's — a reporter that announced every render would
        // lead with "not pending" while the fallback was already on screen,
        // and `toHaveBeenCalledWith(true)` would still be satisfied.
        const { Screen, resolve } = makeSuspendingScreen();
        const reported: boolean[] = [];

        renderWithAudio(
            <GameShell
                registry={{ playfield: Screen }}
                snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                sendAction={vi.fn()}
                localPlayerId={playerId('p1')}
                fadeOutMs={0}
                fadeInMs={0}
                onScenePending={(pending) => reported.push(pending)}
            />,
        );

        await act(async () => {
            await Promise.resolve();
        });
        expect(reported).toEqual([true]);

        await settleChunk(resolve);

        expect(reported).toEqual([true, false]);
        expect(screen.getByTestId('pending-playfield')).toBeTruthy();
    });

    it('reports to the caller’s current callback, not the one it first mounted with', async () => {
        // The reporter is held in a ref refreshed each render precisely so a
        // callback whose identity changes per render — which is what an inline
        // arrow gives — does not re-fire the effect. Refreshing is what makes
        // that safe: without it the ref keeps its first value and the report
        // goes to a callback the caller has already replaced.
        const { Screen, resolve } = makeSuspendingScreen();
        const first: boolean[] = [];
        const second: boolean[] = [];

        function Harness({ sink }: { sink: boolean[] }): React.ReactElement {
            return (
                <GameShell
                    registry={{ playfield: Screen }}
                    snapshot={makePlayerSnapshot({ sceneId: makeSceneId('engine:game') })}
                    sendAction={vi.fn()}
                    localPlayerId={playerId('p1')}
                    fadeOutMs={0}
                    fadeInMs={0}
                    onScenePending={(pending) => sink.push(pending)}
                />
            );
        }

        const { rerender } = renderWithAudio(<Harness sink={first} />);
        await act(async () => {
            await Promise.resolve();
        });

        rerender(wrapWithAudio(<Harness sink={second} />));
        await settleChunk(resolve);

        // The suspend reached the first callback; the resolve reached the second.
        expect(first).toEqual([true]);
        expect(second).toEqual([false]);
    });
});
