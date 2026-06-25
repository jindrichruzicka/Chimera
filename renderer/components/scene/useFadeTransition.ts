'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PlayerId, PlayerSnapshot } from '@chimera/simulation/bridge/api-types.js';
import type { SendAction } from '@chimera/simulation/foundation/game-screen-contract.js';
import { useFade } from '../shell/FadeContext.js';

export interface UseFadeTransitionOptions {
    readonly snapshot: PlayerSnapshot;
    readonly localPlayerId?: PlayerId;
    readonly sendAction: SendAction;
    readonly fadeOutMs?: number;
    readonly fadeInMs?: number;
}

export function useFadeTransition({
    snapshot,
    localPlayerId,
    sendAction,
    fadeOutMs = 300,
    fadeInMs = 300,
}: UseFadeTransitionOptions): void {
    const fade = useFade();
    // Keep the latest FadeControl in a ref so effects can call methods
    // without depending on the mutable object identity.
    const fadeRef = useRef(fade);
    fadeRef.current = fade;
    const lastReadyAttempt = useRef<{ readonly key: string; readonly tick: number } | null>(null);
    const fadeStartedKey = useRef<string | null>(null);
    const fadeCompletedKey = useRef<string | null>(null);
    const mountedRef = useRef(true);

    const transition = snapshot.sceneTransition;
    const playersReadyKey = transition?.playersReady.join('|') ?? '';
    const transitionKey =
        transition === undefined || transition === null
            ? null
            : `${transition.toSceneId}:${transition.startedAtTick}`;
    const previousTransitionKey = useRef<string | null>(transitionKey);
    const activeTransitionKeyRef = useRef<string | null>(transitionKey);
    activeTransitionKeyRef.current = transitionKey;

    // Refs for values needed inside the async .then() callback that must
    // reflect the LATEST render values without re-triggering the effect.
    // Updating refs is a side-effect-free assignment (no render scheduled).
    const latestTickRef = useRef(snapshot.tick);
    const latestPlayersReadyRef = useRef(transition?.playersReady ?? []);
    latestTickRef.current = snapshot.tick;
    latestPlayersReadyRef.current = transition?.playersReady ?? [];

    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const dispatchReadyIfNeeded = useCallback(
        (readyKey: string | null): void => {
            if (!mountedRef.current || localPlayerId === undefined || readyKey === null) {
                return;
            }
            if (latestPlayersReadyRef.current.includes(localPlayerId)) {
                return;
            }
            const currentTick = latestTickRef.current;
            if (
                lastReadyAttempt.current?.key === readyKey &&
                lastReadyAttempt.current.tick === currentTick
            ) {
                return;
            }

            lastReadyAttempt.current = { key: readyKey, tick: currentTick };
            sendAction({
                type: 'engine:scene_ready',
                playerId: localPlayerId,
                tick: currentTick,
                payload: { playerId: localPlayerId },
            });
        },
        [localPlayerId, sendAction],
    );

    useEffect(() => {
        const previousKey = previousTransitionKey.current;
        previousTransitionKey.current = transitionKey;

        if (transitionKey === null) {
            // Transition ended — fade back in and reset the ready guard.
            lastReadyAttempt.current = null;
            fadeStartedKey.current = null;
            fadeCompletedKey.current = null;
            if (previousKey !== null) {
                void fadeRef.current.fadeIn(fadeInMs);
            }
            return;
        }

        // Effect runs when a NEW transition starts (transitionKey changed).
        // At that point the phase is always 'preparing', so the 'ready' /
        // 'committing' branches below are defensive guards only.
        if (transition === undefined || transition === null) {
            return;
        }

        if (transition.phase === 'ready' || transition.phase === 'committing') {
            fadeRef.current.setPhase('hold');
            return;
        }

        if (transition.phase !== 'preparing') {
            return;
        }

        const readyKey = localPlayerId === undefined ? null : `${transitionKey}:${localPlayerId}`;

        if (fadeCompletedKey.current === transitionKey) {
            dispatchReadyIfNeeded(readyKey);
            return;
        }

        if (fadeStartedKey.current === transitionKey) {
            return;
        }

        fadeStartedKey.current = transitionKey;
        const startedTransitionKey = transitionKey;

        void fadeRef.current.fadeOut(fadeOutMs).then(() => {
            if (!mountedRef.current || activeTransitionKeyRef.current !== startedTransitionKey) {
                return;
            }
            fadeCompletedKey.current = transitionKey;
            dispatchReadyIfNeeded(readyKey);
        });
    }, [dispatchReadyIfNeeded, fadeInMs, fadeOutMs, localPlayerId, transition, transitionKey]);

    useEffect(() => {
        if (transitionKey === null || transition === undefined || transition === null) {
            return;
        }
        if (transition.phase !== 'preparing') {
            return;
        }
        if (fadeCompletedKey.current !== transitionKey) {
            return;
        }

        const readyKey = localPlayerId === undefined ? null : `${transitionKey}:${localPlayerId}`;
        dispatchReadyIfNeeded(readyKey);
    }, [
        dispatchReadyIfNeeded,
        localPlayerId,
        playersReadyKey,
        snapshot.tick,
        transition?.phase,
        transitionKey,
    ]);
}
