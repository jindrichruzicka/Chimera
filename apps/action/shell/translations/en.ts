// apps/action/shell/translations/en.ts
//
// The action app's English translation bundle — the game override layer for the
// `en-US` locale (game override → engine default → raw key). It supplies every
// `game.action.*` token the app's shell surfaces consume and re-keys nothing of
// the engine's: the engine's own English is already the copy this app wants
// everywhere it does not speak for itself.
//
// The app declares ONE language (`manifest.languages`), so there is no second
// bundle for this one to stay in parity with. What it must stay in parity with
// is the token catalogue (`keys.ts`) and the raw label strings in
// `main-menu.ts`, which is boundary-restricted and cannot import either —
// `translations.test.ts` holds all three together.
//
// Boundary-restricted pure data (§3): zero imports — no renderer runtime (not
// even the `TranslationBundle` type), no React, no simulation, no Electron. The
// shape is structurally the runtime's `TranslationBundle`
// (`Readonly<Record<string, string>>`); the loader types it against the real
// contract when it wires this into the provider.

export const actionBundleEn: Readonly<Record<string, string>> = {
    // ── main menu ───────────────────────────────────────────────────────────────
    'game.action.menu.continue': 'Continue',
    'game.action.menu.start': 'Start',
    'game.action.menu.settings': 'Settings',
    'game.action.menu.quit': 'Quit',
    'game.action.menu.startConfirmTitle': 'Start a new run?',
    'game.action.menu.startConfirmBody':
        'Starting anew clears the progress your autosave is holding.',
    'game.action.menu.startConfirmAccept': 'Start anew',

    // ── select page ─────────────────────────────────────────────────────────────
    'game.action.select.title': 'Choose your primitive',
    'game.action.select.hint': 'Click one in the scene, or move the ring with the arrow keys.',
    'game.action.select.secondPlayer': 'Second player',
    'game.action.select.secondPlayerHint': 'Player 2 picks and plays with WASD.',
    'game.action.select.start': 'Start',
    'game.action.select.back': 'Back',
    'game.action.select.hostPick': 'Player 1 drives the {shape}',
    'game.action.select.secondPick': 'Player 2 drives the {shape}',
    'game.action.select.startFailed': 'The match could not be started. Try again.',
};
