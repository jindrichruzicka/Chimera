/**
 * electron/main/runtime/QuickStartCoordinator.ts
 *
 * Quick-start orchestrator: the one-click path from a shell screen into a
 * playable match, skipping the lobby UI. Sibling of `SessionRestoreCoordinator.ts`.
 *
 * It is orchestration SUGAR, never a second session constructor: a quick-started
 * session reaches the composition root's `onSessionHosted` by the road the lobby
 * screen drives, because the coordinator composes only public `LobbyManager`
 * verbs — hosting with the AI roster pre-seeded through the existing
 * `HostLobbyParams.agentSlots` seam (one atomic decision, where an `addAi()`
 * loop would instead allocate each slot against the roster as it stood at that
 * moment), stamping the
 * engine-owned session-mode key, applying the merged match settings and seat
 * attributes, readying up, and starting.
 *
 * The coordinator holds NO session objects — only its own in-flight flag — and
 * reaches the outside world exclusively through injected ports. The lobby half
 * of those ports ({@link QuickStartLobbyVerbs}) is a structural slice of the
 * real `LobbyManager`; the coordinator's own test pins that assignability, so
 * every verb below must exist on the public manager with a compatible
 * signature or the typecheck gate reds.
 *
 * Failure policy: any throw AFTER the lobby exists tears it down through
 * `closeLobby()`, so a failed start never leaves a zombie session behind. A
 * failure of the teardown itself is logged, never surfaced — the caller must
 * see the failure that actually broke the start.
 *
 * Architecture reference: §4.14 — lobby / session lifecycle
 *
 * Invariants upheld:
 *   #37/#67 — every collaborator (ports, logger) is constructor-injected.
 *   #99 — the coordinator authors match settings as the HOST and seat
 *         attributes as the SEAT OWNER: the host connection owns every
 *         pass-and-play local seat on a shared machine, and they are seeded at
 *         host time through `addLocalSeat`, not through a runtime attribute
 *         channel.
 */

import type { LobbyAgentSlot, LobbyInfo, PlayerId } from '@chimera-engine/networking';
import { playerId } from '@chimera-engine/networking';
import {
    SESSION_MODE_QUICK,
    SESSION_MODE_SETTING,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import type {
    QuickStartAiSeat,
    QuickStartConfig,
    QuickStartSeat,
} from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import type { QuickStartParams } from '../../preload/api-types.js';
import type { Logger } from '../logging/logger.js';

/**
 * Quick-start failure with a renderer-friendly message: thrown out of
 * {@link QuickStartCoordinator.quickStart}, it propagates through the
 * `chimera:lobby:quick-start` rejection to the caller.
 */
export class QuickStartError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'QuickStartError';
    }
}

/**
 * Mint the `PlayerId` for a pass-and-play seat. Host-scoped so two sessions
 * never collide, and numbered by SEAT POSITION — the host is seat 1, so the
 * first extra local seat is `-local-2`, matching the id shape the E2E
 * pass-and-play bootstrap already uses.
 */
export function quickStartLocalSeatId(hostId: PlayerId, localSeatIndex: number): PlayerId {
    return playerId(`${String(hostId)}-local-${String(localSeatIndex + 2)}`);
}

/**
 * The lobby half of the coordinator's ports: a structural slice of the public
 * `LobbyManager` surface. Declared here rather than imported so this module
 * never depends on the manager (Invariant #37); `QuickStartCoordinator.test.ts`
 * pins `LobbyManager` assignable to it, so every verb below must EXIST on the
 * public manager with a compatible signature — a port that grew into a bespoke
 * session door would red the typecheck gate.
 */
export interface QuickStartLobbyVerbs {
    readonly hostLobby: (params: {
        readonly gameId: string;
        readonly maxPlayers: number;
        readonly agentSlots: readonly LobbyAgentSlot[];
    }) => Promise<LobbyInfo>;
    readonly setMatchSetting: (key: string, value: string) => Promise<void>;
    readonly setPlayerAttribute: (target: PlayerId, key: string, value: string) => Promise<void>;
    readonly addLocalSeat: (
        seatId: PlayerId,
        options: {
            readonly ready: boolean;
            readonly attributes?: Readonly<Record<string, string>>;
        },
    ) => Promise<void>;
    readonly updatePlayerReadyState: (ready: boolean) => Promise<void>;
    readonly startGame: () => Promise<void>;
    readonly closeLobby: () => Promise<void>;
}

/** Everything the coordinator may do to, or ask of, the outside world. */
export interface QuickStartPorts extends QuickStartLobbyVerbs {
    /** True while a hosted or joined session exists — a quick start needs none. */
    readonly hasActiveSession: () => boolean;
    /** True while a menu-load restore is hosting or waiting for saved seats. */
    readonly isRestoreActive: () => boolean;
    /** The game's own declared defaults (`GameLobbySetup.quickStart`), if any. */
    readonly resolveQuickStartDefaults: (gameId: string) => QuickStartConfig | undefined;
    /**
     * The game's default attributes for the seat at `seatIndex`
     * (`GameLobbySetup.resolveDefaultPlayerAttributes`). Consumed for AI seats
     * only: `LobbyManager` seeds the host seat at `hostLobby` and every local
     * seat at `addLocalSeat`, but an agent slot has no such path, so without
     * this port an AI seat would be the one seat kind whose declared defaults
     * never applied.
     */
    readonly resolveSeatDefaultAttributes: (
        gameId: string,
        seatIndex: number,
    ) => Readonly<Record<string, string>>;
}

export interface QuickStartCoordinatorOptions {
    readonly ports: QuickStartPorts;
    readonly logger: Logger;
}

/** A {@link QuickStartConfig} with every optional field resolved. */
interface ResolvedQuickStartConfig {
    readonly matchSettings: Readonly<Record<string, string>>;
    readonly hostAttributes: Readonly<Record<string, string>>;
    readonly localSeats: readonly QuickStartSeat[];
    readonly aiSeats: readonly QuickStartAiSeat[];
}

/**
 * Merge a game's declared defaults UNDER a request.
 *
 * The two maps merge per KEY, so a request that names one setting keeps the
 * game's other defaults. The two seat LISTS do not: a list's length is its seat
 * count, so a positional merge would silently invent seats. A request that
 * supplies a list replaces the declared one whole; a request that omits it
 * inherits the declared one whole.
 */
function mergeQuickStartConfig(
    defaults: QuickStartConfig | undefined,
    request: QuickStartConfig,
): ResolvedQuickStartConfig {
    return {
        matchSettings: { ...defaults?.matchSettings, ...request.matchSettings },
        hostAttributes: { ...defaults?.hostAttributes, ...request.hostAttributes },
        localSeats: [...(request.localSeats ?? defaults?.localSeats ?? [])],
        aiSeats: [...(request.aiSeats ?? defaults?.aiSeats ?? [])],
    };
}

/**
 * A map's entries in ascending key order. Both maps below merge per key, so
 * order cannot change the result — sorting only makes the DRIVEN SEQUENCE a
 * function of the merged config rather than of the key insertion order the
 * merge happened to produce.
 */
function sortedEntries(
    map: Readonly<Record<string, string>>,
): readonly (readonly [string, string])[] {
    return Object.entries(map).sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
    );
}

export class QuickStartCoordinator {
    private readonly ports: QuickStartPorts;
    private readonly logger: Logger;
    /**
     * Raised synchronously at the guard and cleared when the sequence settles.
     * Beyond refusing a concurrent quick start, it is the ONLY signal covering
     * the `hostLobby` await — the window in which the composition root's own
     * `activeSession` is still null, so a `saves:load` arriving there would
     * otherwise route into the menu-restore flow against a lobby being born.
     */
    private inFlight = false;

    constructor(options: QuickStartCoordinatorOptions) {
        this.ports = options.ports;
        this.logger = options.logger.child({ module: 'quick-start' });
    }

    /** True from the guard until the sequence settles (resolved or rejected). */
    isActive(): boolean {
        return this.inFlight;
    }

    /**
     * Open a match without the lobby UI and resolve with the hosted
     * {@link LobbyInfo}.
     *
     * Sequence — guards, then merge, then the public verbs in this order:
     * `hostLobby({ agentSlots })` → stamp `engine.sessionMode` → merged match
     * settings → host attributes → local seats → ready → `startGame()`. The
     * stamp goes first so it is present for every write that follows and for
     * every lobby-state broadcast after the hosting one.
     *
     * The roster is exactly full by design (`maxPlayers = 1 + local + ai`), so
     * no seat is ever left open for a stranger to fill.
     */
    async quickStart(request: QuickStartParams): Promise<LobbyInfo> {
        if (this.inFlight) {
            throw new QuickStartError('lobby:quick-start: a quick start is already in flight.');
        }
        if (this.ports.hasActiveSession()) {
            throw new QuickStartError(
                'lobby:quick-start: a session is already active — leave it before starting again.',
            );
        }
        if (this.ports.isRestoreActive()) {
            throw new QuickStartError(
                'lobby:quick-start: a session restore is in progress — cancel it first.',
            );
        }

        const config = mergeQuickStartConfig(
            this.ports.resolveQuickStartDefaults(request.gameId),
            request,
        );
        if (Object.hasOwn(config.matchSettings, SESSION_MODE_SETTING)) {
            throw new QuickStartError(
                `lobby:quick-start: "${SESSION_MODE_SETTING}" is engine-owned and cannot be ` +
                    `authored by a match-settings request.`,
            );
        }

        const maxPlayers = 1 + config.localSeats.length + config.aiSeats.length;
        // AI slots sit ABOVE the local seats: `nextHumanSlotIndex` hands each
        // local seat the lowest free HUMAN-kind slot, so keeping AI at the top
        // makes a local seat's roster position equal its ledger slot index —
        // and therefore equal the seat index its default attributes resolve at.
        const agentSlots: readonly LobbyAgentSlot[] = config.aiSeats.map((seat, index) => {
            const slotIndex = 1 + config.localSeats.length + index;
            const attributes = {
                ...this.ports.resolveSeatDefaultAttributes(request.gameId, slotIndex),
                ...seat.attributes,
            };
            return {
                slotIndex,
                kind: 'ai',
                ...(seat.omniscient !== undefined ? { omniscient: seat.omniscient } : {}),
                // Omitted when empty rather than written as `{}`: a slot that
                // declares nothing, for a game that declares nothing, must stay
                // out of `setup` exactly as a lobby-added AI seat does.
                ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
            };
        });

        this.inFlight = true;
        let hosted = false;
        try {
            const info = await this.ports.hostLobby({
                gameId: request.gameId,
                maxPlayers,
                agentSlots,
            });
            hosted = true;

            await this.ports.setMatchSetting(SESSION_MODE_SETTING, SESSION_MODE_QUICK);
            for (const [key, value] of sortedEntries(config.matchSettings)) {
                await this.ports.setMatchSetting(key, value);
            }
            for (const [key, value] of sortedEntries(config.hostAttributes)) {
                await this.ports.setPlayerAttribute(info.hostId, key, value);
            }
            for (const [index, seat] of config.localSeats.entries()) {
                await this.ports.addLocalSeat(quickStartLocalSeatId(info.hostId, index), {
                    // A pass-and-play seat has no one to press Ready for it, and
                    // `startGame` gates on every roster entry being ready.
                    ready: true,
                    ...(seat.attributes !== undefined ? { attributes: seat.attributes } : {}),
                });
            }
            await this.ports.updatePlayerReadyState(true);
            await this.ports.startGame();
            return info;
        } catch (error) {
            if (hosted) {
                await this.closeLobbyBestEffort();
            }
            throw error;
        } finally {
            this.inFlight = false;
        }
    }

    private async closeLobbyBestEffort(): Promise<void> {
        try {
            await this.ports.closeLobby();
        } catch (error) {
            this.logger.warn('quick-start: closeLobby failed during unwind', {
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
