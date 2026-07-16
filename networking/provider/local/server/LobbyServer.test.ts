/**
 * networking/provider/local/server/LobbyServer.test.ts
 *
 * Unit tests for LobbyServer — the WebSocket server backbone of
 * LocalWebSocketProvider.
 *
 * All tests bind to port 0 (OS assigns a random free port) to avoid
 * conflicts when run in parallel.
 *
 * Architecture: §4.14 — LocalWebSocketProvider Internal Architecture
 * Task: F10 / T02 (issue #217)
 *
 * Invariants upheld:
 *   #2 — no imports from renderer/, electron/, or DOM APIs
 *   networking boundary — only imports from within local/ or shared/
 */

import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { PlayerId } from '@chimera-engine/simulation/contracts';
import type { Logger } from '@chimera-engine/simulation/foundation/logging.js';
import { playerId as toPlayerId } from '../../MultiplayerProvider.js';
import type { DisconnectReason, LobbyState } from '../../MultiplayerProvider.js';
import type {
    ClientMessage,
    ServerMessage,
} from '@chimera-engine/simulation/foundation/messages.js';
import { LobbyServer } from './LobbyServer.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely convert ws RawData (Buffer | ArrayBuffer | Buffer[]) to a string. */
function rawToString(raw: Buffer | ArrayBuffer | Buffer[]): string {
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return raw.toString('utf8');
}

function connectAndJoin(
    server: LobbyServer,
    displayName = 'Tester',
    reconnectPlayerId?: PlayerId,
): Promise<{ ws: WebSocket; playerId: PlayerId }> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
        ws.on('error', reject);
        ws.on('open', () => {
            const joinMsg: ClientMessage = {
                type: 'JOIN',
                token: server.token,
                profile: { playerId: toPlayerId('pending'), displayName },
                ...(reconnectPlayerId === undefined ? {} : { reconnectPlayerId }),
            };
            ws.send(JSON.stringify(joinMsg));
        });
        ws.on('message', (raw) => {
            const msg = JSON.parse(rawToString(raw)) as ServerMessage;
            if (msg.type === 'WELCOME') {
                resolve({ ws, playerId: msg.playerId });
            } else if (msg.type === 'REJECT') {
                reject(new Error(`JOIN rejected: ${msg.reason}`));
            }
        });
    });
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

const servers: LobbyServer[] = [];

afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers.length = 0;
});

function makeServer(opts?: {
    maxPlayers?: number;
    maxSpectators?: number;
    password?: string;
    matchId?: string;
    hostPlayerId?: PlayerId;
    restoredSeats?: readonly PlayerId[];
    logger?: Logger;
}): LobbyServer {
    const s = new LobbyServer({
        port: 0,
        gameId: 'test',
        maxPlayers: opts?.maxPlayers ?? 4,
        ...(opts?.maxSpectators === undefined ? {} : { maxSpectators: opts.maxSpectators }),
        ...(opts?.password === undefined ? {} : { password: opts.password }),
        ...(opts?.matchId === undefined ? {} : { matchId: opts.matchId }),
        ...(opts?.hostPlayerId === undefined ? {} : { hostPlayerId: opts.hostPlayerId }),
        ...(opts?.restoredSeats === undefined ? {} : { restoredSeats: opts.restoredSeats }),
        ...(opts?.logger === undefined ? {} : { logger: opts.logger }),
    });
    servers.push(s);
    return s;
}

/** Minimal Logger double that records warn messages; child() returns itself. */
function makeWarnCollectingLogger(warns: string[]): Logger {
    const logger: Logger = {
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: (msg) => {
            warns.push(msg);
        },
        error: () => {},
        fatal: () => {},
        child: () => logger,
    };
    return logger;
}

/**
 * Open one socket, send a single JOIN (optionally with a password), and resolve
 * with the first ServerMessage the host returns (WELCOME or REJECT). Used by the
 * password-gate tests (F56) which assert on the handshake outcome rather than a
 * fully established connection.
 */
function joinExpectingResponse(
    server: LobbyServer,
    opts: { token?: string; password?: string } = {},
): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
        ws.on('error', reject);
        ws.on('open', () => {
            const join: ClientMessage = {
                type: 'JOIN',
                token: opts.token ?? server.token,
                profile: { playerId: toPlayerId('pending'), displayName: 'PW' },
                ...(opts.password === undefined ? {} : { password: opts.password }),
            };
            ws.send(JSON.stringify(join));
        });
        ws.on('message', (raw) => {
            resolve(JSON.parse(rawToString(raw)) as ServerMessage);
            ws.close();
        });
    });
}

// ─── Construction & lifecycle ────────────────────────────────────────────────

describe('LobbyServer — construction and lifecycle', () => {
    it('exposes a positive port after construction', async () => {
        const server = makeServer();
        await server.ready();
        expect(server.port).toBeGreaterThan(0);
    });

    it('exposes a non-empty token', async () => {
        const server = makeServer();
        await server.ready();
        expect(typeof server.token).toBe('string');
        expect(server.token.length).toBeGreaterThan(0);
    });

    it('each instance has a unique token', async () => {
        const s1 = makeServer();
        const s2 = makeServer();
        await Promise.all([s1.ready(), s2.ready()]);
        expect(s1.token).not.toBe(s2.token);
    });

    it('close() resolves without throwing', async () => {
        const server = makeServer();
        await server.ready();
        await expect(server.close()).resolves.toBeUndefined();
    });

    it('close() can be called multiple times without throwing', async () => {
        const server = makeServer();
        await server.ready();
        await server.close();
        await expect(server.close()).resolves.toBeUndefined();
    });
});

// ─── JOIN handshake ──────────────────────────────────────────────────────────

describe('LobbyServer — JOIN handshake', () => {
    it('sends WELCOME with a unique PlayerId on valid JOIN', async () => {
        const server = makeServer();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);
        expect(typeof playerId).toBe('string');
        expect(playerId.length).toBeGreaterThan(0);
        ws.close();
    });

    it('assigns distinct PlayerId values to different clients', async () => {
        const server = makeServer();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);
        expect(c1.playerId).not.toBe(c2.playerId);
        c1.ws.close();
        c2.ws.close();
    });

    it('honors reconnectPlayerId for a previously known disconnected player', async () => {
        const server = makeServer();
        await server.ready();
        const first = await connectAndJoin(server, 'Reconnecting');

        await new Promise<void>((resolve) => {
            first.ws.once('close', () => resolve());
            first.ws.close();
        });

        const second = await connectAndJoin(server, 'Reconnecting', first.playerId);
        expect(second.playerId).toBe(first.playerId);
        second.ws.close();
    });

    it('sends REJECT when the token is wrong', async () => {
        const server = makeServer();
        await server.ready();
        const rejected = await new Promise<ServerMessage>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
            ws.on('open', () => {
                const join: ClientMessage = {
                    type: 'JOIN',
                    token: 'wrong-token',
                    profile: { playerId: toPlayerId('x'), displayName: 'X' },
                };
                ws.send(JSON.stringify(join));
            });
            ws.on('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        expect(rejected.type).toBe('REJECT');
    });

    it('rejects when the server is at capacity', async () => {
        const server = new LobbyServer({ port: 0, gameId: 'test', maxPlayers: 1 });
        servers.push(server);
        await server.ready();

        const first = await connectAndJoin(server);

        const rejected = await new Promise<ServerMessage>((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
            ws.on('open', () => {
                ws.send(
                    JSON.stringify({
                        type: 'JOIN',
                        token: server.token,
                        profile: { playerId: toPlayerId('x'), displayName: 'X' },
                    } satisfies ClientMessage),
                );
            });
            ws.on('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        expect(rejected.type).toBe('REJECT');
        first.ws.close();
    });
});

// ─── Spectator admission (join classifier — Invariant #114) ──────────────────

describe('LobbyServer — spectator admission (Invariant #114)', () => {
    it('admits a classified spectator with WELCOME { role: "spectator" }', async () => {
        const server = makeServer();
        server.setJoinClassifier(() => ({ role: 'spectator' }));
        await server.ready();

        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('WELCOME');
        if (msg.type !== 'WELCOME') throw new Error('expected WELCOME');
        expect(msg.role).toBe('spectator');
    });

    it('omits role on a normal WELCOME so the client defaults to player', async () => {
        const server = makeServer();
        await server.ready();

        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('WELCOME');
        if (msg.type !== 'WELCOME') throw new Error('expected WELCOME');
        expect(msg.role).toBeUndefined();
    });

    it('rejects with match_in_progress when the classifier rejects', async () => {
        const server = makeServer();
        server.setJoinClassifier(() => ({ reject: 'match_in_progress' }));
        await server.ready();

        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('REJECT');
        if (msg.type !== 'REJECT') throw new Error('expected REJECT');
        expect(msg.reason).toBe('match_in_progress');
    });

    it('rejects with spectators_disabled when the classifier rejects', async () => {
        const server = makeServer();
        server.setJoinClassifier(() => ({ reject: 'spectators_disabled' }));
        await server.ready();

        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('REJECT');
        if (msg.type !== 'REJECT') throw new Error('expected REJECT');
        expect(msg.reason).toBe('spectators_disabled');
    });

    it('admits a spectator into a full player lobby (spectators do not consume player capacity)', async () => {
        const server = makeServer({ maxPlayers: 1 });
        await server.ready();

        // Fill the single player seat with a normal (unclassified) player.
        const player = await connectAndJoin(server);

        // Now every further join is classified as a spectator.
        server.setJoinClassifier(() => ({ role: 'spectator' }));
        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('WELCOME');
        if (msg.type !== 'WELCOME') throw new Error('expected WELCOME');
        expect(msg.role).toBe('spectator');
        player.ws.close();
    });

    it('still applies the player-capacity gate to classified players', async () => {
        const server = makeServer({ maxPlayers: 1 });
        server.setJoinClassifier(() => ({ role: 'player' }));
        await server.ready();

        const player = await connectAndJoin(server);
        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('REJECT');
        if (msg.type !== 'REJECT') throw new Error('expected REJECT');
        expect(msg.reason).toBe('lobby_full');
        player.ws.close();
    });

    it('enforces the maxSpectators cap', async () => {
        const server = makeServer({ maxSpectators: 1 });
        server.setJoinClassifier(() => ({ role: 'spectator' }));
        await server.ready();

        const firstSpectator = await connectAndJoin(server);
        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('REJECT');
        firstSpectator.ws.close();
    });

    it('lets a rejecting profile gate take precedence over lobby_full on a full lobby', async () => {
        // The player-capacity gate now runs AFTER the profile gate + classification
        // (so a spectator can slip past a full player lobby). Consequence pinned
        // here: on a full lobby a rejected profile reports its own reason, not
        // `lobby_full` — both still reject + close, only the reason differs.
        const server = makeServer({ maxPlayers: 1 });
        await server.ready();

        const player = await connectAndJoin(server);
        server.setJoinGate(() => ({ admitted: false, reason: 'profile:banned' }));
        const msg = await joinExpectingResponse(server);

        expect(msg.type).toBe('REJECT');
        if (msg.type !== 'REJECT') throw new Error('expected REJECT');
        expect(msg.reason).toBe('profile:banned');
        player.ws.close();
    });
});

// ─── Spectator delivery & action boundary (Invariant #114) ───────────────────

describe('LobbyServer — spectator delivery and action boundary (Invariant #114)', () => {
    it('sendToPlayer delivers to a spectator connection', async () => {
        const server = makeServer();
        server.setJoinClassifier(() => ({ role: 'spectator' }));
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const frames: ServerMessage[] = [];
        ws.on('message', (raw) => frames.push(JSON.parse(rawToString(raw)) as ServerMessage));

        server.sendToPlayer(playerId, { type: 'PONG', sentAt: 0 });
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(frames.some((f) => f.type === 'PONG')).toBe(true);
        ws.close();
    });

    it('drops an ACTION from a spectator connection and does not route it', async () => {
        const warns: string[] = [];
        const server = makeServer({ logger: makeWarnCollectingLogger(warns) });
        server.setJoinClassifier(() => ({ role: 'spectator' }));
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const routed: { from: PlayerId; msg: ClientMessage }[] = [];
        server.onMessage((from, msg) => routed.push({ from, msg }));

        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 1,
                action: { type: 'test:noop', playerId, tick: 1, payload: {} },
                checksum: 0,
            } satisfies ClientMessage),
        );
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(routed).toHaveLength(0);
        expect(warns.some((m) => m.toLowerCase().includes('spectator'))).toBe(true);
        ws.close();
    });

    it('still routes non-ACTION messages from a spectator (out-of-band channel stays open)', async () => {
        const server = makeServer();
        server.setJoinClassifier(() => ({ role: 'spectator' }));
        await server.ready();
        const { ws } = await connectAndJoin(server);

        const routed: ClientMessage[] = [];
        server.onMessage((_from, msg) => routed.push(msg));

        ws.send(
            JSON.stringify({
                type: 'SPECTATE_TARGET_UPDATE',
                targetPlayerId: 'seat-1',
            } satisfies ClientMessage),
        );
        await new Promise<void>((r) => setTimeout(r, 30));

        expect(routed.map((m) => m.type)).toContain('SPECTATE_TARGET_UPDATE');
        ws.close();
    });
});

// ─── Restored-session seams (F68/#821) ───────────────────────────────────────

describe('LobbyServer — restored-session seams (#821)', () => {
    const hostSaved = toPlayerId('host-saved');
    const seatA = toPlayerId('seat-a');
    const seatB = toPlayerId('seat-b');

    function makeRestoredServer(): LobbyServer {
        return makeServer({
            matchId: 'match-1',
            hostPlayerId: hostSaved,
            restoredSeats: [seatA, seatB],
        });
    }

    /**
     * Like connectAndJoin, but supports seat claims and resolves with the full
     * WELCOME payload so tests can assert on the lobby state the joiner saw.
     */
    function joinRestored(
        server: LobbyServer,
        opts: {
            reconnectPlayerId?: PlayerId;
            claims?: readonly { matchId: string; playerId: string }[];
        } = {},
    ): Promise<{ ws: WebSocket; playerId: PlayerId; lobbyState: LobbyState }> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
            ws.on('error', reject);
            ws.on('open', () => {
                const joinMsg: ClientMessage = {
                    type: 'JOIN',
                    token: server.token,
                    profile: { playerId: toPlayerId('pending'), displayName: 'Restorer' },
                    ...(opts.reconnectPlayerId === undefined
                        ? {}
                        : { reconnectPlayerId: opts.reconnectPlayerId }),
                    ...(opts.claims === undefined ? {} : { claims: opts.claims }),
                };
                ws.send(JSON.stringify(joinMsg));
            });
            ws.on('message', (raw) => {
                const msg = JSON.parse(rawToString(raw)) as ServerMessage;
                if (msg.type === 'WELCOME') {
                    resolve({ ws, playerId: msg.playerId, lobbyState: msg.lobbyState });
                } else if (msg.type === 'REJECT') {
                    reject(new Error(`JOIN rejected: ${msg.reason}`));
                }
            });
        });
    }

    /** Close a socket WITHOUT sending LEAVE (a bare drop keeps the seat known). */
    function drop(ws: WebSocket): Promise<void> {
        return new Promise((resolve) => {
            ws.once('close', () => resolve());
            ws.close();
        });
    }

    const sockets: WebSocket[] = [];
    function track<T extends { ws: WebSocket }>(joined: T): T {
        sockets.push(joined.ws);
        return joined;
    }

    afterEach(() => {
        for (const ws of sockets) ws.close();
        sockets.length = 0;
    });

    it('fills restored seats in slotIndex order for claimless joins, then mints fresh', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const first = track(await joinRestored(server));
        const second = track(await joinRestored(server));
        const third = track(await joinRestored(server));
        expect(first.playerId).toBe(seatA);
        expect(second.playerId).toBe(seatB);
        expect(third.playerId).toMatch(/^player-\d+$/);
    });

    it('grants a claim whose matchId matches and whose seat is free', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(
            await joinRestored(server, { claims: [{ matchId: 'match-1', playerId: seatB }] }),
        );
        expect(joined.playerId).toBe(seatB);
    });

    it('mints a fresh id for a stale-matchId claim — never the seat fallback', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(
            await joinRestored(server, {
                claims: [{ matchId: 'other-match', playerId: seatA }],
            }),
        );
        expect(joined.playerId).toMatch(/^player-\d+$/);
    });

    it('mints a fresh id for a matching-matchId claim on an unknown playerId', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(
            await joinRestored(server, {
                claims: [{ matchId: 'match-1', playerId: 'never-saved' }],
            }),
        );
        expect(joined.playerId).toMatch(/^player-\d+$/);
    });

    it('treats an empty claims array as claims-presented: fresh id, no seat fallback', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(await joinRestored(server, { claims: [] }));
        expect(joined.playerId).toMatch(/^player-\d+$/);
    });

    it('does not let a connected seat be double-claimed', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const holder = track(
            await joinRestored(server, { claims: [{ matchId: 'match-1', playerId: seatA }] }),
        );
        expect(holder.playerId).toBe(seatA);
        const intruder = track(
            await joinRestored(server, { claims: [{ matchId: 'match-1', playerId: seatA }] }),
        );
        expect(intruder.playerId).toMatch(/^player-\d+$/);
    });

    it('never grants the saved host id to a claim', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(
            await joinRestored(server, {
                claims: [{ matchId: 'match-1', playerId: hostSaved }],
            }),
        );
        expect(joined.playerId).toMatch(/^player-\d+$/);
    });

    it('skips a claimed-then-dropped seat in the fallback but honors a claim for it', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const holder = await joinRestored(server, {
            claims: [{ matchId: 'match-1', playerId: seatB }],
        });
        expect(holder.playerId).toBe(seatB);
        await drop(holder.ws);

        const claimless1 = track(await joinRestored(server));
        expect(claimless1.playerId).toBe(seatA);
        const claimless2 = track(await joinRestored(server));
        expect(claimless2.playerId).toMatch(/^player-\d+$/);

        const reclaimer = track(
            await joinRestored(server, { claims: [{ matchId: 'match-1', playerId: seatB }] }),
        );
        expect(reclaimer.playerId).toBe(seatB);
    });

    it('lets reconnectPlayerId win over claims', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const first = await joinRestored(server);
        expect(first.playerId).toBe(seatA);
        await drop(first.ws);

        const second = track(
            await joinRestored(server, {
                reconnectPlayerId: seatA,
                claims: [{ matchId: 'match-1', playerId: seatB }],
            }),
        );
        expect(second.playerId).toBe(seatA);
    });

    it('never mints a fresh id that collides with a restored seat or live connection', async () => {
        // Restored seats are themselves prior-session 'player-N' ids while
        // idCounter restarts at 0 per server — a naive mint would re-issue
        // 'player-1' and overwrite the seated player's connection.
        const server = makeServer({
            matchId: 'match-1',
            hostPlayerId: hostSaved,
            restoredSeats: [toPlayerId('player-1'), toPlayerId('player-2')],
        });
        await server.ready();
        const first = track(await joinRestored(server));
        const second = track(await joinRestored(server));
        const third = track(await joinRestored(server));
        expect(first.playerId).toBe('player-1');
        expect(second.playerId).toBe('player-2');
        expect(third.playerId).not.toBe('player-1');
        expect(third.playerId).not.toBe('player-2');
        expect(third.playerId).toMatch(/^player-\d+$/);
    });

    it('honors a matchId-proof claim even after the seat holder sent LEAVE', async () => {
        // LEAVE forgets the player (#687) but must not orphan the SAVED seat:
        // the claim presents matchId proof from the save file, so the seat
        // stays reclaimable for the lobby's lifetime.
        const server = makeRestoredServer();
        await server.ready();
        const holder = await joinRestored(server);
        expect(holder.playerId).toBe(seatA);
        await new Promise<void>((resolve) => {
            holder.ws.once('close', () => resolve());
            holder.ws.send(JSON.stringify({ type: 'LEAVE' } satisfies ClientMessage));
        });

        const reclaimer = track(
            await joinRestored(server, { claims: [{ matchId: 'match-1', playerId: seatA }] }),
        );
        expect(reclaimer.playerId).toBe(seatA);
    });

    it('does not grant a never-connected restored seat to a bare reconnectPlayerId', async () => {
        // Restored seats are reclaimed via matchId-proof claims; the reconnect
        // path is reserved for players who actually connected this session,
        // so a stale ticket from another match cannot hijack a saved seat.
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(await joinRestored(server, { reconnectPlayerId: seatB }));
        expect(joined.playerId).toBe(seatA);
    });

    it('never grants the saved host id to a reconnectPlayerId', async () => {
        // The saved host id is distributed in every save file and appears in
        // knownPlayers once the host broadcasts a roster — but the host never
        // occupies a client connection, so without a guard a client could be
        // admitted under the host's identity.
        const server = makeRestoredServer();
        await server.ready();
        server.broadcastLobbyState({
            info: { sessionId: server.token, hostId: hostSaved, gameId: 'test' },
            players: [{ playerId: hostSaved, displayName: 'Host', ready: true }],
        });
        const joined = track(await joinRestored(server, { reconnectPlayerId: hostSaved }));
        expect(joined.playerId).not.toBe(hostSaved);
    });

    it('mints the saved host id into the WELCOME lobby state', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(await joinRestored(server));
        expect(joined.lobbyState.info.hostId).toBe(hostSaved);
    });

    it('does not fabricate restored seats into the broadcast roster', async () => {
        const server = makeRestoredServer();
        await server.ready();
        const joined = track(await joinRestored(server));
        const rosterIds = joined.lobbyState.players.map((p) => p.playerId);
        expect(rosterIds).toEqual([seatA]);
    });
});

// ─── Password gate (F56) ──────────────────────────────────────────────────────

describe('LobbyServer — password gate (F56)', () => {
    it('admits a JOIN that presents the correct password', async () => {
        const server = makeServer({ password: 's3cret' });
        await server.ready();
        const msg = await joinExpectingResponse(server, { password: 's3cret' });
        expect(msg.type).toBe('WELCOME');
    });

    it('rejects a JOIN with the wrong password as invalid_password', async () => {
        const server = makeServer({ password: 's3cret' });
        await server.ready();
        const msg = await joinExpectingResponse(server, { password: 'nope' });
        expect(msg.type).toBe('REJECT');
        if (msg.type === 'REJECT') expect(msg.reason).toBe('invalid_password');
    });

    it('rejects a JOIN that omits the password when one is required', async () => {
        const server = makeServer({ password: 's3cret' });
        await server.ready();
        const msg = await joinExpectingResponse(server);
        expect(msg.type).toBe('REJECT');
        if (msg.type === 'REJECT') expect(msg.reason).toBe('invalid_password');
    });

    it('admits any JOIN when no password is configured (open lobby unchanged)', async () => {
        const server = makeServer();
        await server.ready();
        const msg = await joinExpectingResponse(server);
        expect(msg.type).toBe('WELCOME');
    });

    it('ignores a client-supplied password when the lobby has none', async () => {
        const server = makeServer();
        await server.ready();
        const msg = await joinExpectingResponse(server, { password: 'whatever' });
        expect(msg.type).toBe('WELCOME');
    });

    it('never echoes the password into the WELCOME payload', async () => {
        const server = makeServer({ password: 'leak-check-123' });
        await server.ready();
        const msg = await joinExpectingResponse(server, { password: 'leak-check-123' });
        expect(msg.type).toBe('WELCOME');
        expect(JSON.stringify(msg)).not.toContain('leak-check-123');
    });
});

// ─── LEAVE / intentional departure (#687) ──────────────────────────────────────

describe('LobbyServer — LEAVE / intentional departure (#687)', () => {
    it('fires onPlayerDisconnected with reason "normal" when the client sends LEAVE', async () => {
        const server = makeServer();
        await server.ready();

        const reasons: DisconnectReason[] = [];
        const { ws } = await connectAndJoin(server);
        await new Promise<void>((resolve) => {
            server.onPlayerDisconnected((_id, reason) => {
                reasons.push(reason);
                resolve();
            });
            ws.send(JSON.stringify({ type: 'LEAVE' } satisfies ClientMessage));
        });

        expect(reasons).toEqual(['normal']);
    });

    it('fires onPlayerDisconnected with reason "timeout" on a bare socket close (transient drop)', async () => {
        const server = makeServer();
        await server.ready();

        const reasons: DisconnectReason[] = [];
        const { ws } = await connectAndJoin(server);
        await new Promise<void>((resolve) => {
            server.onPlayerDisconnected((_id, reason) => {
                reasons.push(reason);
                resolve();
            });
            ws.close();
        });

        expect(reasons).toEqual(['timeout']);
    });

    it('treats a reconnect after LEAVE as a fresh join (assigns a new PlayerId)', async () => {
        const server = makeServer();
        await server.ready();
        const first = await connectAndJoin(server, 'Leaver');

        await new Promise<void>((resolve) => {
            first.ws.once('close', () => resolve());
            first.ws.send(JSON.stringify({ type: 'LEAVE' } satisfies ClientMessage));
        });

        const second = await connectAndJoin(server, 'Leaver', first.playerId);
        expect(second.playerId).not.toBe(first.playerId);
        second.ws.close();
    });
});

// ─── sendToPlayer / broadcast ─────────────────────────────────────────────────

describe('LobbyServer — sending messages', () => {
    it('sendToPlayer delivers to the correct client', async () => {
        const server = makeServer();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const received = await new Promise<ServerMessage>((resolve) => {
            ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
            server.sendToPlayer(playerId, { type: 'PONG', sentAt: 0 });
        });
        expect(received.type).toBe('PONG');
        ws.close();
    });

    it('broadcast delivers to all connected clients', async () => {
        const server = makeServer();
        await server.ready();
        const [c1, c2] = await Promise.all([connectAndJoin(server), connectAndJoin(server)]);

        // Set up listeners first, then broadcast, then await
        const p1 = new Promise<ServerMessage>((resolve) => {
            c1.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        const p2 = new Promise<ServerMessage>((resolve) => {
            c2.ws.once('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });

        server.broadcast({ type: 'PONG', sentAt: 0 });

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.type).toBe('PONG');
        expect(r2.type).toBe('PONG');
        c1.ws.close();
        c2.ws.close();
    });

    it('sendToPlayer is a no-op for unknown PlayerId', async () => {
        const server = makeServer();
        await server.ready();
        expect(() =>
            server.sendToPlayer(toPlayerId('ghost'), { type: 'PONG', sentAt: 0 }),
        ).not.toThrow();
    });
});

// ─── Event subscriptions ──────────────────────────────────────────────────────

describe('LobbyServer — event subscriptions', () => {
    it('onPlayerConnected fires when a client completes JOIN', async () => {
        const server = makeServer();
        await server.ready();

        const joined: PlayerId[] = [];
        server.onPlayerConnected((id) => joined.push(id));

        const { ws } = await connectAndJoin(server);
        expect(joined).toHaveLength(1);
        ws.close();
    });

    it('onPlayerDisconnected fires when a client disconnects', async () => {
        const server = makeServer();
        await server.ready();

        const left: PlayerId[] = [];
        server.onPlayerDisconnected((id) => left.push(id));

        const { ws } = await connectAndJoin(server);
        await new Promise<void>((resolve) => {
            server.onPlayerDisconnected(() => resolve());
            ws.close();
        });
        expect(left).toHaveLength(1);
    });

    it('onPlayerConnected returns an Unsubscribe that stops firing', async () => {
        const server = makeServer();
        await server.ready();

        const joined: PlayerId[] = [];
        const unsub = server.onPlayerConnected((id) => joined.push(id));
        unsub();

        const { ws } = await connectAndJoin(server);
        // Allow any pending callbacks to flush
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(joined).toHaveLength(0);
        ws.close();
    });

    it('onMessage fires for ACTION messages from a connected client', async () => {
        const server = makeServer();
        await server.ready();
        const { ws, playerId } = await connectAndJoin(server);

        const messages: { from: PlayerId; msg: ClientMessage }[] = [];
        server.onMessage((from, msg) => messages.push({ from, msg }));

        ws.send(
            JSON.stringify({
                type: 'ACTION',
                tick: 1,
                action: { type: 'test:noop', playerId, tick: 1, payload: {} },
                checksum: 0,
            } satisfies ClientMessage),
        );

        await new Promise<void>((resolve) => setTimeout(resolve, 30));
        expect(messages).toHaveLength(1);
        expect(messages[0]?.from).toBe(playerId);
        expect(messages[0]?.msg.type).toBe('ACTION');
        ws.close();
    });
});

// ─── T07: timing-safe token comparison ───────────────────────────────────────

describe('LobbyServer — timing-safe token comparison (T07)', () => {
    it('rejects JOIN when token has wrong length (timingSafeEqual handles length mismatch)', async () => {
        const server = makeServer();
        await server.ready();

        const rejected = await new Promise<ServerMessage>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
            ws.on('error', reject);
            ws.on('open', () => {
                const join: ClientMessage = {
                    type: 'JOIN',
                    token: 'short', // different length from the 32-hex token
                    profile: { playerId: toPlayerId('x'), displayName: 'X' },
                };
                ws.send(JSON.stringify(join));
            });
            ws.on('message', (raw) => resolve(JSON.parse(rawToString(raw)) as ServerMessage));
        });
        expect(rejected.type).toBe('REJECT');
    });

    it('accepts JOIN when token exactly matches', async () => {
        const server = makeServer();
        await server.ready();
        const { ws } = await connectAndJoin(server);
        ws.close();
    });
});

// ─── T05: close path hardens ──────────────────────────────────────────────────

describe('LobbyServer — close path (T05)', () => {
    it('client receives CLOSE reason before socket closes', async () => {
        const server = makeServer();
        await server.ready();
        const { ws } = await connectAndJoin(server);

        const frames: ServerMessage[] = [];
        ws.on('message', (raw) => frames.push(JSON.parse(rawToString(raw)) as ServerMessage));

        await server.close();
        await new Promise<void>((r) => setTimeout(r, 60));

        expect(frames.some((f) => f.type === 'CLOSE' && f.reason === 'host_closed')).toBe(true);
    });

    it('close() is idempotent under concurrent calls', async () => {
        const server = makeServer();
        await server.ready();
        await Promise.all([server.close(), server.close(), server.close()]);
    });
});
