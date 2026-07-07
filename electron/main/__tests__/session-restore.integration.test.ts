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
import { entityId, playerId } from '@chimera-engine/simulation/engine/types.js';
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
