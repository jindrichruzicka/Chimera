import type { EngineAction, GameResult, PlayerId } from './engine-contract.js';
import type { CommitmentReveal } from './commitment-contract.js';
import type { GameEvent, PlayerSnapshot } from './snapshot-contract.js';
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
 * Engine capabilities handed to a game's in-game menu component (§4.33–§4.34).
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
     * The most recently received verified reveal in commitment battle mode,
     * or null/absent. Main gates it through `CommitmentScheme.verify()`
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

/**
 * Props handed to a game's transition overlay (§4.18–§4.19, §4.33–§4.36) — the
 * component filling {@link GameScreenRegistry.transitionOverlay}.
 *
 * Widens {@link GameScreenProps} by one optional field, so an overlay written
 * before this type existed keeps fitting the slot unchanged.
 */
export interface TransitionOverlayProps extends GameScreenProps {
    /**
     * Fraction in `[0, 1]` of the entering scene's declared required assets that
     * have settled. Absent whenever no measured fraction exists — a run that
     * measures nothing (a scene declaring no refs, a game shipping no manifest)
     * is reported exactly as no run at all, so there is no third state to branch
     * on.
     *
     * Never `0` as a stand-in for "unmeasured": a bar reading 0% for something
     * nobody counted is a claim the engine will not author on a game's behalf.
     */
    readonly preloadProgress?: number;
}

/**
 * Which wait a loading cover is standing in for.
 *
 * `'assets'` — the entering scene's declared `requiredAssets` are still
 * resolving. `'code'` — the screen's own module has not resolved yet.
 *
 * Deliberately NOT `'chunk'`: the reason is REPORTED to the cover by the
 * renderer, and this foundation leaf observes no bundler, so it names no
 * bundler concept (Invariant #1).
 */
export type SceneLoadingReason = 'assets' | 'code';

/**
 * Props handed to a game-supplied loading cover (§4.36).
 *
 * Deliberately does NOT extend {@link GameScreenProps}. A cover stands in for a
 * screen that is not mountable yet, so it is given neither `snapshot` (during a
 * transition the snapshot is still the PRE-commit one, which would describe the
 * scene being left) nor `sendAction` — a cover must not dispatch, and the
 * missing parameter IS the prohibition.
 */
export interface GameLoadingScreenProps {
    /** Screen key the cover stands in for — the key resolved in the registry. */
    readonly screenKey: string;
    /** Scene the cover is shown inside, as carried on the snapshot. */
    readonly sceneId: string;
    /** Which wait this cover is standing in for. */
    readonly reason: SceneLoadingReason;
    /**
     * Fraction in `[0, 1]` of the wait that has settled, or `null` when it is not
     * measured — a code-split `import()` exposes no progress channel. Required
     * and nullable rather than optional with a `0` default, so an unmeasured
     * wait is stated rather than rendered as 0%.
     */
    readonly progress: number | null;
}

/**
 * Static loading cover: a line of text. The string is a translation key, or a
 * literal — `useTranslate`'s `t` returns an unknown key unchanged, so a game
 * that ships no bundle still renders what it wrote.
 */
export interface GameLoadingMessage {
    readonly message: string;
}

/**
 * Static loading cover: an image. `image` is a directly loadable `src` — a
 * `chimera://` URL, a `data:` URI or a public path — never an `AssetRef`, which
 * would have to resolve through the `AssetManager` and reintroduce the very wait
 * the cover exists to mask.
 */
export interface GameLoadingImage {
    readonly image: string;
    readonly alt?: string;
}

/**
 * Every form a loading cover may take.
 *
 * DISCRIMINATION HAZARD for a resolver narrowing this union: `React.lazy`
 * returns an OBJECT, not a function, so narrowing on `typeof value === 'function'`
 * first sends every lazy cover down the static-form branch. Narrow in this order
 * — string sentinel, then `'message' in value`, then `'image' in value`, and only
 * what is left is a component.
 */
export type GameLoadingScreen =
    | GameScreenComponent<GameLoadingScreenProps>
    | GameLoadingMessage
    | GameLoadingImage
    | 'spinner'
    | 'progress'
    | 'none';

export interface GameHudProps extends GameScreenProps {
    readonly tick: number;
    readonly undoDisabled: boolean;
    readonly redoDisabled: boolean;
    readonly endTurnDisabled: boolean;
    readonly handleUndo: () => void;
    readonly handleRedo: () => void;
    readonly handleEndTurn: () => void;
    /**
     * Saves the running match under the given name (host-only — Invariant #25).
     * Deliberately not a `saveDisabled`/`handleSave` pair: ABSENCE of this prop
     * is the withholding mechanism — the shell omits it for non-hosts, when no
     * save handler is wired, or once controls lock after the match resolves.
     * `label` is the trimmed player-entered name; `''` means "no name given"
     * and callers fall back to the engine's default save naming.
     */
    readonly saveGame?: (label: string) => void;
}

/**
 * Per-occurrence play overrides an event-audio {@link GameEventAudioBinding.options}
 * resolver returns, merged OVER the entry's static fields — an omitted key leaves
 * the static value in place.
 *
 * A narrow, sim-safe subset of primitives, deliberately: this contract lives
 * sim-side and flows sim → renderer, never the reverse, so it names no renderer
 * type — not the play options, not a cue, not a spatial spec. `bus` is a
 * string-literal union that coincides with the renderer's bus ids without naming
 * them. `rate` is reserved for a playback-rate override: the engine's event-audio
 * player drops it rather than forwarding an unvalidated field.
 */
export interface EventAudioOverrides {
    readonly bus?: 'master' | 'music' | 'sfx' | 'voice';
    readonly volume?: number;
    readonly priority?: number;
    readonly rate?: number;
}

export type GameEventAudioBinding = Readonly<
    Record<
        string,
        {
            readonly ref: AssetRef<AudioClipAsset>;
            readonly bus?: 'master' | 'music' | 'sfx' | 'voice';
            readonly volume?: number;
            /**
             * Vary the play per occurrence: called by the engine's event-audio
             * player once for each occurrence of this entry's event, and its
             * result merged over the static fields above. It receives the
             * {@link GameEvent} the contract has — `{ type }` and nothing else —
             * so it cannot produce a position; positioned event SFX use explicit
             * call sites instead. Pure config: it receives no dispatcher, and a
             * throw is contained by the player — one warning, the static fields
             * play.
             */
            readonly options?: (event: GameEvent) => EventAudioOverrides;
        }
    >
>;

export interface GameScreenRegistry {
    readonly playfield: GameScreenComponent<GameScreenProps>;
    readonly hud?: GameScreenComponent<GameHudProps>;
    readonly screens?: Readonly<Record<string, GameScreenComponent<GameScreenProps>>>;
    readonly sceneDefaultScreens?: Readonly<Record<string, string>>;
    readonly transitionOverlay?: GameScreenComponent<TransitionOverlayProps>;
    readonly gameResultBanner?: GameScreenComponent<GameResultBannerProps>;
    /**
     * Escape-toggled in-game menu for in-progress matches. Three states:
     * a component (game override), the string `'none'` (opt out → Escape is a
     * no-op), or omitted (engine default Resume/Leave menu). Like every other
     * slot, it is supplied only through this registry (Invariant #80) and is
     * optional (Invariant #81 — `playfield` is the sole required slot).
     */
    readonly inGameMenu?: GameScreenComponent<InGameMenuProps> | 'none';
    /**
     * Cover for a screen that is waiting to become mountable (§4.36), used for
     * any screen key {@link GameScreenRegistry.loadingScreens} does not name.
     *
     * Like every other slot it is supplied only through this registry
     * (Invariant #80) and is optional (Invariant #81 — `playfield` is the sole
     * required slot).
     */
    readonly loadingScreen?: GameLoadingScreen;
    /**
     * Per-screen-key loading covers. A key mapped to the `'none'` opt-out
     * sentinel subtracts that one screen from
     * {@link GameScreenRegistry.loadingScreen}.
     */
    readonly loadingScreens?: Readonly<Record<string, GameLoadingScreen>>;
    /**
     * Minimum time in milliseconds a raised loading cover stays on screen
     * (§4.36). A wait that outlives it changes nothing; a shorter one keeps the
     * cover up for the remainder instead of flashing it. It is a floor, never a
     * delay added to a slow load.
     *
     * Arms only where the cascade resolves a game-declared cover form — never
     * on `'none'` or the engine's empty placeholder. Leave it unset for the
     * engine default; declare `0` to opt down to gate-settle-only.
     */
    readonly loadingScreenMinVisibleMs?: number;
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
