import type { EngineAction, GameResult, PlayerId } from './engine-contract.js';
import type { CommitmentReveal } from './commitment-contract.js';
import type { PlayerSnapshot } from './snapshot-contract.js';
import type { AssetRef, AudioClipAsset } from './asset-contract.js';
import type { GameContent } from './game-content-contract.js';
import type * as React from 'react';

export type GameScreenComponent<TProps> =
    | React.ComponentType<TProps>
    | React.LazyExoticComponent<React.ComponentType<TProps>>;

export interface GameResultBannerProps {
    readonly gameResult: GameResult;
    readonly localPlayerId?: PlayerId;
}

/**
 * Engine capabilities handed to a game's in-game menu component (F55 / §4.33–§4.34).
 * The menu is the Escape-toggled overlay shown during an in-progress match; the
 * engine supplies these callbacks so the game's menu can resume play or leave
 * without importing engine internals (Invariant #80 — the menu reaches the shell
 * only through {@link GameScreenRegistry.inGameMenu}).
 */
export interface InGameMenuProps {
    /** Close the menu and return to the match (Resume). */
    readonly closeMenu: () => void;
    /**
     * Leave the in-progress match. Role-aware in the engine: a host abandons the
     * match and returns everyone to the lobby; a client disconnects to the main
     * menu. The menu component need only invoke it.
     */
    readonly leaveGame: () => void;
    /** Whether the local player hosted this match (host vs. client copy/behaviour). */
    readonly isHost: boolean;
    /** The local player's id, or `undefined` for a purely local game with no lobby. */
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
    /**
     * Whether the local player hosted this match (vs. joined as a client). The
     * shell derives it from the lobby (`hostId === localPlayerId`). Used by the
     * post-game summary to pick the replay it can export: the host gets the
     * authoritative deterministic replay; a client gets only its own perspective
     * replay (the deterministic one re-runs the full sim and would leak hidden
     * information, so it stays host-only — Invariants #71 / #98).
     *
     * Optional/`undefined` when the role is unknown (e.g. a purely local game with
     * no lobby); treat an absent value as host, since only a host records the
     * authoritative replay.
     */
    readonly isHost?: boolean;
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
    /**
     * Escape-toggled in-game menu for in-progress matches (F55). Three states:
     * a component (game override), the string `'none'` (opt out → Escape is a
     * no-op), or omitted (engine default Resume/Leave menu). Like every other
     * slot, it is supplied only through this registry (Invariant #80) and is
     * optional (Invariant #81 — `board` is the sole required slot).
     */
    readonly inGameMenu?: GameScreenComponent<InGameMenuProps> | 'none';
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
