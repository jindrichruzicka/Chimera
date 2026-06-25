// apps/tactics/electron/main.ts
//
// Composition root for the tactics Electron app (F62/T2; relocated here from the
// top-level `app/` directory in F63/#783). This is the SOLE module that names a
// concrete game AND drives the Electron bootstrap: it constructs the tactics
// `MainGameContribution` from `@chimera/tactics/*` and injects it into the
// game-agnostic host `main(contributions)` exposed by the `@chimera/electron`
// package. The host (`@chimera/electron`) ships no game-specific code; game
// definitions enter only here, at runtime.
//
// This is the standalone consumer app's entry, not part of the `@chimera/tactics`
// library: it owns the `@chimera/electron` + `@chimera/tactics` coupling and
// resolves both from the root `package.json` deps, so it is EXCLUDED from the
// tactics composite library build (`tsconfig.build.json`) and type-checked by the
// root flat program. Kept a flat file under `electron/` (not `electron/main/`) so
// it stays outside the `chimera/no-main-games-import` ESLint rule + invariants
// Check 10 scope, which guard the `electron/main/` package directory.

import { main, type MainGameContribution } from '@chimera/electron/main';

import { createTacticsAIState } from '@chimera/tactics/ai/tacticsPolicy.js';
import { registerTacticsActions, resolveTacticsFirstPlayer } from '@chimera/tactics/actions.js';
import {
    paletteFromCollections,
    TACTICS_CONTENT_SCHEMAS,
} from '@chimera/tactics/content/tacticsContent.js';
import { buildTacticsLobbySetup } from '@chimera/tactics/lobby/lobby-setup.js';
import { tacticsManifest } from '@chimera/tactics/manifest.js';
import { tacticsCommitmentOrchestration } from '@chimera/tactics/commitment/orchestration.js';
import { tacticsResolveIsMyTurn } from '@chimera/tactics/commitment/turnGate.js';
import { tacticsSettingsSchema } from '@chimera/tactics/settings-schema.js';
import { tacticsVisibilityRules } from '@chimera/tactics/visibility-rules.js';
import { TACTICS_GAME_ID } from '@chimera/tactics/constants.js';

/**
 * The tactics reference game's main-side contribution. Exported for the
 * composition-root test; injected into the host below.
 */
export const tacticsContribution: MainGameContribution = {
    gameId: TACTICS_GAME_ID,
    gameVersion: '0.1.0',
    manifest: tacticsManifest,
    contentSchemas: TACTICS_CONTENT_SCHEMAS,
    lobbySetup: (content) => buildTacticsLobbySetup(paletteFromCollections(content)),
    registerActions: registerTacticsActions,
    registerSettings: (manager) => manager.registerSchema(tacticsSettingsSchema),
    visibilityRules: tacticsVisibilityRules,
    resolveFirstPlayer: resolveTacticsFirstPlayer,
    createAIState: createTacticsAIState,
    commitment: tacticsCommitmentOrchestration,
    resolveIsMyTurn: tacticsResolveIsMyTurn,
};

// Auto-bootstrap only when executed by Electron, not when imported by Vitest.
if (process.env['VITEST'] === undefined) {
    void main([tacticsContribution]);
}
