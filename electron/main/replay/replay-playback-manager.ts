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

import type { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import type { BaseGameSnapshot, PlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { ReplayFile } from '@chimera-engine/simulation/replay/index.js';
import {
    createBaseReplayInitialSnapshot,
    ReplayPlayer,
} from '@chimera-engine/simulation/replay/index.js';
import type {
    StateProjector,
    VisibilityRules,
} from '@chimera-engine/simulation/projection/index.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/index.js';
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
    /**
     * Assemble the in-progress recording of the just-finished match as a
     * {@link ReplayFile} for in-memory preview, without persisting it (backs
     * {@link ReplayPlaybackManager.openCurrent}).
     */
    getCurrentMatchFile(): ReplayFile;
}

interface ActivePlayback {
    readonly player: ReplayPlayer;
    readonly projector: StateProjector;
    readonly viewerId: PlayerId;
    /**
     * Absolute tick the replay starts at (the first recorded action's tick). The
     * renderer scrubs in 0-based ticks; this offset maps a renderer tick onto the
     * replay's absolute tick. A second-or-later match in a session starts at a
     * tick > 0 because the session tick is monotonic across match boundaries.
     */
    readonly baseTick: number;
    /** Absolute tick of the last snapshot produced, so sequential requests can `step`. */
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
        return this.#openFile(file);
    }

    /**
     * Open playback for the **in-memory** recording of the just-finished match —
     * the preview path for the post-game **Replay** action, which previews the
     * match before it is written to disk (the player's save icon is the sole
     * persistence gate). Mirrors {@link open} but sources the {@link ReplayFile}
     * from the loader's in-progress recording instead of a stored file, so no path
     * is validated and nothing is read from the filesystem.
     *
     * @throws when no recording is in progress, or the game has no visibility rules.
     */
    openCurrent(): Promise<ReplayPlaybackInfo> {
        this.#logger.debug('openCurrent');
        // Build synchronously from the in-memory recording, but return a promise
        // (symmetric with `open`) so a throw from the loader or a missing-visibility-
        // rules error surfaces as a rejection rather than a synchronous throw.
        return Promise.resolve().then(() => this.#openFile(this.#loader.getCurrentMatchFile()));
    }

    /** Build a `ReplayPlayer` over the live pipeline for `file` and ready it at tick 0. */
    #openFile(file: ReplayFile): ReplayPlaybackInfo {
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

        this.#active = {
            player,
            projector,
            viewerId,
            baseTick: initial.tick,
            lastTick: initial.tick,
        };

        return {
            gameId: file.gameId,
            // The renderer scrubs 0..totalTicks. Under invariant #42 each recorded
            // action advances the tick by exactly 1, so the number of scrubbable
            // steps is `file.actions.length` — independent of the replay's
            // (possibly non-zero) base tick. `#projectedAt` maps each 0-based
            // renderer tick onto the replay's absolute ticks, so the terminal
            // (game-over) snapshot at renderer tick `file.actions.length` stays
            // reachable (#663). The file's `metadata.durationTicks` records the
            // highest *issued* action tick and cannot be used here.
            totalTicks: file.actions.length,
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
     * Advance/seek the active player to the 0-based renderer `tick` and project
     * the result. The renderer tick is mapped onto the replay's absolute tick
     * (`baseTick + tick`); playback then advances via `step()` for the common
     * sequential case (`absoluteTick === lastTick + 1`) and falls back to `seek()`
     * for scrubbing.
     *
     * The `step()` fast-path is sound because every recorded action advances the
     * tick by exactly 1 (Invariant #42): `step()` therefore returns either the
     * snapshot at `lastTick + 1` or `null` at end-of-replay — never a snapshot at
     * an unexpected tick — so trusting its `.tick` here cannot desynchronise
     * `lastTick`.
     */
    #projectedAt(active: ActivePlayback, tick: number): PlayerSnapshot {
        // `tick` is renderer-space (0-based); map it onto the replay's absolute
        // ticks, which start at `baseTick` (non-zero for a second-or-later match).
        const absoluteTick = active.baseTick + tick;
        let state: BaseGameSnapshot;
        if (absoluteTick === active.lastTick + 1) {
            const next = active.player.step();
            state = next ?? active.player.seek(absoluteTick);
        } else {
            state = active.player.seek(absoluteTick);
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
