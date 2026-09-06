// @vitest-environment jsdom
// renderer/components/shell/GameShell.beat.test.tsx
//
// Where the shell reads the match clock, and what a parent re-render costs the
// tree below it.
//
// Uses the REAL game store: the `tick` prop's absence MEANS "read the live
// clock", so a double that answers a selector without holding state could not
// tell the two sources apart.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameHudProps,
    GameScreenProps,
    GameScreenRegistry,
    SendAction,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { Providers } from '../../app/providers.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { useGameStore } from '../../state/gameStore.js';
import { useUiStore } from '../../state/uiStore.js';
import { ThemeProvider } from '../../theme/ThemeProvider.js';
import { GameShell } from './GameShell.js';

const LOCAL_PLAYER = playerId('local-player');
const SEND_ACTION: SendAction = vi.fn();

let screenRenders = 0;

const registry: GameScreenRegistry = {
    playfield: ({ snapshot }: GameScreenProps) => {
        screenRenders += 1;
        return <div data-testid="playfield-screen" data-tick={snapshot.tick} />;
    },
    hud: ({ tick }: GameHudProps) => <output data-testid="hud-tick">{tick}</output>,
};

function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick: 3,
        viewerId: LOCAL_PLAYER,
        players: { [LOCAL_PLAYER]: { id: LOCAL_PLAYER } },
        entities: {},
        phase: gamePhase('playing'),
        sceneId: makeSceneId('engine:game'),
        sceneTransition: null,
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}

const SNAPSHOT = makeSnapshot();

/**
 * Registry-mode `GameShell` reaches the app-level audio, input, input-manager
 * and asset-delegation contexts through throwing hooks (Invariant #83), so
 * every render here mounts the real app root rather than four hand-built
 * doubles that would drift from it.
 */
function wrapShell(element: React.ReactElement): React.ReactElement {
    return (
        <I18nProvider>
            <Providers>
                <ThemeProvider>{element}</ThemeProvider>
            </Providers>
        </I18nProvider>
    );
}

function renderShell(currentTick?: number): ReturnType<typeof render> {
    return render(
        wrapShell(
            <GameShell
                registry={registry}
                snapshot={SNAPSHOT}
                sendAction={SEND_ACTION}
                localPlayerId={LOCAL_PLAYER}
                {...(currentTick === undefined ? {} : { currentTick })}
            />,
        ),
    );
}

beforeEach(() => {
    screenRenders = 0;
    useGameStore.getState().reset();
    useUiStore.getState().resetScreenNavigation();
});

afterEach(() => {
    cleanup();
    useGameStore.getState().reset();
});

describe('GameShell — where the HUD clock comes from', () => {
    it('reads the live store clock when no tick is passed', async () => {
        act(() => {
            useGameStore.getState().applySnapshot(makeSnapshot({ tick: 3 }));
            useGameStore.getState().applyTick(17);
        });

        renderShell();

        expect(await screen.findByTestId('hud-tick')).toHaveTextContent('17');
    });

    it('lets an explicit tick WIN over the live store clock', async () => {
        // The replay player's clock is its own. A live store left holding the
        // last match would otherwise overwrite it on screen.
        act(() => {
            useGameStore.getState().applySnapshot(makeSnapshot({ tick: 3 }));
            useGameStore.getState().applyTick(17);
        });

        renderShell(4);

        expect(await screen.findByTestId('hud-tick')).toHaveTextContent('4');
    });

    it('falls back to the rendered snapshot tick when the store holds no match', async () => {
        // Absence of a match is NOT tick 0: an empty store must not report the
        // match as having just started.
        renderShell();

        expect(await screen.findByTestId('hud-tick')).toHaveTextContent('3');
    });
});

describe('GameShell — what a parent re-render costs the game screen', () => {
    // The SCREEN's bail-out specifically. Whether the router itself also bails
    // is a separate property, measured in `SceneRouter.memo.test.tsx` — this
    // test passes on the screen memo alone and cannot see the router's.
    it('does not re-render the game screen when nothing it reads changed', async () => {
        function Parent(): React.ReactElement {
            const [, setBump] = React.useState(0);
            return (
                <>
                    <button data-testid="bump" type="button" onClick={() => setBump((n) => n + 1)}>
                        Bump
                    </button>
                    <GameShell
                        registry={registry}
                        snapshot={SNAPSHOT}
                        sendAction={SEND_ACTION}
                        localPlayerId={LOCAL_PLAYER}
                    />
                </>
            );
        }

        render(wrapShell(<Parent />));
        await screen.findByTestId('playfield-screen');
        const rendersAtRest = screenRenders;

        act(() => {
            screen.getByTestId('bump').click();
        });
        act(() => {
            screen.getByTestId('bump').click();
        });

        expect(screenRenders).toBe(rendersAtRest);
    });
});
