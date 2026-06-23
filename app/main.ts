// app/main.ts
//
// In-tree composition root for the tactics Electron app (F62/T2). This is the
// SOLE module that names a concrete game AND drives the Electron bootstrap: it
// constructs the tactics `MainGameContribution` from `@chimera/tactics/*` and
// injects it into the game-agnostic host `main(contributions)` exposed by the
// `@chimera/electron` package. The host (`@chimera/electron`) ships no
// game-specific code; game definitions enter only here, at runtime.
//
// Because it owns the `@chimera/tactics/*` coupling, this module lives OUTSIDE
// the `@chimera/electron` package and is therefore outside the
// `chimera/no-main-games-import` ESLint rule + invariants Check 10 scope. F63
// relocates it into the standalone consumer app `apps/tactics/`.

import { main, type MainGameContribution } from '@chimera/electron/main';

import { createTacticsAIState } from '@chimera/tactics/ai/tacticsPolicy.js';
import { registerTacticsActions, resolveTacticsFirstPlayer } from '@chimera/tactics/actions.js';
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
