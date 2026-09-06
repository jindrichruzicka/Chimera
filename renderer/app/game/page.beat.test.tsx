// @vitest-environment jsdom
// renderer/app/game/page.beat.test.tsx
//
// What a BEAT costs the match tree.
//
// Deliberately mounts the REAL `gameStore`, unlike the sibling `page.test.tsx`
// whose module double answers a selector without ever notifying a subscriber:
// a clock-only beat is a store `set`, and only a real store can say which
// components it woke. `applyTick` is exactly what `ipcClient` calls on the
// host's clock-only push.
//
// Architecture reference: §4.4 — Renderer State Stores
//
// Invariants upheld:
//   #3  — Only PlayerSnapshot enters the store.
//   #4  — Dispatch still goes through the page's `sendAction` wrapper; this
//          file pins its IDENTITY, never a new write path.

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type EngineAction,
    type LobbyState,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameHudProps,
    GameScreenProps,
    GameScreenRegistry,
    SendAction,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { I18nProvider } from '../../i18n/I18nProvider';
import { SCENE_READY_RETRY_MS } from '../../components/scene/useFadeTransition.js';
import { useGameStore } from '../../state/gameStore';
import { snapshotPacingEnabled } from '../../state/snapshotPacing';
import { useToastStore } from '../../state/toastStore';
import { useUiStore } from '../../state/uiStore';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { Providers } from '../providers';
import GamePage from './page';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockReplace = vi.fn();
const mockSendAction = vi.fn();
let mockLobbyState: LobbyState | null = null;

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('../../state/saveStore', () => ({
    useSaveStore: Object.assign(
        (selector: (state: { readonly restoreAbortPending: boolean }) => unknown) =>
            selector({ restoreAbortPending: false }),
        { getState: () => ({ clearRestoreAbort: vi.fn() }) },
    ),
}));

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: Object.assign(
        (
            selector: (state: {
                readonly localPlayerId: string | null;
                readonly role: 'player' | 'spectator';
                readonly leavingToMainMenu: boolean;
            }) => unknown,
        ) => selector({ localPlayerId: 'p1', role: 'player', leavingToMainMenu: false }),
        {
            getState: () => ({
                setLeavingToMainMenu: vi.fn(),
                clearLocalLobbyContext: vi.fn(),
            }),
        },
    ),
    useIsSpectator: () => false,
}));

vi.mock('../../state/lobbyStore', () => ({
    useLobbyStore: (
        selector: (state: {
            readonly lobbyState: LobbyState | null;
            readonly hasLoadedInitialState: boolean;
        }) => unknown,
    ) => selector({ lobbyState: mockLobbyState, hasLoadedInitialState: true }),
}));

vi.mock('../../bridge/useSendAction', () => ({
    useSendAction: () => mockSendAction,
}));

const loadRendererGameMock = vi.hoisted(() => vi.fn());
vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGame: loadRendererGameMock,
}));

vi.mock('../../input/useInputAction.js', () => ({
    useInputAction: () => undefined,
}));

// ── Recorders ─────────────────────────────────────────────────────────────────

/** Every `sendAction` identity the game screen was rendered with, in order. */
const screenSendActions: SendAction[] = [];
/** Every tick the HUD was rendered with, in order. */
const hudTicks: number[] = [];

const testRegistry: GameScreenRegistry = {
    playfield: ({ snapshot, sendAction }: GameScreenProps) => {
        screenSendActions.push(sendAction);
        return (
            <div data-testid="test-playfield" data-tick={snapshot.tick}>
                <button
                    data-testid="dispatch-gameplay"
                    type="button"
                    onClick={() =>
                        sendAction({
                            type: 'game:move',
                            playerId: playerId('p1'),
                            // Deliberately the SNAPSHOT's tick, which on a
                            // clock-only beat is older than the clock: what the
                            // envelope carries must be the page's answer, not
                            // this one.
                            tick: snapshot.tick,
                            payload: {},
                        })
                    }
                >
                    Move
                </button>
            </div>
        );
    },
    hud: ({ tick }: GameHudProps) => {
        hudTicks.push(tick);
        return <output data-testid="hud-tick">{tick}</output>;
    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    const id = playerId('p1');
    return {
        tick: 5,
        viewerId: id,
        players: { [id]: { id } },
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

function makeLobbyState(): LobbyState {
    return {
        info: { sessionId: 'session-1', hostId: 'p1', gameId: 'test-game' },
        players: [{ playerId: 'p1', displayName: 'Player One', ready: true }],
    };
}

/**
 * Mounts the route and settles the reveal gate.
 *
 * The drain is entered INSIDE `act` before the gate's promise microtask, which
 * is what keeps the beat readable on the first commit (see the sibling
 * fade-gate spec) — a polled read would only prove the commit it happened to
 * observe.
 */
async function mountGamePage(): Promise<void> {
    render(
        <I18nProvider>
            <Providers>
                <ThemeProvider>
                    <GamePage />
                </ThemeProvider>
            </Providers>
        </I18nProvider>,
    );
    await act(async () => {
        await Promise.resolve();
    });
    await screen.findByTestId('test-playfield');
}

/** The shipped realtime beat period (10 Hz), as `apps/action` declares it. */
const BEAT_MS = 100;

async function sleep(ms: number): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, ms);
        });
    });
}

/** One clock-only beat: the host advanced the tick and re-sent no snapshot. */
function beat(tick: number): void {
    act(() => {
        useGameStore.getState().applyTick(tick);
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockLobbyState = makeLobbyState();
    mockSendAction.mockReset();
    mockReplace.mockReset();
    loadRendererGameMock.mockReset();
    loadRendererGameMock.mockResolvedValue({ registry: testRegistry });
    screenSendActions.length = 0;
    hudTicks.length = 0;
    useGameStore.getState().reset();
    useUiStore.getState().resetScreenNavigation();
    useToastStore.getState().dismissAll();
    window.history.replaceState({}, '', '/game');
    act(() => {
        useGameStore.getState().applySnapshot(makeSnapshot());
    });
});

afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useGameStore.getState().reset();
});

describe('GamePage under a clock-only beat stream', () => {
    it('does not re-render the game screen, however many beats arrive', async () => {
        await mountGamePage();
        const rendersAtRest = screenSendActions.length;

        for (let i = 1; i <= 8; i += 1) {
            beat(5 + i);
        }

        // The count must not grow WITH N — asserted against the beat count
        // itself, not against a literal, so a fix that merely halved the
        // cascade could not pass.
        expect(screenSendActions.length).toBe(rendersAtRest);
    });

    it('keeps sendAction identity across clock-only beats and across a snapshot beat', async () => {
        await mountGamePage();
        const atRest = screenSendActions.at(-1);

        beat(6);
        beat(7);
        act(() => {
            useGameStore.getState().applySnapshot(makeSnapshot({ tick: 8 }));
        });

        expect(screenSendActions.at(-1)).toBe(atRest);
        // A snapshot beat DOES re-render the screen — that is the whole point
        // of a snapshot — so the identity above is a real re-render's prop,
        // not a subtree that never woke.
        expect(screenSendActions.length).toBeGreaterThan(1);
    });

    it('still shows the newest tick in the HUD', async () => {
        await mountGamePage();

        beat(11);

        expect(hudTicks.at(-1)).toBe(11);
        expect(await screen.findByTestId('hud-tick')).toHaveTextContent('11');
    });

    it('stamps the CURRENT clock on a dispatched action, not the tick of the last render', async () => {
        await mountGamePage();

        beat(42);
        fireEvent.click(screen.getByTestId('dispatch-gameplay'));

        expect(dispatchedActions().at(-1)?.tick).toBe(42);
    });

    it('stops dispatching gameplay once a LATER snapshot ends the match', async () => {
        // `sendAction` reads the snapshot off a ref rather than a closure now.
        // A closure pinned to `[isSpectator, sendActionToHost]` would still be
        // holding the PLAYING snapshot here, and the terminal gate — the one
        // that stops a resolved match accepting gameplay — would wave this
        // through.
        await mountGamePage();

        act(() => {
            useGameStore.getState().applySnapshot(
                makeSnapshot({
                    tick: 9,
                    phase: gamePhase('ended'),
                    gameResult: { winnerIds: [playerId('p1')] },
                }),
            );
        });
        fireEvent.click(screen.getByTestId('dispatch-gameplay'));

        expect(dispatchedActions().filter((a) => a.type === 'game:move')).toHaveLength(0);
    });

    it('leaves the scene-ready retry cadence armed long enough to fire', async () => {
        // The cadence is a 1 s interval whose effect lists `dispatchReadyIfNeeded`
        // — pinned to `sendAction`. A `sendAction` re-created per beat clears and
        // re-arms that interval every 100 ms, so under a realtime tick stream it
        // never reaches its own period and a lost ack is never re-sent.
        //
        // REAL timers, deliberately: the interval is armed by an effect at mount,
        // and a fake clock installed after that mount can never drive a handle
        // the real one owns. The beats below arrive the same 100 ms apart the
        // shipped 10 Hz ticker sends them.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        act(() => {
            useGameStore.getState().applySnapshot(
                makeSnapshot({
                    sceneTransition: {
                        toSceneId: makeSceneId('engine:post-game'),
                        phase: 'preparing',
                        startedAtTick: 2,
                        params: {},
                        playersReady: [],
                    },
                }),
            );
        });
        await mountGamePage();
        // Past the fade-out and the (empty) preload, so the first ack is out and
        // the cadence's own guard — "the chain completed once" — is satisfied.
        await waitFor(() => {
            expect(sceneReadyAckCount()).toBeGreaterThan(0);
        });
        const acksBeforeCadence = sceneReadyAckCount();

        // A 10 Hz beat stream spanning one whole retry period, plus slack.
        const beatsPerRetryPeriod = Math.ceil(SCENE_READY_RETRY_MS / BEAT_MS);
        for (let i = 1; i <= beatsPerRetryPeriod + 2; i += 1) {
            await sleep(BEAT_MS);
            beat(5 + i);
        }

        expect(sceneReadyAckCount()).toBeGreaterThan(acksBeforeCadence);
    });
});

function sceneReadyAckCount(): number {
    return dispatchedActions().filter((action) => action.type === 'engine:scene_ready').length;
}

function dispatchedActions(): readonly EngineAction[] {
    return mockSendAction.mock.calls.map((call) => call[0] as EngineAction);
}

describe('GamePage — publishing the active game snapshot pacing', () => {
    it('turns pacing ON while a game that declares realtime is mounted', async () => {
        loadRendererGameMock.mockResolvedValue({ registry: testRegistry, realtime: true });

        await mountGamePage();

        expect(snapshotPacingEnabled()).toBe(true);
    });

    it('leaves pacing OFF for a game that declares itself turn-based', async () => {
        loadRendererGameMock.mockResolvedValue({ registry: testRegistry, realtime: false });

        await mountGamePage();

        expect(snapshotPacingEnabled()).toBe(false);
    });

    it('leaves pacing OFF for a game that declares nothing', async () => {
        // Absent is the pre-declaration answer: apply on arrival.
        loadRendererGameMock.mockResolvedValue({ registry: testRegistry });

        await mountGamePage();

        expect(snapshotPacingEnabled()).toBe(false);
    });

    it('clears pacing when the route unmounts', async () => {
        // Outside a match no game's declaration still applies, and the client
        // that reads this store outlives the route.
        loadRendererGameMock.mockResolvedValue({ registry: testRegistry, realtime: true });
        await mountGamePage();
        expect(snapshotPacingEnabled()).toBe(true);

        cleanup();

        expect(snapshotPacingEnabled()).toBe(false);
    });
});
