// renderer/i18n/engine-bundle.en.ts
//
// The engine's base English translation bundle: the single source of truth for
// every user-facing string the engine itself ships. This is the `engineDefault`
// layer of the fallback chain (game override → engineDefault → raw key), so it
// must be exhaustive for engine UI — with no game override, every engine string
// still renders here in English.
//
// Namespace convention: `engine.<area>.<name>` (see engine-keys.ts, the token
// catalogue this bundle is kept in exact parity with). Games localise the
// engine by RE-KEYING these exact tokens in their own override bundle (e.g.
// supplying `engine.chat.title`); a game override wins, but never deletes — an
// un-overridden token always still resolves to its English default here.
//
// Templates may embed ICU syntax (see format-message.ts); this module is plain
// data and never parses it. Interpolated strings use `{param}`; countable ones
// use `{n, plural, one {…} other {…}}`. Zero cross-layer imports: the only
// dependency is the sibling `TranslationBundle` type. No React, no simulation
// or AI runtime, no Electron, no game module.

import type { TranslationBundle } from './translation-bundle.js';

export const engineBundleEn: TranslationBundle = {
    // ── chat ──────────────────────────────────────────────────────────────────
    'engine.chat.title': 'Chat',
    'engine.chat.messagesAriaLabel': 'Chat messages',
    'engine.chat.unavailable': 'Chat is unavailable.',
    'engine.chat.loading': 'Loading messages…',
    'engine.chat.empty': 'No messages yet.',
    'engine.chat.inputLabel': 'Message',
    'engine.chat.inputPlaceholder': 'Type a message and press Enter…',
    'engine.chat.rejectTooLong': 'Message is too long.',
    'engine.chat.rejectRateLimited': 'You are sending messages too quickly.',
    'engine.chat.rejectEmpty': 'Message cannot be empty.',
    'engine.chat.rejectInvalidScope': 'That recipient is unavailable.',
    'engine.chat.rejectNoSession': 'You are not connected to a session.',
    'engine.chat.rateLimitedToast': 'Sending messages too quickly',

    // ── menu ──────────────────────────────────────────────────────────────────
    'engine.menu.play': 'Play',
    'engine.menu.settings': 'Settings',
    'engine.menu.quit': 'Quit',

    // ── settings ────────────────────────────────────────────────────────────────
    'engine.settings.masterVolume': 'Master Volume',
    'engine.settings.sfxVolume': 'SFX Volume',
    'engine.settings.musicVolume': 'Music Volume',
    'engine.settings.muted': 'Muted',
    'engine.settings.targetFps': 'Target FPS',
    'engine.settings.language': 'Language',
    'engine.settings.autoSave': 'Auto Save',
    'engine.settings.autoSaveInterval': 'Auto Save Interval',
    'engine.settings.showHints': 'Show Hints',
    'engine.settings.showPerfHud': 'Show Performance HUD',
    'engine.settings.controlsField': 'Controls',
    'engine.settings.fps30': '30 FPS',
    'engine.settings.fps60': '60 FPS',
    'engine.settings.fps120': '120 FPS',
    'engine.settings.fpsUncapped': 'Uncapped',
    // Language endonyms: accents corrected vs. the ASCII source labels
    // ('Espanol'/'Francais') as a deliberate text fix in this task.
    'engine.settings.langEnUs': 'English (US)',
    'engine.settings.langDeDe': 'Deutsch',
    'engine.settings.langEsEs': 'Español',
    'engine.settings.langFrFr': 'Français',
    // Value formatters. Numeric scaling/rounding stays with the consumer (the
    // source does `value*100` for percent), so `n` is the already-scaled,
    // already-rounded value; these tokens only render it.
    'engine.settings.formatPercent': '{n}%',
    // Pluralized deliberately: the source renders "{n} turns" unconditionally,
    // so this corrects the singular case ("1 turn") when a consumer adopts it.
    'engine.settings.formatTurns': '{n, plural, one {# turn} other {# turns}}',
    'engine.settings.tabAudio': 'Audio',
    'engine.settings.tabDisplay': 'Display',
    'engine.settings.tabGameplay': 'Gameplay',
    'engine.settings.tabControls': 'Controls',
    'engine.settings.modalTitle': 'Settings',
    'engine.settings.reset': 'Reset',
    'engine.settings.close': 'Close',
    'engine.settings.tabsAriaLabel': 'Settings categories',
    'engine.settings.loading': 'Loading settings',
    'engine.settings.noSettings': 'No settings available.',
    'engine.settings.keyBindingsManaged': 'Key bindings are managed by the engine controls panel.',
    'engine.settings.noControls': 'No controls registered.',
    'engine.settings.pressKey': 'Press a key...',
    'engine.settings.conflictWith': 'Conflict with ',
    'engine.settings.unbindAndRebind': 'Unbind existing & rebind',
    'engine.settings.rebindSaved': 'Saved',
    'engine.settings.editBinding': 'Edit',
    'engine.settings.resetBinding': 'Reset',
    'engine.settings.unbound': 'Unbound',

    // ── saves ─────────────────────────────────────────────────────────────────
    'engine.saves.title': 'Saves',
    'engine.saves.close': 'Close',
    'engine.saves.loadingAriaLabel': 'Loading save slots',
    'engine.saves.loading': 'Loading…',
    'engine.saves.emptyAriaLabel': 'No saves yet',
    'engine.saves.empty': 'No saves yet.',
    // Anticipatory: no current surface renders a save count — this is the
    // canonical ICU-plural token the feature specifies, provided so the format
    // contract is exercised and a future save-count consumer has a token to bind.
    'engine.saves.slotCount': '{n, plural, one {# save} other {# saves}}',
    'engine.saves.loadRowAriaLabel': 'Load {title}',
    'engine.saves.deleteRowAriaLabel': 'Delete {title}',
    'engine.saves.loadFailedError': 'Load failed: {message}',
    'engine.saves.deleteConfirmTitle': 'Delete save?',
    'engine.saves.deleteCancel': 'Cancel',
    'engine.saves.deleteConfirm': 'Delete',
    'engine.saves.deleteConfirmBody':
        'This save will be permanently deleted. This cannot be undone.',
    'engine.saves.deletedToast': 'Save deleted',
    'engine.saves.deleteFailedToast': 'Delete failed',

    // ── lobby ─────────────────────────────────────────────────────────────────
    'engine.lobby.title': 'Multiplayer Lobby',
    'engine.lobby.close': 'Close',
    'engine.lobby.hostLobby': 'Host Lobby',
    'engine.lobby.hosting': 'Hosting...',
    'engine.lobby.joinLobby': 'Join Lobby',
    'engine.lobby.joining': 'Joining...',
    'engine.lobby.leaveLobby': 'Leave Lobby',
    'engine.lobby.leaving': 'Leaving...',
    'engine.lobby.startGame': 'Start Game',
    'engine.lobby.starting': 'Starting...',
    'engine.lobby.errorPrefix': 'Error: {error}',
    'engine.lobby.leaveWarning': 'This will disconnect you from the current lobby',
    'engine.lobby.hostFailed': 'Failed to host lobby',
    'engine.lobby.enterCode': 'Please enter a lobby code',
    'engine.lobby.joinFailed': 'Failed to join lobby',
    'engine.lobby.leaveFailed': 'Failed to leave lobby',
    'engine.lobby.readyFailed': 'Failed to update ready state',
    'engine.lobby.startFailed': 'Failed to start game',
    'engine.lobby.matchSettingFailed': 'Failed to update match setting',
    'engine.lobby.playerAttrFailed': 'Failed to update player attribute',
    'engine.lobby.addAiFailed': 'Failed to add AI player',
    'engine.lobby.removeAiFailed': 'Failed to remove AI player',
    'engine.lobby.entryTabsAriaLabel': 'Lobby entry mode',
    'engine.lobby.tabHost': 'Host',
    'engine.lobby.tabJoin': 'Join',
    'engine.lobby.hostPasswordLabel': 'Password (optional):',
    'engine.lobby.hostPasswordPlaceholder': 'Leave blank for an open lobby',
    'engine.lobby.codeLabel': 'Lobby Code:',
    'engine.lobby.codePlaceholder': '127.0.0.1:7777',
    'engine.lobby.joinPasswordLabel': 'Password:',
    'engine.lobby.joinPasswordPlaceholder': 'Required only if the host set one',
    'engine.lobby.sessionHeading': 'Session',
    'engine.lobby.sessionIdLabel': 'Session ID:',
    'engine.lobby.copySessionAriaLabel': 'Copy session ID',
    'engine.lobby.hostIdLabel': 'Host ID:',
    'engine.lobby.gameLabel': 'Game:',
    'engine.lobby.playersHeading': 'Players ({n})',
    'engine.lobby.readySummary': 'Ready: {ready}/{total}',
    'engine.lobby.you': '(You)',
    'engine.lobby.ready': 'Ready',
    'engine.lobby.notReady': 'Not Ready',
    'engine.lobby.toggleReady': 'Toggle Ready',

    // ── replays ─────────────────────────────────────────────────────────────────
    'engine.replays.title': 'Replays',
    'engine.replays.close': 'Close',
    'engine.replays.loadingAriaLabel': 'Loading replays',
    'engine.replays.loading': 'Loading…',
    'engine.replays.emptyAriaLabel': 'No replays saved yet',
    'engine.replays.empty': 'No replays saved yet.',
    'engine.replays.loadFailedError': 'Failed to load replays',
    'engine.replays.deterministicBadge': 'Deterministic',
    // Pluralized deliberately: the source renders "{n} ticks" unconditionally,
    // so this corrects the singular case ("1 tick") when a consumer adopts it.
    'engine.replays.ticksSuffix': '{n, plural, one {# tick} other {# ticks}}',
    'engine.replays.openDeterministicAriaLabel': 'Open replay recorded {recorded}',
    'engine.replays.deleteDeterministicAriaLabel': 'Delete replay recorded {recorded}',
    'engine.replays.openPerspectiveAriaLabel': 'Open perspective replay {label}',
    'engine.replays.deletePerspectiveAriaLabel': 'Delete perspective replay {label}',
    'engine.replays.deleteConfirmTitle': 'Delete replay?',
    'engine.replays.deleteCancel': 'Cancel',
    'engine.replays.deleteConfirm': 'Delete',
    'engine.replays.deleteConfirmBody':
        'This replay will be permanently deleted. This cannot be undone.',
    'engine.replays.deletedToast': 'Replay deleted',
    'engine.replays.deleteFailedToast': 'Delete failed',
    'engine.replays.playerLoadingAriaLabel': 'Loading replay',
    'engine.replays.playerLoading': 'Loading replay…',
    'engine.replays.noPathError': 'No replay path provided.',
    'engine.replays.openFailedError': 'Failed to open replay.',
    'engine.replays.loadTicksFailedError': 'Failed to load ticks.',
    'engine.replays.loadFrameFailedError': 'Failed to load frame.',
    'engine.replays.controlsGroupDeterministic': 'Replay playback controls',
    'engine.replays.controlsGroupPerspective': 'Perspective replay playback controls',
    'engine.replays.saveReplay': 'Save replay',
    'engine.replays.replaySavedLabel': 'Replay saved',
    'engine.replays.saveDialogTitle': 'Save replay',
    'engine.replays.saveNameLabel': 'Name',
    'engine.replays.saveCancel': 'Cancel',
    'engine.replays.saveConfirm': 'Save',
    'engine.replays.untitledReplay': 'Untitled replay',
    'engine.replays.seekStart': 'Seek to start',
    'engine.replays.stepBack': 'Step back',
    'engine.replays.pause': 'Pause',
    'engine.replays.play': 'Play',
    'engine.replays.stepForward': 'Step forward',
    'engine.replays.seekEnd': 'Seek to end',
    'engine.replays.scrubberLabel': 'Replay position',
    'engine.replays.speedLabel': 'Playback speed',
    'engine.replays.speed05': '0.5×',
    'engine.replays.speed1': '1×',
    'engine.replays.speed2': '2×',
    'engine.replays.speed4': '4×',

    // ── toast (§4.30 engine-wired) ────────────────────────────────────────────
    'engine.toast.playerDisconnected': 'Player disconnected',
    'engine.toast.playerReconnected': 'Player reconnected',
    'engine.toast.playerLeftGame': '{displayName} left game.',
    'engine.toast.profileRejectedPrefix': 'Profile rejected: {reason}',
    'engine.toast.replaySaved': 'Replay saved',
    'engine.toast.restoreCancelled': 'Restore cancelled',
    'engine.toast.gameSaved': 'Game saved',
    'engine.toast.saveFailed': 'Save failed',
    'engine.toast.hostAriaLabel': 'Notifications',
    'engine.toast.profileDisplayNameEmpty': 'display name is required',
    'engine.toast.profileDisplayNameTooLong': 'display name is too long',
    'engine.toast.profileAvatarInvalidMime': 'avatar image type is not supported',
    'engine.toast.profileAvatarTooLarge': 'avatar image is too large',
    'engine.toast.profileAvatarDecodeFailed': 'avatar image could not be read',
    'engine.toast.profileSchemaMismatch': 'profile data is invalid',
    'engine.toast.profileNamespaceCollision': 'that profile is already in use',
    'engine.toast.profileRateLimit': 'updating too quickly',

    // ── in-game menu ────────────────────────────────────────────────────────────
    'engine.inGameMenu.title': 'Menu',
    'engine.inGameMenu.resume': 'Resume',
    'engine.inGameMenu.leaveMatch': 'Leave match',
    'engine.inGameMenu.leavePromptHost':
        'Leave the match? This ends it for everyone and returns all players to the lobby.',
    'engine.inGameMenu.leavePromptClient':
        'Leave the match? You will disconnect and return to the main menu.',

    // ── save-game dialog ────────────────────────────────────────────────────────
    'engine.saveGame.save': 'Save',
    'engine.saveGame.cancel': 'Cancel',
    'engine.saveGame.dialogTitle': 'Save game',
    'engine.saveGame.nameLabel': 'Name',

    // ── restore overlay ─────────────────────────────────────────────────────────
    'engine.restore.waitingTitle': 'Waiting for players',
    'engine.restore.spinnerLabel': 'Waiting for players to reconnect',
    'engine.restore.joinCode': 'Join code: {code}',
    'engine.restore.rosterProgress': '{connected} / {expected} players reconnected',
    'engine.restore.cancel': 'Cancel',

    // ── crash boundary ──────────────────────────────────────────────────────────
    'engine.crash.heading': 'An unexpected error occurred.',
    'engine.crash.crashId': 'Crash ID: {crashId}',
    'engine.crash.returnToMenu': 'Return to Main Menu',
    'engine.crash.restart': 'Restart Application',

    // ── connection status ───────────────────────────────────────────────────────
    'engine.connection.statusAriaLabel': 'Connection status: {status}',
    // Per-status display words for the {status} slot. The English values equal
    // the ConnectionStatus enum identifiers on purpose — the en-US aria output
    // stays byte-identical to the pre-tokenised rendering.
    'engine.connection.statusConnected': 'connected',
    'engine.connection.statusDisconnected': 'disconnected',
    'engine.connection.statusConnecting': 'connecting',
    'engine.connection.statusError': 'error',

    // ── game shell landmarks ────────────────────────────────────────────────────
    'engine.gameShell.mainAriaLabel': 'Game',
    'engine.gameShell.canvasAriaLabel': 'Game canvas',
    'engine.gameShell.hudAriaLabel': 'Game HUD',

    // ── game result / game-over banner ──────────────────────────────────────────
    'engine.gameResult.gameOver': 'Game Over',
    'engine.gameResult.draw': 'Draw',
    'engine.gameResult.ended': 'Game ended',
    'engine.gameResult.won': 'You won',
    'engine.gameResult.lose': 'You lose',

    // ── in-game HUD scaffold ────────────────────────────────────────────────────
    'engine.hud.undo': 'Undo',
    'engine.hud.redo': 'Redo',
    'engine.hud.endTurn': 'End Turn',

    // ── performance HUD (§4.16) ─────────────────────────────────────────────────
    // {value} carries the pre-formatted reading (number + unit); the component
    // keeps the numeric scaling, mirroring the settings value formatters.
    'engine.perfHud.fps': 'FPS: {value}',
    'engine.perfHud.frameAvg': 'Frame avg: {value}',
    'engine.perfHud.frameP95': 'Frame p95: {value}',
    'engine.perfHud.simTick': 'Sim tick: {value}',
    'engine.perfHud.actionsPerSec': 'Actions/s: {value}',
    'engine.perfHud.actionRtt': 'Action RTT: {value}',
    'engine.perfHud.ping': 'Ping: {value}',
    'engine.perfHud.heap': 'Heap: {value}',
    'engine.perfHud.drawCalls': 'Draw calls: {value}',
    'engine.perfHud.triangles': 'Triangles: {value}',

    // ── engine-reserved input-action descriptions (§4.26) ───────────────────────
    'engine.actions.undo': 'Undo last action',
    'engine.actions.redo': 'Redo last undone action',
    'engine.actions.toggleMenu': 'Toggle game menu',
    'engine.actions.togglePerfHud': 'Toggle performance HUD',
    'engine.actions.toggleDebugInspector': 'Toggle debug inspector',
    'engine.actions.toggleI18nTokenMode': 'Toggle translation token display',
    'engine.actions.spectateCycle': 'Spectate next player',

    // ── spectator HUD (Invariant #114) ──────────────────────────────────────────
    'engine.spectate.modeLabel': 'Spectating',
    'engine.spectate.switchHint': 'Press {key} to switch',
    'engine.spectate.switchAction': 'Switch view',

    // ── common ────────────────────────────────────────────────────────────────
    'engine.common.close': 'Close',
    'engine.common.cancel': 'Cancel',
    'engine.common.confirm': 'Confirm',
};
