/**
 * electron/main/replay/replay-playback-manager.ts
 *
 * Main-process owner of *replay playback* (§4.28, F44 / T6, #660).
 *
 * The renderer's replay player never runs a `ReplayPlayer` itself — it requests
 * tick-by-tick snapshots over IPC. This manager loads a replay file, drives a
 * `ReplayPlayer` over the *live* `ActionPipeline` wiring (the same wiring a
 * hosted session uses, via `buildHostSessionPipeline` — invariant #70), and
 * projects each authoritative `BaseGameSnapshot` to a per-viewer
 * `PlayerSnapshot` before it crosses the IPC boundary (invariant #3).
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #3  — only a projected `PlayerSnapshot` ever leaves the manager; the raw
 *           `BaseGameSnapshot` produced by `ReplayPlayer` stays host-local.
 *   #67 — constructed with an injected `Logger` child; no logger is created here.
 *   #70 — playback reuses `buildHostSessionPipeline`; there is no replay-only
 *           pipeline shortcut, so recorded `engine:undo`/`engine:redo` actions
 *           replay through the same undo/history machinery as live play.
 */

import type { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera/simulation/engine/types.js';
import type { ReplayFile } from '@chimera/simulation/replay/index.js';
import { createBaseReplayInitialSnapshot, ReplayPlayer } from '@chimera/simulation/replay/index.js';
import type { StateProjector, VisibilityRules } from '@chimera/simulation/projection/index.js';
import { DefaultStateProjector } from '@chimera/simulation/projection/index.js';
import type { PlayerSnapshot, ReplayPlaybackInfo } from '../../preload/api-types.js';
import type { Logger } from '../logging/logger.js';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';

/**
 * Resolves the {@link VisibilityRules} for a game id, or `undefined` when the
 * game is unknown to this build. Injected (DIP) so the manager stays free of any
 * concrete `games/*` import — the composition root owns the game→rules mapping.
 */
export type VisibilityRulesResolver = (gameId: string) => VisibilityRules | undefined;

/** Narrow slice of `ReplayManager` the playback manager depends on. */
export interface ReplayLoaderPort {
    load(path: string): Promise<ReplayFile>;
}

interface ActivePlayback {
    readonly player: ReplayPlayer;
    readonly projector: StateProjector;
    readonly viewerId: PlayerId;
    /** Tick of the last snapshot produced, so sequential requests can `step`. */
    lastTick: number;
}

/**
 * Loads a replay and serves projected per-viewer snapshots tick-by-tick. Holds
 * at most one active playback session; opening a new replay replaces it.
 */
export class ReplayPlaybackManager {
    readonly #registry: ActionRegistry;
    readonly #resolveVisibilityRules: VisibilityRulesResolver;
    readonly #loader: ReplayLoaderPort;
    readonly #logger: Logger;
    #active: ActivePlayback | null = null;

    constructor(
        registry: ActionRegistry,
        resolveVisibilityRules: VisibilityRulesResolver,
        loader: ReplayLoaderPort,
        logger: Logger,
    ) {
        this.#registry = registry;
        this.#resolveVisibilityRules = resolveVisibilityRules;
        this.#loader = loader;
        this.#logger = logger.child({ module: 'replay-playback-manager' });
    }

    /**
     * Load `path`, build a `ReplayPlayer` over the live pipeline wiring, and
     * initialise it to tick 0. Returns the playback metadata. Replaces any
     * previously open session.
     *
     * @throws when the replay's game has no registered visibility rules — without
     *   them no safe `PlayerSnapshot` can be projected (invariant #3).
     */
    async open(path: string): Promise<ReplayPlaybackInfo> {
        this.#logger.debug('open', { path });
        const file = await this.#loader.load(path);

        const rules = this.#resolveVisibilityRules(file.gameId);
        if (rules === undefined) {
            throw new Error(
                `ReplayPlaybackManager.open: no visibility rules registered for game ${JSON.stringify(file.gameId)}`,
            );
        }

        // Invariant #70: reuse the exact live host pipeline wiring (undo +
        // history) so recorded undo/redo actions replay faithfully. The broadcast
        // and autosave ports are no-ops — playback projects outside the pipeline
        // and never persists.
        const { pipeline } = buildHostSessionPipeline(this.#registry, () => undefined, {
            gameId: file.gameId,
            savePort: { autoSave: () => Promise.resolve() },
            logger: this.#logger,
        });

        const player = new ReplayPlayer(
            file,
            pipeline,
            createBaseReplayInitialSnapshot,
            this.#logger,
        );
        const initial = player.initialize();

        const projector = new DefaultStateProjector(rules);
        const playerIds = Object.keys(initial.players);
        const viewerId = (playerIds[0] ?? '') as PlayerId;

        this.#active = { player, projector, viewerId, lastTick: initial.tick };

        return {
            gameId: file.gameId,
            totalTicks: file.metadata.durationTicks,
            playerIds: [...playerIds],
            viewerId,
        };
    }

    /**
     * Produce the projected {@link PlayerSnapshot} at `tick`. Advances via
     * `step()` for the common sequential case (`tick === lastTick + 1`) and falls
     * back to `seek()` for scrubbing.
     *
     * @throws when no playback session is open.
     */
    snapshotAt(tick: number): PlayerSnapshot {
        return this.#projectedAt(this.#requireActive('snapshotAt'), tick);
    }

    /**
     * Produce the projected {@link PlayerSnapshot}s for the inclusive tick range
     * `[from, to]` in a single call, so the renderer can prefetch a buffer of
     * ticks per IPC round-trip instead of one round-trip per tick. The walk is
     * sequential, so every tick after the first advances via the `step()`
     * fast-path.
     *
     * @throws when no playback session is open, or when `from > to`.
     */
    snapshotRange(from: number, to: number): PlayerSnapshot[] {
        const active = this.#requireActive('snapshotRange');
        if (from > to) {
            throw new Error(
                `ReplayPlaybackManager.snapshotRange: from (${from.toString()}) must be <= to (${to.toString()})`,
            );
        }

        const snapshots: PlayerSnapshot[] = [];
        for (let tick = from; tick <= to; tick += 1) {
            snapshots.push(this.#projectedAt(active, tick));
        }
        return snapshots;
    }

    /**
     * Advance/seek the active player to `tick` and project the result. Advances
     * via `step()` for the common sequential case (`tick === lastTick + 1`) and
     * falls back to `seek()` for scrubbing.
     *
     * The `step()` fast-path is sound because every recorded action advances the
     * tick by exactly 1 (Invariant #42): `step()` therefore returns either the
     * snapshot at `lastTick + 1` or `null` at end-of-replay — never a snapshot at
     * an unexpected tick — so trusting its `.tick` here cannot desynchronise
     * `lastTick`.
     */
    #projectedAt(active: ActivePlayback, tick: number): PlayerSnapshot {
        let state: BaseGameSnapshot;
        if (tick === active.lastTick + 1) {
            const next = active.player.step();
            state = next ?? active.player.seek(tick);
        } else {
            state = active.player.seek(tick);
        }
        active.lastTick = state.tick;

        return active.projector.project(state, active.viewerId);
    }

    #requireActive(method: string): ActivePlayback {
        if (this.#active === null) {
            throw new Error(`ReplayPlaybackManager.${method}: no replay playback session is open`);
        }
        return this.#active;
    }

    /** End the active playback session, if any. */
    close(): void {
        this.#logger.debug('close', { active: this.#active !== null });
        this.#active = null;
    }
}

/**
 * Build a {@link VisibilityRulesResolver} from a plain `gameId → rules` map.
 * Keeps the composition root's wiring declarative.
 */
export function createVisibilityRulesResolver(
    rulesByGameId: Readonly<Record<string, VisibilityRules>>,
): VisibilityRulesResolver {
    return (gameId) => rulesByGameId[gameId];
}
