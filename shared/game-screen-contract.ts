import type {
    CommitmentReveal,
    EngineAction,
    GameResult,
    PlayerId,
    PlayerSnapshot,
} from '@chimera/electron/preload/api-types.js';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';
import type { GameContent } from '@chimera/shared/game-content-contract.js';
import type * as React from 'react';

export type GameScreenComponent<TProps> =
    | React.ComponentType<TProps>
    | React.LazyExoticComponent<React.ComponentType<TProps>>;

export interface GameResultBannerProps {
    readonly gameResult: GameResult;
    readonly localPlayerId?: PlayerId;
}

export interface GameScreenProps {
    readonly snapshot: PlayerSnapshot;
    readonly localPlayerId?: PlayerId;
    readonly sendAction: SendAction;
    /**
     * This game's content collections (§4.8), loaded in main and delivered to
     * the renderer. Generic and game-agnostic — only the authoring game's screen
     * interprets it (e.g. tactics derives its colour palette). Optional: absent
     * for games with no content or before the fetch resolves.
     */
    readonly content?: GameContent;
    /**
     * The most recently received verified reveal in commitment battle mode
     * (F54 / T9), or null/absent. Main gates it through `CommitmentScheme.verify()`
     * (Invariant #9) before it reaches the renderer. Generic and game-agnostic —
     * only the authoring game interprets the opaque `reveal.value` (e.g. tactics
     * plays back the revealed turn).
     */
    readonly reveal?: CommitmentReveal | null;
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
    readonly gameResultBanner?: GameScreenComponent<GameResultBannerProps>;
    readonly eventAudioBinding?: GameEventAudioBinding;
}

export type SendAction = (action: EngineAction) => void;

export type GameResultOutcome = 'draw' | 'unknown' | 'win' | 'loss';

export function resolveGameResultOutcome(
    gameResult: GameResult,
    localPlayerId: PlayerId | undefined,
): GameResultOutcome {
    if (gameResult.winnerIds.length === 0) {
        return 'draw';
    }
    if (localPlayerId === undefined) {
        return 'unknown';
    }
    return gameResult.winnerIds.includes(localPlayerId) ? 'win' : 'loss';
}
