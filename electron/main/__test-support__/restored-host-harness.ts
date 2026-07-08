/**
 * electron/main/__test-support__/restored-host-harness.ts
 *
 * In-process composition harness for the F68 restore-protocol integration
 * tests (#827). Composes the REAL restore stack — `LobbyManager` over an
 * injected `MultiplayerProvider`, `SessionRuntime`, `SessionRestoreCoordinator`,
 * `SaveManager` over `InMemorySaveRepository`, the real engine pipeline,
 * projector, and AI agents — around a mirror of the composition-root glue in
 * `electron/main/index.ts` (`onSessionHosted` / `onGameStartRequested` /
 * coordinator ports). Each mirrored block is annotated with the `index.ts`
 * symbol it reproduces; the wiring *shape* of the real composition root stays
 * locked by the mocked #823/#826 suites in `index.test.ts`.
 *
 * Deliberate omissions (renderer-/FS-facing, not load-bearing for the restore
 * protocol): renderer egress + host perspective recording, replay recording,
 * `RealtimeTicker` (null for turn-based games), auto local-seat handoff, E2E
 * hooks, chat relay / profile gate, and the debug bridge.
 *
 * This module is game-agnostic (`chimera/no-main-games-import` guards
 * `__test-support__`): the game arrives as an injected `MainGameContribution`
 * plus a prebuilt `GameLobbySetup` — the same seam the production composition
 * root uses (`apps/tactics/electron/main.ts`).
 */

import type {
    HostTransport,
    JoinLobbyParams,
    LobbyAgentSlot,
    LobbyPlayerEntry,
    MultiplayerProvider,
    PlayerSnapshot as WirePlayerSnapshot,
    SeatClaim,
} from '@chimera-engine/networking';
import type { WireCommitmentReveal } from '@chimera-engine/simulation/foundation/messages.js';
import type { GameLobbySetup } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase } from '@chimera-engine/simulation/engine/types.js';
import { DefaultStateProjector } from '@chimera-engine/simulation/projection/index.js';
import type {
    SaveFile,
    SaveSeat,
    SaveSessionManifest,
} from '@chimera-engine/simulation/persistence/SaveFile.js';
import { InMemorySaveRepository } from '@chimera-engine/simulation/persistence/InMemorySaveRepository.js';
import { AgentManager, HumanPlayerAgent } from '@chimera-engine/ai/engine';
import { SimulationHost } from '@chimera-engine/simulation/host';

import type { MainGameContribution } from '../game/mainGameRegistry.js';
import { LobbyManager } from '../lobby/LobbyManager.js';
import { buildSetupFromLobbyState } from '../lobby/lobbySetupRegistry.js';
import { createNoopLogger } from '../logging/logger.js';
import { SaveManager } from '../saves/SaveManager.js';
import { InMemorySessionTicketStore } from '../session/InMemorySessionTicketStore.js';
import type { SessionTicketStore } from '../session/SessionTicketStore.js';
import { createSnapshotTicketRecorder } from '../session/snapshot-ticket-recorder.js';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    collectGameStartAiPlayerSlots,
    collectInitialPlayerSlots,
    resolveAgentSlot,
} from '../runtime/HostedSessionAgents.js';
import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import { runRevealSync } from '../runtime/RevealOrchestrator.js';
import { wireDefaultSceneActions } from '../runtime/SceneActionWiring.js';
import { SessionCommitmentRuntime, SessionRuntime } from '../runtime/SessionRuntime.js';
import {
    SessionRestoreCoordinator,
    type SessionRestoreStatus,
} from '../runtime/SessionRestoreCoordinator.js';
import { StateBroadcaster } from '../runtime/StateBroadcaster.js';

export interface RestoredHostHarnessOptions {
    /** Shared provider — tests pass one `InMemoryMultiplayerProvider`. */
    readonly provider: MultiplayerProvider;
    /** The hosted game, injected exactly like `main(contributions)`. */
    readonly contribution: MainGameContribution;
    /** Prebuilt lobby-setup descriptor (skips the FS content-DB load). */
    readonly lobbySetup?: GameLobbySetup;
    /** Fixed session seed — `index.ts` uses `Date.now() >>> 0`. */
    readonly seed?: number;
}

/** Ordered observation log — proves gate/AI sequencing in the tests. */
export type HarnessEvent =
    | { readonly kind: 'game-start'; readonly tick: number }
    | { readonly kind: 'player-joined'; readonly playerId: PlayerId }
    | { readonly kind: 'ai-action'; readonly action: ActionEnvelope };

export interface RestoredHostHarness {
    readonly lobbyManager: LobbyManager;
    readonly coordinator: SessionRestoreCoordinator;
    readonly saveManager: SaveManager;
    readonly repository: InMemorySaveRepository;
    /** The live hosted `SessionRuntime`, or null outside a hosted session. */
    activeRuntime(): SessionRuntime | null;
    /** The host's own action path (mirrors `dispatchRendererAction`). */
    dispatchHostAction(action: ActionEnvelope): void;
    events(): readonly HarnessEvent[];
    /** Every action an AI seat routed through the host fan-out. */
    aiActions(): readonly ActionEnvelope[];
    /** Every coordinator status transition, in publish order. */
    statuses(): readonly SessionRestoreStatus[];
}

/**
 * One "client machine": a `LobbyManager` wired with the production
 * snapshot-ticket recorder and JOIN-claims resolver around an (in-memory)
 * `SessionTicketStore`, joining through a capturing provider wrapper so tests
 * can assert the exact claims presented on the wire. Mirrors the #822 wiring
 * in `index.ts` and `session-ticket-claims.integration.test.ts::makeClient`.
 */
export interface RestoreClientHarness {
    readonly manager: LobbyManager;
    readonly ticketStore: SessionTicketStore;
    /** Raw `JoinLobbyParams` handed to the provider, in call order. */
    readonly joins: readonly JoinLobbyParams[];
    /** Every `PlayerSnapshot` this client received, in receive order. */
    readonly snapshots: readonly WirePlayerSnapshot[];
    /** Every commitment reveal this client received, in receive order. */
    readonly reveals: readonly WireCommitmentReveal[];
}

export function buildRestoredHostHarness(options: RestoredHostHarnessOptions): RestoredHostHarness {
    const logger = createNoopLogger();
    const { contribution } = options;
    const gameId = contribution.gameId;

    // mirrors electron/main/index.ts::main() registry seeding (#827)
    const gameRegistry = new ActionRegistry();
    registerEngineActions(gameRegistry);
    wireDefaultSceneActions(gameRegistry);
    contribution.registerActions(gameRegistry);

    const repository = new InMemorySaveRepository();
    const saveManager = new SaveManager(repository, logger);

    const events: HarnessEvent[] = [];
    const statuses: SessionRestoreStatus[] = [];

    // ── main()-scope mutable seams (mirrors electron/main/index.ts) ──────────
    let activeSession: SessionRuntime | null = null;
    let currentMatchId: string | null = null;
    let dispatchRendererAction: ((action: ActionEnvelope) => void) | null = null;
    let saveInitialTurnMemento: ((pid: PlayerId) => void) | null = null;
    let handleHostedLocalSeatAdded: ((entry: LobbyPlayerEntry) => void) | null = null;
    let seatLobbyAgentsForGameStart:
        | ((slots: readonly LobbyAgentSlot[]) => readonly PlayerId[])
        | null = null;
    let syncLiveAgentSlots: ((slots: readonly LobbyAgentSlot[]) => void) | null = null;
    let seatRestoredRoster: ((seats: readonly SaveSeat[]) => Promise<void>) | null = null;
    /** Return-to-lobby (#737) host-local reset seam — assigned in `onSessionHosted`. */
    let resetActiveSessionToLobby: (() => void) | null = null;
    /** Start-suppression gate for an in-flight restore (F68 #823). */
    let restoreSeatingActive = false;

    const lobbyManager = new LobbyManager(options.provider, logger, {
        resolveLobbySetup: (requestedGameId) =>
            requestedGameId === gameId ? options.lobbySetup : undefined,

        // mirrors electron/main/index.ts::onSessionHosted (#827); omissions in
        // the module header.
        onSessionHosted: (transport: HostTransport, metadata) => {
            const agentManager = new AgentManager({ logger });
            const broadcasterRef: { current: StateBroadcaster | null } = { current: null };
            const simulationHostRef: { current: SimulationHost | null } = { current: null };

            const initialPlayerSlots = collectInitialPlayerSlots(metadata);
            const initialPlayerIds = initialPlayerSlots.map((slot) => slot.playerId);
            // mirrors index.ts::resolveInitialEntitiesForGame
            const initialEntities =
                gameRegistry.resolveGame(gameId)?.buildInitialEntities?.(initialPlayerIds) ?? {};

            const sessionSeed = options.seed ?? 42;
            const initialSnapshot = buildInitialHostedSessionSnapshot({
                seed: sessionSeed,
                hostPlayerId: metadata.hostId,
                playerSlots: initialPlayerSlots,
                phase: gamePhase('lobby'),
                ...(Object.keys(initialEntities).length > 0 ? { initialEntities } : {}),
            });

            const { processAction, clearUndoHistory, undoManager } = buildHostSessionPipeline(
                gameRegistry,
                (snap, to) => {
                    if (broadcasterRef.current === null) {
                        throw new Error(
                            'StateBroadcaster used before hosted session wiring completed',
                        );
                    }
                    broadcasterRef.current.broadcast(snap, to);
                },
                (tick, to) => {
                    if (broadcasterRef.current === null) {
                        throw new Error(
                            'StateBroadcaster used before hosted session wiring completed',
                        );
                    }
                    broadcasterRef.current.broadcastTick(tick, to);
                },
                {
                    gameId,
                    savePort: {
                        autoSave: async (
                            saveGameId: string,
                            snapshot: BaseGameSnapshot,
                        ): Promise<void> => {
                            if (activeSession === null) return;
                            const file = activeSession.captureSaveFile(
                                { gameId: saveGameId },
                                snapshot,
                            );
                            await saveManager.autoSave(file);
                        },
                    },
                    gameEndPort: {
                        onGameEnd: (snapshot, result) => {
                            simulationHostRef.current?.onGameEnd(snapshot, result);
                        },
                    },
                    logger,
                },
            );

            // mirrors index.ts: per-session commitment runtime shared between
            // the projector and SessionRuntime.
            const sessionCommitmentRuntime = new SessionCommitmentRuntime();
            const projector = new DefaultStateProjector(contribution.visibilityRules, {
                getUndoMeta: (viewerId) => ({
                    canUndo: undoManager.canUndo(viewerId),
                    canRedo: undoManager.canRedo(viewerId),
                }),
                getPendingCommitments: () => sessionCommitmentRuntime.capturePendingCommitments(),
                ...(contribution.resolveIsMyTurn === undefined
                    ? {}
                    : { resolveIsMyTurn: contribution.resolveIsMyTurn }),
            });
            const simulationHost = new SimulationHost(agentManager, projector);
            simulationHostRef.current = simulationHost;
            broadcasterRef.current = new StateBroadcaster(transport, projector, logger, {
                hostViewerId: metadata.hostId,
            });

            // mirrors index.ts::getSessionManifest (F68 #820)
            const getSessionManifest = (): SaveSessionManifest | null => {
                if (currentMatchId === null) {
                    return null;
                }
                const seats: SaveSeat[] = [...playerSlotIndexById.entries()].map(
                    ([pid, slotIndex]) => {
                        const agentSlot = resolveLiveAgentSlot(slotIndex);
                        if (agentSlot.kind === 'ai') {
                            return {
                                playerId: pid,
                                control: 'ai',
                                slotIndex,
                                ...(agentSlot.omniscient === true ? { omniscient: true } : {}),
                            };
                        }
                        if (pid === metadata.hostId) {
                            return { playerId: pid, control: 'host', slotIndex };
                        }
                        if (lobbyManager.isLocalSeat(pid)) {
                            return { playerId: pid, control: 'local', slotIndex };
                        }
                        return { playerId: pid, control: 'remote', slotIndex };
                    },
                );
                seats.sort((a, b) => a.slotIndex - b.slotIndex);
                return { matchId: currentMatchId, maxPlayers: metadata.maxPlayers, seats };
            };

            const sessionRuntime = new SessionRuntime({
                gameId,
                gameVersion: contribution.gameVersion,
                initialSnapshot,
                applyAction: processAction,
                commitmentRuntime: sessionCommitmentRuntime,
                getSessionManifest,
            });
            activeSession = sessionRuntime;

            // mirrors index.ts::stageCommitmentIfAccepted / revealIfCommitmentEndTurn /
            // autoEndTurnIfReady (no host-renderer reveal push in the harness).
            const commitmentOrchestration = contribution.commitment;
            const stageCommitmentIfAccepted = (action: ActionEnvelope): void => {
                if (commitmentOrchestration === undefined) {
                    return;
                }
                const staged = commitmentOrchestration.stageOnCommit(
                    action,
                    sessionRuntime.getSnapshot(),
                );
                if (staged !== null) {
                    sessionRuntime.commitTurn(staged.playerId, staged.value);
                }
            };
            const revealIfCommitmentEndTurn = (action: ActionEnvelope): void => {
                if (
                    commitmentOrchestration?.shouldReveal(action, sessionRuntime.getSnapshot()) !==
                    true
                ) {
                    return;
                }
                runRevealSync({
                    orchestration: commitmentOrchestration,
                    session: sessionRuntime,
                    sendReveal: (target, wireReveal) => {
                        transport.sendReveal(target, wireReveal);
                    },
                });
                simulationHost.afterTick(sessionRuntime.getSnapshot());
            };
            const autoEndTurnIfReady = (action: ActionEnvelope): void => {
                if (
                    commitmentOrchestration?.shouldAutoEndTurn?.(
                        action,
                        sessionRuntime.getSnapshot(),
                    ) !== true
                ) {
                    return;
                }
                const snap = sessionRuntime.getSnapshot();
                const activePlayerId = snap.turnClock?.activePlayerId;
                if (activePlayerId === undefined) {
                    return;
                }
                const endTurnAction: ActionEnvelope = {
                    type: 'engine:end_turn',
                    playerId: activePlayerId,
                    tick: snap.tick,
                    payload: {},
                };
                sessionRuntime.applyAction(endTurnAction);
                simulationHost.afterTick(sessionRuntime.getSnapshot());
                revealIfCommitmentEndTurn(endTurnAction);
            };

            // mirrors index.ts::runHostAction — the shared host fan-out.
            const runHostAction = (action: ActionEnvelope): void => {
                sessionRuntime.applyAction(action);
                stageCommitmentIfAccepted(action);
                simulationHost.afterTick(sessionRuntime.getSnapshot());
                revealIfCommitmentEndTurn(action);
                autoEndTurnIfReady(action);
            };
            dispatchRendererAction = runHostAction;

            // mirrors index.ts::dispatchAiAction, instrumented for the tests.
            const AI_DRIVE_MAX_DEPTH = 512;
            let aiDriveDepth = 0;
            const dispatchAiAction = (action: ActionEnvelope): void => {
                events.push({ kind: 'ai-action', action });
                if (aiDriveDepth >= AI_DRIVE_MAX_DEPTH) {
                    return;
                }
                aiDriveDepth += 1;
                try {
                    runHostAction(action);
                } finally {
                    aiDriveDepth -= 1;
                }
            };
            saveInitialTurnMemento = (pid) => {
                undoManager.saveTurnMemento(sessionRuntime.getSnapshot(), pid);
            };

            // mirrors index.ts seating state (activePlayers / slots / gate).
            const activePlayers = new Set<PlayerId>(initialPlayerIds);
            const assignedSlotIndexes = new Set<number>(
                initialPlayerSlots.map((slot) => slot.slotIndex),
            );
            const playerSlotIndexById = new Map<PlayerId, number>();
            let gameStarted = false;
            let currentAgentSlots: readonly LobbyAgentSlot[] = metadata.agentSlots ?? [];
            const resolveLiveAgentSlot = (slotIndex: number): LobbyAgentSlot =>
                resolveAgentSlot({ ...metadata, agentSlots: currentAgentSlots }, slotIndex);

            // mirrors index.ts::registerSlotAgent
            const registerSlotAgent = (pid: PlayerId, slotIndex: number): void => {
                playerSlotIndexById.set(pid, slotIndex);
                const agentSlot = resolveLiveAgentSlot(slotIndex);
                if (agentSlot.kind === 'ai') {
                    simulationHost.registerAgent(
                        buildDefaultAIPlayerAgent({
                            playerId: pid,
                            initialSnapshot: sessionRuntime.getSnapshot(),
                            dispatch: dispatchAiAction,
                            logger,
                            omniscient: agentSlot.omniscient ?? false,
                            createState: contribution.createAIState,
                        }),
                    );
                    return;
                }
                simulationHost.registerAgent(new HumanPlayerAgent(pid));
            };

            // mirrors index.ts::nextHumanSlotIndex
            const nextHumanSlotIndex = (): number => {
                for (let slotIndex = 0; slotIndex < metadata.maxPlayers; slotIndex += 1) {
                    if (assignedSlotIndexes.has(slotIndex)) {
                        continue;
                    }
                    if (resolveLiveAgentSlot(slotIndex).kind === 'human') {
                        assignedSlotIndexes.add(slotIndex);
                        return slotIndex;
                    }
                }
                return assignedSlotIndexes.size;
            };

            // mirrors index.ts::tryStartGame — the restore start gate (F68 #823),
            // instrumented with the ordered `game-start` event.
            const tryStartGame = (): void => {
                if (restoreSeatingActive) {
                    return;
                }
                if (!gameStarted && activePlayers.size >= metadata.maxPlayers) {
                    gameStarted = true;
                    events.push({
                        kind: 'game-start',
                        tick: sessionRuntime.getSnapshot().tick,
                    });
                    simulationHost.onGameStart(sessionRuntime.getSnapshot());
                }
            };

            const broadcastCurrentGameSnapshot = (viewerId: PlayerId): void => {
                const snapshot = sessionRuntime.getSnapshot();
                if (snapshot.phase === gamePhase('lobby')) {
                    return;
                }
                broadcasterRef.current?.broadcast(snapshot, viewerId);
            };

            // mirrors index.ts::handleHostedLocalSeatAdded (F68 #823)
            handleHostedLocalSeatAdded = (entry): void => {
                if (activePlayers.has(entry.playerId)) {
                    return;
                }
                activePlayers.add(entry.playerId);
                registerSlotAgent(entry.playerId, nextHumanSlotIndex());
                tryStartGame();
            };

            // mirrors index.ts::seatLobbyAgentsForGameStart
            seatLobbyAgentsForGameStart = (liveAgentSlots): readonly PlayerId[] => {
                currentAgentSlots = liveAgentSlots;
                const aiSlots = collectGameStartAiPlayerSlots(liveAgentSlots);
                for (const slot of aiSlots) {
                    if (activePlayers.has(slot.playerId)) {
                        continue;
                    }
                    activePlayers.add(slot.playerId);
                    assignedSlotIndexes.add(slot.slotIndex);
                    registerSlotAgent(slot.playerId, slot.slotIndex);
                }
                return aiSlots.map((slot) => slot.playerId);
            };

            // mirrors index.ts::syncLiveAgentSlots (#833) — keep the live AI
            // roster in sync as `addAi()` mutates it during the lobby, so
            // `nextHumanSlotIndex` skips an added AI's slot when a human joins
            // after it. Guarded to the lobby phase: a restored session seats its
            // AI roster from the SAVED seats via `seatRestoredRoster` (the
            // LobbyManager's own agentSlots stay empty) and reconnecting remotes
            // rejoin post-checkpoint (in-game phase) — syncing then would wipe
            // `currentAgentSlots`.
            syncLiveAgentSlots = (liveAgentSlots): void => {
                if (sessionRuntime.getSnapshot().phase !== gamePhase('lobby')) {
                    return;
                }
                currentAgentSlots = liveAgentSlots;
            };

            // mirrors index.ts::seatRestoredRoster (F68 #823) — including the
            // `finally` release of the start-suppression gate.
            seatRestoredRoster = async (seats): Promise<void> => {
                try {
                    currentAgentSlots = seats
                        .filter((seatEntry) => seatEntry.control === 'ai')
                        .map((seatEntry) => ({
                            slotIndex: seatEntry.slotIndex,
                            kind: 'ai' as const,
                            ...(seatEntry.omniscient === true ? { omniscient: true } : {}),
                        }));
                    assignedSlotIndexes.clear();
                    for (const seatEntry of seats) {
                        assignedSlotIndexes.add(seatEntry.slotIndex);
                        registeredPlayers.add(seatEntry.playerId);
                        registerSlotAgent(seatEntry.playerId, seatEntry.slotIndex);
                        if (seatEntry.control !== 'remote') {
                            activePlayers.add(seatEntry.playerId);
                        }
                        if (seatEntry.control === 'local') {
                            await lobbyManager.addLocalSeat(seatEntry.playerId);
                        }
                    }
                } finally {
                    restoreSeatingActive = false;
                }
                tryStartGame();
            };

            const registeredPlayers = new Set<PlayerId>(initialPlayerIds);
            for (const slot of initialPlayerSlots) {
                registerSlotAgent(slot.playerId, slot.slotIndex);
            }
            tryStartGame();

            // mirrors index.ts::releaseLobbySeat (#834): free a departing lobby
            // seat and re-pack the remaining HUMANS into contiguous human-kind
            // slots so the host ledger stays in step with LobbyManager's
            // compacted `players` roster. AI seats in the ledger (host-time
            // `agentSlots` / a return-to-lobby #737) are PINNED at their slots —
            // a position-only re-pack would misclassify an AI as `remote`.
            const releaseLobbySeat = (pid: PlayerId): void => {
                playerSlotIndexById.delete(pid);
                registeredPlayers.delete(pid); // a lobby rejoin is a fresh join, not a reconnect
                const entries = [...playerSlotIndexById.entries()].sort((a, b) => a[1] - b[1]);
                const humanPids: PlayerId[] = [];
                playerSlotIndexById.clear();
                assignedSlotIndexes.clear();
                for (const [entryPid, entrySlot] of entries) {
                    if (resolveLiveAgentSlot(entrySlot).kind === 'ai') {
                        playerSlotIndexById.set(entryPid, entrySlot); // AI keeps its slot
                        assignedSlotIndexes.add(entrySlot);
                    } else {
                        humanPids.push(entryPid);
                    }
                }
                let slot = 0;
                for (const hpid of humanPids) {
                    while (resolveLiveAgentSlot(slot).kind !== 'human') slot += 1;
                    playerSlotIndexById.set(hpid, slot);
                    assignedSlotIndexes.add(slot);
                    slot += 1;
                }
            };

            // mirrors index.ts::resetActiveSessionToLobby (#737, slot-ledger
            // subset): re-arm the start gate and rebuild agents over the RETAINED
            // slot ledger, so the prior match's AI seats stay in
            // `playerSlotIndexById` at lobby phase. Omits the ticker/replay/
            // perspective/FS/undo/commitment resets (renderer-/FS-facing).
            resetActiveSessionToLobby = (): void => {
                gameStarted = false; // never reset elsewhere; re-arms tryStartGame
                agentManager.clear();
                for (const [pid, slotIndex] of [...playerSlotIndexById]) {
                    registerSlotAgent(pid, slotIndex);
                }
                tryStartGame();
            };

            // mirrors index.ts transport wiring (join / leave / action fan-in),
            // instrumented with the ordered `player-joined` event.
            const unsubJoined = transport.onPlayerJoined(({ playerId: pid }) => {
                events.push({ kind: 'player-joined', playerId: pid });
                activePlayers.add(pid);
                const isReconnect = registeredPlayers.has(pid);
                if (!isReconnect) {
                    registeredPlayers.add(pid);
                    registerSlotAgent(pid, nextHumanSlotIndex());
                }
                tryStartGame();
                if (isReconnect) {
                    broadcastCurrentGameSnapshot(pid);
                }
                sessionRestoreCoordinator.notePlayerJoined(pid);
            });
            const unsubLeft = transport.onPlayerLeft((pid) => {
                activePlayers.delete(pid);
                // A lobby-phase leave frees + re-packs the slot ledger (#834); an
                // in-match disconnect retains the seat for reconnect/restore, and
                // a mid-restore leave is left to the coordinator.
                if (
                    sessionRuntime.getSnapshot().phase === gamePhase('lobby') &&
                    !restoreSeatingActive
                ) {
                    releaseLobbySeat(pid);
                }
            });
            const unsubAction = transport.onActionReceived((_from, action) => {
                try {
                    runHostAction(action);
                } catch {
                    // index.ts logs and continues; a single rejected action
                    // never crashes the host loop.
                }
            });

            // mirrors index.ts hosted-session teardown (minus replay/renderer).
            return () => {
                const finalSnapshot = sessionRuntime.getSnapshot();
                if (finalSnapshot.gameResult === null) {
                    simulationHost.onGameEnd(finalSnapshot, { winnerIds: [] });
                }
                unsubJoined();
                unsubLeft();
                unsubAction();
                clearUndoHistory([...activePlayers]);
                broadcasterRef.current?.dispose();
                if (activeSession === sessionRuntime) {
                    activeSession = null;
                    currentMatchId = null;
                    dispatchRendererAction = null;
                    saveInitialTurnMemento = null;
                    handleHostedLocalSeatAdded = null;
                    seatLobbyAgentsForGameStart = null;
                    syncLiveAgentSlots = null;
                    seatRestoredRoster = null;
                    resetActiveSessionToLobby = null;
                    restoreSeatingActive = false;
                    sessionRestoreCoordinator.noteSessionClosed();
                }
            };
        },
        onLocalSeatAdded: (entry) => {
            handleHostedLocalSeatAdded?.(entry);
        },

        // mirrors electron/main/index.ts::onLobbyStateChanged (#833) — feed the
        // live lobby roster to the hosted session so a human joining after
        // `addAi()` skips the AI's slot. The harness has no renderer windows, so
        // it drops production's `LOBBY_UPDATE_CHANNEL` broadcast + E2E auto-start.
        onLobbyStateChanged: (state) => {
            syncLiveAgentSlots?.(state.agentSlots ?? []);
        },

        // mirrors electron/main/index.ts::onGameStartRequested (#827) — the
        // E2E first-player override is fixed to its 'host' default.
        onGameStartRequested: (state) => {
            const sessionRuntime = activeSession;
            if (sessionRuntime === null) {
                throw new Error('LobbyManager: no hosted session runtime is available');
            }
            const firstPlayer = contribution.resolveFirstPlayer({
                hostPlayerId: state.info.hostId,
                firstPlayer: state.info.hostId,
            });
            const aiPlayerIds = seatLobbyAgentsForGameStart?.(state.agentSlots ?? []) ?? [];
            const allPlayerIds = [
                ...state.players.map((player) => player.playerId),
                ...aiPlayerIds,
            ];
            const playerIds = [firstPlayer, ...allPlayerIds.filter((id) => id !== firstPlayer)];
            const initialEntities =
                gameRegistry.resolveGame(gameId)?.buildInitialEntities?.(playerIds) ?? {};
            const setup = buildSetupFromLobbyState(state);
            // mirrors index.ts: the host mints the stable match identity once
            // per match start (F68 #820, Invariant #101).
            const matchId = crypto.randomUUID();
            currentMatchId = matchId;
            sessionRuntime.applyAction({
                type: 'engine:start_game',
                playerId: state.info.hostId,
                tick: sessionRuntime.getSnapshot().tick,
                payload: {
                    playerIds: allPlayerIds,
                    firstPlayerId: firstPlayer,
                    matchId,
                    ...(Object.keys(initialEntities).length > 0 ? { initialEntities } : {}),
                    ...(setup !== undefined ? { setup } : {}),
                },
            });
            saveInitialTurnMemento?.(firstPlayer);
        },

        // mirrors electron/main/index.ts::onReturnToLobbyRequested (#737) —
        // dispatch `engine:return_to_lobby` (phase → lobby, matchId preserved)
        // then run the host-local slot-ledger reset. Same `applyAction` primitive
        // as `onGameStartRequested`; `currentMatchId` is left intact so a capture
        // after return-to-lobby still resolves a live manifest.
        onReturnToLobbyRequested: (state) => {
            const sessionRuntime = activeSession;
            if (sessionRuntime === null) {
                throw new Error('LobbyManager: no hosted session runtime is available');
            }
            sessionRuntime.applyAction({
                type: 'engine:return_to_lobby',
                playerId: state.info.hostId,
                tick: sessionRuntime.getSnapshot().tick,
                payload: {},
            });
            resetActiveSessionToLobby?.();
        },
    });

    // mirrors electron/main/index.ts::applyRestoredFileToActiveSession — the
    // ONE live-restore apply path (Invariant #24). The production version also
    // re-projects to the host renderer; the harness has no renderer.
    const applyRestoredFileToActiveSession = (file: SaveFile): void => {
        if (activeSession === null) {
            throw new Error('saves:load: no active session to apply the restored save to.');
        }
        activeSession.applyRestoredFile(file);
        currentMatchId = file.session.matchId;
    };

    // mirrors electron/main/index.ts coordinator wiring (F68 #823/#826).
    const sessionRestoreCoordinator = new SessionRestoreCoordinator({
        logger,
        ports: {
            hostLobby: async ({ maxPlayers, restore }) => {
                restoreSeatingActive = true;
                try {
                    const info = await lobbyManager.hostLobby({ gameId, maxPlayers, restore });
                    return { lobbyCode: info.sessionId };
                } catch (error) {
                    restoreSeatingActive = false;
                    throw error;
                }
            },
            applyRestoredFile: applyRestoredFileToActiveSession,
            seatRestoredRoster: async (seats) => {
                if (seatRestoredRoster === null) {
                    throw new Error(
                        'saves:load: hosted session wiring incomplete — cannot seat the roster.',
                    );
                }
                await seatRestoredRoster(seats);
            },
            closeLobby: () => lobbyManager.closeLobby(),
        },
    });
    sessionRestoreCoordinator.onStatusChanged((status) => {
        statuses.push(status);
    });

    return {
        lobbyManager,
        coordinator: sessionRestoreCoordinator,
        saveManager,
        repository,
        activeRuntime: () => activeSession,
        dispatchHostAction: (action) => {
            if (dispatchRendererAction === null) {
                throw new Error('restored-host-harness: no hosted session is active');
            }
            dispatchRendererAction(action);
        },
        events: () => events,
        aiActions: () =>
            events
                .filter(
                    (event): event is Extract<HarnessEvent, { kind: 'ai-action' }> =>
                        event.kind === 'ai-action',
                )
                .map((event) => event.action),
        statuses: () => statuses,
    };
}

export function buildRestoreClientHarness(
    provider: MultiplayerProvider,
    options: { readonly gameId: string; readonly ticketStore?: SessionTicketStore },
): RestoreClientHarness {
    const store = options.ticketStore ?? new InMemorySessionTicketStore();
    const joins: JoinLobbyParams[] = [];
    const snapshots: WirePlayerSnapshot[] = [];
    const reveals: WireCommitmentReveal[] = [];

    const capturing: MultiplayerProvider = {
        hostLobby: (params) => provider.hostLobby(params),
        async joinLobby(params) {
            joins.push(params);
            return provider.joinLobby(params);
        },
        dispose: () => provider.dispose(),
    };

    const recordTicket = createSnapshotTicketRecorder({
        store,
        gameId: options.gameId,
        now: () => 1_700_000_000_000,
    });

    const manager = new LobbyManager(capturing, createNoopLogger(), {
        onClientSnapshotReceived: (snapshot) => {
            snapshots.push(snapshot);
            recordTicket(snapshot);
        },
        onSessionJoined: (transport) => {
            const unsubReveal = transport.onReveal((reveal) => {
                reveals.push(reveal);
            });
            return () => {
                unsubReveal();
            };
        },
        // mirrors the #822 resolveJoinClaims wiring in electron/main/index.ts:
        // `undefined` (never `[]`) when no ticket matches, so a fresh client
        // keeps the host's claimless join-order fallback available (#821).
        resolveJoinClaims: async (): Promise<readonly SeatClaim[] | undefined> => {
            const tickets = await store.claims();
            const relevant = tickets.filter((ticket) => ticket.gameId === options.gameId);
            return relevant.length > 0
                ? relevant.map((ticket) => ({
                      matchId: ticket.matchId,
                      playerId: ticket.playerId,
                  }))
                : undefined;
        },
    });

    return { manager, ticketStore: store, joins, snapshots, reveals };
}
