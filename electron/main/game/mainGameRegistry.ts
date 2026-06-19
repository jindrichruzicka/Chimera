/**
 * electron/main/game/mainGameRegistry.ts
 *
 * Main-side composition root. This is the SINGLE `electron/main` module — beside
 * the content (`gameContentRegistry.ts`) and lobby (`lobbySetupRegistry.ts`)
 * registries — permitted to import `games/*`. It aggregates every per-game
 * contribution the host bootstrap needs (action registration, settings schema,
 * visibility rules, first-player resolution, and version) behind a generic,
 * `gameId`-keyed contract, so `index.ts` and the rest of the main process name
 * no specific game.
 *
 * This mirrors the renderer's `renderer/game/rendererGameRegistry.ts` — the sole
 * coupling point between the engine and a concrete game (Invariants #48/#80/#94).
 * Adding a game: import its main-side modules here and add one registry entry.
 * Nothing else under `electron/main/` may import `games/*`; that boundary is
 * enforced by ESLint (`chimera/no-main-games-import`) and the invariants check
 * (Check 10).
 *
 * The host currently hosts exactly one game ({@link hostedGame}, the M1
 * single-game lifecycle). F18 (multi-game) replaces that constant with a runtime
 * selection from the registry; the rest of the contract is already general.
 *
 * Architecture: §4.8 Content Database, §4.13 Settings, §4.6/§8 Projection.
 */

import type { AIState } from '@chimera/ai/engine/AIState.js';
import { createTacticsAIState } from '@chimera/games/tactics/ai/tacticsPolicy.js';
import type { GameManifest } from '@chimera/shared/game-manifest-contract.js';
import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';
import type {
    CommitmentTurnOrchestration,
    VisibilityRules,
} from '@chimera/simulation/projection/index.js';

import {
    registerTacticsActions,
    resolveTacticsFirstPlayer,
    type TacticsGameInitializationConfig,
} from '@chimera/games/tactics/actions.js';
import { tacticsManifest } from '@chimera/games/tactics/manifest.js';
import { tacticsCommitmentOrchestration } from '@chimera/games/tactics/commitment/orchestration.js';
import { tacticsResolveIsMyTurn } from '@chimera/games/tactics/commitment/turnGate.js';
import { tacticsSettingsSchema } from '@chimera/games/tactics/settings-schema.js';
import { tacticsVisibilityRules } from '@chimera/games/tactics/visibility-rules.js';
import { TACTICS_GAME_ID } from '@chimera/games/tactics/constants.js';

import type { SettingsManager } from '../settings/SettingsManager.js';

/** Config for resolving which seat moves first in a new match. */
export type FirstPlayerConfig = TacticsGameInitializationConfig;

/** Everything a game contributes to the MAIN process at the composition root. */
export interface MainGameContribution {
    readonly gameId: string;
    readonly gameVersion: string;
    /**
     * The game's self-description (display name, window title, real-time loop
     * mode, optional icon). Pure shared data — the renderer reads the same
     * manifest for its shell title; the host reads `realtime`/`tickRateMs` to
     * decide whether to drive a {@link RealtimeTicker}.
     */
    readonly manifest: GameManifest;
    /** Register the game's action reducers into the shared engine registry. */
    readonly registerActions: (registry: ActionRegistry<BaseGameSnapshot>) => void;
    /**
     * Register the game's settings schema with the {@link SettingsManager}. A
     * thunk (rather than the raw schema) so the concrete `GameSettingsSchema<T>`
     * is registered with no variance cast.
     */
    readonly registerSettings: (manager: SettingsManager) => void;
    /** Visibility rules for host projection + replay playback. */
    readonly visibilityRules: VisibilityRules;
    /** Resolve the first player for a new match. */
    readonly resolveFirstPlayer: (config: FirstPlayerConfig) => PlayerId;
    /**
     * Optional factory for the game's AI brain state. When present, hosted AI
     * slots run this policy (composed in {@link buildDefaultAIPlayerAgent})
     * instead of the generic `engine:auto-end-turn` fallback. The factory lives
     * in the pure `ai/` policy package; this registry only wires it.
     */
    readonly createAIState?: (playerId: PlayerId) => AIState;
    /**
     * Optional host-side commit-then-sync reveal orchestration (F54 / T9). When
     * present, the host stages each commit and, on the commitment-mode End Turn,
     * drives the deterministic reveal sequence through these pure hooks — staying
     * ignorant of the game (Invariant #2). Absent ⇒ the game has no commitment
     * turn mode and the host never reveals.
     */
    readonly commitment?: CommitmentTurnOrchestration;
    /**
     * Optional `isMyTurn` resolver fed to `StateProjectorOptions.resolveIsMyTurn`
     * (F54 / #730). Simultaneous turn modes supply it so more than one seat can
     * be active at once (e.g. commitment mode: every not-yet-committed seat acts
     * in parallel). Absent ⇒ the projector keeps its single-active default, so
     * sequential games are unaffected. Pure and host-side (may read host-local
     * fields the projection does not cross).
     */
    readonly resolveIsMyTurn?: (state: Readonly<BaseGameSnapshot>, viewerId: PlayerId) => boolean;
}

/**
 * The tactics reference game's main-side contribution. Currently the only
 * registered game; further games are added as sibling entries (see file header).
 */
const tacticsContribution: MainGameContribution = {
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

/**
 * `gameId → contribution`. The sole non-registry place in `electron/main` that
 * imports `games/*`. A game with no main-side contribution simply does not
 * appear here.
 */
export const mainGameRegistry: Readonly<Record<string, MainGameContribution>> = {
    [tacticsContribution.gameId]: tacticsContribution,
};

/**
 * The single game the host currently hosts (M1). Sourced from the registry —
 * `index.ts` never names a game. F18 replaces this with a runtime selection.
 */
export const hostedGame: MainGameContribution = tacticsContribution;

/** All registered game ids — drives the crash-recovery scan and content load. */
export const knownGameIds: readonly string[] = Object.keys(mainGameRegistry);

/** `gameId → version` — the identity map ReplayManager stamps onto replays. */
export const gameVersions: ReadonlyMap<string, string> = new Map(
    Object.values(mainGameRegistry).map((game) => [game.gameId, game.gameVersion]),
);

/** `gameId → visibility rules` — fed to `createVisibilityRulesResolver`. */
export const visibilityRulesByGameId: Readonly<Record<string, VisibilityRules>> =
    Object.fromEntries(
        Object.values(mainGameRegistry).map((game) => [game.gameId, game.visibilityRules]),
    );

/** `gameId → manifest` — drives window title + real-time ticker selection. */
export const manifestsByGameId: Readonly<Record<string, GameManifest>> = Object.fromEntries(
    Object.values(mainGameRegistry).map((game) => [game.gameId, game.manifest]),
);
