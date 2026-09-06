'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PlayerId, PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import type { SendAction } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import { useFade } from '../shell/FadeContext.js';
import {
    SCENE_PRELOAD_BUDGET_MS,
    scenePreloadMeasuresProgress,
    startScenePreload,
    type ScenePreloadRun,
} from './scenePreload.js';

/**
 * How often an unacknowledged `engine:scene_ready` is re-sent while the
 * barrier stays in `preparing`.
 *
 * Every other retry in this hook is edge-triggered — it fires when the
 * snapshot CHANGES. A lost ack changes nothing: the dispatch is
 * fire-and-forget at every hop, a rejected action is dropped without a
 * broadcast, and in a turn-based game no ticker advances anything — so no
 * edge ever arrives, and the barrier holds every player in the match. Only
 * a cadence re-sends after silence.
 *
 * One second: several attempts fit inside the 15 s the e2e barrier poll
 * allows even after a worst-case 5 s preload fail-open, and a lost ack
 * costs at most one extra second over an instant nack.
 */
export const SCENE_READY_RETRY_MS = 1_000;

export interface UseFadeTransitionOptions {
    readonly snapshot: PlayerSnapshot;
    readonly localPlayerId?: PlayerId;
    readonly sendAction: SendAction;
    readonly fadeOutMs?: number;
    readonly fadeInMs?: number;
    /**
     * Whether a cover the caller wants the reveal held for is still up.
     *
     * The reveal is OWED while this is true and spent the moment it falls,
     * which is what puts black between the cover and the scene: the cover
     * leaves against a curtain still at full opacity, and only then does the
     * curtain ease off. Fading in beside a cover instead reveals the scene
     * around it, which is the sequence this replaces.
     *
     * Only the REVEAL waits. The fade-out, the preload run, the ack and the
     * retry cadence never read this (Invariant #133).
     */
    readonly coverUp?: boolean;
    /**
     * The active game's manifest, for the entering scene's asset preload. Blank
     * for a game that declares none — the preload step is then a synchronous
     * no-op and reports no fraction.
     */
    readonly assetManifest?: AssetManifest;
    /** How long the reveal may wait on the entering scene's declared refs. */
    readonly preloadTimeoutMs?: number;
    /**
     * Fraction in `[0, 1]` of the entering scene's declared refs that have
     * settled — `0` the moment a measured run starts, then one report per ref —
     * and `null` once the transition ends. A run that waits on nothing reports
     * NOTHING, so a number here always means a wait somebody counted.
     *
     * Nothing travels back UP from here — the ack still carries `{ playerId }`
     * only.
     */
    readonly onPreloadProgress?: (fraction: number | null) => void;
}

/** A run, paired with the transition key it belongs to. */
interface ActiveScenePreload {
    readonly key: string;
    readonly run: ScenePreloadRun;
}

export function useFadeTransition({
    snapshot,
    localPlayerId,
    sendAction,
    fadeOutMs = 300,
    fadeInMs = 300,
    coverUp = false,
    assetManifest,
    preloadTimeoutMs = SCENE_PRELOAD_BUDGET_MS,
    onPreloadProgress,
}: UseFadeTransitionOptions): void {
    const fade = useFade();
    // Keep the latest FadeControl in a ref so effects can call methods
    // without depending on the mutable object identity.
    const fadeRef = useRef(fade);
    fadeRef.current = fade;
    const lastReadyAttempt = useRef<{ readonly key: string; readonly tick: number } | null>(null);
    const fadeStartedKey = useRef<string | null>(null);
    // A reveal the transition has earned but a cover is still standing in
    // front of. STATE rather than a ref: the effect that pays it has to be
    // reached, and a ref write schedules no render — the debt would sit
    // until some unrelated render happened to come along, and for a caller
    // that never raises a cover none ever would.
    const [revealOwed, setRevealOwed] = useState(false);
    const fadeInMsRef = useRef(fadeInMs);
    fadeInMsRef.current = fadeInMs;
    const fadeCompletedKey = useRef<string | null>(null);
    const mountedRef = useRef(true);

    const transition = snapshot.sceneTransition;
    const playersReadyKey = transition?.playersReady.join('|') ?? '';
    const transitionKey =
        transition === undefined || transition === null
            ? null
            : `${transition.toSceneId}:${transition.startedAtTick}`;
    // Pays a reveal the transition earned while a cover was still standing
    // in front of it. Its own effect, because the transition effect below
    // cannot fire it: the cover outlives the transition by its own minimum,
    // and that effect will not re-run when the cover finally leaves.
    //
    // Only the REVEAL waits here. The fade-out leg, the preload run, the ack
    // and the retry cadence never read `coverUp` (Invariant #133).
    useEffect(() => {
        if (coverUp || !revealOwed) {
            return;
        }
        setRevealOwed(false);
        void fadeRef.current.fadeIn(fadeInMsRef.current);
    }, [coverUp, revealOwed]);
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

    // `useContext(AssetManagerContext)` and NOT `useAssetManager()`: that hook
    // THROWS without a provider (Invariant #83), which would turn every
    // `SceneRouter` / `useFadeTransition` mount that stands up no asset session
    // into a crash. A blank manager here simply means "nothing to preload".
    // Invariant #21: the manager is BORROWED — this hook disposes nothing, and
    // a transition abandons a run by cancelling it.
    const assetManager = useContext(AssetManagerContext);
    const assetManagerRef = useRef(assetManager);
    assetManagerRef.current = assetManager;
    const assetManifestRef = useRef(assetManifest);
    assetManifestRef.current = assetManifest;
    const preloadTimeoutMsRef = useRef(preloadTimeoutMs);
    preloadTimeoutMsRef.current = preloadTimeoutMs;
    const onPreloadProgressRef = useRef(onPreloadProgress);
    onPreloadProgressRef.current = onPreloadProgress;
    const preloadRunRef = useRef<ActiveScenePreload | null>(null);

    // RE-ASSERTED in the setup, not only cleared in the cleanup: StrictMode's
    // simulated remount runs cleanup → setup on the SAME instance with refs
    // preserved, so a cleanup-only effect leaves this permanently `false` and
    // `dispatchReadyIfNeeded` bails for the rest of the mount — a barrier that
    // never acks, in exactly the mode `pnpm dev` runs (`reactStrictMode: true`).
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // The ONLY unmount-scoped cancel. CANCELLATION IS NOT THE TRANSITION
    // EFFECT'S CLEANUP: that effect depends on the freshly parsed
    // `sceneTransition` OBJECT, so it re-runs on every state frame — a remote
    // player's ack alone re-runs it — and a cancel hung on its cleanup would
    // kill this client's own progress and error channels the instant any other
    // player acked. The other cancel site is an explicit identity check at the
    // top of that effect's body.
    useEffect(() => {
        return () => {
            preloadRunRef.current?.run.cancel();
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

        // Cancel site 1 of 2: the run belongs to a transition this client has
        // left. Explicit, so it fires on the identity change alone and never on
        // the per-frame re-runs this effect also gets.
        const activePreload = preloadRunRef.current;
        if (activePreload !== null && activePreload.key !== transitionKey) {
            activePreload.run.cancel();
            preloadRunRef.current = null;
        }

        if (transitionKey === null) {
            // Transition ended — owe the reveal and reset the ready guard.
            lastReadyAttempt.current = null;
            fadeStartedKey.current = null;
            fadeCompletedKey.current = null;
            // Released HERE and not in the same turn as the ack: the terminal
            // fraction stays readable for the whole commit, so a cover is not
            // blanked the instant the last ref lands.
            onPreloadProgressRef.current?.(null);
            if (previousKey !== null) {
                // Owed, not spent: the reveal effect above pays it once no
                // cover stands in front of the scene, so the scene is revealed
                // out of black rather than appearing around a loading screen.
                setRevealOwed(true);
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
        // The ENTERING scene's declaration, as carried on the snapshot — a
        // `simulation/foundation` contract. The descriptor itself is host-side
        // only and never reaches here (Invariant #1).
        const requiredAssets: readonly AssetRef[] = transition.requiredAssets ?? [];

        void fadeRef.current.fadeOut(fadeOutMs).then(async () => {
            if (!mountedRef.current || activeTransitionKeyRef.current !== startedTransitionKey) {
                return;
            }

            const inputs = {
                assetManager: assetManagerRef.current,
                assetManifest: assetManifestRef.current,
                requiredAssets,
            };
            // A run that waits on nothing still reports `1` — 100% of an empty
            // list — and that is a measurement nobody took. Asked of the run's
            // own predicate rather than restated here, and withheld entirely
            // rather than passed on, so a transition with nothing to preload
            // reaches the overlay exactly as it did before this gate existed.
            const measured = scenePreloadMeasuresProgress(inputs);
            if (measured) {
                onPreloadProgressRef.current?.(0);
            }

            const run = startScenePreload({
                ...inputs,
                timeoutMs: preloadTimeoutMsRef.current,
                onProgress: (fraction) => {
                    if (!measured) {
                        return;
                    }
                    onPreloadProgressRef.current?.(fraction);
                },
            });
            preloadRunRef.current = { key: startedTransitionKey, run };

            // Never rejects, by that module's contract — a throw here would
            // strand the reveal on exactly the path the outcome describes.
            await run.settled;

            // The ack fires on ALL FOUR outcomes. The host barrier waits for
            // every player and only evaluates `timeoutTicks` when an action is
            // applied, and a turn-based game has a null ticker — so a client
            // that withheld its ack on a bad disk would freeze the tick with no
            // host timeout able to rescue it.
            if (preloadRunRef.current?.key === startedTransitionKey) {
                preloadRunRef.current = null;
            }
            // The inserted await REOPENED the identity window the check above
            // closes exactly once: a different transition may have started, or
            // the hook unmounted, while the refs were warming.
            if (!mountedRef.current || activeTransitionKeyRef.current !== startedTransitionKey) {
                return;
            }
            fadeCompletedKey.current = startedTransitionKey;
            dispatchReadyIfNeeded(readyKey);
        });
        // `fadeInMs` is deliberately absent: this effect no longer spends the
        // reveal, so re-running the whole transition for a duration change it
        // does not read would be waste. The payment site reads it off a ref.
    }, [dispatchReadyIfNeeded, fadeOutMs, localPlayerId, transition, transitionKey]);

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

    // The retry CADENCE — the re-send that fires on TIME where the effects
    // above fire on snapshot edges. Keyed on the phase and the key, never the
    // transition OBJECT — that identity changes on every broadcast, and
    // re-arming per broadcast would mean the cadence never fires under a
    // realtime tick stream.
    //
    // `dispatchReadyIfNeeded` is the OTHER term that decides that, and this
    // hook does not own it: it is pinned to the caller's `sendAction`, so a
    // caller that re-creates that callback per beat clears and re-arms this
    // interval faster than its own period, and it never fires.
    useEffect(() => {
        if (transitionKey === null || transition === undefined || transition === null) {
            return;
        }
        if (transition.phase !== 'preparing' || localPlayerId === undefined) {
            return;
        }

        const readyKey = `${transitionKey}:${localPlayerId}`;
        const intervalId = setInterval(() => {
            // Never before the chain has completed once: the ack MEANS
            // "fade-out done, preload settled", and a cadence must not become
            // a second door past that meaning. A chain that cannot complete
            // is someone else's bounded problem — the fade watchdog and the
            // preload budget.
            if (fadeCompletedKey.current !== transitionKey) {
                return;
            }
            // The (key, tick) dedupe records that an ack was SENT, not that
            // it arrived. Clearing it is what lets this re-send go out when
            // the tick has not moved — exactly the state a lost ack leaves
            // behind, since nothing advances without it.
            lastReadyAttempt.current = null;
            dispatchReadyIfNeeded(readyKey);
        }, SCENE_READY_RETRY_MS);

        // Load-bearing, not hygiene: `fadeCompletedKey` is reset when a
        // transition ENDS, not when the key changes — a survivor from
        // transition A would pass its own closure's guard and ack B before
        // B's fade and preload ever completed.
        return () => {
            clearInterval(intervalId);
        };
    }, [dispatchReadyIfNeeded, localPlayerId, transition?.phase, transitionKey]);
}
