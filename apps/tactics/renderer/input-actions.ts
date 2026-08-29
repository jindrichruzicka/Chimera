import type { InputAction } from '@chimera-engine/renderer/input';

// The game's rebindable input actions (§4.26).
//
// Description and category are game.tactics.actions.* translation tokens: the
// settings Controls panel resolves both through t() (a literal falls back to
// itself), so the row follows the active locale. The category doubles as the
// grouping key — grouping compares the raw token string, which stays stable.
//
// It lives beside `loaders.ts` — the module that puts it on both payloads —
// because the SHELL payload is what carries it: the engine registers these at
// app boot so a menu route can subscribe to them and Settings > Controls can
// list them before any match has run. Authored here rather than in
// `screens/index.tsx` so that registration costs the menu nothing but this file
// — reading it off the screen registry would pull the lazy screen table and the
// asset manifest along with it. The match payload carries the same array, so
// the engine's second registration inside `GameShell` is a no-op.
//
// The IMPORT is the point: this file is tactics' adopter of the public
// `@chimera-engine/renderer/input` barrel (§4.26). The annotation is what the
// import is for — it states the contract where the table is authored, rather
// than leaving `apps/tactics/renderer/loaders.ts` to be where it is first
// checked.
export const TACTICS_INPUT_ACTIONS: readonly InputAction[] = [
    {
        id: 'game:end-turn',
        description: 'game.tactics.actions.endTurn',
        category: 'game.tactics.actions.categoryGame',
        oneShot: true,
    },
];
