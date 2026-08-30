// apps/action/electron/main.ts
//
// Composition root for the action Electron app — where this game meets the
// Electron bootstrap: it constructs the action
// `MainGameContribution` from `@chimera-engine/action/*` and injects it into the
// game-agnostic host `main(contributions)` exposed by the `@chimera-engine/electron`
// package. The host ships no game-specific code; a game definition arrives at a
// consumer app root like this one, at runtime.
//
// This is the standalone consumer app's entry, not part of the `@chimera-engine/action`
// library: it owns the `@chimera-engine/electron` + `@chimera-engine/action` coupling, so
// it is EXCLUDED from the action composite library build (`tsconfig.build.json`) and
// type-checked by the root flat program. Kept a flat file under `electron/` (not
// `electron/main/`) so it stays outside the `chimera/no-main-games-import` ESLint rule +
// invariants Check 10 scope, which guard the `electron/main/` package directory.
//
// The `@chimera-engine/action/*` self-imports resolve to this app's own source: the
// `build:app` bundler driver (electron/build-main.ts) aliases `@chimera-engine/<game>`
// (read from package.json `name`) onto the app directory.

import { main, type MainGameContribution } from '@chimera-engine/electron/main';

import { registerActionActions } from '@chimera-engine/action/simulation/actions.js';
import { resolveActionFirstPlayer } from '@chimera-engine/action/simulation/init.js';
import { actionManifest } from '@chimera-engine/action/manifest.js';
import { actionSettingsSchema } from '@chimera-engine/action/settings-schema.js';
import { actionVisibilityRules } from '@chimera-engine/action/simulation/visibility-rules.js';
import { ACTION_GAME_ID } from '@chimera-engine/action/simulation/constants.js';

/**
 * The action reference game's main-side contribution. Exported for the
 * composition-root test; injected into the host below.
 *
 * Only the required fields are set. The optional capabilities a game may add —
 * `contentSchemas`, `lobbySetup`, `createAIState`, `commitment`,
 * `resolveIsMyTurn`, `registerScenes` — are all deliberately absent: this app
 * ships no content collections, no AI, no custom lobby and no simultaneous-turn
 * mode, and declaring any of them empty would claim a capability it has not
 * built.
 *
 * `manifest.realtime` is what makes this app the engine's first realtime
 * consumer: the host reads it and starts a `RealtimeTicker` that dispatches
 * `engine:tick` on a wall-clock heartbeat, which is what drives the simulation's
 * per-beat movement pass.
 */
export const actionContribution: MainGameContribution = {
    gameId: ACTION_GAME_ID,
    gameVersion: '0.1.0',
    manifest: actionManifest,
    registerActions: registerActionActions,
    registerSettings: (manager) => manager.registerSchema(actionSettingsSchema),
    visibilityRules: actionVisibilityRules,
    resolveFirstPlayer: resolveActionFirstPlayer,
};

// Auto-bootstrap only when executed by Electron, not when imported by Vitest.
if (process.env['VITEST'] === undefined) {
    void main([actionContribution]);
}
