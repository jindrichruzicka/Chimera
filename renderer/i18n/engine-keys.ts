// renderer/i18n/engine-keys.ts
//
// The engine's translation-token catalogue: the stable, documented set of
// TranslationKey constants for every user-facing string the engine itself
// ships. This is the public contract two later steps build against — the
// components that consume the tokens via useTranslate(), and the games that
// localise the engine UI.
//
// Namespace convention: `engine.<area>.<name>` — a reserved `engine` root, an
// area segment (chat, menu, settings, …), and a camelCase leaf name. The
// `engine.` prefix is engine-owned, mirroring the reserved `engine:` action
// namespace (Invariant #11); games add their own tokens under their own prefix.
//
// Games localise the engine UI by RE-KEYING these exact tokens in their own
// translation bundle: supplying, say, `engine.chat.title` in a game override
// bundle wins over the engine default (game → engineDefault → raw key). A game
// override never *deletes* an engine token — the engine base bundle
// (engine-bundle.en.ts) is the guaranteed floor, so an un-overridden token
// always still resolves to its English default.
//
// The paired `engine-bundle.en.ts` supplies an English template for every key
// here; a co-located test asserts the two stay in exact parity (no missing or
// orphaned keys). Zero cross-layer imports — the only dependency is the sibling
// TranslationKey brand factory.

import { translationKey, type TranslationKey } from './translation-bundle.js';

/** Chat panel: accessible names, placeholders, composer, and rejection reasons. */
export const CHAT_KEYS = {
    title: translationKey('engine.chat.title'),
    messagesAriaLabel: translationKey('engine.chat.messagesAriaLabel'),
    unavailable: translationKey('engine.chat.unavailable'),
    loading: translationKey('engine.chat.loading'),
    empty: translationKey('engine.chat.empty'),
    inputLabel: translationKey('engine.chat.inputLabel'),
    inputPlaceholder: translationKey('engine.chat.inputPlaceholder'),
    rejectTooLong: translationKey('engine.chat.rejectTooLong'),
    rejectRateLimited: translationKey('engine.chat.rejectRateLimited'),
    rejectEmpty: translationKey('engine.chat.rejectEmpty'),
    rejectInvalidScope: translationKey('engine.chat.rejectInvalidScope'),
    rejectNoSession: translationKey('engine.chat.rejectNoSession'),
    rateLimitedToast: translationKey('engine.chat.rateLimitedToast'),
} as const;

/** Engine-default main-menu button labels. */
export const MENU_KEYS = {
    play: translationKey('engine.menu.play'),
    settings: translationKey('engine.menu.settings'),
    quit: translationKey('engine.menu.quit'),
} as const;

/** Settings modal: field labels, option labels, value formatters, tabs, and the controls panel. */
export const SETTINGS_KEYS = {
    // Field labels (mirrored by the engine-field descriptors in settings/page.tsx).
    masterVolume: translationKey('engine.settings.masterVolume'),
    sfxVolume: translationKey('engine.settings.sfxVolume'),
    musicVolume: translationKey('engine.settings.musicVolume'),
    muted: translationKey('engine.settings.muted'),
    fullscreen: translationKey('engine.settings.fullscreen'),
    vsync: translationKey('engine.settings.vsync'),
    targetFps: translationKey('engine.settings.targetFps'),
    uiScale: translationKey('engine.settings.uiScale'),
    language: translationKey('engine.settings.language'),
    autoSave: translationKey('engine.settings.autoSave'),
    autoSaveInterval: translationKey('engine.settings.autoSaveInterval'),
    showHints: translationKey('engine.settings.showHints'),
    showPerfHud: translationKey('engine.settings.showPerfHud'),
    controlsField: translationKey('engine.settings.controlsField'),
    // Target-FPS option labels.
    fps30: translationKey('engine.settings.fps30'),
    fps60: translationKey('engine.settings.fps60'),
    fps120: translationKey('engine.settings.fps120'),
    fpsUncapped: translationKey('engine.settings.fpsUncapped'),
    // Language option display labels.
    langEnUs: translationKey('engine.settings.langEnUs'),
    langDeDe: translationKey('engine.settings.langDeDe'),
    langEsEs: translationKey('engine.settings.langEsEs'),
    langFrFr: translationKey('engine.settings.langFrFr'),
    // Value formatters (interpolated).
    formatPercent: translationKey('engine.settings.formatPercent'),
    formatScale: translationKey('engine.settings.formatScale'),
    formatTurns: translationKey('engine.settings.formatTurns'),
    // Tab labels.
    tabAudio: translationKey('engine.settings.tabAudio'),
    tabDisplay: translationKey('engine.settings.tabDisplay'),
    tabGameplay: translationKey('engine.settings.tabGameplay'),
    tabControls: translationKey('engine.settings.tabControls'),
    // Modal chrome.
    modalTitle: translationKey('engine.settings.modalTitle'),
    reset: translationKey('engine.settings.reset'),
    close: translationKey('engine.settings.close'),
    tabsAriaLabel: translationKey('engine.settings.tabsAriaLabel'),
    loading: translationKey('engine.settings.loading'),
    // Controls panel.
    keyBindingsManaged: translationKey('engine.settings.keyBindingsManaged'),
    noControls: translationKey('engine.settings.noControls'),
    pressKey: translationKey('engine.settings.pressKey'),
    conflictWith: translationKey('engine.settings.conflictWith'),
    unbindAndRebind: translationKey('engine.settings.unbindAndRebind'),
    rebindSaved: translationKey('engine.settings.rebindSaved'),
    editBinding: translationKey('engine.settings.editBinding'),
    resetBinding: translationKey('engine.settings.resetBinding'),
    unbound: translationKey('engine.settings.unbound'),
} as const;

/** Saves browser modal: chrome, row actions, delete confirmation, and toasts. */
export const SAVES_KEYS = {
    title: translationKey('engine.saves.title'),
    close: translationKey('engine.saves.close'),
    loadingAriaLabel: translationKey('engine.saves.loadingAriaLabel'),
    loading: translationKey('engine.saves.loading'),
    emptyAriaLabel: translationKey('engine.saves.emptyAriaLabel'),
    empty: translationKey('engine.saves.empty'),
    slotCount: translationKey('engine.saves.slotCount'),
    loadRowAriaLabel: translationKey('engine.saves.loadRowAriaLabel'),
    deleteRowAriaLabel: translationKey('engine.saves.deleteRowAriaLabel'),
    loadFailedError: translationKey('engine.saves.loadFailedError'),
    deleteConfirmTitle: translationKey('engine.saves.deleteConfirmTitle'),
    deleteCancel: translationKey('engine.saves.deleteCancel'),
    deleteConfirm: translationKey('engine.saves.deleteConfirm'),
    deleteConfirmBody: translationKey('engine.saves.deleteConfirmBody'),
    deletedToast: translationKey('engine.saves.deletedToast'),
    deleteFailedToast: translationKey('engine.saves.deleteFailedToast'),
} as const;

/** Multiplayer lobby: page chrome, footer actions, error fallbacks, entry tabs, session panel, player list. */
export const LOBBY_KEYS = {
    title: translationKey('engine.lobby.title'),
    close: translationKey('engine.lobby.close'),
    hostLobby: translationKey('engine.lobby.hostLobby'),
    hosting: translationKey('engine.lobby.hosting'),
    joinLobby: translationKey('engine.lobby.joinLobby'),
    joining: translationKey('engine.lobby.joining'),
    leaveLobby: translationKey('engine.lobby.leaveLobby'),
    leaving: translationKey('engine.lobby.leaving'),
    startGame: translationKey('engine.lobby.startGame'),
    starting: translationKey('engine.lobby.starting'),
    errorPrefix: translationKey('engine.lobby.errorPrefix'),
    leaveWarning: translationKey('engine.lobby.leaveWarning'),
    // Error-message fallbacks.
    hostFailed: translationKey('engine.lobby.hostFailed'),
    enterCode: translationKey('engine.lobby.enterCode'),
    joinFailed: translationKey('engine.lobby.joinFailed'),
    leaveFailed: translationKey('engine.lobby.leaveFailed'),
    readyFailed: translationKey('engine.lobby.readyFailed'),
    startFailed: translationKey('engine.lobby.startFailed'),
    matchSettingFailed: translationKey('engine.lobby.matchSettingFailed'),
    playerAttrFailed: translationKey('engine.lobby.playerAttrFailed'),
    addAiFailed: translationKey('engine.lobby.addAiFailed'),
    removeAiFailed: translationKey('engine.lobby.removeAiFailed'),
    // Entry tabs.
    entryTabsAriaLabel: translationKey('engine.lobby.entryTabsAriaLabel'),
    tabHost: translationKey('engine.lobby.tabHost'),
    tabJoin: translationKey('engine.lobby.tabJoin'),
    hostPasswordLabel: translationKey('engine.lobby.hostPasswordLabel'),
    hostPasswordPlaceholder: translationKey('engine.lobby.hostPasswordPlaceholder'),
    codeLabel: translationKey('engine.lobby.codeLabel'),
    codePlaceholder: translationKey('engine.lobby.codePlaceholder'),
    joinPasswordLabel: translationKey('engine.lobby.joinPasswordLabel'),
    joinPasswordPlaceholder: translationKey('engine.lobby.joinPasswordPlaceholder'),
    // Active session panel.
    sessionHeading: translationKey('engine.lobby.sessionHeading'),
    roleHost: translationKey('engine.lobby.roleHost'),
    rolePlayer: translationKey('engine.lobby.rolePlayer'),
    sessionIdLabel: translationKey('engine.lobby.sessionIdLabel'),
    hostIdLabel: translationKey('engine.lobby.hostIdLabel'),
    gameLabel: translationKey('engine.lobby.gameLabel'),
    readyLabel: translationKey('engine.lobby.readyLabel'),
    // Player list.
    playersHeading: translationKey('engine.lobby.playersHeading'),
    you: translationKey('engine.lobby.you'),
    ready: translationKey('engine.lobby.ready'),
    notReady: translationKey('engine.lobby.notReady'),
    toggleReady: translationKey('engine.lobby.toggleReady'),
    updating: translationKey('engine.lobby.updating'),
} as const;

/** Replays browser, playback controls, and the replay player page. */
export const REPLAYS_KEYS = {
    title: translationKey('engine.replays.title'),
    close: translationKey('engine.replays.close'),
    loadingAriaLabel: translationKey('engine.replays.loadingAriaLabel'),
    loading: translationKey('engine.replays.loading'),
    emptyAriaLabel: translationKey('engine.replays.emptyAriaLabel'),
    empty: translationKey('engine.replays.empty'),
    loadFailedError: translationKey('engine.replays.loadFailedError'),
    deterministicBadge: translationKey('engine.replays.deterministicBadge'),
    perspectiveBadge: translationKey('engine.replays.perspectiveBadge'),
    ticksSuffix: translationKey('engine.replays.ticksSuffix'),
    singleViewer: translationKey('engine.replays.singleViewer'),
    openDeterministicAriaLabel: translationKey('engine.replays.openDeterministicAriaLabel'),
    deleteDeterministicAriaLabel: translationKey('engine.replays.deleteDeterministicAriaLabel'),
    openPerspectiveAriaLabel: translationKey('engine.replays.openPerspectiveAriaLabel'),
    deletePerspectiveAriaLabel: translationKey('engine.replays.deletePerspectiveAriaLabel'),
    deleteConfirmTitle: translationKey('engine.replays.deleteConfirmTitle'),
    deleteCancel: translationKey('engine.replays.deleteCancel'),
    deleteConfirm: translationKey('engine.replays.deleteConfirm'),
    deleteConfirmBody: translationKey('engine.replays.deleteConfirmBody'),
    deletedToast: translationKey('engine.replays.deletedToast'),
    deleteFailedToast: translationKey('engine.replays.deleteFailedToast'),
    // Player page.
    playerLoadingAriaLabel: translationKey('engine.replays.playerLoadingAriaLabel'),
    playerLoading: translationKey('engine.replays.playerLoading'),
    noPathError: translationKey('engine.replays.noPathError'),
    openFailedError: translationKey('engine.replays.openFailedError'),
    loadTicksFailedError: translationKey('engine.replays.loadTicksFailedError'),
    loadFrameFailedError: translationKey('engine.replays.loadFrameFailedError'),
    // Playback controls.
    controlsGroupDeterministic: translationKey('engine.replays.controlsGroupDeterministic'),
    controlsGroupPerspective: translationKey('engine.replays.controlsGroupPerspective'),
    saveReplay: translationKey('engine.replays.saveReplay'),
    replaySavedLabel: translationKey('engine.replays.replaySavedLabel'),
    seekStart: translationKey('engine.replays.seekStart'),
    stepBack: translationKey('engine.replays.stepBack'),
    pause: translationKey('engine.replays.pause'),
    play: translationKey('engine.replays.play'),
    stepForward: translationKey('engine.replays.stepForward'),
    seekEnd: translationKey('engine.replays.seekEnd'),
    scrubberLabel: translationKey('engine.replays.scrubberLabel'),
    speedLabel: translationKey('engine.replays.speedLabel'),
    speed05: translationKey('engine.replays.speed05'),
    speed1: translationKey('engine.replays.speed1'),
    speed2: translationKey('engine.replays.speed2'),
    speed4: translationKey('engine.replays.speed4'),
} as const;

/** Engine-wired toast titles (§4.30) and the profile-rejection friendly-reason map. */
export const TOAST_KEYS = {
    playerDisconnected: translationKey('engine.toast.playerDisconnected'),
    playerReconnected: translationKey('engine.toast.playerReconnected'),
    playerLeftGame: translationKey('engine.toast.playerLeftGame'),
    profileRejectedPrefix: translationKey('engine.toast.profileRejectedPrefix'),
    replaySaved: translationKey('engine.toast.replaySaved'),
    restoreCancelled: translationKey('engine.toast.restoreCancelled'),
    gameSaved: translationKey('engine.toast.gameSaved'),
    saveFailed: translationKey('engine.toast.saveFailed'),
    hostAriaLabel: translationKey('engine.toast.hostAriaLabel'),
    // Profile-rejection friendly reasons (interpolated into profileRejectedPrefix).
    profileDisplayNameEmpty: translationKey('engine.toast.profileDisplayNameEmpty'),
    profileDisplayNameTooLong: translationKey('engine.toast.profileDisplayNameTooLong'),
    profileAvatarInvalidMime: translationKey('engine.toast.profileAvatarInvalidMime'),
    profileAvatarTooLarge: translationKey('engine.toast.profileAvatarTooLarge'),
    profileAvatarDecodeFailed: translationKey('engine.toast.profileAvatarDecodeFailed'),
    profileSchemaMismatch: translationKey('engine.toast.profileSchemaMismatch'),
    profileNamespaceCollision: translationKey('engine.toast.profileNamespaceCollision'),
    profileRateLimit: translationKey('engine.toast.profileRateLimit'),
} as const;

/** Engine-default in-game (pause) menu. */
export const IN_GAME_MENU_KEYS = {
    title: translationKey('engine.inGameMenu.title'),
    resume: translationKey('engine.inGameMenu.resume'),
    leaveMatch: translationKey('engine.inGameMenu.leaveMatch'),
    leavePromptHost: translationKey('engine.inGameMenu.leavePromptHost'),
    leavePromptClient: translationKey('engine.inGameMenu.leavePromptClient'),
} as const;

/** In-HUD save-game dialog. */
export const SAVE_GAME_KEYS = {
    save: translationKey('engine.saveGame.save'),
    cancel: translationKey('engine.saveGame.cancel'),
    dialogTitle: translationKey('engine.saveGame.dialogTitle'),
    nameLabel: translationKey('engine.saveGame.nameLabel'),
} as const;

/** Session-restore waiting overlay. */
export const RESTORE_KEYS = {
    waitingTitle: translationKey('engine.restore.waitingTitle'),
    spinnerLabel: translationKey('engine.restore.spinnerLabel'),
    joinCode: translationKey('engine.restore.joinCode'),
    rosterProgress: translationKey('engine.restore.rosterProgress'),
    cancel: translationKey('engine.restore.cancel'),
} as const;

/** Root error-boundary crash fallback. */
export const CRASH_KEYS = {
    heading: translationKey('engine.crash.heading'),
    crashId: translationKey('engine.crash.crashId'),
    returnToMenu: translationKey('engine.crash.returnToMenu'),
    restart: translationKey('engine.crash.restart'),
} as const;

/** Connection-status indicator. */
export const CONNECTION_KEYS = {
    statusAriaLabel: translationKey('engine.connection.statusAriaLabel'),
    // Per-status display words interpolated into statusAriaLabel — the raw
    // ConnectionStatus enum values are wire identifiers, not display strings.
    statusConnected: translationKey('engine.connection.statusConnected'),
    statusDisconnected: translationKey('engine.connection.statusDisconnected'),
    statusConnecting: translationKey('engine.connection.statusConnecting'),
    statusError: translationKey('engine.connection.statusError'),
} as const;

/** GameShell landmark accessible names. */
export const GAME_SHELL_KEYS = {
    mainAriaLabel: translationKey('engine.gameShell.mainAriaLabel'),
    canvasAriaLabel: translationKey('engine.gameShell.canvasAriaLabel'),
    hudAriaLabel: translationKey('engine.gameShell.hudAriaLabel'),
} as const;

/** Engine-default game-over / result banner copy. */
export const GAME_RESULT_KEYS = {
    gameOver: translationKey('engine.gameResult.gameOver'),
    draw: translationKey('engine.gameResult.draw'),
    ended: translationKey('engine.gameResult.ended'),
    won: translationKey('engine.gameResult.won'),
    lose: translationKey('engine.gameResult.lose'),
} as const;

/** Engine-default in-game HUD scaffold (tick readout + undo/redo/end-turn). */
export const HUD_KEYS = {
    tick: translationKey('engine.hud.tick'),
    undo: translationKey('engine.hud.undo'),
    redo: translationKey('engine.hud.redo'),
    endTurn: translationKey('engine.hud.endTurn'),
} as const;

/**
 * Performance HUD metric rows (§4.16). Each template interpolates the
 * pre-formatted `{value}` (the numeric scaling/units stay with the component,
 * mirroring the settings value formatters).
 */
export const PERF_HUD_KEYS = {
    fps: translationKey('engine.perfHud.fps'),
    frameAvg: translationKey('engine.perfHud.frameAvg'),
    frameP95: translationKey('engine.perfHud.frameP95'),
    simTick: translationKey('engine.perfHud.simTick'),
    actionsPerSec: translationKey('engine.perfHud.actionsPerSec'),
    actionRtt: translationKey('engine.perfHud.actionRtt'),
    ping: translationKey('engine.perfHud.ping'),
    heap: translationKey('engine.perfHud.heap'),
    drawCalls: translationKey('engine.perfHud.drawCalls'),
    triangles: translationKey('engine.perfHud.triangles'),
} as const;

/**
 * Engine-reserved input-action descriptions (§4.26). Engine actions are hidden
 * from the player-rebindable Controls panel, but their descriptions can still
 * surface (the rebind-conflict message), so they resolve through tokens.
 */
export const ACTIONS_KEYS = {
    undo: translationKey('engine.actions.undo'),
    redo: translationKey('engine.actions.redo'),
    toggleMenu: translationKey('engine.actions.toggleMenu'),
    togglePerfHud: translationKey('engine.actions.togglePerfHud'),
    toggleDebugInspector: translationKey('engine.actions.toggleDebugInspector'),
    toggleI18nTokenMode: translationKey('engine.actions.toggleI18nTokenMode'),
} as const;

/** Cross-cutting UI primitives shared across surfaces. */
export const COMMON_KEYS = {
    close: translationKey('engine.common.close'),
    cancel: translationKey('engine.common.cancel'),
    confirm: translationKey('engine.common.confirm'),
} as const;

// The grouped maps share leaf names across areas (`title`, `close`, `cancel`,
// …), so a spread aggregate keyed by leaf name would silently collapse them.
// Key the flat aggregate by each token's *full* string instead — those are
// unique by construction (the `engine.<area>.` prefix disambiguates) — so every
// token survives.
const ALL_AREA_MAPS = [
    CHAT_KEYS,
    MENU_KEYS,
    SETTINGS_KEYS,
    SAVES_KEYS,
    LOBBY_KEYS,
    REPLAYS_KEYS,
    TOAST_KEYS,
    IN_GAME_MENU_KEYS,
    SAVE_GAME_KEYS,
    RESTORE_KEYS,
    CRASH_KEYS,
    CONNECTION_KEYS,
    GAME_SHELL_KEYS,
    GAME_RESULT_KEYS,
    HUD_KEYS,
    PERF_HUD_KEYS,
    ACTIONS_KEYS,
    COMMON_KEYS,
] as const;

/**
 * Flat aggregate of every engine token, keyed by the token's own string, for
 * callers that need to iterate the whole catalogue (the parity test; the future
 * token-consumer wiring). Grouped per-area maps above are the ergonomic import
 * surface for components.
 */
export const ENGINE_KEYS: Readonly<Record<string, TranslationKey>> = Object.fromEntries(
    ALL_AREA_MAPS.flatMap((area) => Object.values(area)).map((token) => [token, token]),
);
