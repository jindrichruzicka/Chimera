/**
 * e2e/helpers/snapshot-assert.test.ts
 *
 * Unit tests for snapshot-assert helpers. Verifies assertNoLeakedFields detects
 * owner-only leaks, and that assertChecksumMatch / assertTickAdvanced delegate to
 * ipc-spy and assert via @playwright/test expect.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Issue: #473
 *
 * Tests written FIRST (red confirmed before implementation).
 *
 * Invariants verified:
 *   #3 — Operates on PlayerSnapshot only; never on GameSnapshot.
 *   #8 — assertNoLeakedFields is the post-projection gate for leaked owner-only fields.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ElectronApplication } from '@playwright/test';

// ---------------------------------------------------------------------------
// Mock ipc-spy — must be declared before importing snapshot-assert so that
// the hoisted mock is active when assertChecksumMatch / assertTickAdvanced
// are imported.
// ---------------------------------------------------------------------------

vi.mock('./ipc-spy', () => ({
    getLastBroadcastChecksum: vi.fn(),
    getSimulationTick: vi.fn(),
}));

import { assertNoLeakedFields, assertChecksumMatch, assertTickAdvanced } from './snapshot-assert';
import * as ipcSpy from './ipc-spy';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal snapshot shape accepted by assertNoLeakedFields. */
interface MinimalPlayerSnapshot {
    readonly tick: number;
    readonly viewerId: string;
    readonly phase: string;
    readonly players: Record<string, Record<string, unknown>>;
    readonly entities: Record<string, unknown>;
    readonly events: unknown[];
    readonly commitments: Record<string, unknown>;
    readonly undoMeta: { readonly canUndo: boolean; readonly canRedo: boolean };
}

function makeSnapshot(players: Record<string, Record<string, unknown>>): MinimalPlayerSnapshot {
    return {
        tick: 1,
        viewerId: 'p1',
        phase: 'playing',
        players,
        entities: {},
        events: [],
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
    };
}

function makeApp(): ElectronApplication {
    return {} as ElectronApplication;
}

afterEach(() => {
    vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// assertNoLeakedFields
// ---------------------------------------------------------------------------

describe('assertNoLeakedFields', () => {
    it('does not throw when viewerId === ownerId, even if owner-only fields are present', () => {
        const snapshot = makeSnapshot({
            p1: {
                id: 'p1',
                hand: { __visibility: 'owner-only', value: ['card-a'] },
            },
        });

        expect(() =>
            assertNoLeakedFields(
                // cast: MinimalPlayerSnapshot satisfies the structural subset assertNoLeakedFields inspects; PlayerSnapshot is module-local
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p1',
            ),
        ).not.toThrow();
    });

    it('does not throw when viewerId !== ownerId and no owner-only fields present on opponent', () => {
        const snapshot = makeSnapshot({
            p1: { id: 'p1', score: 10 },
            p2: { id: 'p2', score: 5 },
        });

        expect(() =>
            assertNoLeakedFields(
                // cast: MinimalPlayerSnapshot satisfies the structural subset assertNoLeakedFields inspects; PlayerSnapshot is module-local
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p2',
            ),
        ).not.toThrow();
    });

    it('throws when opponent player has an owner-only field and viewer is not the owner', () => {
        const snapshot = makeSnapshot({
            p1: { id: 'p1', score: 10 },
            p2: {
                id: 'p2',
                score: 5,
                hand: { __visibility: 'owner-only', value: ['card-x'] },
            },
        });

        expect(() =>
            assertNoLeakedFields(
                // cast: MinimalPlayerSnapshot satisfies the structural subset assertNoLeakedFields inspects; PlayerSnapshot is module-local
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p2',
            ),
        ).toThrow();
    });

    it('throws when any opponent player has an owner-only field, regardless of ownerId argument', () => {
        // ownerId='p3' (absent from snapshot), but p2 has a leaked field —
        // all non-viewer players are checked, not just ownerId.
        const snapshot = makeSnapshot({
            p1: { id: 'p1' },
            p2: {
                id: 'p2',
                secretPlan: { __visibility: 'owner-only', value: 'rush-towers' },
            },
        });

        expect(() =>
            assertNoLeakedFields(
                // cast: MinimalPlayerSnapshot satisfies the structural subset assertNoLeakedFields inspects; PlayerSnapshot is module-local
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p3',
            ),
        ).toThrow();
    });

    it('does not throw for a snapshot with no players', () => {
        const snapshot = makeSnapshot({});

        expect(() =>
            assertNoLeakedFields(
                // cast: MinimalPlayerSnapshot satisfies the structural subset assertNoLeakedFields inspects; PlayerSnapshot is module-local
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p2',
            ),
        ).not.toThrow();
    });

    it('does not check the viewer own player entry for owner-only fields', () => {
        const snapshot = makeSnapshot({
            p1: {
                id: 'p1',
                // Viewer's own data may have owner-only markers — must not throw
                ownSecret: { __visibility: 'owner-only', value: 'my-plan' },
            },
            p2: { id: 'p2', score: 0 },
        });

        expect(() =>
            assertNoLeakedFields(
                // cast: MinimalPlayerSnapshot satisfies the structural subset assertNoLeakedFields inspects; PlayerSnapshot is module-local
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p2',
            ),
        ).not.toThrow();
    });

    it('throws when a deeply nested field carries an owner-only marker (recursive scan)', () => {
        // The __visibility marker is two levels below playerState — a shallow
        // scan (Object.entries(playerState) only) would miss it.
        const snapshot = makeSnapshot({
            p1: { id: 'p1' },
            p2: {
                id: 'p2',
                hand: {
                    cards: [{ name: 'card-x', __visibility: 'owner-only' }],
                },
            },
        });

        expect(() =>
            assertNoLeakedFields(
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p2',
            ),
        ).toThrow();
    });

    it('does not throw when the viewer owns the deeply nested owner-only field', () => {
        // p1 is the viewer — their own nested owner-only data must not trigger the check.
        const snapshot = makeSnapshot({
            p1: {
                id: 'p1',
                hand: {
                    cards: [{ name: 'card-x', __visibility: 'owner-only' }],
                },
            },
            p2: { id: 'p2', score: 0 },
        });

        expect(() =>
            assertNoLeakedFields(
                snapshot as unknown as Parameters<typeof assertNoLeakedFields>[0],
                'p1',
                'p2',
            ),
        ).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// assertChecksumMatch
// ---------------------------------------------------------------------------

describe('assertChecksumMatch', () => {
    it('resolves without throwing when host and client checksums match', async () => {
        vi.mocked(ipcSpy.getLastBroadcastChecksum).mockResolvedValue(42);

        await expect(assertChecksumMatch(makeApp(), makeApp())).resolves.toBeUndefined();
    });

    it('rejects when host checksum differs from client checksum', async () => {
        vi.mocked(ipcSpy.getLastBroadcastChecksum)
            .mockResolvedValueOnce(42)
            .mockResolvedValueOnce(99);

        await expect(assertChecksumMatch(makeApp(), makeApp())).rejects.toThrow();
    });

    it('calls getLastBroadcastChecksum with the host app and then the client app', async () => {
        const hostApp = makeApp();
        const clientApp = makeApp();
        vi.mocked(ipcSpy.getLastBroadcastChecksum).mockResolvedValue(7);

        await assertChecksumMatch(hostApp, clientApp);

        expect(vi.mocked(ipcSpy.getLastBroadcastChecksum)).toHaveBeenCalledTimes(2);
        expect(vi.mocked(ipcSpy.getLastBroadcastChecksum)).toHaveBeenNthCalledWith(1, hostApp);
        expect(vi.mocked(ipcSpy.getLastBroadcastChecksum)).toHaveBeenNthCalledWith(2, clientApp);
    });
});

// ---------------------------------------------------------------------------
// assertTickAdvanced
// ---------------------------------------------------------------------------

describe('assertTickAdvanced', () => {
    it('resolves without throwing when tick is greater than the baseline', async () => {
        vi.mocked(ipcSpy.getSimulationTick).mockResolvedValue(10);

        await expect(assertTickAdvanced(makeApp(), 5)).resolves.toBeUndefined();
    });

    it('rejects when tick equals the baseline', async () => {
        vi.mocked(ipcSpy.getSimulationTick).mockResolvedValue(5);

        await expect(assertTickAdvanced(makeApp(), 5)).rejects.toThrow();
    });

    it('rejects when tick is less than the baseline', async () => {
        vi.mocked(ipcSpy.getSimulationTick).mockResolvedValue(3);

        await expect(assertTickAdvanced(makeApp(), 5)).rejects.toThrow();
    });

    it('calls getSimulationTick with the provided app', async () => {
        const app = makeApp();
        vi.mocked(ipcSpy.getSimulationTick).mockResolvedValue(100);

        await assertTickAdvanced(app, 50);

        expect(vi.mocked(ipcSpy.getSimulationTick)).toHaveBeenCalledOnce();
        expect(vi.mocked(ipcSpy.getSimulationTick)).toHaveBeenCalledWith(app);
    });
});
