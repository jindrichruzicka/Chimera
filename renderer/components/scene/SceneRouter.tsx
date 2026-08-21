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
import { resolveLoadingBeatFloorMs } from './loadingCoverHold.js';
import { resolveLoadingScreen } from './resolveLoadingScreen.js';
import { LoadingBeatCover } from './LoadingBeatCover.js';
import { SceneLoadingFallback } from './SceneLoadingFallback.js';
import { TransitionOverlay } from './TransitionOverlay.js';
import { useFade } from '../shell/FadeContext.js';
import { screenFadeMs } from '../shell/screenFadeDuration.js';
import { useFadeTransition } from './useFadeTransition.js';
import { useLoadingBeat } from './useLoadingBeat.js';
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
     * Called when a code-split screen starts or stops suspending below. What a
     * consumer makes of that wait is the consumer's (Invariant #133).
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

    useEffect(() => {
        useUiStore.getState().setActiveSceneId(sceneId, defaultScreenKey);
    }, [defaultScreenKey, sceneId]);

    const Screen = resolveScreen(registry, activeScreenKey);
    const Overlay = registry.transitionOverlay;
    // The curtain the hop's beat sequences against: `GameShell`'s own inner
    // `FadeProvider`, the one `useFadeTransition` fades out for the ack.
    const fade = useFade();

    // ── Two waits, two machines (§4.36) ───────────────────────────────────────
    //
    // This router serves two different waits through one cover site, and only
    // one of them has a curtain owner.
    //
    // A SCENE HOP has one: `useFadeTransition` fades to black because the
    // `engine:scene_ready` ack awaits that fade. So the hop runs the same
    // `useLoadingBeat` the route entries run — `ownsDarkening: false` because
    // that fade-out is already owned, `ownsReveal: false` because the hook that
    // owes the reveal is the one that must pay it.
    //
    // A WITHIN-SCENE SCREEN SWITCH — `navigateToScreen`, playfield → tech-tree —
    // has NO curtain owner at all: nothing fades, and a beat here would have to
    // black out a running game to open a tech tree. So that wait keeps the
    // minimum-visible held layer below, which is the only way to floor a
    // Suspense cover whose fallback unmounts the instant its chunk resolves.
    //
    // The same floor feeds both, so the knob means one thing wherever a cover
    // is raised.
    const holdMs = resolveLoadingBeatFloorMs(registry);
    // Whether the Suspense fallback is currently mounted, reported by the
    // wrapper around the fallback JSX (state, not a ref: the fallback's unmount
    // is exactly the drop the held layer must re-render across, so it has to
    // schedule a render).
    const [fallbackMounted, setFallbackMounted] = React.useState(false);
    // The held COPY, written render-phase further down (the same mirror pattern
    // as the page's fadeRef) so the commit render that drops the live cover can
    // still paint it. Declared here because the hop effect below clears it.
    const heldCoverRef = React.useRef<HeldCover | null>(null);

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
    // Resolved ONCE per render, then handed to both the beat and the hook that
    // pays the reveal, so the closing black and the reveal cannot drift apart.
    // The default is `screenFadeMs()`, the same source every other screen fade
    // reads — 0 under the e2e flag and under reduced motion, re-read per render
    // because the OS preference can change while the app runs.
    const revealFadeMs = fadeInMs ?? screenFadeMs();

    // ── The hop's beat ────────────────────────────────────────────────────────
    //
    // Latched on the transition KEY, never on the parsed object: the beat has to
    // outlive the transition that started it — the reveal is the last leg, and
    // by then the host has already committed and `sceneTransition` is null —
    // and a snapshot arriving each frame re-parses that object every time.
    const hopKey = readTransitionKey(snapshot);
    const [hop, setHop] = React.useState<ActiveHop | null>(null);
    React.useEffect(() => {
        if (hopKey === null) {
            return;
        }
        setHop(readHop(registry, snapshot));
        // A new wait starts unmeasured. The channel is released here — on the
        // key CHANGE — and deliberately not when the key goes null: the
        // terminal fraction must survive the commit, since the cover outlives
        // it, but a superseding hop must not open already showing the last
        // wait's number.
        setPreloadProgress(null);
        // Pre-hop held residue dies with the wait it belonged to. A latch still
        // serving a pre-hop minimum outlives this hop — its clock is its own —
        // and left in place, the OLD screen's copy would rise over the newly
        // revealed scene for that stale remainder.
        heldCoverRef.current = null;
        // What is NOT cleared, and deliberately: the beat. `hop` never goes
        // null across a supersession, so the machine stays armed on the phase
        // it was in and the floor it already stamped — the second hop stands on
        // what is LEFT of the first one's minimum. The floor is on the RAISE
        // and this is not one: the cover the player is looking at never left,
        // only the form it resolves changed. Re-arming per hop would push the
        // reveal another whole floor out for every superseding transition the
        // host emits (§4.36).
        // The KEY alone. `registry` and `snapshot` are read for the hop's
        // identity, and a snapshot arrives every frame — depending on it would
        // re-resolve the hop mid-wait. Keying the effect is the whole guard: a
        // second conditional inside the setter would be unreachable, since this
        // body already runs once per hop.
    }, [hopKey]);

    const hopBeat = useLoadingBeat({
        curtain: fade,
        active: hop !== null,
        declared: hop?.declared ?? false,
        // The wait is over when the host has committed — and, when this hop
        // raises a cover, once no code-split chunk is still in flight either.
        // Folding the chunk in is what gives a covered hop ONE clock across the
        // commit-time hand-off from the asset cover to a Suspense fallback.
        //
        // It is conditioned on `declared` because the LAYER is what makes that
        // deferral safe: a chunk is the one wait Invariant #133 leaves
        // unbounded, and the beat's own cover — mounted above the curtain — is
        // what the player looks at meanwhile. An undeclared hop mounts no such
        // cover, so folding the chunk in there would hold a full-opacity
        // curtain over nothing, released only by the module import. Where there
        // is no layer there is no deferral.
        settled: !transitionPending && (!(hop?.declared ?? false) || !fallbackMounted),
        holdMs,
        // The SAME number the reveal is paid with below. The beat times its
        // cover legs against it and `useFadeTransition` spends it on the fade,
        // so a default resolved in two places would let the closing black and
        // the reveal drift apart with nothing going red.
        fadeMs: revealFadeMs,
        ownsDarkening: false,
        ownsReveal: false,
        occluded: sceneCoverOccluded,
    });
    // The last fraction THIS hop measured, keyed on the hop so a superseding
    // one never inherits it. `useFadeTransition` releases the channel to `null`
    // at the commit, and the cover now outlives the commit — reading the live
    // value there would blank a cover that is still standing, which is the
    // flash the held copy used to exist to prevent. Written render-phase, the
    // same mirror pattern the copy used.
    const hopProgressRef = React.useRef<{ key: string; progress: number | null }>({
        key: '',
        progress: null,
    });
    if (hop !== null && (hopProgressRef.current.key !== hop.key || preloadProgress !== null)) {
        hopProgressRef.current = { key: hop.key, progress: preloadProgress };
    }
    const coverProgress = hop === null ? null : hopProgressRef.current.progress;

    // The activation ends where the beat does, and only once no transition is
    // pending — a superseding hop keeps the machine armed for its own wait
    // rather than tearing down between the two.
    React.useEffect(() => {
        if (hopBeat.phase === 'revealed' && !transitionPending) {
            setHop(null);
        }
    }, [hopBeat.phase, transitionPending]);

    // ── The screen switch's held layer ────────────────────────────────────────
    //
    // Scoped to the CODE wait alone now. A Suspense fallback unmounts the
    // instant its chunk resolves, so a cover whose minimum has not elapsed
    // would drop mid-wait; ONE held-layer slot re-renders the same resolved
    // cover — the held COPY below, snapshotted during covered renders, since
    // the commit render can no longer compute it — until the remainder elapses.
    // `!hopBeat.coverMounted` because this is a minimum-VISIBLE hold: while the
    // hop's cover stands, its scrim paints over the fallback, so nobody saw
    // the cover this latch would be flooring. Armed anyway, the latch outlives
    // the hop — its minimum runs from the chunk's mount — and the held copy
    // rises OVER the revealed scene for the remainder.
    const liveCoverShown =
        !sceneCoverOccluded &&
        !hopBeat.coverMounted &&
        fallbackMounted &&
        isCascadeDeclared(registry, activeScreenKey);
    const coverHeld = useMinimumVisibleHold(liveCoverShown, holdMs);
    if (fallbackMounted) {
        heldCoverRef.current = {
            sceneId: String(sceneId),
            screenKey: activeScreenKey,
            reason: 'code',
            progress: null,
        };
    }
    const heldCover = heldCoverRef.current;
    // At most one cover layer at a time: a mounted fallback is itself the
    // cover, an in-flight transition's fade-out owns the screen, and an outer
    // cover above makes holding pointless. A hop needs no term of its own —
    // arriving, it cleared the residue above, and its own beat's cover window
    // is walled off by `fallbackMounted` (the only writer of a new copy).
    const showHeldLayer =
        coverHeld &&
        !liveCoverShown &&
        !fallbackMounted &&
        !transitionPending &&
        !sceneCoverOccluded &&
        heldCover !== null;

    // Whether a cover still stands between the player and the scene. The
    // transition owes its reveal until this falls, so the cover leaves against
    // a curtain still at full opacity and the scene is revealed out of black
    // rather than appearing around a loading screen.
    //
    // The hop's term is the beat's: `revealed` is entered when the cover has
    // finished its closing leg, which is precisely when the debt should be
    // paid. The held layer counts too — it paints at `--ch-z-loading-hud` (150),
    // over the curtain's `--ch-z-scene-fade` (130).
    //
    // A mounted Suspense fallback is NOT one on its own: the preset is
    // `position: absolute` with no z-index by design, "a sibling inside the
    // scene, not a route-level layer", so it renders BENEATH the curtain. Its
    // chunk reaches this term only through a DECLARED hop's `settled`, where
    // the beat's own cover — above the curtain — is what the player looks at
    // for however long the chunk takes; deferring on the fallback alone would
    // show black for that whole wait instead.
    const coverUp = hop !== null ? !hopBeat.revealed : showHeldLayer;

    // Declared HERE rather than beside the state above, because `coverUp` is
    // what it needs and that is not known until the cover layers are
    // resolved. Unconditional either way, so the hook order is stable.
    useFadeTransition({
        snapshot,
        sendAction,
        onPreloadProgress: setPreloadProgress,
        coverUp,
        ...(localPlayerId === undefined ? {} : { localPlayerId }),
        ...(assetManifest === undefined ? {} : { assetManifest }),
        ...(fadeOutMs === undefined ? {} : { fadeOutMs }),
        fadeInMs: revealFadeMs,
    });

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
                        {/*
                         * Suppressed while the hop's own cover stands. That
                         * cover spans the whole hop — the chunk wait folds into
                         * its `settled` term — so rendering this one too would
                         * put a SECOND cover under it: invisible, since the hop
                         * layer paints scrim above, but a second `role="status"`
                         * in the accessibility tree announcing the same wait.
                         * The reporter itself stays mounted either way, because
                         * it is what tells the beat a chunk is still in flight.
                         */}
                        {hopBeat.coverMounted ? null : (
                            <SceneLoadingFallback
                                registry={registry}
                                screenKey={activeScreenKey}
                                sceneId={String(sceneId)}
                                reason="code"
                                progress={null}
                            />
                        )}
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
            {hopBeat.coverMounted && hop !== null ? (
                <LoadingBeatCover
                    registry={registry}
                    snapshot={snapshot}
                    surface="scene"
                    visible={hopBeat.coverVisible}
                    fadeMs={revealFadeMs}
                    target={hop}
                    progress={coverProgress}
                />
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
 * exists to explain. `pointerEvents: 'none'` is the held layer's pre-existing
 * contract, kept as-is; the hop's cover reasons the other way and swallows —
 * see `LoadingBeatCover`.
 */
const preloadCoverLayerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 'var(--ch-z-loading-hud)',
    // Paints its OWN backdrop rather than borrowing the fade’s. A cover
    // that declares no background is a glyph over whatever stands behind
    // it, which makes "only the loading screen is visible" a property of
    // the layer beneath rather than of the cover — the defect the loading
    // beat exists to remove.
    backgroundColor: 'var(--ch-color-scrim)',
    pointerEvents: 'none',
};

/** One scene hop, resolved once and held for as long as its beat runs. */
interface ActiveHop {
    /** `toSceneId:startedAtTick` — see {@link readTransitionKey}. */
    readonly key: string;
    readonly sceneId: string;
    readonly screenKey: string;
    /** Whether the cascade resolves a game-declared cover for this hop. */
    readonly declared: boolean;
}

/**
 * A STRING identity for the transition in flight, or `null` when none is.
 *
 * A string and not the parsed object: a snapshot arrives every frame and
 * re-parses `sceneTransition` each time, so a beat keyed on the object would
 * restart mid-wait. `startedAtTick` is what separates two hops to the same
 * scene — `toSceneId` alone would read a re-entry as the same wait.
 */
function readTransitionKey(snapshot: PlayerSnapshot): string | null {
    const transition = snapshot.sceneTransition;
    if (transition === undefined || transition === null) {
        return null;
    }
    return `${String(transition.toSceneId)}:${transition.startedAtTick}`;
}

/**
 * The scene the cover stands in for.
 *
 * Resolved off `sceneTransition.toSceneId` and not `snapshot.sceneId`, which
 * stays the scene being LEFT for the whole `'preparing'` phase; and off the
 * screen-key cascade below rather than `useActiveScreen()`, which is likewise
 * still the outgoing scene's key.
 *
 * Deliberately NOT gated on a measured fraction. The old gate meant a scene
 * declaring no `requiredAssets` — or a game shipping no manifest — hopped with
 * no cover at all while the same registry entering through `/game` got the full
 * beat. A wait that settles before anything could be counted is exactly the
 * wait a floor exists for; what decides whether a beat happens is the DECLARED
 * cover, which is why it is resolved here rather than inferred from progress.
 */
function readHop(registry: GameScreenRegistry, snapshot: PlayerSnapshot): ActiveHop | null {
    const key = readTransitionKey(snapshot);
    const transition = snapshot.sceneTransition;
    if (key === null || transition === undefined || transition === null) {
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
    return { key, sceneId, screenKey, declared: isCascadeDeclared(registry, screenKey) };
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
