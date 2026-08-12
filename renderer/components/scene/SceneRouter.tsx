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
    SendAction,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import { useActiveScreen, useUiStore } from '../../state/uiStore.js';
import { SceneLoadingFallback } from './SceneLoadingFallback.js';
import { TransitionOverlay } from './TransitionOverlay.js';
import { useFadeTransition } from './useFadeTransition.js';

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
                    <SceneLoadingFallback
                        registry={registry}
                        screenKey={activeScreenKey}
                        sceneId={String(sceneId)}
                        reason="code"
                        progress={null}
                    />
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
            {enteringScene !== null && (
                <div data-testid="scene-preload-cover" style={preloadCoverLayerStyle}>
                    <SceneLoadingFallback
                        registry={registry}
                        screenKey={enteringScene.screenKey}
                        sceneId={enteringScene.sceneId}
                        reason="assets"
                        progress={preloadProgress}
                    />
                </div>
            )}
        </div>
    );
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
 * registry's default for that scene rather than `useActiveScreen()`, which is
 * likewise still the outgoing scene's key.
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
    return { sceneId, screenKey: registry.sceneDefaultScreens?.[sceneId] ?? 'playfield' };
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
