// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamePhase, playerId, type PlayerSnapshot } from '@chimera/electron/preload/api-types.js';
import { FadeContext, FadeProvider, type FadeControl } from '../shell/FadeContext.js';
import { useFadeTransition } from './useFadeTransition.js';

const LOCAL_PLAYER = playerId('local-player');

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
        return globalThis.setTimeout(() => {
            callback(Date.now());
        }, 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
        globalThis.clearTimeout(frameId);
    });
});

describe('useFadeTransition', () => {
    it('dispatches engine:scene_ready only after fade-out completes', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        render(
            <FadeProvider>
                <Harness />
            </FadeProvider>,
        );

        expect(sendAction).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(31);
        expect(sendAction).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(sendAction).toHaveBeenCalledWith({
            type: 'engine:scene_ready',
            playerId: LOCAL_PLAYER,
            tick: snapshot.tick,
            payload: { playerId: LOCAL_PLAYER },
        });
    });

    it('does not dispatch scene_ready when this player already acknowledged', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [LOCAL_PLAYER],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 1,
                fadeInMs: 1,
            });
            return <div />;
        }

        render(
            <FadeProvider>
                <Harness />
            </FadeProvider>,
        );
        await vi.advanceTimersByTimeAsync(1);

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('does not restart fade-out when another player becomes ready mid-transition', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const FADE_MS = 32;

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: FADE_MS,
                fadeInMs: FADE_MS,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        // Fade started. Advance 24ms — not yet complete.
        await vi.advanceTimersByTimeAsync(24);
        expect(sendAction).not.toHaveBeenCalled();

        // Another player becomes ready: tick advances, playersReady changes.
        // This must NOT cancel and restart the local player's in-flight fade.
        rerender(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 4,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [playerId('other-player')],
                        },
                    })}
                />
            </FadeProvider>,
        );

        // 8ms more — the original 32ms fade should now be complete.
        await vi.advanceTimersByTimeAsync(8);

        // scene_ready must fire exactly once (fade was NOT restarted).
        expect(sendAction).toHaveBeenCalledOnce();
        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'engine:scene_ready', playerId: LOCAL_PLAYER }),
        );
    });

    it('retries scene_ready on newer tick when zero-duration fade sent a stale acknowledgement', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 0,
                fadeInMs: 0,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.runAllTimersAsync();

        expect(sendAction).toHaveBeenCalledTimes(1);
        expect(sendAction).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ type: 'engine:scene_ready', tick: 3 }),
        );

        // Host accepted another player's ready, so the transition tick advanced,
        // but this local player is still missing from playersReady.
        rerender(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 4,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [playerId('other-player')],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.runAllTimersAsync();

        expect(sendAction).toHaveBeenCalledTimes(2);
        expect(sendAction).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ type: 'engine:scene_ready', tick: 4 }),
        );
    });

    it('does not trigger repeated fadeIn while sceneTransition stays null across tick updates', () => {
        const sendAction = vi.fn();
        const fadeControl: FadeControl = {
            phase: 'idle',
            opacity: 0,
            setPhase: vi.fn(),
            fadeOut: vi.fn().mockResolvedValue(undefined),
            fadeIn: vi.fn().mockResolvedValue(undefined),
        };

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 10,
                fadeInMs: 10,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeContext.Provider value={fadeControl}>
                <Harness snap={makeSnapshot({ tick: 10, sceneTransition: null })} />
            </FadeContext.Provider>,
        );

        rerender(
            <FadeContext.Provider value={fadeControl}>
                <Harness snap={makeSnapshot({ tick: 11, sceneTransition: null })} />
            </FadeContext.Provider>,
        );
        rerender(
            <FadeContext.Provider value={fadeControl}>
                <Harness snap={makeSnapshot({ tick: 12, sceneTransition: null })} />
            </FadeContext.Provider>,
        );

        expect(fadeControl.fadeIn).not.toHaveBeenCalled();
        expect(sendAction).not.toHaveBeenCalled();
    });
});

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
