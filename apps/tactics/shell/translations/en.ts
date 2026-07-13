// apps/tactics/shell/translations/en.ts
//
// Tactics' base English translation bundle. This is the game's contributed
// override for the `en-US` locale (game override → engineDefault → raw key): it
// supplies every `game.tactics.*` token the Tactics renderer consumes AND
// re-keys a single engine token (`engine.chat.title`) to relabel the shared chat
// panel in the Tactics context.
//
// Every `game.tactics.*` value here MUST be byte-identical to the string the
// corresponding component rendered before tokenisation, so adopting i18n leaves
// en-US visually unchanged. A paired parity test keeps this bundle in exact key
// parity with the `cs.ts` translation and the `keys.ts` catalogue.
//
// Boundary-restricted pure data (§3): zero imports — no renderer runtime (not
// even the TranslationBundle type), no React, no simulation/ai, no Electron. The
// bundle's shape is structurally the runtime's `TranslationBundle`
// (`Readonly<Record<string, string>>`); the registration loader (Part D) types it
// against the real contract when it wires this into the provider. Templates may
// embed ICU syntax (see renderer/i18n/format-message.ts); this module never
// parses it.

export const tacticsBundleEn: Readonly<Record<string, string>> = {
    // ── engine-token override ───────────────────────────────────────────────────
    // Overrides the engine chat title so the shared ChatPanel's accessible name
    // and the wrapping Drawer's caption are named for the Tactics context and
    // switch with the locale.
    'engine.chat.title': 'Match chat',

    // ── hud ─────────────────────────────────────────────────────────────────────
    'game.tactics.hud.turnYours': 'Your turn',
    'game.tactics.hud.turnWaiting': 'Waiting',
    'game.tactics.hud.stamina': 'Stamina',
    'game.tactics.hud.tick': 'Tactics Tick',
    'game.tactics.hud.waitingForCommitments': 'Waiting for other player(s)…',
    'game.tactics.hud.undo': 'Undo',
    'game.tactics.hud.redo': 'Redo',
    'game.tactics.hud.endTurn': 'End Turn',
    'game.tactics.hud.chat': 'Chat',
    'game.tactics.hud.hideChat': 'Hide chat',
    'game.tactics.hud.hudAriaLabel': 'Game HUD',
    'game.tactics.hud.actionsAriaLabel': 'Tactics actions',

    // ── in-game (leave) menu ────────────────────────────────────────────────────
    'game.tactics.inGameMenu.leaveTitle': 'Leave the battle?',
    'game.tactics.inGameMenu.leavePromptHost':
        'Leaving ends the battle for everyone and returns all players to the lobby.',
    'game.tactics.inGameMenu.leavePromptClient':
        'Leaving disconnects you from the battle and returns you to the main menu.',
    'game.tactics.inGameMenu.cancel': 'Cancel',
    'game.tactics.inGameMenu.leaveConfirm': 'Leave battle',

    // ── result banner ───────────────────────────────────────────────────────────
    'game.tactics.result.victory': 'Tactical Victory',
    'game.tactics.result.defeat': 'Tactical Defeat',
    'game.tactics.result.stalemate': 'Stalemate',
    'game.tactics.result.concluded': 'Battle Concluded',
    'game.tactics.result.iconVictory': 'Victory',
    'game.tactics.result.iconDefeat': 'Defeat',
    'game.tactics.result.iconDraw': 'Draw',
    'game.tactics.result.iconConcluded': 'Concluded',
    'game.tactics.result.continueHint': 'Press Enter to continue',

    // ── post-game summary ───────────────────────────────────────────────────────
    'game.tactics.summary.badgeVictory': 'Victory',
    'game.tactics.summary.badgeDefeat': 'Defeat',
    'game.tactics.summary.badgeStalemate': 'Stalemate',
    'game.tactics.summary.badgeConcluded': 'Concluded',
    'game.tactics.summary.messageWin': 'Mission accomplished. Your formation controls the field.',
    'game.tactics.summary.messageLoss': 'Operation failed. Regroup and prepare a new strategy.',
    'game.tactics.summary.messageDraw': 'No decisive winner. Tactical parity achieved.',
    'game.tactics.summary.messageUnknown': 'Game completed. Final battlefield report is available.',
    'game.tactics.summary.panelTitle': 'Post-Game Summary',
    'game.tactics.summary.replayButton': 'Replay',
    'game.tactics.summary.replayError': 'Could not open replay.',

    // ── demo board ──────────────────────────────────────────────────────────────
    'game.tactics.board.loadingAriaLabel': 'Tactics board loading',
    'game.tactics.board.emptyAriaLabel': 'No visible tactics units',
    'game.tactics.board.ariaLabel': 'Tactics board',
    'game.tactics.board.revealed': 'Revealed {player}: {actions}',

    // ── lobby ───────────────────────────────────────────────────────────────────
    'game.tactics.lobby.battleSetup': 'Battle Setup',
    'game.tactics.lobby.roleHost': 'Host',
    'game.tactics.lobby.rolePlayer': 'Player',
    'game.tactics.lobby.addressLabel': 'Lobby address',
    'game.tactics.lobby.copyAddressAriaLabel': 'Copy lobby address',
    'game.tactics.lobby.boardColour': 'Board colour',
    'game.tactics.lobby.simultaneousTurns': 'Simultaneous turns',
    'game.tactics.lobby.readySummary': 'Ready: {ready}/{total}',
    'game.tactics.lobby.players': 'Players',
    'game.tactics.lobby.you': '(You)',
    'game.tactics.lobby.ready': 'Ready',
    'game.tactics.lobby.notReady': 'Not Ready',
    'game.tactics.lobby.playerColourAriaLabel': '{name} colour',
    'game.tactics.lobby.readyToggle': 'Ready',
    'game.tactics.lobby.aiPlayers': 'AI Players',
    'game.tactics.lobby.addAiAriaLabel': 'Add AI player',
    'game.tactics.lobby.noAiPlayers': 'No AI players added.',
    'game.tactics.lobby.aiBadge': 'AI',
    'game.tactics.lobby.aiPlayerName': 'AI Player {n}',
    'game.tactics.lobby.removeAiAriaLabel': 'Remove AI Player {n}',

    // ── main menu ───────────────────────────────────────────────────────────────
    'game.tactics.menu.newGame': 'New Game',
    'game.tactics.menu.loadGame': 'Load Game',
    'game.tactics.menu.settings': 'Settings',
    'game.tactics.menu.replays': 'Replays',
    'game.tactics.menu.quit': 'Quit',

    // ── settings ────────────────────────────────────────────────────────────────
    'game.tactics.settings.tabAudio': 'Audio',
    'game.tactics.settings.tabDisplay': 'Display',
    'game.tactics.settings.tabGameplay': 'Gameplay',
    'game.tactics.settings.tabAi': 'AI',
    'game.tactics.settings.tabControls': 'Controls',
    'game.tactics.settings.showGrid': 'Show Grid',
    'game.tactics.settings.animationSpeed': 'Animation Speed',
    'game.tactics.settings.showDamageNumbers': 'Show Damage Numbers',
    'game.tactics.settings.aiThinkingDelay': 'AI Thinking Delay',
    'game.tactics.settings.animSpeedSlow': 'Slow',
    'game.tactics.settings.animSpeedNormal': 'Normal',
    'game.tactics.settings.animSpeedFast': 'Fast',
    'game.tactics.settings.animSpeedInstant': 'Instant',

    // ── shell background ────────────────────────────────────────────────────────
    'game.tactics.shell.subtitle': 'Chimera testing stub',
};
