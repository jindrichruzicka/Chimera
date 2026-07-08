/**
 * electron/main/__tests__/session-restore.integration.test.ts
 *
 * Host-level integration tests for the F68 restore protocol (#827): save a
 * mixed-roster multiplayer game, menu-load it through the
 * `SessionRestoreCoordinator`, and prove the full reconnect sequence over the
 * REAL components — `LobbyManager` + `InMemoryMultiplayerProvider` (shared
 * `resolveRestoredSeat`), `SessionRuntime.captureSaveFile`/`applyRestoredFile`,
 * the real engine + tactics pipeline, real AI agents, and the real
 * `SessionTicketStore` → JOIN-claims loop. No real FS, network, or Electron
 * IPC anywhere (Invariant #41 doubles: `InMemorySaveRepository`,
 * `InMemoryMultiplayerProvider`, `InMemorySessionTicketStore`).
 *
 * The composition-root glue (start gate, roster seating, action fan-out) is
 * composed by `__test-support__/restored-host-harness.ts`, which mirrors
 * `electron/main/index.ts::onSessionHosted` — the wiring *shape* stays locked
 * by the mocked #823/#826 suites in `index.test.ts`; these tests prove the
 * end-to-end behavior.
 *
 * Scenarios (issue #827):
 *   S1 — full protocol: save (host + 1 remote + 1 AI) → restore → claimed
 *        rejoin reclaims the exact PlayerId → onGameStart only after the last
 *        human seat fills → tick/stamina/setup/matchId intact.
 *   S2 — mid-commitment save: pendingCommitments + stagedReveals restored
 *        before any broadcast; committed players stay committed; the reveal
 *        fires when the rest commit (Invariant #26).
 *   S3 — no AI-originated action while any human seat is missing.
 *   S4 — cancel mid-wait fully unwinds; a fresh host/join afterwards works.
 *   S5 — claimless rejoin falls back to the lowest open restored seat.
 *
 * Architecture: §4.11 / §4.14 · Invariants verified: #24, #25, #26, #41.
 */

import { describe, expect, it } from 'vitest';

import { InMemoryMultiplayerProvider } from '@chimera-engine/networking/provider/InMemoryMultiplayerProvider.js';
import type { ActionEnvelope } from '@chimera-engine/simulation/engine/types.js';
import { entityId, gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';

import { toSlotId } from '../../preload/api-types.js';

import {
    registerTacticsActions,
    resolveTacticsFirstPlayer,
} from '@chimera-engine/tactics/simulation/actions.js';
import { createTacticsAIState } from '@chimera-engine/tactics/ai/tacticsPolicy.js';
import { tacticsCommitmentOrchestration } from '@chimera-engine/tactics/simulation/commitment/orchestration.js';
import { tacticsResolveIsMyTurn } from '@chimera-engine/tactics/simulation/commitment/turnGate.js';
import {
    TACTICS_COMMIT_ACTION,
    TACTICS_GAME_ID,
    TACTICS_MAX_STAMINA,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera-engine/tactics/simulation/constants.js';
import {
    buildTacticsLobbySetup,
    type TacticsPalette,
} from '@chimera-engine/tactics/lobby/lobby-setup.js';
import { tacticsManifest } from '@chimera-engine/tactics/manifest.js';
import { tacticsSettingsSchema } from '@chimera-engine/tactics/settings-schema.js';
import { readStamina } from '@chimera-engine/tactics/simulation/stamina.js';
import { tacticsVisibilityRules } from '@chimera-engine/tactics/simulation/visibility-rules.js';

import type { MainGameContribution } from '../game/mainGameRegistry.js';
import {
    buildRestoredHostHarness,
    buildRestoreClientHarness,
    type RestoredHostHarness,
} from '../__test-support__/restored-host-harness.js';

/**
 * The same tactics contribution `apps/tactics/electron/main.ts` injects into
 * `main(contributions)` — rebuilt here (rather than imported) so the spec does
 * not load the Electron bootstrap module graph.
 */
const contribution: MainGameContribution = {
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
 * Inline palette so the lobby setup is pure — the production content-DB load
 * is FS-bound and out of scope here (its interpretation into a palette is
 * covered by the tactics content tests).
 */
const TEST_PALETTE: TacticsPalette = {
    playerColors: [
        { value: 'red', label: 'Red' },
        { value: 'teal', label: 'Teal' },
        { value: 'gold', label: 'Gold' },
        { value: 'violet', label: 'Violet' },
    ],
    boardColors: [{ value: 'slate', label: 'Slate' }],
    playerColorHex: { red: '#ef4444', teal: '#14b8a6', gold: '#f59e0b', violet: '#8b5cf6' },
    boardColorHex: { slate: '#3f3f46' },
};

const AI_SEAT = playerId('ai-2');
const HOST_UNIT = 'unit-1';
const SEAT1_UNIT = 'unit-2';
const SEAT2_UNIT = 'unit-3';
const SLOT_ID = toSlotId('restore-slot');
const QUALIFIED_SLOT = `${TACTICS_GAME_ID}/${SLOT_ID}`;

/** The provider fires `onPlayerJoined` (and clients their callbacks) on a macrotask. */
async function flushProviderEvents(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function buildHost(provider: InMemoryMultiplayerProvider): RestoredHostHarness {
    return buildRestoredHostHarness({
        provider,
        contribution,
        lobbySetup: buildTacticsLobbySetup(TEST_PALETTE),
    });
}

function moveAction(
    actor: string,
    tick: number,
    unitId: string,
    x: number,
    y: number,
): ActionEnvelope {
    return {
        type: TACTICS_MOVE_UNIT_ACTION,
        playerId: playerId(actor),
        tick,
        payload: { unitId, x, y },
    };
}

function commitAction(
    actor: string,
    tick: number,
    bufferedMove: { unitId: string; x: number; y: number },
): ActionEnvelope {
    return {
        type: TACTICS_COMMIT_ACTION,
        playerId: playerId(actor),
        tick,
        payload: {
            actions: [
                {
                    type: TACTICS_MOVE_UNIT_ACTION,
                    payload: {
                        unitId: bufferedMove.unitId,
                        x: bufferedMove.x,
                        y: bufferedMove.y,
                    },
                },
            ],
        },
    };
}

describe('session restore protocol (F68 / #827) — integration', () => {
    it('S1: full protocol — save (host + remote + AI), restore, claimed rejoin, deferred start, state intact', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host + remote human + host-time AI slot ─────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
            agentSlots: [{ slotIndex: 2, kind: 'ai', omniscient: true }],
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        // Let the started-game broadcast reach A so its session ticket records
        // the match identity (#822) for the later claimed rejoin.
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;
        expect(matchId).toBeDefined();

        // Advance distinguishably: two host moves (tick bumps, stamina spent),
        // without ending the turn (no AI turn, no autosave noise).
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 2),
        );
        const savedTick = runtime!.getSnapshot().tick;

        // ── Save through the real capture path (#820 manifest included) ───────
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        expect(file.session.matchId).toBe(matchId);
        expect(file.session.maxPlayers).toBe(3);
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
            { playerId: AI_SEAT, control: 'ai', slotIndex: 2, omniscient: true },
        ]);

        // ── Tear the session down (client first, then host) ───────────────────
        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();
        expect(host.activeRuntime()).toBeNull();

        // ── Menu-load restore (#823) ───────────────────────────────────────────
        const restoreMark = host.events().length;
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);

        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(waiting.matchId).toBe(matchId);
        expect(waiting.missingSeats).toStrictEqual([seatA]);
        // The checkpoint is applied before seating (Invariant #24 helper), so
        // the live snapshot is already at the saved tick while waiting…
        expect(host.activeRuntime()!.getSnapshot().tick).toBe(savedTick);
        // …but the start gate stays closed: no game-start while a human seat
        // is missing.
        const waitingEvents = host.events().slice(restoreMark);
        expect(waitingEvents.some((event) => event.kind === 'game-start')).toBe(false);

        // ── Claimed rejoin: A presents its remembered {matchId, playerId} ─────
        await clientA.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();

        // The exact saved PlayerId is reclaimed through the shared
        // resolveRestoredSeat claims match (#821/#822).
        expect(clientA.joins.at(-1)?.claims).toStrictEqual([{ matchId, playerId: String(seatA) }]);
        expect(clientA.manager.getLocalPlayerId()).toBe(seatA);
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });

        // onGameStart fired exactly once, only AFTER the last human seat
        // filled, and over the restored snapshot (saved tick).
        const restoredEvents = host.events().slice(restoreMark);
        const joinIndex = restoredEvents.findIndex(
            (event) => event.kind === 'player-joined' && event.playerId === seatA,
        );
        const startEvents = restoredEvents.filter((event) => event.kind === 'game-start');
        expect(startEvents).toHaveLength(1);
        expect(restoredEvents.findIndex((event) => event.kind === 'game-start')).toBeGreaterThan(
            joinIndex,
        );
        expect(startEvents[0]).toStrictEqual({ kind: 'game-start', tick: savedTick });

        // Restored state intact: tick, stamina, setup (colors + match
        // settings), and the stable match identity (#820/#101).
        const restored = host.activeRuntime()!.getSnapshot();
        expect(restored.tick).toBe(savedTick);
        expect(restored.matchId).toBe(matchId);
        expect(readStamina(restored, hostInfo.hostId)).toStrictEqual({
            current: TACTICS_MAX_STAMINA - 2,
            max: TACTICS_MAX_STAMINA,
        });
        expect(restored.setup?.matchSettings).toStrictEqual({
            boardColor: 'slate',
            [TACTICS_TURN_MODE_SETTING]: 'sequential',
        });
        expect(restored.setup?.playerAttributes).toStrictEqual({
            [String(hostInfo.hostId)]: { color: 'red' },
            [String(seatA)]: { color: 'teal' },
        });

        // The reconnecting peer was re-synced with the restored snapshot.
        const resync = clientA.snapshots.at(-1);
        expect(resync?.tick).toBe(savedTick);
        expect(resync?.matchId).toBe(matchId);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1c: AI added via addAi() AFTER a remote joins gets a non-colliding slot, so the mixed save restores (#832)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host + remote human, then AI added at LOBBY time ──
        // via addAi() (no host-time agentSlots). Before #832, addAi() reused the
        // remote's slot 1, producing a duplicate-slotIndex manifest that restore
        // rejects; the AI must instead land at slot 2.
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        // The host adds an AI only after the remote has taken slot 1.
        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 2, kind: 'ai' },
        ]);

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;

        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );
        const savedTick = runtime!.getSnapshot().tick;

        // ── Save: the remote must stay `control: 'remote'` and every slotIndex
        // must be unique (acceptance criteria #1/#2). ───────────────────────────
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
            { playerId: AI_SEAT, control: 'ai', slotIndex: 2 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore: the save is accepted (no duplicate-slotIndex rejection) and
        // completes once the remote reclaims its seat (acceptance criterion #3). ─
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);

        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(waiting.matchId).toBe(matchId);
        expect(waiting.missingSeats).toStrictEqual([seatA]);

        await clientA.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();

        expect(clientA.manager.getLocalPlayerId()).toBe(seatA);
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });
        expect(host.activeRuntime()!.getSnapshot().tick).toBe(savedTick);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1d: a remote joining AFTER addAi() skips the AI slot, so the reverse-ordering mixed save restores (#833)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host adds an AI at LOBBY time via addAi() FIRST,
        // then a remote human joins — the reverse of S1c. The AI takes slot 1
        // (next free after the host at slot 0). Before #833, the human-slot
        // authority read a stale live roster and handed the joining remote the
        // AI's slot 1, producing a duplicate-slotIndex manifest that restore
        // rejects; the remote must instead land at slot 2. ────────────────────
        const aiSeat = playerId('ai-1');
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });

        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 1, kind: 'ai' },
        ]);

        // The remote joins only after the AI already holds slot 1.
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;

        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );
        const savedTick = runtime!.getSnapshot().tick;

        // ── Save: the remote must stay `control: 'remote'` at its OWN slot 2 and
        // every slotIndex must be unique (acceptance criteria #1/#2). ──────────
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: aiSeat, control: 'ai', slotIndex: 1 },
            { playerId: seatA, control: 'remote', slotIndex: 2 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore: the save is accepted (no duplicate-slotIndex rejection) and
        // completes once the remote reclaims its seat (acceptance criterion #3). ─
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);

        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(waiting.matchId).toBe(matchId);
        expect(waiting.missingSeats).toStrictEqual([seatA]);

        await clientA.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();

        expect(clientA.manager.getLocalPlayerId()).toBe(seatA);
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });
        expect(host.activeRuntime()!.getSnapshot().tick).toBe(savedTick);

        // Pin the lobby-phase guard on `syncLiveAgentSlots` (#833): the restored
        // AI roster is seated from the SAVED seats (the lobby's own agentSlots
        // stay empty), and the remote's reconnect above fired an
        // `onLobbyStateChanged` with an empty `agentSlots` at in-game phase.
        // Re-capturing the restored session must STILL classify the AI as
        // `control:'ai'` — without the guard that push would wipe
        // `currentAgentSlots`, misclassifying the AI as `remote` (Invariant
        // #101/#108 fidelity regression).
        const resaved = host
            .activeRuntime()!
            .captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(resaved.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: aiSeat, control: 'ai', slotIndex: 1 },
            { playerId: seatA, control: 'remote', slotIndex: 2 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1i: an AI added BEFORE a human join gets a non-colliding slot above the human, so the mixed save restores (#836)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host adds an AI at LOBBY time FIRST (slot 1); a
        // remote then joins and the host seats it at the lowest NON-AI slot (2),
        // pushing it ABOVE the AI. A SECOND addAi must land at slot 3, not
        // re-issue the remote's slot 2. Before #836, `nextFreeAiSlotIndex`
        // reserved the contiguous block `[0, players.length)`, counted the low AI
        // slot as a human seat, and collided the second AI with the remote — a
        // duplicate-slotIndex manifest that restore rejects (the #832 failure
        // class, reachable with NO leave). ─────────────────────────────────────
        const ai1 = playerId('ai-1');
        const ai3 = playerId('ai-3');
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 4,
        });

        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 1, kind: 'ai' },
        ]);

        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        // The second AI skips the remote's slot 2 and lands at slot 3.
        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 1, kind: 'ai' },
            { slotIndex: 3, kind: 'ai' },
        ]);

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;

        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );
        const savedTick = runtime!.getSnapshot().tick;

        // ── Save: every slotIndex unique and in-range, the remote stays
        // `control: 'remote'`, and both AI seats keep their own slots. ──────────
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: ai1, control: 'ai', slotIndex: 1 },
            { playerId: seatA, control: 'remote', slotIndex: 2 },
            { playerId: ai3, control: 'ai', slotIndex: 3 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore: accepted (no duplicate-slotIndex rejection), and completes
        // once the remote reclaims its seat. ───────────────────────────────────
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);
        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(waiting.matchId).toBe(matchId);
        expect(waiting.missingSeats).toStrictEqual([seatA]);

        await clientA.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        expect(clientA.manager.getLocalPlayerId()).toBe(seatA);
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });
        expect(host.activeRuntime()!.getSnapshot().tick).toBe(savedTick);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1e: a lobby leave frees + re-packs the host slot ledger so a later join stays contiguous, with no stale seat (#834)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host + two remotes (slots 1, 2); the FIRST remote
        // then leaves DURING the lobby. Before #834 the host ledger never freed
        // slot 1, so the next joiner fell through `nextHumanSlotIndex`'s `.size`
        // fallback to an out-of-range slot and the departed remote lingered as a
        // stale seat in the captured manifest. ────────────────────────────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        const clientB = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        await clientB.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatB = clientB.manager.getLocalPlayerId();
        expect(seatB).not.toBeNull();

        // The first remote leaves during the lobby.
        await clientA.manager.closeLobby();
        await flushProviderEvents();

        // A fresh remote takes the freed seat — only reachable because
        // LobbyManager also compacted its roster, opening a slot under maxPlayers.
        const clientC = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientC.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatC = clientC.manager.getLocalPlayerId();
        expect(seatC).not.toBeNull();

        await clientB.manager.updatePlayerReadyState(true);
        await clientC.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;

        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );
        const savedTick = runtime!.getSnapshot().tick;

        // ── Save: the remaining remote re-packed to slot 1, the fresh remote took
        // slot 2, the departed remote left NO seat, and every slotIndex is in
        // [0, maxPlayers) with no duplicates (#834 acceptance #1/#2/#3). ────────
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatB, control: 'remote', slotIndex: 1 },
            { playerId: seatC, control: 'remote', slotIndex: 2 },
        ]);

        await clientB.manager.closeLobby();
        await clientC.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore + re-save: the clean post-leave ledger round-trips through the
        // restore path, and re-capturing reproduces the same seats (S1d-style). ─
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);
        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(waiting.missingSeats).toStrictEqual([seatB, seatC]);

        await clientB.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        await clientC.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });
        expect(host.activeRuntime()!.getSnapshot().tick).toBe(savedTick);

        const resaved = host
            .activeRuntime()!
            .captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(resaved.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatB, control: 'remote', slotIndex: 1 },
            { playerId: seatC, control: 'remote', slotIndex: 2 },
        ]);

        await clientB.manager.closeLobby();
        await clientC.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1f: after a lobby leave, addAi() no longer collides with a stranded human seat (#834)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── host + two remotes (slots 1, 2); the FIRST remote leaves, then the
        // host fills the freed seat with an AI. Before #834 the host ledger left
        // the second remote stranded at slot 2 while LobbyManager (compacted to 2
        // humans) handed the AI slot 2 too — a duplicate-slotIndex manifest that
        // restore rejects (the #832 failure class, now via a leave). ───────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        const clientB = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        await clientB.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatB = clientB.manager.getLocalPlayerId();
        expect(seatB).not.toBeNull();

        await clientA.manager.closeLobby();
        await flushProviderEvents();

        // The AI lands at slot 2 (LobbyManager reserves [0, 2) for the two
        // humans); the remaining remote must be re-packed to slot 1 to clear it.
        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 2, kind: 'ai' },
        ]);

        await clientB.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatB, control: 'remote', slotIndex: 1 },
            { playerId: AI_SEAT, control: 'ai', slotIndex: 2 },
        ]);

        await clientB.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1g: an in-match disconnect RETAINS its seat in the ledger (no #821 reconnect regression) (#834)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 2,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();

        // The match is under way; the remote drops. The lobby-phase release must
        // NOT fire — the seat is retained so the remote can reconnect / the save
        // can be restored (#821/#823). The `phase === lobby` guard is what keeps
        // this an in-match disconnect rather than a lobby leave.
        await clientA.manager.closeLobby();
        await flushProviderEvents();

        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
        ]);

        await host.lobbyManager.closeLobby();
    });

    it('S1h: a lobby leave keeps an AI seat pinned at its slot, re-packing only the humans (#834, review BLOCK-1)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Host-time AI at slot 2, so the AI lives in the host ledger DURING
        // the lobby (the same state a return-to-lobby #737 produces). A remote
        // takes the lone human slot 1, then leaves. The re-pack must PIN the AI
        // at slot 2 and re-slot only humans — a position-only re-pack would
        // slide the AI down into a human slot and record it as `remote` in the
        // manifest (breaking a later save/restore). ────────────────────────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
            agentSlots: [{ slotIndex: 2, kind: 'ai' }],
        });

        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        expect(clientA.manager.getLocalPlayerId()).not.toBeNull();

        // The remote leaves during the lobby (AI still seated in the ledger).
        await clientA.manager.closeLobby();
        await flushProviderEvents();

        // A fresh remote reclaims the lone human slot 1 — NOT the AI's slot 2.
        const clientB = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientB.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatB = clientB.manager.getLocalPlayerId();
        expect(seatB).not.toBeNull();

        await clientB.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        // The AI stayed at slot 2 (`control: 'ai'`); the fresh remote took slot 1.
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatB, control: 'remote', slotIndex: 1 },
            { playerId: AI_SEAT, control: 'ai', slotIndex: 2 },
        ]);

        await clientB.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1j: a return-to-lobby (#737) then a lobby leave keeps the AI seat pinned at its slot (#834 WARN-1 / #837)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── host + one remote + an AI at slot 2 → start the match → RETURN TO
        // LOBBY (#737). `resetActiveSessionToLobby` re-registers the AI into the
        // host ledger and `engine:return_to_lobby` leaves phase 'lobby'. The
        // remote then leaves that returned lobby: `releaseLobbySeat` must PIN the
        // retained AI at slot 2 — the #834 BLOCK-1 fix exercised via the
        // return-to-lobby trigger (the twin of S1h's host-time-agentSlots one). ─
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });

        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        expect(clientA.manager.getLocalPlayerId()).not.toBeNull();

        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 2, kind: 'ai' },
        ]);

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        // ── Return to lobby: phase flips to 'lobby', the matchId is preserved,
        // and the AI stays in the host ledger. ─────────────────────────────────
        await host.lobbyManager.returnToLobby();
        await flushProviderEvents();
        expect(host.activeRuntime()!.getSnapshot().phase).toBe(gamePhase('lobby'));
        expect(host.activeRuntime()!.getSnapshot().matchId).toBe(matchId);

        // ── The remote leaves the returned lobby → the AI is pinned at slot 2,
        // the remote leaves no seat, nothing is stale/out-of-range. ─────────────
        await clientA.manager.closeLobby();
        await flushProviderEvents();

        const file = host
            .activeRuntime()!
            .captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: AI_SEAT, control: 'ai', slotIndex: 2 },
        ]);

        // Re-capture is idempotent — the pinned ledger is stable (S1d-style).
        const resaved = host
            .activeRuntime()!
            .captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(resaved.session.seats).toStrictEqual(file.session.seats);

        await host.lobbyManager.closeLobby();
    });

    it('S1k: removeAi of a host-time AI drops its stale ledger seat, so a later join fills the freed slot (#838)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Host-time AI at slot 1 seeds the AI INTO the host ledger. `removeAi(1)`
        // must drop its ledger seat + agent; before #838 the stale `ai-1` lingered
        // as a phantom `remote` seat and the later joiner fell out of range. ─────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 2,
            agentSlots: [{ slotIndex: 1, kind: 'ai' }],
        });

        await host.lobbyManager.removeAi(1);

        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1l: removeAi of a low AI re-packs a human that sat above it, so a later addAi does not collide (#838)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });

        // addAi FIRST (AI@1); a remote then joins ABOVE it at slot 2.
        await host.lobbyManager.addAi();
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        // removeAi(1): the remote stranded at slot 2 must re-pack down to slot 1,
        // so a fresh addAi lands at slot 2 instead of re-issuing the remote's slot.
        await host.lobbyManager.removeAi(1);
        await host.lobbyManager.addAi();
        expect(host.lobbyManager.getCurrentState()?.agentSlots).toStrictEqual([
            { slotIndex: 2, kind: 'ai' },
        ]);

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
            { playerId: AI_SEAT, control: 'ai', slotIndex: 2 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1m: removeAi after a return-to-lobby (#737) drops the retained AI seat, with no stale seat (#838)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();

        await host.lobbyManager.addAi(); // AI@2
        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        const matchId = runtime!.getSnapshot().matchId;
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        // Return to lobby — the AI stays in the host ledger — then remove it.
        await host.lobbyManager.returnToLobby();
        await flushProviderEvents();
        expect(host.activeRuntime()!.getSnapshot().phase).toBe(gamePhase('lobby'));

        await host.lobbyManager.removeAi(2);

        const file = host
            .activeRuntime()!
            .captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
        ]);
        expect(file.session.matchId).toBe(matchId);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1n: an overflowing human join auto-removes a host-time AI and drops its ledger seat (#838)', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Host-time AI@1 fills a maxPlayers-2 lobby (host + AI). A human join
        // overflows → LobbyManager auto-removes the AI; the host ledger must drop
        // its stale seat too (the same reconcile as removeAi, via the join path). ─
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 2,
            agentSlots: [{ slotIndex: 1, kind: 'ai' }],
        });

        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        expect(seatA).not.toBeNull();
        expect(host.lobbyManager.getCurrentState()?.agentSlots ?? []).toStrictEqual([]);

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await flushProviderEvents();
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime).not.toBeNull();
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );

        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        expect(file.session.seats).toStrictEqual([
            { playerId: hostInfo.hostId, control: 'host', slotIndex: 0 },
            { playerId: seatA, control: 'remote', slotIndex: 1 },
        ]);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S1b: a single-seat save restores over the restored checkpoint, never the pre-restore lobby snapshot', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original solo session: the host alone ──────────────────────────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 1,
        });
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();

        const runtime = host.activeRuntime();
        host.dispatchHostAction(
            moveAction(String(hostInfo.hostId), runtime!.getSnapshot().tick, HOST_UNIT, 0, 1),
        );
        const savedTick = runtime!.getSnapshot().tick;
        const matchId = runtime!.getSnapshot().matchId;
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore: the roster is complete at hosting time, so the start-
        // suppression gate (`restoreSeatingActive`, F68 #823) is the ONLY
        // thing deferring onGameStart past the checkpoint apply ────────────────
        const restoreMark = host.events().length;
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);

        // No remote seats → the restore completes immediately…
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });
        // …and onGameStart fired exactly once, over the RESTORED snapshot —
        // a start on the pre-restore lobby snapshot would carry tick 0.
        const restoredEvents = host.events().slice(restoreMark);
        expect(restoredEvents.filter((event) => event.kind === 'game-start')).toStrictEqual([
            { kind: 'game-start', tick: savedTick },
        ]);
        expect(host.activeRuntime()!.getSnapshot().tick).toBe(savedTick);

        await host.lobbyManager.closeLobby();
    });

    it('S5: claimless rejoin — join-order fallback fills the lowest open restored seat', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host + two remote humans ─────────────────────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        const clientB = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        await clientB.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        const seatB = clientB.manager.getLocalPlayerId();

        await clientA.manager.updatePlayerReadyState(true);
        await clientB.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        const matchId = runtime!.getSnapshot().matchId;
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        expect(
            file.session.seats.map((seat) => [seat.playerId, seat.control, seat.slotIndex]),
        ).toStrictEqual([
            [hostInfo.hostId, 'host', 0],
            [seatA, 'remote', 1],
            [seatB, 'remote', 2],
        ]);

        await clientA.manager.closeLobby();
        await clientB.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore, then rejoin from BRAND-NEW machines (empty ticket stores) ─
        const restoreMark = host.events().length;
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);
        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(waiting.missingSeats).toStrictEqual([seatA, seatB]);

        const fresh1 = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await fresh1.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        // A fresh client presents NO claims key at all (presenting `[]` would
        // opt out of the fallback, #821)…
        expect(fresh1.joins[0] !== undefined && 'claims' in fresh1.joins[0]).toBe(false);
        // …and the join-order fallback hands out the LOWEST open restored seat.
        expect(fresh1.manager.getLocalPlayerId()).toBe(seatA);

        const midStatus = host.coordinator.status();
        expect(midStatus.state).toBe('waiting-for-players');
        if (midStatus.state !== 'waiting-for-players') throw new Error('unreachable');
        expect(midStatus.missingSeats).toStrictEqual([seatB]);
        expect(
            host
                .events()
                .slice(restoreMark)
                .some((event) => event.kind === 'game-start'),
        ).toBe(false);

        const fresh2 = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await fresh2.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        expect(fresh2.manager.getLocalPlayerId()).toBe(seatB);
        expect(host.coordinator.status()).toStrictEqual({ state: 'complete', matchId });

        // The start gate opened only once the SECOND (last) seat filled.
        const restoredEvents = host.events().slice(restoreMark);
        const secondJoinIndex = restoredEvents.findIndex(
            (event) => event.kind === 'player-joined' && event.playerId === seatB,
        );
        expect(restoredEvents.filter((event) => event.kind === 'game-start')).toHaveLength(1);
        expect(restoredEvents.findIndex((event) => event.kind === 'game-start')).toBeGreaterThan(
            secondJoinIndex,
        );

        await fresh1.manager.closeLobby();
        await fresh2.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S3: zero AI-originated actions while a human seat is missing; the AI acts once the gate opens', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host + remote + omniscient AI at slot 2 ─────────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
            agentSlots: [{ slotIndex: 2, kind: 'ai', omniscient: true }],
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });

        // A mid-AI-turn save is unreachable naturally — the afterTick pump
        // plays an AI seat's turn to completion synchronously inside
        // runHostAction — so point the SAVED turn clock at the AI seat. This
        // is fixture data (the checkpoint is still the real captured one), not
        // a mock: it makes the AI the active seat the moment the gate opens.
        const midAiTurn: SaveFile = {
            ...file,
            checkpoint: {
                ...file.checkpoint,
                turnClock: { activePlayerId: AI_SEAT, deadlineMs: 30_000 },
            },
        };

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore: the AI is the active seat, but a human seat is missing ───
        const restoreMark = host.events().length;
        await host.coordinator.restoreSession(midAiTurn);
        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');

        // ZERO AI-originated actions while waiting: nothing pumps the agents —
        // no onGameStart, no action fan-out, no ticker (Invariant #17 path).
        expect(
            host
                .events()
                .slice(restoreMark)
                .filter((event) => event.kind === 'ai-action'),
        ).toStrictEqual([]);

        // ── The missing human reconnects → gate opens → the AI takes its turn ─
        await clientA.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        expect(clientA.manager.getLocalPlayerId()).toBe(seatA);
        expect(host.coordinator.status().state).toBe('complete');

        const restoredEvents = host.events().slice(restoreMark);
        const joinIndex = restoredEvents.findIndex((event) => event.kind === 'player-joined');
        const firstAiIndex = restoredEvents.findIndex((event) => event.kind === 'ai-action');
        const aiEvents = restoredEvents.filter(
            (event): event is Extract<(typeof restoredEvents)[number], { kind: 'ai-action' }> =>
                event.kind === 'ai-action',
        );
        // The zero-actions assertion above had teeth: the SAME agents dispatch
        // as soon as the last human seat fills…
        expect(aiEvents.length).toBeGreaterThan(0);
        expect(firstAiIndex).toBeGreaterThan(joinIndex);
        // …and every AI-originated action comes from the restored AI seat.
        expect(aiEvents.every((event) => event.action.playerId === AI_SEAT)).toBe(true);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S2: mid-commitment save — commitments and staged reveals survive restore and reveal when the rest commit', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session: host + two remotes in commitment turn mode ──────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        const clientB = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        await clientB.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();
        const seatB = clientB.manager.getLocalPlayerId();

        await host.lobbyManager.setMatchSetting(TACTICS_TURN_MODE_SETTING, 'commitment');
        await clientA.manager.updatePlayerReadyState(true);
        await clientB.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        expect(runtime!.getSnapshot().setup?.matchSettings?.[TACTICS_TURN_MODE_SETTING]).toBe(
            'commitment',
        );

        // ── A commits; host and B have not ─────────────────────────────────────
        clientA.manager.sendAction(
            commitAction(String(seatA), runtime!.getSnapshot().tick, {
                unitId: SEAT1_UNIT,
                x: 2,
                y: 1,
            }),
        );
        expect(runtime!.committedPlayerIds()).toStrictEqual([seatA]);

        // ── Mid-commitment save: envelope + staged reveal persist as a unit ───
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        const envelopeIds = Object.keys(file.pendingCommitments);
        expect(envelopeIds).toHaveLength(1);
        // Invariant #26: stagedReveals move as a unit with pendingCommitments.
        expect(Object.keys(file.stagedReveals)).toStrictEqual(envelopeIds);
        expect(Object.values(file.stagedReveals)[0]?.playerId).toBe(seatA);

        await clientA.manager.closeLobby();
        await clientB.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore: commitments are live BEFORE any client rejoins ───────────
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);
        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');

        const restored = host.activeRuntime();
        expect(Object.keys(restored!.capturePendingCommitments())).toStrictEqual(envelopeIds);
        expect(restored!.committedPlayerIds()).toStrictEqual([seatA]);

        // ── Rejoin: the first re-sync snapshot already carries A's envelope ───
        await clientA.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        await clientB.manager.joinLobby({ address: waiting.lobbyCode });
        await flushProviderEvents();
        expect(clientA.manager.getLocalPlayerId()).toBe(seatA);
        expect(clientB.manager.getLocalPlayerId()).toBe(seatB);
        expect(host.coordinator.status().state).toBe('complete');
        expect(Object.keys(clientA.snapshots.at(-1)?.commitments ?? {})).toStrictEqual(envelopeIds);
        expect(Object.keys(clientB.snapshots.at(-1)?.commitments ?? {})).toStrictEqual(envelopeIds);

        // ── The REST commit; A stays committed and never re-commits ───────────
        const savedTurnNumber = file.checkpoint.turnNumber;
        host.dispatchHostAction(
            commitAction(String(hostInfo.hostId), restored!.getSnapshot().tick, {
                unitId: HOST_UNIT,
                x: 0,
                y: 1,
            }),
        );
        clientB.manager.sendAction(
            commitAction(String(seatB), restored!.getSnapshot().tick, {
                unitId: SEAT2_UNIT,
                x: 3,
                y: -1,
            }),
        );

        // The completing commit auto-advanced the turn and revealed — A's
        // PRE-SAVE bundle included (its envelope id reached both peers)…
        expect(clientA.reveals.map((reveal) => reveal.id)).toContain(envelopeIds[0]);
        expect(clientB.reveals.map((reveal) => reveal.id)).toContain(envelopeIds[0]);
        // …its buffered move landed on the board…
        const unitA = restored!.getSnapshot().entities[entityId(SEAT1_UNIT)] as unknown as {
            x: number;
            y: number;
        };
        expect([unitA.x, unitA.y]).toStrictEqual([2, 1]);
        // …and the turn advanced exactly once past the saved turn.
        expect(restored!.getSnapshot().turnNumber).toBe(savedTurnNumber + 1);

        await clientA.manager.closeLobby();
        await clientB.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });

    it('S4: cancel mid-wait fully unwinds the session; a fresh host/join afterwards works', async () => {
        const provider = new InMemoryMultiplayerProvider();
        const host = buildHost(provider);

        // ── Original session + save (host + remote + AI), then teardown ───────
        const hostInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 3,
            agentSlots: [{ slotIndex: 2, kind: 'ai', omniscient: true }],
        });
        const clientA = buildRestoreClientHarness(provider, { gameId: TACTICS_GAME_ID });
        await clientA.manager.joinLobby({ address: hostInfo.sessionId });
        await flushProviderEvents();
        const seatA = clientA.manager.getLocalPlayerId();

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const runtime = host.activeRuntime();
        const matchId = runtime!.getSnapshot().matchId;
        const file = runtime!.captureSaveFile({ gameId: TACTICS_GAME_ID, slotId: SLOT_ID });
        await host.saveManager.save(file);
        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
        await flushProviderEvents();

        // ── Restore, then cancel mid-wait ──────────────────────────────────────
        const loaded = await host.saveManager.restoreFromSave(QUALIFIED_SLOT);
        await host.coordinator.restoreSession(loaded);
        const waiting = host.coordinator.status();
        expect(waiting.state).toBe('waiting-for-players');
        if (waiting.state !== 'waiting-for-players') throw new Error('unreachable');

        await host.coordinator.cancel();

        // Fully unwound: terminal `aborted` published exactly once (the
        // coordinator's unwinding latch suppressed the teardown's transient
        // transition), no live session, and the restored lobby is gone.
        expect(host.coordinator.status()).toStrictEqual({ state: 'aborted', matchId });
        expect(host.statuses().filter((status) => status.state === 'aborted')).toHaveLength(1);
        expect(host.activeRuntime()).toBeNull();
        await expect(provider.joinLobby({ address: waiting.lobbyCode })).rejects.toThrow(
            'no session found',
        );

        // ── A fresh host/join afterwards works ────────────────────────────────
        const freshMark = host.events().length;
        const freshInfo = await host.lobbyManager.hostLobby({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 2,
        });
        await clientA.manager.joinLobby({ address: freshInfo.sessionId });
        await flushProviderEvents();
        // The client's stale ticket still presents claims, but the fresh
        // (non-restore) lobby has no restored match — it degrades to a fresh
        // mint instead of reclaiming the old seat.
        const freshJoin = clientA.joins.at(-1);
        expect(freshJoin !== undefined && 'claims' in freshJoin).toBe(true);
        const freshSeat = clientA.manager.getLocalPlayerId();
        expect(freshSeat).not.toBe(seatA);

        await clientA.manager.updatePlayerReadyState(true);
        await host.lobbyManager.updatePlayerReadyState(true);
        await host.lobbyManager.startGame();
        await flushProviderEvents();

        const freshEvents = host.events().slice(freshMark);
        expect(freshEvents.filter((event) => event.kind === 'game-start')).toHaveLength(1);
        // The new match is live and playable (nothing wedged by the cancel).
        const freshRuntime = host.activeRuntime();
        const tickBefore = freshRuntime!.getSnapshot().tick;
        host.dispatchHostAction(moveAction(String(freshInfo.hostId), tickBefore, HOST_UNIT, 0, 1));
        expect(freshRuntime!.getSnapshot().tick).toBe(tickBefore + 1);

        await clientA.manager.closeLobby();
        await host.lobbyManager.closeLobby();
    });
});
