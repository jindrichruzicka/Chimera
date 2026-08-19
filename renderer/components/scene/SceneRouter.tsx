'use client';

import React, { useEffect } from 'react';
import type {
    CommitmentReveal,
    PlayerId,
    PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameScreenComponent,
    GameScreenProps,
    GameScreenRegistry,
    SceneLoadingReason,
    SendAction,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import { useActiveScreen, useUiStore } from '../../state/uiStore.js';
import { resolveLoadingCoverHoldMs } from './loadingCoverHold.js';
import { resolveLoadingScreen } from './resolveLoadingScreen.js';
import { SceneLoadingFallback } from './SceneLoadingFallback.js';
import { TransitionOverlay } from './TransitionOverlay.js';
import { useFadeTransition } from './useFadeTransition.js';
import { useMinimumVisibleHold } from './useMinimumVisibleHold.js';

export interface SceneRouterProps {
    readonly registry: GameScreenRegistry;
    readonly snapshot: PlayerSnapshot;
    readonly localPlayerId?: PlayerId;
    readonly sendAction: SendAction;
    readonly content?: GameContent;
    readonly reveal?: CommitmentReveal | null;
    readonly isHost?: boolean;
    readonly fadeOutMs?: number;
    readonly fadeInMs?: number;
    /** The active game's manifest, for the entering scene's asset preload. */
    readonly assetManifest?: AssetManifest;
    /**
     * True while an OUTER cover or the opaque app-level scrim sits above this
     * router — the route-entry cover's mounted window, or the screen fade at
     * full black. Not derivable in here: the route cover's state is local to
     * the page, and `GameShell` mounts an inner `FadeProvider` that shadows the
     * app-level fade context below it. While `true`, the minimum-visible hold
     * never arms — nobody saw the cover it would be flooring (§4.36).
     */
    readonly sceneCoverOccluded?: boolean;
    /**
     * Called when a code-split screen starts or stops suspending below. A
     * loading beat folds this into its settle term: the asset gate can be ready
     * while the screen's own chunk is still in flight, and revealing then lands
     * the player on the fallback rather than on the screen.
     *
     * Only transitions are reported — a router whose screen never suspends
     * calls this never, so a consumer starts from "not pending" itself.
     */
    readonly onScenePending?: (pending: boolean) => void;
}

export function SceneRouter({
    registry,
    snapshot,
    localPlayerId,
    sendAction,
    content,
    reveal,
    isHost,
    fadeOutMs,
    fadeInMs,
    assetManifest,
    sceneCoverOccluded = false,
    onScenePending,
}: SceneRouterProps): React.ReactElement {
    const activeScreenKey = useActiveScreen();
    const sceneId = snapshot.sceneId ?? 'engine:game';
    const sceneDefaultScreen = readSceneDefaultScreen(snapshot);
    const defaultScreenKey =
        sceneDefaultScreen ?? registry.sceneDefaultScreens?.[String(sceneId)] ?? 'playfield';
    // A plain local `useState`, deliberately NOT `uiStore` (a module singleton
    // that `/game` and `/replays/player` both mount a router against — two
    // routers would cross-talk) and NOT `FadeControl` (also mounted app-level,
    // where no scene preload exists; a load fraction is not a fade property).
    const [preloadProgress, setPreloadProgress] = React.useState<number | null>(null);
    useFadeTransition({
        snapshot,
        sendAction,
        onPreloadProgress: setPreloadProgress,
        ...(localPlayerId === undefined ? {} : { localPlayerId }),
        ...(assetManifest === undefined ? {} : { assetManifest }),
        ...(fadeOutMs === undefined ? {} : { fadeOutMs }),
        ...(fadeInMs === undefined ? {} : { fadeInMs }),
    });

    useEffect(() => {
        useUiStore.getState().setActiveSceneId(sceneId, defaultScreenKey);
    }, [defaultScreenKey, sceneId]);

    const Screen = resolveScreen(registry, activeScreenKey);
    const Overlay = registry.transitionOverlay;
    const enteringScene = readEnteringScene(registry, snapshot, preloadProgress);

    // ── Minimum-visible held layer (§4.36) ────────────────────────────────────
    //
    // Both cover drops here are events the hold must not delay: the transition
    // cover unmounts on a host-side commit (`readEnteringScene` answers `null`
    // before it ever reads the fraction) and a Suspense fallback unmounts the
    // instant its chunk resolves. So when a cover whose minimum has not elapsed
    // would drop, ONE held-layer slot re-renders the same resolved cover — the
    // held COPY below, snapshotted during covered renders, since the commit
    // render can no longer compute it — until the remainder elapses.
    // `useFadeTransition` above is deliberately untouched: the ack, both fade
    // channels and the progress protocol are what "nothing host-visible moves"
    // means (Invariant #133).
    const holdMs = resolveLoadingCoverHoldMs(registry);
    // Whether the Suspense fallback is currently mounted, reported by the
    // wrapper around the fallback JSX (state, not a ref: the fallback's unmount
    // is exactly the drop the held layer must re-render across, so it has to
    // schedule a render).
    const [fallbackMounted, setFallbackMounted] = React.useState(false);

    // Held in a ref, refreshed each render, so a callback whose identity changes
    // per render does not re-fire this effect; what the consumer is watching is
    // the chunk's state, not the reporter's identity.
    const scenePendingRef = React.useRef(onScenePending);
    scenePendingRef.current = onScenePending;
    // Only CHANGES are reported, and the starting value counts as already
    // reported. `FallbackLifetimeReporter` sits deeper in the tree, so on the
    // commit that mounts the fallback its effect — the one that sets
    // `fallbackMounted` — runs before this one, and this one would otherwise
    // announce "not pending" with the fallback already on screen. A consumer
    // folding that into a settle term could reveal on it.
    const lastPendingRef = React.useRef(false);
    React.useEffect(() => {
        if (lastPendingRef.current === fallbackMounted) {
            return;
        }
        lastPendingRef.current = fallbackMounted;
        scenePendingRef.current?.(fallbackMounted);
    }, [fallbackMounted]);

    const transitionPending =
        snapshot.sceneTransition !== undefined && snapshot.sceneTransition !== null;
    const liveCoverShown =
        !sceneCoverOccluded &&
        (enteringScene !== null
            ? isCascadeDeclared(registry, enteringScene.screenKey)
            : fallbackMounted && isCascadeDeclared(registry, activeScreenKey));
    // One visual wait gets one clock. Covers can CHAIN inside a single wait —
    // the commit-time sequence swaps the transition cover for the Suspense
    // fallback across two effect flushes, and the latch re-stamps on that
    // re-show — so the epoch below remembers when the wait's FIRST cover rose
    // and shrinks the latch's hold to the remainder. The latch re-times a
    // holdMs change from its current stamp, which lands the release exactly at
    // epoch start + minimum; a fresh wait (previous one fully released) resets
    // the epoch to the full minimum.
    const [epochHoldMs, setEpochHoldMs] = React.useState(holdMs);
    const epochStartRef = React.useRef<number | null>(null);
    const coverHeld = useMinimumVisibleHold(liveCoverShown, epochHoldMs);
    React.useEffect(() => {
        // A wait's epoch ends when its hold fully releases — and also when a
        // NEW transition supersedes it before its own cover has risen: the
        // superseded layer is dropped immediately, but the superseding cover
        // is a new wait and keeps its own full minimum, never the old
        // remainder.
        if (!coverHeld || (transitionPending && !liveCoverShown)) {
            epochStartRef.current = null;
            return;
        }
        if (!liveCoverShown) {
            return;
        }
        if (epochStartRef.current === null) {
            epochStartRef.current = performance.now();
            setEpochHoldMs(holdMs);
        } else {
            setEpochHoldMs(Math.max(0, holdMs - (performance.now() - epochStartRef.current)));
        }
    }, [coverHeld, liveCoverShown, holdMs, transitionPending]);
    // The held COPY: the last covered render's resolution, written render-phase
    // (the same mirror pattern as the page's fadeRef) so the commit render that
    // drops the live cover can still paint it.
    const heldCoverRef = React.useRef<HeldCover | null>(null);
    if (enteringScene !== null) {
        heldCoverRef.current = {
            sceneId: enteringScene.sceneId,
            screenKey: enteringScene.screenKey,
            reason: 'assets',
            progress: preloadProgress,
        };
    } else if (fallbackMounted) {
        heldCoverRef.current = {
            sceneId: String(sceneId),
            screenKey: activeScreenKey,
            reason: 'code',
            progress: null,
        };
    }
    const heldCover = heldCoverRef.current;
    // At most one cover layer at a time: a live entering-scene cover renders
    // instead of the held layer, a NEW transition supersedes it before its own
    // cover has even risen (the incoming fade-out owns the screen), a mounted
    // fallback is itself the cover, and an outer cover above makes holding
    // pointless.
    const showHeldLayer =
        coverHeld &&
        !liveCoverShown &&
        !transitionPending &&
        !fallbackMounted &&
        !sceneCoverOccluded &&
        heldCover !== null;

    // WITHHELD, not passed as `null`: the contract reads an absent prop as "no
    // preload is running" and a `null` one as "running, but unmeasured", and the
    // hook only ever reports a number for a run that measures something.
    const preloadProgressProps = preloadProgress === null ? {} : { preloadProgress };
    const screenProps = {
        snapshot,
        sendAction,
        ...(localPlayerId === undefined ? {} : { localPlayerId }),
        ...(content === undefined ? {} : { content }),
        ...(reveal === undefined ? {} : { reveal }),
        ...(isHost === undefined ? {} : { isHost }),
    };

    return (
        <div
            className="chimera-scene-router"
            data-testid="scene-router"
            data-active-scene-id={sceneId}
            data-active-screen-key={activeScreenKey}
        >
            <React.Suspense
                fallback={
                    <FallbackLifetimeReporter onMountedChange={setFallbackMounted}>
                        <SceneLoadingFallback
                            registry={registry}
                            screenKey={activeScreenKey}
                            sceneId={String(sceneId)}
                            reason="code"
                            progress={null}
                        />
                    </FallbackLifetimeReporter>
                }
            >
                <Screen {...screenProps} />
            </React.Suspense>
            {Overlay === undefined ? (
                <TransitionOverlay snapshot={snapshot} {...preloadProgressProps} />
            ) : (
                <React.Suspense fallback={null}>
                    <Overlay {...screenProps} {...preloadProgressProps} />
                </React.Suspense>
            )}
            {/*
             * The transition cover site (§4.36), a SIBLING of the overlay branch
             * and never its child. Nested in the branch above it would be
             * unreachable for every game that supplies a `transitionOverlay`;
             * nested inside `TransitionOverlay` it would inherit that element's
             * `aria-hidden="true"` and drop the preset's `role="status"` out of
             * the accessibility tree entirely.
             */}
            {enteringScene !== null ? (
                <div data-testid="scene-preload-cover" style={preloadCoverLayerStyle}>
                    <SceneLoadingFallback
                        registry={registry}
                        screenKey={enteringScene.screenKey}
                        sceneId={enteringScene.sceneId}
                        reason="assets"
                        progress={preloadProgress}
                    />
                </div>
            ) : showHeldLayer && heldCover !== null ? (
                /*
                 * The held layer: the SAME cascade resolution the dropped cover
                 * rendered, kept for the minimum's remainder. A sibling at the
                 * same layer as the live cover above — never a child of an
                 * overlay, whose aria-hidden would drop the preset's
                 * role="status" out of the accessibility tree.
                 */
                <div data-testid="scene-held-cover" style={preloadCoverLayerStyle}>
                    <SceneLoadingFallback
                        registry={registry}
                        screenKey={heldCover.screenKey}
                        sceneId={heldCover.sceneId}
                        reason={heldCover.reason}
                        progress={heldCover.progress}
                    />
                </div>
            ) : null}
        </div>
    );
}

/** The held copy of a dropped cover: what it resolved, and its last fraction. */
interface HeldCover {
    readonly sceneId: string;
    readonly screenKey: string;
    readonly reason: SceneLoadingReason;
    readonly progress: number | null;
}

/**
 * Whether the cascade resolves a GAME-DECLARED cover form for `screenKey` —
 * anything but `undefined` (the engine's empty placeholder) and the `'none'`
 * opt-out. The hold arms only for a cover the game chose to show: an empty
 * placeholder held on screen is a wait with no explanation.
 */
function isCascadeDeclared(registry: GameScreenRegistry, screenKey: string): boolean {
    const cover = resolveLoadingScreen(registry, screenKey);
    return cover !== undefined && cover !== 'none';
}

interface FallbackLifetimeReporterProps {
    readonly onMountedChange: (mounted: boolean) => void;
    readonly children: React.ReactNode;
}

/**
 * Stamps the Suspense cover's lifetime for the hold above: mounted on effect
 * flush, unmounted on cleanup. A component-form cover that is itself lazy
 * stamps at THIS wrapper's mount regardless — the inner placeholder frame it
 * may paint first is accepted. Renders its children unchanged, so the
 * fallback's content reaches the accessibility tree exactly as it did before
 * the wrapper existed.
 */
function FallbackLifetimeReporter({
    onMountedChange,
    children,
}: FallbackLifetimeReporterProps): React.ReactElement {
    useEffect(() => {
        onMountedChange(true);
        return () => {
            onMountedChange(false);
        };
    }, [onMountedChange]);
    return <>{children}</>;
}

/**
 * A layer above the fade, not merely beside it: `--ch-z-scene-fade` is opaque at
 * hold, so a cover painted under it would be invisible for the whole wait it
 * exists to explain. `pointerEvents: 'none'` keeps it a picture — a cover is
 * handed no `sendAction` (§4.36), so it must not swallow a click.
 */
const preloadCoverLayerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 'var(--ch-z-loading-hud)',
    pointerEvents: 'none',
};

interface EnteringScene {
    readonly sceneId: string;
    readonly screenKey: string;
}

/**
 * The scene the cover stands in for, or `null` when there is nothing to cover.
 *
 * Gated on a MEASURED fraction rather than on the transition alone: the run
 * starts on the far side of the fade-out, so a cover keyed to the transition
 * would pop over the outgoing scene while the scrim was still ramping, and
 * would appear at all for a scene with nothing to preload. `preloadProgress`
 * turns numeric when a measured run starts and stays so until the transition
 * ends, which is exactly the wait this cover explains.
 *
 * Resolved off `sceneTransition.toSceneId` and not `snapshot.sceneId`, which
 * stays the scene being LEFT for the whole `'preparing'` phase; and off the
 * screen-key cascade below rather than `useActiveScreen()`, which is likewise
 * still the outgoing scene's key.
 */
function readEnteringScene(
    registry: GameScreenRegistry,
    snapshot: PlayerSnapshot,
    preloadProgress: number | null,
): EnteringScene | null {
    const transition = snapshot.sceneTransition;
    if (transition === undefined || transition === null) {
        return null;
    }
    if (preloadProgress === null) {
        return null;
    }

    const sceneId = String(transition.toSceneId);
    // The transition's own key first: it is the ENTERING scene's declared
    // `SceneDescriptor.defaultScreen`, carried from the host, and it is the only
    // source that a game registering a scene populates by construction. The
    // registry map stays as the fallback — a host that does not emit the field
    // must still resolve — and `'playfield'` behind it.
    const screenKey =
        transition.defaultScreen ?? registry.sceneDefaultScreens?.[sceneId] ?? 'playfield';
    return { sceneId, screenKey };
}

function readSceneDefaultScreen(snapshot: PlayerSnapshot): string | undefined {
    const record = snapshot as unknown as Readonly<Record<string, unknown>>;
    return typeof record['sceneDefaultScreen'] === 'string'
        ? record['sceneDefaultScreen']
        : undefined;
}

function resolveScreen(
    registry: GameScreenRegistry,
    activeScreenKey: string,
): GameScreenComponent<GameScreenProps> {
    if (activeScreenKey === 'playfield') {
        return registry.playfield;
    }
    return registry.screens?.[activeScreenKey] ?? registry.playfield;
}
