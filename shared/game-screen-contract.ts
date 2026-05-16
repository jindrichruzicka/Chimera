import type {
    EngineAction,
    MatchResult,
    PlayerId,
    PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';
import type * as React from 'react';

export type GameScreenComponent<TProps> =
    | React.ComponentType<TProps>
    | React.LazyExoticComponent<React.ComponentType<TProps>>;

export interface MatchResultBannerProps {
    readonly matchResult: MatchResult;
    readonly localPlayerId?: PlayerId;
}

export interface GameScreenProps {
    readonly snapshot: PlayerSnapshot;
    readonly localPlayerId?: PlayerId;
    readonly sendAction: SendAction;
}

export interface GameHudProps extends GameScreenProps {
    readonly tick: number;
    readonly undoDisabled: boolean;
    readonly redoDisabled: boolean;
    readonly endTurnDisabled: boolean;
    readonly handleUndo: () => void;
    readonly handleRedo: () => void;
    readonly handleEndTurn: () => void;
}

export type GameEventAudioBinding = Readonly<
    Record<
        string,
        {
            readonly ref: AssetRef<AudioClipAsset>;
            readonly bus?: 'master' | 'music' | 'sfx' | 'voice';
            readonly volume?: number;
        }
    >
>;

export interface GameScreenRegistry {
    readonly board: GameScreenComponent<GameScreenProps>;
    readonly hud?: GameScreenComponent<GameHudProps>;
    readonly screens?: Readonly<Record<string, GameScreenComponent<GameScreenProps>>>;
    readonly sceneDefaultScreens?: Readonly<Record<string, string>>;
    readonly transitionOverlay?: GameScreenComponent<GameScreenProps>;
    readonly matchResultBanner?: GameScreenComponent<MatchResultBannerProps>;
    readonly eventAudioBinding?: GameEventAudioBinding;
}

export type SendAction = (action: EngineAction) => void;

export type MatchResultOutcome = 'draw' | 'unknown' | 'win' | 'loss';

export function resolveMatchResultOutcome(
    matchResult: MatchResult,
    localPlayerId: PlayerId | undefined,
): MatchResultOutcome {
    if (matchResult.winnerIds.length === 0) {
        return 'draw';
    }
    if (localPlayerId === undefined) {
        return 'unknown';
    }
    return matchResult.winnerIds.includes(localPlayerId) ? 'win' : 'loss';
}
