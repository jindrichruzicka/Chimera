/**
 * electron/main/dev/DevHarnessCoordinator.ts
 *
 * The dev multiplayer harness auto-flow (§4.32): drives the same authoritative
 * lobby operations a user would trigger through the UI — host, seed match
 * settings and seat attributes from the game-owned dev scenario, add AI seats,
 * announce the lobby code, ready up, join, and finally start the match once
 * the roster is complete — so `pnpm dev:mp N` yields an instantly-running
 * session with zero manual clicks.
 *
 * Part of the self-contained dev graph under `electron/main/dev/`, reached
 * only via the harness-gated dynamic import in `index.ts` (Invariant #27
 * pattern; Invariant #77 gates the flags themselves). No Electron imports —
 * everything arrives through structural ports, so the whole flow unit-tests
 * with recording fakes (the real `LobbyManager` satisfies
 * {@link DevHarnessLobbyPort} structurally).
 *
 * Failure policy: any bootstrap error propagates to the caller, which
 * fatal-logs and exits the instance — the orchestrator's one-out-all-out
 * teardown then stops the siblings. This intentionally diverges from the
 * E2E flow's log-and-continue: a dev harness that half-starts is worse than
 * one that stops loudly.
 */

import type { LobbyState, PlayerId } from '@chimera-engine/networking';
import {
    devScenarioAutoStart,
    devScenarioHumanSeats,
    devScenarioMaxPlayers,
    devScenarioSeat,
    devSeatReady,
    type DevAnnounce,
    type DevScenario,
} from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';

import type { Logger } from '../logging/logger.js';

/**
 * The slice of the harness flags the coordinator consumes. `HarnessFlags`
 * (parsed in `index.ts`) is structurally assignable; declared locally so this
 * module never imports the host entry (no cycle into `index.ts`).
 */
export interface DevHarnessFlagsView {
    readonly autoHost: boolean;
    readonly autoJoin: string | undefined;
    readonly scenarioFile: string | undefined;
    readonly seat: number | undefined;
    readonly players: number | undefined;
    readonly announceFile: string | undefined;
    readonly game: string | undefined;
}

/**
 * Structural port over the authoritative lobby operations the auto-flow
 * drives. Satisfied by the real `LobbyManager` — the coordinator only ever
 * calls the same public methods the lobby IPC handlers call, so the harness
 * exercises the production flow, not a side door.
 */
export interface DevHarnessLobbyPort {
    hostLobby(params: {
        gameId: string;
        maxPlayers: number;
    }): Promise<{ readonly sessionId: string; readonly hostId: PlayerId }>;
    joinLobby(params: {
        address: string;
        profile?: unknown;
    }): Promise<{ readonly sessionId: string; readonly hostId: PlayerId }>;
    setMatchSetting(key: string, value: string): Promise<void>;
    setPlayerAttribute(playerId: PlayerId, key: string, value: string): Promise<void>;
    updatePlayerReadyState(ready: boolean): Promise<void>;
    addAi(): Promise<void>;
    startGame(): Promise<void>;
    getLocalPlayerId(): PlayerId | null;
}

export interface DevHarnessCoordinatorOptions {
    readonly flags: DevHarnessFlagsView;
    /** The single hosted game's id (from the injected contribution set). */
    readonly hostedGameId: string;
    /**
     * Seat cap used when neither a scenario nor `--dev-players` is present —
     * resolved by the wiring point from the game's `lobbySetup.maxPlayers`.
     */
    readonly fallbackMaxPlayers: number;
    readonly lobby: DevHarnessLobbyPort;
    /**
     * The local profile attestation attached to an auto-join — the same
     * `profileManager.currentAttestation()` the `chimera:lobby:join` IPC
     * handler attaches, so a seeded dev profile reaches the host's gate.
     */
    readonly attestation?: () => unknown;
    /** Injected fixture loaders (see `dev-fixture-loader.ts`). */
    readonly loadScenario: (path: string) => Promise<DevScenario>;
    readonly writeAnnounce: (path: string, announce: DevAnnounce) => Promise<void>;
    readonly logger: Logger;
    /**
     * Delay before a failed auto-start self-retries against the last seen
     * lobby state. Overridable so tests need not wait the real interval.
     */
    readonly startRetryDelayMs?: number;
}

/** Default self-retry delay after a failed auto-start. */
const DEFAULT_START_RETRY_DELAY_MS = 250;

export class DevHarnessCoordinator {
    private readonly opts: DevHarnessCoordinatorOptions;
    private readonly log: Logger;
    private scenario: DevScenario | undefined;
    private startRequested = false;

    constructor(options: DevHarnessCoordinatorOptions) {
        this.opts = options;
        this.log = options.logger;
    }

    /**
     * Run the instance's auto-flow. Host instances host + seed + announce +
     * ready; client instances join + apply their seat + ready; instances with
     * neither auto flag do nothing. Any error propagates (see failure policy
     * in the module header).
     */
    async bootstrap(): Promise<void> {
        const { flags, hostedGameId } = this.opts;
        if (!flags.autoHost && flags.autoJoin === undefined) {
            return;
        }

        // Cross-check the declared game id BEFORE touching the lobby: a
        // harness pointed at the wrong app must stop before it seeds anything.
        if (flags.game !== undefined && flags.game !== hostedGameId) {
            throw new Error(
                `Dev harness --dev-game=${flags.game} does not match the hosted game ` +
                    `'${hostedGameId}' — this app cannot launch that game.`,
            );
        }
        if (flags.scenarioFile !== undefined) {
            this.scenario = await this.opts.loadScenario(flags.scenarioFile);
            if (this.scenario.gameId !== undefined && this.scenario.gameId !== hostedGameId) {
                throw new Error(
                    `Dev scenario declares gameId '${this.scenario.gameId}' but this app ` +
                        `hosts '${hostedGameId}' — refusing to seed a mismatched session.`,
                );
            }
        }

        if (flags.autoHost) {
            await this.bootstrapHost();
        } else {
            await this.bootstrapClient();
        }
    }

    private async bootstrapHost(): Promise<void> {
        const { flags, hostedGameId, lobby } = this.opts;
        const scenario = this.scenario;

        const maxPlayers =
            scenario !== undefined
                ? devScenarioMaxPlayers(scenario)
                : (flags.players ?? this.opts.fallbackMaxPlayers);
        this.log.info('dev harness: auto-hosting', { gameId: hostedGameId, maxPlayers });
        const info = await lobby.hostLobby({ gameId: hostedGameId, maxPlayers });

        for (const [key, value] of Object.entries(scenario?.matchSettings ?? {})) {
            await lobby.setMatchSetting(key, value);
        }

        const hostSeat = scenario !== undefined ? devScenarioSeat(scenario, 1) : undefined;
        const localId = lobby.getLocalPlayerId() ?? info.hostId;
        for (const [key, value] of Object.entries(hostSeat?.attributes ?? {})) {
            await lobby.setPlayerAttribute(localId, key, value);
        }

        for (let i = 0; i < (scenario?.aiSeats ?? 0); i++) {
            await lobby.addAi();
        }

        // Announce ONLY after all seeding: the orchestrator's announce-wait
        // doubles as the "host fully seeded" barrier, so a client can never
        // join a lobby whose match settings are still being applied.
        if (flags.announceFile !== undefined) {
            await this.opts.writeAnnounce(flags.announceFile, {
                lobbyCode: info.sessionId,
                gameId: hostedGameId,
            });
        }

        if (devSeatReady(hostSeat)) {
            await lobby.updatePlayerReadyState(true);
        }
    }

    private async bootstrapClient(): Promise<void> {
        const { flags, lobby } = this.opts;
        const address = flags.autoJoin;
        if (address === undefined) {
            return;
        }

        this.log.info('dev harness: auto-joining', { seat: flags.seat });
        const profile = this.opts.attestation?.();
        await lobby.joinLobby(profile !== undefined ? { address, profile } : { address });

        const seat =
            this.scenario !== undefined && flags.seat !== undefined
                ? devScenarioSeat(this.scenario, flags.seat)
                : undefined;
        const seatAttributes = Object.entries(seat?.attributes ?? {});
        if (seatAttributes.length > 0) {
            const localId = lobby.getLocalPlayerId();
            if (localId === null) {
                // Fail loudly (the module's stated policy) rather than silently
                // starting a match with this seat's scenario attributes dropped.
                throw new Error(
                    'dev harness: no local player id after join — cannot apply the ' +
                        `scenario's seat ${flags.seat ?? '?'} attributes.`,
                );
            }
            for (const [key, value] of seatAttributes) {
                await lobby.setPlayerAttribute(localId, key, value);
            }
        }

        if (devSeatReady(seat)) {
            await lobby.updatePlayerReadyState(true);
        }
    }

    /**
     * Auto-start latch, tapped from the host's `onLobbyStateChanged`. Fires
     * `startGame()` exactly once, when: this instance auto-hosted, the
     * scenario (or its default) opts in, every expected human seat is filled
     * and ready, and every declared AI slot is present. A failed start (e.g.
     * a transient un-ready race) clears the latch so a later push retries —
     * `startGame` itself remains the authoritative all-ready gate.
     */
    onLobbyStateChanged(state: LobbyState): void {
        if (!this.opts.flags.autoHost || this.startRequested) {
            return;
        }
        // Lobby pushes are rare; logging each evaluation keeps a stalled
        // auto-start diagnosable from the instance log alone.
        this.log.info('dev harness: lobby state changed', {
            players: state.players.length,
            ready: state.players.filter((entry) => entry.ready).length,
            agentSlots: (state.agentSlots ?? []).length,
        });
        const scenario = this.scenario;
        if (scenario !== undefined && !devScenarioAutoStart(scenario)) {
            return;
        }

        const expectedHumans =
            scenario !== undefined
                ? devScenarioHumanSeats(scenario)
                : (this.opts.flags.players ?? this.opts.fallbackMaxPlayers);
        const expectedAi = scenario?.aiSeats ?? 0;

        if (state.players.length !== expectedHumans) {
            return;
        }
        if (!state.players.every((entry) => entry.ready)) {
            return;
        }
        if ((state.agentSlots ?? []).length !== expectedAi) {
            return;
        }

        this.startRequested = true;
        this.log.info('dev harness: roster complete — auto-starting the match', {
            humans: expectedHumans,
            aiSeats: expectedAi,
        });
        void this.opts.lobby.startGame().catch((err: unknown) => {
            this.log.error(
                'dev harness: auto-start failed; retrying shortly',
                err instanceof Error ? err : new Error(String(err)),
            );
            this.startRequested = false;
            // Self-retry against the state that armed the latch: with the
            // roster already complete and stable, no further lobby push would
            // ever arrive to re-trigger it (startGame stays the authoritative
            // all-ready gate on every attempt).
            setTimeout(
                () => this.onLobbyStateChanged(state),
                this.opts.startRetryDelayMs ?? DEFAULT_START_RETRY_DELAY_MS,
            );
        });
    }
}
