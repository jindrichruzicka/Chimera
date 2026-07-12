// apps/tactics/electron/main.ts
//
// Composition root for the tactics Electron app. This is the SOLE module that names a
// concrete game AND drives the Electron bootstrap: it constructs the tactics
// `MainGameContribution` from `@chimera-engine/tactics/*` and injects it into the
// game-agnostic host `main(contributions)` exposed by the `@chimera-engine/electron`
// package. The host (`@chimera-engine/electron`) ships no game-specific code; game
// definitions enter only here, at runtime.
//
// This is the standalone consumer app's entry, not part of the `@chimera-engine/tactics`
// library: it owns the `@chimera-engine/electron` + `@chimera-engine/tactics` coupling and
// resolves both from the root `package.json` deps, so it is EXCLUDED from the
// tactics composite library build (`tsconfig.build.json`) and type-checked by the
// root flat program. Kept a flat file under `electron/` (not `electron/main/`) so
// it stays outside the `chimera/no-main-games-import` ESLint rule + invariants
// Check 10 scope, which guard the `electron/main/` package directory.

import { main, type MainGameContribution } from '@chimera-engine/electron/main';

import { createTacticsAIState } from '@chimera-engine/tactics/ai/tacticsPolicy.js';
import {
    registerTacticsActions,
    resolveTacticsFirstPlayer,
} from '@chimera-engine/tactics/simulation/actions.js';
import {
    paletteFromCollections,
    TACTICS_CONTENT_SCHEMAS,
} from '@chimera-engine/tactics/content/tacticsContent.js';
import { buildTacticsLobbySetup } from '@chimera-engine/tactics/lobby/lobby-setup.js';
import { tacticsManifest } from '@chimera-engine/tactics/manifest.js';
import { tacticsCommitmentOrchestration } from '@chimera-engine/tactics/simulation/commitment/orchestration.js';
import { tacticsResolveIsMyTurn } from '@chimera-engine/tactics/simulation/commitment/turnGate.js';
import { tacticsSettingsSchema } from '@chimera-engine/tactics/settings-schema.js';
import { tacticsVisibilityRules } from '@chimera-engine/tactics/simulation/visibility-rules.js';
import { TACTICS_GAME_ID } from '@chimera-engine/tactics/simulation/constants.js';

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
