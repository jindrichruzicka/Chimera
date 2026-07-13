// apps/tactics/shell/translations/cs.ts
//
// Tactics' Czech (`cs-CZ`) translation bundle — the game's contributed override
// for the Czech locale. It carries the IDENTICAL key set to the English bundle
// (`en.ts`), including the `engine.chat.title` engine-token override, so a parity
// test keeps the two locales symmetric. ICU plural templates use Czech plural
// categories (one=1, few=2–4, many=fractions, other=0/5+), selected at render by
// Intl.PluralRules('cs-CZ').
//
// Boundary-restricted pure data (§3): zero imports — no renderer runtime (not
// even the TranslationBundle type), no React, no simulation/ai, no Electron. The
// bundle's shape is structurally the runtime's `TranslationBundle`
// (`Readonly<Record<string, string>>`).

export const tacticsBundleCs: Readonly<Record<string, string>> = {
    // ── engine-token override ───────────────────────────────────────────────────
    'engine.chat.title': 'Zápasový chat',

    // ── hud ─────────────────────────────────────────────────────────────────────
    'game.tactics.hud.turnYours': 'Tvůj tah',
    'game.tactics.hud.turnWaiting': 'Čekání',
    'game.tactics.hud.stamina': 'Výdrž',
    'game.tactics.hud.tick': 'Takt Tactics',
    'game.tactics.hud.waitingForCommitments': 'Čekání na ostatní hráče…',
    'game.tactics.hud.undo': 'Zpět',
    'game.tactics.hud.redo': 'Znovu',
    'game.tactics.hud.endTurn': 'Ukončit tah',
    'game.tactics.hud.chat': 'Chat',
    'game.tactics.hud.hideChat': 'Skrýt chat',
    'game.tactics.hud.hudAriaLabel': 'Herní HUD',
    'game.tactics.hud.actionsAriaLabel': 'Akce Tactics',

    // ── in-game (leave) menu ────────────────────────────────────────────────────
    'game.tactics.inGameMenu.leaveTitle': 'Opustit bitvu?',
    'game.tactics.inGameMenu.leavePromptHost':
        'Odchodem ukončíš bitvu pro všechny a vrátíš všechny hráče do lobby.',
    'game.tactics.inGameMenu.leavePromptClient':
        'Odchodem se odpojíš od bitvy a vrátíš se do hlavního menu.',
    'game.tactics.inGameMenu.cancel': 'Zrušit',
    'game.tactics.inGameMenu.leaveConfirm': 'Opustit bitvu',

    // ── result banner ───────────────────────────────────────────────────────────
    'game.tactics.result.victory': 'Taktické vítězství',
    'game.tactics.result.defeat': 'Taktická porážka',
    'game.tactics.result.stalemate': 'Pat',
    'game.tactics.result.concluded': 'Bitva skončila',
    'game.tactics.result.iconVictory': 'Vítězství',
    'game.tactics.result.iconDefeat': 'Porážka',
    'game.tactics.result.iconDraw': 'Remíza',
    'game.tactics.result.iconConcluded': 'Ukončeno',
    'game.tactics.result.continueHint': 'Pokračuj stisknutím Enter',

    // ── post-game summary ───────────────────────────────────────────────────────
    'game.tactics.summary.badgeVictory': 'Vítězství',
    'game.tactics.summary.badgeDefeat': 'Porážka',
    'game.tactics.summary.badgeStalemate': 'Pat',
    'game.tactics.summary.badgeConcluded': 'Ukončeno',
    'game.tactics.summary.messageWin': 'Mise splněna. Tvá formace ovládá pole.',
    'game.tactics.summary.messageLoss':
        'Operace selhala. Přeskupte se a připravte novou strategii.',
    'game.tactics.summary.messageDraw': 'Bez jasného vítěze. Dosaženo taktické rovnováhy.',
    'game.tactics.summary.messageUnknown':
        'Hra dokončena. Závěrečná zpráva z bojiště je k dispozici.',
    'game.tactics.summary.panelTitle': 'Shrnutí po hře',
    'game.tactics.summary.replayButton': 'Záznam',
    'game.tactics.summary.replayError': 'Záznam se nepodařilo otevřít.',

    // ── demo board ──────────────────────────────────────────────────────────────
    'game.tactics.board.loadingAriaLabel': 'Načítání herního pole Tactics',
    'game.tactics.board.emptyAriaLabel': 'Žádné viditelné jednotky Tactics',
    'game.tactics.board.ariaLabel': 'Herní pole Tactics',
    'game.tactics.board.revealed': 'Odhaleno {player}: {actions}',

    // ── lobby ───────────────────────────────────────────────────────────────────
    'game.tactics.lobby.battleSetup': 'Nastavení bitvy',
    'game.tactics.lobby.roleHost': 'Hostitel',
    'game.tactics.lobby.rolePlayer': 'Hráč',
    'game.tactics.lobby.addressLabel': 'Adresa lobby',
    'game.tactics.lobby.copyAddressAriaLabel': 'Kopírovat adresu lobby',
    'game.tactics.lobby.boardColour': 'Barva pole',
    'game.tactics.lobby.simultaneousTurns': 'Souběžné tahy',
    'game.tactics.lobby.readySummary': 'Připraveni: {ready}/{total}',
    'game.tactics.lobby.players': 'Hráči',
    'game.tactics.lobby.you': '(Ty)',
    'game.tactics.lobby.ready': 'Připraven',
    'game.tactics.lobby.notReady': 'Nepřipraven',
    'game.tactics.lobby.playerColourAriaLabel': 'Barva hráče {name}',
    'game.tactics.lobby.readyToggle': 'Připraven',
    'game.tactics.lobby.aiPlayers': 'Hráči AI',
    'game.tactics.lobby.addAiAriaLabel': 'Přidat hráče AI',
    'game.tactics.lobby.noAiPlayers': 'Žádní hráči AI nebyli přidáni.',
    'game.tactics.lobby.aiBadge': 'AI',
    'game.tactics.lobby.aiPlayerName': 'Hráč AI {n}',
    'game.tactics.lobby.removeAiAriaLabel': 'Odebrat hráče AI {n}',

    // ── main menu ───────────────────────────────────────────────────────────────
    'game.tactics.menu.newGame': 'Nová hra',
    'game.tactics.menu.loadGame': 'Načíst hru',
    'game.tactics.menu.settings': 'Nastavení',
    'game.tactics.menu.replays': 'Záznamy',
    'game.tactics.menu.quit': 'Ukončit',

    // ── settings ────────────────────────────────────────────────────────────────
    'game.tactics.settings.tabAudio': 'Zvuk',
    'game.tactics.settings.tabDisplay': 'Zobrazení',
    'game.tactics.settings.tabGameplay': 'Hratelnost',
    'game.tactics.settings.tabAi': 'AI',
    'game.tactics.settings.tabControls': 'Ovládání',
    'game.tactics.settings.showGrid': 'Zobrazit mřížku',
    'game.tactics.settings.animationSpeed': 'Rychlost animace',
    'game.tactics.settings.showDamageNumbers': 'Zobrazit čísla poškození',
    'game.tactics.settings.aiThinkingDelay': 'Prodleva přemýšlení AI',
    'game.tactics.settings.animSpeedSlow': 'Pomalá',
    'game.tactics.settings.animSpeedNormal': 'Normální',
    'game.tactics.settings.animSpeedFast': 'Rychlá',
    'game.tactics.settings.animSpeedInstant': 'Okamžitá',

    // ── shell background ────────────────────────────────────────────────────────
    'game.tactics.shell.subtitle': 'Testovací výplň Chimera',
};
