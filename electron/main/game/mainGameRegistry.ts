/**
 * electron/main/game/mainGameRegistry.ts
 *
 * Game-agnostic main-side registry FACTORY. This module ships inside
 * `@chimera/electron` and therefore names NO concrete game: it owns only the
 * generic {@link MainGameContribution} contract and {@link createMainGameRegistry},
 * which turns the per-game contributions injected at bootstrap into the lookup
 * maps the host (`index.ts`) consumes.
 *
 * The games/* coupling that used to live here has moved to the consumer app
 * composition root `apps/tactics/electron/main.ts` (relocated there from the
 * top-level `app/` in F63/#783).
 * That root constructs each game's `MainGameContribution` from `@chimera/<game>/*`
 * and injects it into `main(contributions)` at runtime — so this file, and the
 * rest of `electron/main/`, never import a game. The boundary is enforced by
 * ESLint (`chimera/no-main-games-import`) and invariants Check 10.
 *
 * The host currently hosts exactly one game ({@link MainGameRegistryView.hostedGame},
 * the M1 single-game lifecycle); `createMainGameRegistry` enforces that invariant
 * structurally (exactly one contribution) without naming a game. F18 (multi-game)
 * relaxes the guard into a runtime selection; the derived maps are already general.
 *
 * Architecture: §4.8 Content Database, §4.13 Settings, §4.6/§8 Projection.
 */

import type { AIState } from '@chimera/ai';
import type { GameManifest } from '@chimera/simulation/foundation/game-manifest-contract.js';
import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';
import type {
    CommitmentTurnOrchestration,
    VisibilityRules,
} from '@chimera/simulation/projection/index.js';

import type { SettingsManager } from '../settings/SettingsManager.js';

/**
 * Game-agnostic config for resolving which seat moves first in a new match.
 * Generalizes the former `FirstPlayerConfig = TacticsGameInitializationConfig`
 * alias — a concrete game's first-player config is structurally assignable to it.
 */
export interface FirstPlayerConfig {
    readonly hostPlayerId: PlayerId;
    readonly firstPlayer?: PlayerId;
}

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
 * The host-side view derived from the injected contribution set: the selected
 * hosted game plus the gameId-keyed lookup maps `index.ts` consumes.
 */
export interface MainGameRegistryView {
    /** `gameId → contribution` for the injected set. */
    readonly mainGameRegistry: Readonly<Record<string, MainGameContribution>>;
    /**
     * The single game the host currently hosts (M1). Selected from the injected
     * set — the host never names a game. F18 replaces this with a runtime choice.
     */
    readonly hostedGame: MainGameContribution;
    /** All injected game ids — drives the crash-recovery scan and content load. */
    readonly knownGameIds: readonly string[];
    /** `gameId → version` — the identity map ReplayManager stamps onto replays. */
    readonly gameVersions: ReadonlyMap<string, string>;
    /** `gameId → visibility rules` — fed to `createVisibilityRulesResolver`. */
    readonly visibilityRulesByGameId: Readonly<Record<string, VisibilityRules>>;
    /** `gameId → manifest` — drives window title + real-time ticker selection. */
    readonly manifestsByGameId: Readonly<Record<string, GameManifest>>;
}

/**
 * Build the host-side registry view from the game contributions injected at
 * bootstrap. Enforces the M1 single-game lifecycle structurally — exactly one
 * contribution — so the host can pick a `hostedGame` without naming any game.
 * F18 (multi-game) relaxes this guard into a runtime selection; the derived maps
 * are already general over the set.
 *
 * @throws if the injected set is not exactly one contribution.
 */
export function createMainGameRegistry(
    contributions: readonly MainGameContribution[],
): MainGameRegistryView {
    if (contributions.length !== 1) {
        throw new Error(
            `Host expects exactly one game contribution (M1 single-game lifecycle); received ${contributions.length}.`,
        );
    }
    const [hostedGame] = contributions;
    // Narrowed by the length check above; the destructure keeps TS happy under
    // `noUncheckedIndexedAccess` without a non-null assertion.
    if (hostedGame === undefined) {
        throw new Error('Host expects exactly one game contribution; received an empty slot.');
    }

    const mainGameRegistry: Readonly<Record<string, MainGameContribution>> = Object.fromEntries(
        contributions.map((game) => [game.gameId, game]),
    );

    return {
        mainGameRegistry,
        hostedGame,
        knownGameIds: contributions.map((game) => game.gameId),
        gameVersions: new Map(contributions.map((game) => [game.gameId, game.gameVersion])),
        visibilityRulesByGameId: Object.fromEntries(
            contributions.map((game) => [game.gameId, game.visibilityRules]),
        ),
        manifestsByGameId: Object.fromEntries(
            contributions.map((game) => [game.gameId, game.manifest]),
        ),
    };
}
