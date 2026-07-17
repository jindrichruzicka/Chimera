// apps/tactics/shell/translations/keys.ts
//
// Tactics' translation-token catalogue: the stable set of TranslationKey
// constants for every user-facing string the Tactics renderer ships. Mirrors the
// engine catalogue (renderer/i18n/engine-keys.ts) — grouped per-area maps for
// ergonomic component imports, plus a flat TACTICS_KEYS aggregate keyed by each
// token's own string for callers that iterate the whole set (the parity test,
// the bundle-registration wiring).
//
// Namespace convention: `game.tactics.<area>.<name>` — the game-owned `tactics`
// prefix under the `game` root (games add tokens under their own prefix; the
// `engine.` root is reserved for the engine, Invariant #11). A Tactics bundle may
// ALSO re-key an `engine.*` token to relabel engine UI in the Tactics context —
// see the paired `en.ts`/`cs.ts`, which additionally override `engine.chat.title`.
//
// This module imports the runtime brand factory, so it is NOT one of the
// boundary-restricted pure-data modules (shell/main-menu.ts, settings-page.ts,
// and the bundle DATA files) that must never import renderer/i18n. Only .tsx
// components and the bundle-registration loader import from here.

import { translationKey, type TranslationKey } from '@chimera-engine/renderer/i18n';

/** In-match HUD: turn status, tick/stamina readouts, action buttons, chat toggle. */
export const HUD_KEYS = {
    turnYours: translationKey('game.tactics.hud.turnYours'),
    turnWaiting: translationKey('game.tactics.hud.turnWaiting'),
    stamina: translationKey('game.tactics.hud.stamina'),
    waitingForCommitments: translationKey('game.tactics.hud.waitingForCommitments'),
    undo: translationKey('game.tactics.hud.undo'),
    redo: translationKey('game.tactics.hud.redo'),
    endTurn: translationKey('game.tactics.hud.endTurn'),
    chat: translationKey('game.tactics.hud.chat'),
    hideChat: translationKey('game.tactics.hud.hideChat'),
    hudAriaLabel: translationKey('game.tactics.hud.hudAriaLabel'),
    actionsAriaLabel: translationKey('game.tactics.hud.actionsAriaLabel'),
} as const;

/** Leave-battle confirmation dialog (in-game menu slot). */
export const IN_GAME_MENU_KEYS = {
    leaveTitle: translationKey('game.tactics.inGameMenu.leaveTitle'),
    leavePromptHost: translationKey('game.tactics.inGameMenu.leavePromptHost'),
    leavePromptClient: translationKey('game.tactics.inGameMenu.leavePromptClient'),
    cancel: translationKey('game.tactics.inGameMenu.cancel'),
    leaveConfirm: translationKey('game.tactics.inGameMenu.leaveConfirm'),
} as const;

/** Game-over result banner: outcome message, icon labels, continue hint. */
export const RESULT_KEYS = {
    victory: translationKey('game.tactics.result.victory'),
    defeat: translationKey('game.tactics.result.defeat'),
    stalemate: translationKey('game.tactics.result.stalemate'),
    concluded: translationKey('game.tactics.result.concluded'),
    iconVictory: translationKey('game.tactics.result.iconVictory'),
    iconDefeat: translationKey('game.tactics.result.iconDefeat'),
    iconDraw: translationKey('game.tactics.result.iconDraw'),
    iconConcluded: translationKey('game.tactics.result.iconConcluded'),
    continueHint: translationKey('game.tactics.result.continueHint'),
} as const;

/** Post-game summary panel: per-outcome badge + message, chrome, replay action. */
export const SUMMARY_KEYS = {
    badgeVictory: translationKey('game.tactics.summary.badgeVictory'),
    badgeDefeat: translationKey('game.tactics.summary.badgeDefeat'),
    badgeStalemate: translationKey('game.tactics.summary.badgeStalemate'),
    badgeConcluded: translationKey('game.tactics.summary.badgeConcluded'),
    messageWin: translationKey('game.tactics.summary.messageWin'),
    messageLoss: translationKey('game.tactics.summary.messageLoss'),
    messageDraw: translationKey('game.tactics.summary.messageDraw'),
    messageUnknown: translationKey('game.tactics.summary.messageUnknown'),
    panelTitle: translationKey('game.tactics.summary.panelTitle'),
    replayButton: translationKey('game.tactics.summary.replayButton'),
    replayError: translationKey('game.tactics.summary.replayError'),
} as const;

/** Demo board: fallback accessible names + the reveal-playback overlay. */
export const BOARD_KEYS = {
    loadingAriaLabel: translationKey('game.tactics.board.loadingAriaLabel'),
    emptyAriaLabel: translationKey('game.tactics.board.emptyAriaLabel'),
    ariaLabel: translationKey('game.tactics.board.ariaLabel'),
    revealed: translationKey('game.tactics.board.revealed'),
} as const;

/** Custom lobby screen: setup panel, roster, ready toggle, AI section. */
export const LOBBY_KEYS = {
    battleSetup: translationKey('game.tactics.lobby.battleSetup'),
    addressLabel: translationKey('game.tactics.lobby.addressLabel'),
    copyAddressAriaLabel: translationKey('game.tactics.lobby.copyAddressAriaLabel'),
    boardColour: translationKey('game.tactics.lobby.boardColour'),
    simultaneousTurns: translationKey('game.tactics.lobby.simultaneousTurns'),
    allowSpectators: translationKey('game.tactics.lobby.allowSpectators'),
    readySummary: translationKey('game.tactics.lobby.readySummary'),
    players: translationKey('game.tactics.lobby.players'),
    you: translationKey('game.tactics.lobby.you'),
    ready: translationKey('game.tactics.lobby.ready'),
    notReady: translationKey('game.tactics.lobby.notReady'),
    playerColourAriaLabel: translationKey('game.tactics.lobby.playerColourAriaLabel'),
    readyToggle: translationKey('game.tactics.lobby.readyToggle'),
    aiPlayers: translationKey('game.tactics.lobby.aiPlayers'),
    addAiAriaLabel: translationKey('game.tactics.lobby.addAiAriaLabel'),
    aiBadge: translationKey('game.tactics.lobby.aiBadge'),
    aiPlayerName: translationKey('game.tactics.lobby.aiPlayerName'),
    removeAiAriaLabel: translationKey('game.tactics.lobby.removeAiAriaLabel'),
} as const;

/** Main-menu button labels (resolved by the engine renderer from the data def). */
export const MENU_KEYS = {
    newGame: translationKey('game.tactics.menu.newGame'),
    loadGame: translationKey('game.tactics.menu.loadGame'),
    settings: translationKey('game.tactics.menu.settings'),
    replays: translationKey('game.tactics.menu.replays'),
    quit: translationKey('game.tactics.menu.quit'),
} as const;

/** Settings page: tab labels, game-field labels, animation-speed option labels. */
export const SETTINGS_KEYS = {
    tabAudio: translationKey('game.tactics.settings.tabAudio'),
    tabDisplay: translationKey('game.tactics.settings.tabDisplay'),
    tabGameplay: translationKey('game.tactics.settings.tabGameplay'),
    tabAi: translationKey('game.tactics.settings.tabAi'),
    tabControls: translationKey('game.tactics.settings.tabControls'),
    showGrid: translationKey('game.tactics.settings.showGrid'),
    animationSpeed: translationKey('game.tactics.settings.animationSpeed'),
    showDamageNumbers: translationKey('game.tactics.settings.showDamageNumbers'),
    aiThinkingDelay: translationKey('game.tactics.settings.aiThinkingDelay'),
    animSpeedSlow: translationKey('game.tactics.settings.animSpeedSlow'),
    animSpeedNormal: translationKey('game.tactics.settings.animSpeedNormal'),
    animSpeedFast: translationKey('game.tactics.settings.animSpeedFast'),
    animSpeedInstant: translationKey('game.tactics.settings.animSpeedInstant'),
} as const;

/** Shell background overlay subtitle. */
export const SHELL_KEYS = {
    subtitle: translationKey('game.tactics.shell.subtitle'),
} as const;

/** Input-action metadata rendered in the settings Controls panel. */
export const ACTIONS_KEYS = {
    endTurn: translationKey('game.tactics.actions.endTurn'),
    categoryGame: translationKey('game.tactics.actions.categoryGame'),
} as const;

// The grouped maps share leaf names across areas (`cancel`, `ready`, `settings`,
// …), so a spread aggregate keyed by leaf name would silently collapse them. Key
// the flat aggregate by each token's *full* string instead — unique by
// construction (the `game.tactics.<area>.` prefix disambiguates) — so every token
// survives. Mirrors the engine's ENGINE_KEYS aggregate.
const ALL_AREA_MAPS = [
    HUD_KEYS,
    IN_GAME_MENU_KEYS,
    RESULT_KEYS,
    SUMMARY_KEYS,
    BOARD_KEYS,
    LOBBY_KEYS,
    MENU_KEYS,
    SETTINGS_KEYS,
    SHELL_KEYS,
    ACTIONS_KEYS,
] as const;

/**
 * Flat aggregate of every Tactics token, keyed by the token's own string, for
 * callers that need to iterate the whole catalogue (the parity test; the
 * bundle-registration wiring). Grouped per-area maps above are the ergonomic
 * import surface for components.
 */
export const TACTICS_KEYS: Readonly<Record<string, TranslationKey>> = Object.fromEntries(
    ALL_AREA_MAPS.flatMap((area) => Object.values(area)).map((token) => [token, token]),
);
