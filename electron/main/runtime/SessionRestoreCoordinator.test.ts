/**
 * electron/main/runtime/SessionRestoreCoordinator.test.ts
 *
 * Unit tests for the menu-load restore orchestrator (F68, #823): the pure
 * `sanitizeRestoreManifest` guard and the `SessionRestoreCoordinator`
 * port-driven state machine. All collaborators are vi.fn port stubs — no
 * FS, network, or Electron IPC (repo unit-test rule).
 *
 * Architecture reference: §4.11 / §4.14
 * Task: F68 / issue #823
 */

import { describe, expect, it, vi } from 'vitest';
import { playerId } from '@chimera-engine/simulation/engine/index.js';
import { WIRE_MAX_JOIN_CLAIM_ID_LENGTH } from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type {
    SaveFile,
    SaveSeat,
    SaveSessionManifest,
} from '@chimera-engine/simulation/persistence/SaveFile.js';
import { createNoopLogger } from '../logging/logger.js';
import {
    MAX_RESTORED_SEATS,
    SessionRestoreCoordinator,
    SessionRestoreError,
    sanitizeRestoreManifest,
    type SessionRestorePorts,
    type SessionRestoreStatus,
} from './SessionRestoreCoordinator.js';

const MATCH_ID = 'match-under-test';

function seat(
    id: string,
    control: SaveSeat['control'],
    slotIndex: number,
    omniscient?: boolean,
): SaveSeat {
    return {
        playerId: playerId(id),
        control,
        slotIndex,
        ...(omniscient !== undefined ? { omniscient } : {}),
    };
}

function makeManifest(
    seats: readonly SaveSeat[],
    overrides: Partial<SaveSessionManifest> = {},
): SaveSessionManifest {
    return {
        matchId: MATCH_ID,
        maxPlayers: seats.length,
        seats,
        ...overrides,
    };
}

describe('sanitizeRestoreManifest', () => {
    it('passes a valid mixed roster through with seats and remoteSeats slotIndex-ascending', () => {
        const manifest = makeManifest([
            seat('remote-b', 'remote', 3),
            seat('host-1', 'host', 0),
            seat('ai-1', 'ai', 2, true),
            seat('remote-a', 'remote', 1),
        ]);

        const sanitized = sanitizeRestoreManifest(manifest);

        expect(sanitized.matchId).toBe(MATCH_ID);
        expect(sanitized.maxPlayers).toBe(4);
        expect(sanitized.seats.map((s) => s.slotIndex)).toEqual([0, 1, 2, 3]);
        expect(sanitized.hostSeat.playerId).toBe(playerId('host-1'));
        // Remote-only, slotIndex-ascending — this order feeds restore.humanSeats.
        expect(sanitized.remoteSeats.map((s) => s.playerId)).toEqual([
            playerId('remote-a'),
            playerId('remote-b'),
        ]);
    });

    it('raises a floor maxPlayers (migrated v5 backfill) to the seat count', () => {
        const manifest = makeManifest(
            [seat('host-1', 'host', 0), seat('ai-1', 'ai', 1), seat('local-1', 'local', 2)],
            { maxPlayers: 2 },
        );

        expect(sanitizeRestoreManifest(manifest).maxPlayers).toBe(3);
    });

    it('pins maxPlayers to the actual seat count — the manifest value is only a hint', () => {
        // Oversized hint: the start gate compares activePlayers against
        // maxPlayers, so any value above the seat count would wait forever for
        // phantom seats no one can fill.
        const oversized = makeManifest([seat('host-1', 'host', 0), seat('remote-a', 'remote', 1)], {
            maxPlayers: 500,
        });
        expect(sanitizeRestoreManifest(oversized).maxPlayers).toBe(2);

        // Sparse migrated manifest (deriveSessionManifest backfills
        // highestSlot + 1 when an AI id claims a gapped slot): same rule.
        const sparse = makeManifest(
            [seat('host-1', 'host', 0), seat('local-1', 'local', 1), seat('ai-3', 'ai', 3)],
            { maxPlayers: 4 },
        );
        expect(sanitizeRestoreManifest(sparse).maxPlayers).toBe(3);
    });

    it('rejects a corrupted out-of-range slotIndex (migrated ai-1000000 case)', () => {
        const manifest = makeManifest(
            [seat('host-1', 'host', 0), seat('ai-1000000', 'ai', 1_000_000)],
            {
                maxPlayers: 1_000_001,
            },
        );

        expect(() => sanitizeRestoreManifest(manifest)).toThrow(SessionRestoreError);
        expect(() => sanitizeRestoreManifest(manifest)).toThrow(/slotIndex/);
    });

    it('rejects negative and non-integer slotIndexes', () => {
        expect(() => sanitizeRestoreManifest(makeManifest([seat('host-1', 'host', -1)]))).toThrow(
            /slotIndex/,
        );
        expect(() => sanitizeRestoreManifest(makeManifest([seat('host-1', 'host', 0.5)]))).toThrow(
            /slotIndex/,
        );
    });

    it('rejects duplicate slotIndexes and duplicate playerIds', () => {
        expect(() =>
            sanitizeRestoreManifest(
                makeManifest([seat('host-1', 'host', 0), seat('remote-a', 'remote', 0)]),
            ),
        ).toThrow(/slotIndex/);
        expect(() =>
            sanitizeRestoreManifest(
                makeManifest([seat('host-1', 'host', 0), seat('host-1', 'remote', 1)]),
            ),
        ).toThrow(/playerId/);
    });

    it('rejects empty and wire-overlong ids (corrupted save)', () => {
        expect(() => sanitizeRestoreManifest(makeManifest([seat('', 'host', 0)]))).toThrow(
            /playerId/,
        );
        const overlongId = 'p'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1);
        expect(() =>
            sanitizeRestoreManifest(
                makeManifest([seat('host-1', 'host', 0), seat(overlongId, 'remote', 1)]),
            ),
        ).toThrow(/playerId/);
        expect(() =>
            sanitizeRestoreManifest(
                makeManifest([seat('host-1', 'host', 0)], {
                    matchId: 'm'.repeat(WIRE_MAX_JOIN_CLAIM_ID_LENGTH + 1),
                }),
            ),
        ).toThrow(/matchId/);
    });

    it('rejects rosters without exactly one host seat', () => {
        expect(() =>
            sanitizeRestoreManifest(
                makeManifest([seat('remote-a', 'remote', 0), seat('remote-b', 'remote', 1)]),
            ),
        ).toThrow(/host/);
        expect(() =>
            sanitizeRestoreManifest(
                makeManifest([seat('host-1', 'host', 0), seat('host-2', 'host', 1)]),
            ),
        ).toThrow(/host/);
    });

    it('rejects an empty roster, an oversized roster, and an empty matchId', () => {
        expect(() => sanitizeRestoreManifest(makeManifest([]))).toThrow(/seat/);
        const oversized = [
            seat('host-1', 'host', 0),
            ...Array.from({ length: MAX_RESTORED_SEATS }, (_, i) =>
                seat(`remote-${i}`, 'remote' as const, i + 1),
            ),
        ];
        expect(() => sanitizeRestoreManifest(makeManifest(oversized))).toThrow(/seat/);
        expect(() =>
            sanitizeRestoreManifest(makeManifest([seat('host-1', 'host', 0)], { matchId: '' })),
        ).toThrow(/matchId/);
    });
});

// ─── SessionRestoreCoordinator ────────────────────────────────────────────────

const ALL_LOCAL_SEATS: readonly SaveSeat[] = [
    seat('host-1', 'host', 0),
    seat('local-1', 'local', 1),
    seat('ai-1', 'ai', 2, true),
];

const REMOTE_SEATS: readonly SaveSeat[] = [
    seat('host-1', 'host', 0),
    seat('local-1', 'local', 1),
    seat('remote-a', 'remote', 2),
    seat('remote-b', 'remote', 3),
];

function makeRestoreFile(seats: readonly SaveSeat[]): SaveFile {
    return {
        header: {
            schemaVersion: 6,
            engineVersion: '0.0.0',
            gameId: 'tactics',
            gameVersion: '0.0.0',
            slotId: 'restore-slot',
            savedAt: 1_700_000_000_000,
            turnNumber: 4,
            playerNames: [],
        },
        checkpoint: {
            tick: 42,
            // @chimera-review: minimal stub; the coordinator never inspects the
            // checkpoint — it hands the whole file to the applyRestoredFile port.
        } as unknown as SaveFile['checkpoint'],
        deltaActions: [],
        pendingCommitments: {},
        stagedReveals: {},
        session: makeManifest(seats),
    };
}

interface Harness {
    readonly calls: string[];
    readonly statuses: SessionRestoreStatus[];
    readonly ports: {
        readonly hostLobby: ReturnType<typeof vi.fn>;
        readonly applyRestoredFile: ReturnType<typeof vi.fn>;
        readonly seatRestoredRoster: ReturnType<typeof vi.fn>;
        readonly closeLobby: ReturnType<typeof vi.fn>;
    };
    readonly coordinator: SessionRestoreCoordinator;
}

function makeHarness(overrides: Partial<SessionRestorePorts> = {}): Harness {
    const calls: string[] = [];
    const ports = {
        hostLobby: vi.fn(async () => {
            calls.push('hostLobby');
        }),
        applyRestoredFile: vi.fn(() => {
            calls.push('applyRestoredFile');
        }),
        seatRestoredRoster: vi.fn(async () => {
            calls.push('seatRestoredRoster');
        }),
        closeLobby: vi.fn(async () => {
            calls.push('closeLobby');
        }),
    };
    const coordinator = new SessionRestoreCoordinator({
        ports: { ...ports, ...overrides },
        logger: createNoopLogger(),
    });
    const statuses: SessionRestoreStatus[] = [];
    coordinator.onStatusChanged((status) => {
        statuses.push(status);
    });
    return { calls, statuses, ports, coordinator };
}

describe('SessionRestoreCoordinator', () => {
    describe('restoreSession — all-local roster', () => {
        it('runs hostLobby → applyRestoredFile → seatRestoredRoster in order and completes', async () => {
            const { calls, statuses, ports, coordinator } = makeHarness();

            await coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));

            expect(calls).toEqual(['hostLobby', 'applyRestoredFile', 'seatRestoredRoster']);
            expect(ports.hostLobby).toHaveBeenCalledWith({
                maxPlayers: 3,
                restore: {
                    matchId: MATCH_ID,
                    hostPlayerId: playerId('host-1'),
                    humanSeats: [],
                },
            });
            // The full sanitized roster, slotIndex-ascending.
            expect(ports.seatRestoredRoster).toHaveBeenCalledTimes(1);
            const seated = ports.seatRestoredRoster.mock.calls[0]?.[0] as readonly SaveSeat[];
            expect(seated.map((s) => s.playerId)).toEqual([
                playerId('host-1'),
                playerId('local-1'),
                playerId('ai-1'),
            ]);
            expect(coordinator.status()).toEqual({ state: 'complete', matchId: MATCH_ID });
            expect(statuses.map((s) => s.state)).toEqual(['hosting', 'complete']);
        });
    });

    describe('restoreSession — remote seats missing', () => {
        it('parks in waiting-for-players with remote-only humanSeats and missingSeats', async () => {
            const { ports, coordinator } = makeHarness();

            await coordinator.restoreSession(makeRestoreFile(REMOTE_SEATS));

            expect(ports.hostLobby).toHaveBeenCalledWith({
                maxPlayers: 4,
                restore: {
                    matchId: MATCH_ID,
                    hostPlayerId: playerId('host-1'),
                    // Remote seats only — a local seat in humanSeats would let a
                    // claimless stranger be granted its playerId.
                    humanSeats: [playerId('remote-a'), playerId('remote-b')],
                },
            });
            expect(coordinator.status()).toEqual({
                state: 'waiting-for-players',
                matchId: MATCH_ID,
                missingSeats: [playerId('remote-a'), playerId('remote-b')],
            });
        });

        it('notePlayerJoined fills seats one by one and completes on the last', async () => {
            const { statuses, coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(REMOTE_SEATS));

            coordinator.notePlayerJoined(playerId('stranger'));
            expect(coordinator.status()).toEqual({
                state: 'waiting-for-players',
                matchId: MATCH_ID,
                missingSeats: [playerId('remote-a'), playerId('remote-b')],
            });

            coordinator.notePlayerJoined(playerId('remote-a'));
            expect(coordinator.status()).toEqual({
                state: 'waiting-for-players',
                matchId: MATCH_ID,
                missingSeats: [playerId('remote-b')],
            });

            coordinator.notePlayerJoined(playerId('remote-b'));
            expect(coordinator.status()).toEqual({ state: 'complete', matchId: MATCH_ID });
            expect(statuses.map((s) => s.state)).toEqual([
                'hosting',
                'waiting-for-players',
                'waiting-for-players',
                'complete',
            ]);
        });

        it('ignores notePlayerJoined outside the waiting state', () => {
            const { statuses, coordinator } = makeHarness();
            coordinator.notePlayerJoined(playerId('remote-a'));
            expect(coordinator.status()).toEqual({ state: 'idle' });
            expect(statuses).toEqual([]);
        });
    });

    describe('failure paths', () => {
        it('rejects a structurally corrupt manifest without touching any port', async () => {
            const { calls, coordinator } = makeHarness();
            const corrupt = makeRestoreFile([
                seat('host-1', 'host', 0),
                seat('ai-x', 'ai', 999_999),
            ]);

            await expect(coordinator.restoreSession(corrupt)).rejects.toBeInstanceOf(
                SessionRestoreError,
            );
            expect(calls).toEqual([]);
            expect(coordinator.status()).toMatchObject({ state: 'failed' });
        });

        it('maps a hostLobby rejection to failed and never applies or seats', async () => {
            const { calls, coordinator } = makeHarness({
                hostLobby: () => Promise.reject(new Error('port already in use')),
            });

            await expect(
                coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS)),
            ).rejects.toThrow(/port already in use/);
            expect(calls).toEqual([]);
            expect(coordinator.status()).toMatchObject({ state: 'failed' });
        });

        it('unwinds via closeLobby when seating fails after hosting', async () => {
            const { calls, coordinator } = makeHarness({
                seatRestoredRoster: () => Promise.reject(new Error('seat wiring incomplete')),
            });

            await expect(
                coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS)),
            ).rejects.toThrow(/seat wiring incomplete/);
            expect(calls).toEqual(['hostLobby', 'applyRestoredFile', 'closeLobby']);
            expect(coordinator.status()).toMatchObject({ state: 'failed' });
        });

        it('does not emit a transient aborted when the teardown fires during a failure unwind', async () => {
            const { statuses, ports, coordinator } = makeHarness();
            ports.seatRestoredRoster.mockImplementationOnce(() =>
                Promise.reject(new Error('seat wiring incomplete')),
            );
            // Production closeLobby runs the hosted-session teardown, which
            // calls noteSessionClosed BEFORE the coordinator can record the
            // failure — listeners must not see the restore flip to aborted
            // on its way to failed (#826 pushes every transition to the UI).
            ports.closeLobby.mockImplementationOnce(() => {
                coordinator.noteSessionClosed();
                return Promise.resolve();
            });

            await expect(
                coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS)),
            ).rejects.toThrow(/seat wiring incomplete/);

            expect(statuses.map((s) => s.state)).toEqual(['hosting', 'failed']);
        });

        it('still fails cleanly when closeLobby itself rejects during the unwind', async () => {
            const { ports, coordinator } = makeHarness();
            ports.seatRestoredRoster.mockImplementationOnce(() =>
                Promise.reject(new Error('seat wiring incomplete')),
            );
            ports.closeLobby.mockImplementationOnce(() =>
                Promise.reject(new Error('server already gone')),
            );

            // The caller sees the ORIGINAL failure, not the unwind error.
            await expect(
                coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS)),
            ).rejects.toThrow(/seat wiring incomplete/);
            expect(ports.closeLobby).toHaveBeenCalledTimes(1);
            expect(coordinator.status()).toMatchObject({ state: 'failed' });
        });

        it('rejects a concurrent restoreSession while one is in progress', async () => {
            const { ports, coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(REMOTE_SEATS)); // parks waiting

            await expect(
                coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS)),
            ).rejects.toThrow(/already in progress/);
            expect(ports.hostLobby).toHaveBeenCalledTimes(1);
        });
    });

    describe('cancel', () => {
        it('while waiting: closes the lobby once and marks the restore aborted', async () => {
            const { ports, coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(REMOTE_SEATS));

            await coordinator.cancel();

            expect(ports.closeLobby).toHaveBeenCalledTimes(1);
            expect(coordinator.status()).toEqual({ state: 'aborted' });
        });

        it('during hosting: defers the abort until hostLobby settles, then unwinds', async () => {
            const releaseHostLobby: { current: (() => void) | null } = { current: null };
            const { calls, ports, coordinator } = makeHarness({
                hostLobby: () =>
                    new Promise<void>((resolve) => {
                        releaseHostLobby.current = resolve;
                    }),
            });

            const restore = coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));
            const rejection = expect(restore).rejects.toThrow(/cancelled/);
            await coordinator.cancel();
            releaseHostLobby.current?.();
            await rejection;

            expect(ports.applyRestoredFile).not.toHaveBeenCalled();
            expect(ports.seatRestoredRoster).not.toHaveBeenCalled();
            expect(calls).toContain('closeLobby');
            expect(coordinator.status()).toEqual({ state: 'aborted' });
        });

        it('during seating: defers the abort until seating settles, then unwinds', async () => {
            const releaseSeat: { current: (() => void) | null } = { current: null };
            const { ports, coordinator } = makeHarness();
            ports.seatRestoredRoster.mockImplementationOnce(
                () =>
                    new Promise<void>((resolve) => {
                        releaseSeat.current = resolve;
                    }),
            );

            const restore = coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));
            const rejection = expect(restore).rejects.toThrow(/cancelled/);
            await vi.waitFor(() => {
                expect(ports.seatRestoredRoster).toHaveBeenCalledTimes(1);
            });
            await coordinator.cancel();
            releaseSeat.current?.();
            await rejection;

            expect(ports.closeLobby).toHaveBeenCalledTimes(1);
            expect(coordinator.status()).toEqual({ state: 'aborted' });
        });

        it('after complete: is a no-op and does not close the live session', async () => {
            const { ports, coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));

            await coordinator.cancel();

            expect(ports.closeLobby).not.toHaveBeenCalled();
            expect(coordinator.status()).toEqual({ state: 'complete', matchId: MATCH_ID });
        });

        it('when idle: is a no-op', async () => {
            const { ports, coordinator } = makeHarness();
            await coordinator.cancel();
            expect(ports.closeLobby).not.toHaveBeenCalled();
            expect(coordinator.status()).toEqual({ state: 'idle' });
        });
    });

    describe('noteSessionClosed', () => {
        it('while waiting: marks aborted WITHOUT calling closeLobby (teardown already ran)', async () => {
            const { ports, coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(REMOTE_SEATS));

            coordinator.noteSessionClosed();

            expect(ports.closeLobby).not.toHaveBeenCalled();
            expect(coordinator.status()).toEqual({ state: 'aborted' });
        });

        it('after complete: returns to idle so a later menu-load can restore again', async () => {
            const { coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));

            coordinator.noteSessionClosed();
            expect(coordinator.status()).toEqual({ state: 'idle' });

            await coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));
            expect(coordinator.status()).toEqual({ state: 'complete', matchId: MATCH_ID });
        });

        it('a fresh restore succeeds after an aborted one', async () => {
            const { ports, coordinator } = makeHarness();
            await coordinator.restoreSession(makeRestoreFile(REMOTE_SEATS));
            await coordinator.cancel();

            await coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));

            expect(ports.hostLobby).toHaveBeenCalledTimes(2);
            expect(coordinator.status()).toEqual({ state: 'complete', matchId: MATCH_ID });
        });
    });

    describe('onStatusChanged', () => {
        it('supports unsubscribe and survives a throwing listener', async () => {
            const { coordinator } = makeHarness();
            const seen: string[] = [];
            coordinator.onStatusChanged(() => {
                throw new Error('listener bug');
            });
            const unsubscribe = coordinator.onStatusChanged((status) => {
                seen.push(status.state);
            });

            await coordinator.restoreSession(makeRestoreFile(ALL_LOCAL_SEATS));
            expect(seen).toEqual(['hosting', 'complete']);

            unsubscribe();
            coordinator.noteSessionClosed();
            expect(seen).toEqual(['hosting', 'complete']);
        });
    });
});
