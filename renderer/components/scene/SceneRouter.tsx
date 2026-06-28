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
import { useActiveScreen, useUiStore } from '../../state/uiStore.js';
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
}: SceneRouterProps): React.ReactElement {
    const activeScreenKey = useActiveScreen();
    const sceneId = snapshot.sceneId ?? 'engine:game';
    const sceneDefaultScreen = readSceneDefaultScreen(snapshot);
    const defaultScreenKey =
        sceneDefaultScreen ?? registry.sceneDefaultScreens?.[String(sceneId)] ?? 'board';
    useFadeTransition({
        snapshot,
        sendAction,
        ...(localPlayerId === undefined ? {} : { localPlayerId }),
        ...(fadeOutMs === undefined ? {} : { fadeOutMs }),
        ...(fadeInMs === undefined ? {} : { fadeInMs }),
    });

    useEffect(() => {
        useUiStore.getState().setActiveSceneId(sceneId, defaultScreenKey);
    }, [defaultScreenKey, sceneId]);

    const Screen = resolveScreen(registry, activeScreenKey);
    const Overlay = registry.transitionOverlay;
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
            <React.Suspense fallback={<div data-testid="scene-screen-loading" />}>
                <Screen {...screenProps} />
            </React.Suspense>
            {Overlay === undefined ? (
                <TransitionOverlay snapshot={snapshot} />
            ) : (
                <React.Suspense fallback={null}>
                    <Overlay {...screenProps} />
                </React.Suspense>
            )}
        </div>
    );
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
    if (activeScreenKey === 'board') {
        return registry.board;
    }
    return registry.screens?.[activeScreenKey] ?? registry.board;
}
