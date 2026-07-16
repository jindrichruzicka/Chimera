// apps/tactics/shell/translations/cs.ts
//
// Tactics' Czech (`cs-CZ`) translation bundle — the game's contributed override
// for the Czech locale. It supplies every `game.tactics.*` token (in exact key
// parity with `en.ts`) AND re-keys the FULL engine token catalogue, so the
// whole engine UI (settings chrome, saves, lobby, replays, toasts, HUD
// scaffold) renders Czech — the engine ships English only, and re-keying is the
// sanctioned localisation mechanism (Invariant #112). The parity test locks the
// full-catalogue coverage, so an engine token added later fails the reference
// game's tests until translated here. ICU plural templates use Czech plural
// categories (one=1, few=2–4, many=fractions, other=0/5+), selected at render by
// Intl.PluralRules('cs-CZ').
//
// Boundary-restricted pure data (§3): zero imports — no renderer runtime (not
// even the TranslationBundle type), no React, no simulation/ai, no Electron. The
// bundle's shape is structurally the runtime's `TranslationBundle`
// (`Readonly<Record<string, string>>`).

export const tacticsBundleCs: Readonly<Record<string, string>> = {
    // ═══ engine-token re-keys — the full catalogue, in engine-bundle.en.ts order.
    // `engine.chat.title` is deliberately game-flavored ("Zápasový chat", not a
    // literal "Chat"): it labels the in-match chat panel for the Tactics context.
    // `engine.settings.formatPercent` uses a non-breaking space (\u00A0) per
    // Czech typography ("80 %" never wraps between the number and the sign).
    // ── chat ──────────────────────────────────────────────────────────────────
    'engine.chat.title': 'Zápasový chat',
    'engine.chat.messagesAriaLabel': 'Zprávy chatu',
    'engine.chat.unavailable': 'Chat není k dispozici.',
    'engine.chat.loading': 'Načítání zpráv…',
    'engine.chat.empty': 'Zatím žádné zprávy.',
    'engine.chat.inputLabel': 'Zpráva',
    'engine.chat.inputPlaceholder': 'Napiš zprávu a stiskni Enter…',
    'engine.chat.rejectTooLong': 'Zpráva je příliš dlouhá.',
    'engine.chat.rejectRateLimited': 'Odesíláš zprávy příliš rychle.',
    'engine.chat.rejectEmpty': 'Zpráva nemůže být prázdná.',
    'engine.chat.rejectInvalidScope': 'Tento příjemce není k dispozici.',
    'engine.chat.rejectNoSession': 'Nejsi připojen k žádné relaci.',
    'engine.chat.rateLimitedToast': 'Příliš rychlé odesílání zpráv',

    // ── menu ──────────────────────────────────────────────────────────────────
    'engine.menu.play': 'Hrát',
    'engine.menu.settings': 'Nastavení',
    'engine.menu.quit': 'Ukončit',

    // ── settings ────────────────────────────────────────────────────────────────
    'engine.settings.masterVolume': 'Celková hlasitost',
    'engine.settings.sfxVolume': 'Hlasitost efektů',
    'engine.settings.musicVolume': 'Hlasitost hudby',
    'engine.settings.muted': 'Ztlumeno',
    'engine.settings.fullscreen': 'Celá obrazovka',
    'engine.settings.vsync': 'VSync',
    'engine.settings.targetFps': 'Cílové FPS',
    'engine.settings.uiScale': 'Měřítko rozhraní',
    'engine.settings.language': 'Jazyk',
    'engine.settings.autoSave': 'Automatické ukládání',
    'engine.settings.autoSaveInterval': 'Interval automatického ukládání',
    'engine.settings.showHints': 'Zobrazit tipy',
    'engine.settings.showPerfHud': 'Zobrazit výkonnostní HUD',
    'engine.settings.controlsField': 'Ovládání',
    'engine.settings.fps30': '30 FPS',
    'engine.settings.fps60': '60 FPS',
    'engine.settings.fps120': '120 FPS',
    'engine.settings.fpsUncapped': 'Bez omezení',
    'engine.settings.langEnUs': 'English (US)',
    'engine.settings.langDeDe': 'Deutsch',
    'engine.settings.langEsEs': 'Español',
    'engine.settings.langFrFr': 'Français',
    'engine.settings.formatPercent': '{n}\u00A0%',
    'engine.settings.formatScale': '{n}×',
    'engine.settings.formatTurns':
        '{n, plural, one {# tah} few {# tahy} many {# tahu} other {# tahů}}',
    'engine.settings.tabAudio': 'Zvuk',
    'engine.settings.tabDisplay': 'Zobrazení',
    'engine.settings.tabGameplay': 'Hratelnost',
    'engine.settings.tabControls': 'Ovládání',
    'engine.settings.modalTitle': 'Nastavení',
    'engine.settings.reset': 'Obnovit výchozí',
    'engine.settings.close': 'Zavřít',
    'engine.settings.tabsAriaLabel': 'Kategorie nastavení',
    'engine.settings.loading': 'Načítání nastavení',
    'engine.settings.keyBindingsManaged': 'Přiřazení kláves spravuje panel Ovládání.',
    'engine.settings.noControls': 'Žádné ovládací prvky nejsou registrovány.',
    'engine.settings.pressKey': 'Stiskni klávesu…',
    'engine.settings.conflictWith': 'V konfliktu s akcí ',
    'engine.settings.unbindAndRebind': 'Zrušit stávající a přiřadit',
    'engine.settings.rebindSaved': 'Uloženo',
    'engine.settings.editBinding': 'Upravit',
    'engine.settings.resetBinding': 'Obnovit',
    'engine.settings.unbound': 'Nepřiřazeno',

    // ── saves ─────────────────────────────────────────────────────────────────
    'engine.saves.title': 'Uložené hry',
    'engine.saves.close': 'Zavřít',
    'engine.saves.loadingAriaLabel': 'Načítání uložených her',
    'engine.saves.loading': 'Načítání…',
    'engine.saves.emptyAriaLabel': 'Zatím žádné uložené hry',
    'engine.saves.empty': 'Zatím žádné uložené hry.',
    'engine.saves.slotCount':
        '{n, plural, one {# uložená hra} few {# uložené hry} many {# uložené hry} other {# uložených her}}',
    'engine.saves.loadRowAriaLabel': 'Načíst {title}',
    'engine.saves.deleteRowAriaLabel': 'Smazat {title}',
    'engine.saves.loadFailedError': 'Načtení se nezdařilo: {message}',
    'engine.saves.deleteConfirmTitle': 'Smazat uloženou hru?',
    'engine.saves.deleteCancel': 'Zrušit',
    'engine.saves.deleteConfirm': 'Smazat',
    'engine.saves.deleteConfirmBody':
        'Tato uložená hra bude trvale smazána. Tuto akci nelze vrátit zpět.',
    'engine.saves.deletedToast': 'Uložená hra smazána',
    'engine.saves.deleteFailedToast': 'Smazání se nezdařilo',

    // ── lobby ─────────────────────────────────────────────────────────────────
    'engine.lobby.title': 'Lobby pro více hráčů',
    'engine.lobby.close': 'Zavřít',
    'engine.lobby.hostLobby': 'Hostovat lobby',
    'engine.lobby.hosting': 'Hostování…',
    'engine.lobby.joinLobby': 'Připojit se k lobby',
    'engine.lobby.joining': 'Připojování…',
    'engine.lobby.leaveLobby': 'Opustit lobby',
    'engine.lobby.leaving': 'Opouštění…',
    'engine.lobby.startGame': 'Spustit hru',
    'engine.lobby.starting': 'Spouštění…',
    'engine.lobby.errorPrefix': 'Chyba: {error}',
    'engine.lobby.leaveWarning': 'Tímto se odpojíš od aktuální lobby',
    'engine.lobby.hostFailed': 'Nepodařilo se hostovat lobby',
    'engine.lobby.enterCode': 'Zadej prosím kód lobby',
    'engine.lobby.joinFailed': 'Nepodařilo se připojit k lobby',
    'engine.lobby.leaveFailed': 'Nepodařilo se opustit lobby',
    'engine.lobby.readyFailed': 'Nepodařilo se změnit stav připravenosti',
    'engine.lobby.startFailed': 'Nepodařilo se spustit hru',
    'engine.lobby.matchSettingFailed': 'Nepodařilo se změnit nastavení zápasu',
    'engine.lobby.playerAttrFailed': 'Nepodařilo se změnit atribut hráče',
    'engine.lobby.addAiFailed': 'Nepodařilo se přidat hráče AI',
    'engine.lobby.removeAiFailed': 'Nepodařilo se odebrat hráče AI',
    'engine.lobby.entryTabsAriaLabel': 'Způsob vstupu do lobby',
    'engine.lobby.tabHost': 'Hostovat',
    'engine.lobby.tabJoin': 'Připojit se',
    'engine.lobby.hostPasswordLabel': 'Heslo (volitelné):',
    'engine.lobby.hostPasswordPlaceholder': 'Ponech prázdné pro otevřenou lobby',
    'engine.lobby.codeLabel': 'Kód lobby:',
    'engine.lobby.codePlaceholder': '127.0.0.1:7777',
    'engine.lobby.joinPasswordLabel': 'Heslo:',
    'engine.lobby.joinPasswordPlaceholder': 'Vyžadováno, jen pokud ho hostitel nastavil',
    'engine.lobby.sessionHeading': 'Relace',
    'engine.lobby.roleHost': 'Hostitel',
    'engine.lobby.rolePlayer': 'Hráč',
    'engine.lobby.sessionIdLabel': 'ID relace:',
    'engine.lobby.hostIdLabel': 'ID hostitele:',
    'engine.lobby.gameLabel': 'Hra:',
    'engine.lobby.readyLabel': 'Připraven:',
    'engine.lobby.playersHeading': 'Hráči ({n})',
    'engine.lobby.you': '(Ty)',
    'engine.lobby.ready': 'Připraven',
    'engine.lobby.notReady': 'Nepřipraven',
    'engine.lobby.toggleReady': 'Přepnout připravenost',
    'engine.lobby.updating': 'Aktualizace…',

    // ── replays ─────────────────────────────────────────────────────────────────
    'engine.replays.title': 'Záznamy',
    'engine.replays.close': 'Zavřít',
    'engine.replays.loadingAriaLabel': 'Načítání záznamů',
    'engine.replays.loading': 'Načítání…',
    'engine.replays.emptyAriaLabel': 'Zatím žádné uložené záznamy',
    'engine.replays.empty': 'Zatím žádné uložené záznamy.',
    'engine.replays.loadFailedError': 'Nepodařilo se načíst záznamy',
    'engine.replays.deterministicBadge': 'Deterministický',
    'engine.replays.ticksSuffix':
        '{n, plural, one {# takt} few {# takty} many {# taktu} other {# taktů}}',
    'engine.replays.openDeterministicAriaLabel': 'Otevřít záznam pořízený {recorded}',
    'engine.replays.deleteDeterministicAriaLabel': 'Smazat záznam pořízený {recorded}',
    'engine.replays.openPerspectiveAriaLabel': 'Otevřít záznam z pohledu hráče {label}',
    'engine.replays.deletePerspectiveAriaLabel': 'Smazat záznam z pohledu hráče {label}',
    'engine.replays.deleteConfirmTitle': 'Smazat záznam?',
    'engine.replays.deleteCancel': 'Zrušit',
    'engine.replays.deleteConfirm': 'Smazat',
    'engine.replays.deleteConfirmBody':
        'Tento záznam bude trvale smazán. Tuto akci nelze vrátit zpět.',
    'engine.replays.deletedToast': 'Záznam smazán',
    'engine.replays.deleteFailedToast': 'Smazání se nezdařilo',
    'engine.replays.playerLoadingAriaLabel': 'Načítání záznamu',
    'engine.replays.playerLoading': 'Načítání záznamu…',
    'engine.replays.noPathError': 'Nebyla zadána cesta k záznamu.',
    'engine.replays.openFailedError': 'Nepodařilo se otevřít záznam.',
    'engine.replays.loadTicksFailedError': 'Nepodařilo se načíst takty.',
    'engine.replays.loadFrameFailedError': 'Nepodařilo se načíst snímek.',
    'engine.replays.controlsGroupDeterministic': 'Ovládání přehrávání záznamu',
    'engine.replays.controlsGroupPerspective': 'Ovládání přehrávání záznamu z pohledu hráče',
    'engine.replays.saveReplay': 'Uložit záznam',
    'engine.replays.replaySavedLabel': 'Záznam uložen',
    'engine.replays.saveDialogTitle': 'Uložit záznam',
    'engine.replays.saveNameLabel': 'Název',
    'engine.replays.saveCancel': 'Zrušit',
    'engine.replays.saveConfirm': 'Uložit',
    'engine.replays.untitledReplay': 'Nepojmenovaný záznam',
    'engine.replays.seekStart': 'Přejít na začátek',
    'engine.replays.stepBack': 'Krok zpět',
    'engine.replays.pause': 'Pozastavit',
    'engine.replays.play': 'Přehrát',
    'engine.replays.stepForward': 'Krok vpřed',
    'engine.replays.seekEnd': 'Přejít na konec',
    'engine.replays.scrubberLabel': 'Pozice záznamu',
    'engine.replays.speedLabel': 'Rychlost přehrávání',
    'engine.replays.speed05': '0,5×',
    'engine.replays.speed1': '1×',
    'engine.replays.speed2': '2×',
    'engine.replays.speed4': '4×',

    // ── toast (§4.30 engine-wired) ────────────────────────────────────────────
    'engine.toast.playerDisconnected': 'Hráč se odpojil',
    'engine.toast.playerReconnected': 'Hráč se znovu připojil',
    'engine.toast.playerLeftGame': '{displayName} opustil(a) hru.',
    'engine.toast.profileRejectedPrefix': 'Profil odmítnut: {reason}',
    'engine.toast.replaySaved': 'Záznam uložen',
    'engine.toast.restoreCancelled': 'Obnovení zrušeno',
    'engine.toast.gameSaved': 'Hra uložena',
    'engine.toast.saveFailed': 'Uložení se nezdařilo',
    'engine.toast.hostAriaLabel': 'Oznámení',
    'engine.toast.profileDisplayNameEmpty': 'zobrazované jméno je povinné',
    'engine.toast.profileDisplayNameTooLong': 'zobrazované jméno je příliš dlouhé',
    'engine.toast.profileAvatarInvalidMime': 'typ obrázku avatara není podporován',
    'engine.toast.profileAvatarTooLarge': 'obrázek avatara je příliš velký',
    'engine.toast.profileAvatarDecodeFailed': 'obrázek avatara se nepodařilo přečíst',
    'engine.toast.profileSchemaMismatch': 'data profilu jsou neplatná',
    'engine.toast.profileNamespaceCollision': 'tento profil se již používá',
    'engine.toast.profileRateLimit': 'aktualizuješ příliš rychle',

    // ── in-game menu ────────────────────────────────────────────────────────────
    'engine.inGameMenu.title': 'Menu',
    'engine.inGameMenu.resume': 'Pokračovat',
    'engine.inGameMenu.leaveMatch': 'Opustit zápas',
    'engine.inGameMenu.leavePromptHost':
        'Opustit zápas? Tím ho ukončíš pro všechny a vrátíš všechny hráče do lobby.',
    'engine.inGameMenu.leavePromptClient':
        'Opustit zápas? Odpojíš se a vrátíš se do hlavního menu.',

    // ── save-game dialog ────────────────────────────────────────────────────────
    'engine.saveGame.save': 'Uložit',
    'engine.saveGame.cancel': 'Zrušit',
    'engine.saveGame.dialogTitle': 'Uložit hru',
    'engine.saveGame.nameLabel': 'Název',

    // ── restore overlay ─────────────────────────────────────────────────────────
    'engine.restore.waitingTitle': 'Čekání na hráče',
    'engine.restore.spinnerLabel': 'Čekání na opětovné připojení hráčů',
    'engine.restore.joinCode': 'Kód pro připojení: {code}',
    'engine.restore.rosterProgress': '{connected} / {expected} hráčů znovu připojeno',
    'engine.restore.cancel': 'Zrušit',

    // ── crash boundary ──────────────────────────────────────────────────────────
    'engine.crash.heading': 'Došlo k neočekávané chybě.',
    'engine.crash.crashId': 'ID pádu: {crashId}',
    'engine.crash.returnToMenu': 'Zpět do hlavního menu',
    'engine.crash.restart': 'Restartovat aplikaci',

    // ── connection status ───────────────────────────────────────────────────────
    'engine.connection.statusAriaLabel': 'Stav připojení: {status}',
    'engine.connection.statusConnected': 'připojeno',
    'engine.connection.statusDisconnected': 'odpojeno',
    'engine.connection.statusConnecting': 'připojování',
    'engine.connection.statusError': 'chyba',

    // ── game shell landmarks ────────────────────────────────────────────────────
    'engine.gameShell.mainAriaLabel': 'Hra',
    'engine.gameShell.canvasAriaLabel': 'Herní plátno',
    'engine.gameShell.hudAriaLabel': 'Herní HUD',

    // ── game result / game-over banner ──────────────────────────────────────────
    'engine.gameResult.gameOver': 'Konec hry',
    'engine.gameResult.draw': 'Remíza',
    'engine.gameResult.ended': 'Hra skončila',
    'engine.gameResult.won': 'Vyhrál jsi',
    'engine.gameResult.lose': 'Prohrál jsi',

    // ── in-game HUD scaffold ────────────────────────────────────────────────────
    'engine.hud.tick': 'Takt',
    'engine.hud.undo': 'Zpět',
    'engine.hud.redo': 'Znovu',
    'engine.hud.endTurn': 'Ukončit tah',

    // ── performance HUD ─────────────────────────────────────────────────────────
    // FPS / Ping / RTT / Draw calls stay as established technical borrowings,
    // like VSync in the settings section.
    'engine.perfHud.fps': 'FPS: {value}',
    'engine.perfHud.frameAvg': 'Snímek prům.: {value}',
    'engine.perfHud.frameP95': 'Snímek p95: {value}',
    'engine.perfHud.simTick': 'Takt simulace: {value}',
    'engine.perfHud.actionsPerSec': 'Akce/s: {value}',
    'engine.perfHud.actionRtt': 'RTT akce: {value}',
    'engine.perfHud.ping': 'Ping: {value}',
    'engine.perfHud.heap': 'Paměť: {value}',
    'engine.perfHud.drawCalls': 'Draw calls: {value}',
    'engine.perfHud.triangles': 'Trojúhelníky: {value}',

    // ── engine-reserved input-action descriptions ───────────────────────────────
    'engine.actions.undo': 'Vrátit poslední akci',
    'engine.actions.redo': 'Znovu provést vrácenou akci',
    'engine.actions.toggleMenu': 'Přepnout herní menu',
    'engine.actions.togglePerfHud': 'Přepnout výkonnostní HUD',
    'engine.actions.toggleDebugInspector': 'Přepnout ladicí inspektor',
    'engine.actions.toggleI18nTokenMode': 'Přepnout zobrazení překladových tokenů',
    'engine.actions.spectateCycle': 'Sledovat dalšího hráče',

    // ── spectator HUD ───────────────────────────────────────────────────────────
    'engine.spectate.modeLabel': 'Sledování',
    'engine.spectate.switchHint': 'Stiskni {key} pro přepnutí',
    'engine.spectate.switchAction': 'Přepnout pohled',

    // ── common ────────────────────────────────────────────────────────────────
    'engine.common.close': 'Zavřít',
    'engine.common.cancel': 'Zrušit',
    'engine.common.confirm': 'Potvrdit',

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
    'game.tactics.lobby.addressLabel': 'Adresa lobby',
    'game.tactics.lobby.copyAddressAriaLabel': 'Kopírovat adresu lobby',
    'game.tactics.lobby.boardColour': 'Barva pole',
    'game.tactics.lobby.simultaneousTurns': 'Souběžné tahy',
    'game.tactics.lobby.allowSpectators': 'Povolit diváky',
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

    // ── input actions (settings Controls panel) ─────────────────────────────────
    'game.tactics.actions.endTurn': 'Ukončit aktuální tah',
    'game.tactics.actions.categoryGame': 'Hra',
};
