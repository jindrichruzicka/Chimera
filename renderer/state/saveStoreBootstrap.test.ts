// @vitest-environment jsdom

/**
 * renderer/state/saveStoreBootstrap.test.ts
 *
 * Unit tests for bootstrapSaveStore.
 * Verifies the initial list() fetch and the onSlotUpdate push subscription.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #373
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playerId, toSlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    RestoreStatusEvent,
    SavesAPI,
    SaveSlotMeta,
    Unsubscribe,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { bootstrapSaveStore } from './saveStoreBootstrap';
import { useSaveStore } from './saveStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlot(slotId: string, tick = 1): SaveSlotMeta {
    return { slotId: toSlotId(slotId), gameId: 'tactics', tick, savedAt: 1_000_000 };
}

function makeSavesApi(
    listImpl?: (gameId: string) => Promise<SaveSlotMeta[]>,
    onSlotUpdateImpl?: (cb: (slots: SaveSlotMeta[]) => void) => Unsubscribe,
    onRestoreStatusImpl?: (cb: (event: RestoreStatusEvent) => void) => Unsubscribe,
): Pick<SavesAPI, 'list' | 'onSlotUpdate' | 'onRestoreStatus'> {
    return {
        list: vi.fn(listImpl ?? (() => Promise.resolve([]))),
        onSlotUpdate: vi.fn(onSlotUpdateImpl ?? (() => vi.fn())),
        onRestoreStatus: vi.fn(onRestoreStatusImpl ?? (() => vi.fn())),
    };
}

// Reset singleton between tests
beforeEach(() => {
    useSaveStore.setState({
        slots: [],
        isLoading: true,
        restore: null,
        restoreExpectedSeats: null,
        restoreLatchMatchId: null,
    });
});

// ── bootstrapSaveStore ────────────────────────────────────────────────────────

describe('bootstrapSaveStore()', () => {
    it('registers an onSlotUpdate callback with the bridge', () => {
        const api = makeSavesApi();
        bootstrapSaveStore(api, 'tactics');
        expect(api.onSlotUpdate).toHaveBeenCalledOnce();
    });

    it('calls list() with the provided gameId', () => {
        const api = makeSavesApi();
        bootstrapSaveStore(api, 'tactics');
        expect(api.list).toHaveBeenCalledWith('tactics');
    });

    it('returns an Unsubscribe function', () => {
        const unsubscribe = vi.fn();
        const api = makeSavesApi(undefined, () => unsubscribe);
        const stop = bootstrapSaveStore(api, 'tactics');
        expect(typeof stop).toBe('function');
    });

    it('calling the returned unsubscribe invokes the bridge unsubscribe', () => {
        const unsubscribe = vi.fn();
        const api = makeSavesApi(undefined, () => unsubscribe);
        const stop = bootstrapSaveStore(api, 'tactics');
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('populates slots and sets isLoading: false after list() resolves', async () => {
        const slots = [makeSlot('slot-1', 5), makeSlot('autosave', 10)];
        const api = makeSavesApi(() => Promise.resolve(slots));

        bootstrapSaveStore(api, 'tactics');

        // isLoading is still true synchronously
        expect(useSaveStore.getState().isLoading).toBe(true);

        await Promise.resolve();

        expect(useSaveStore.getState().isLoading).toBe(false);
        expect(useSaveStore.getState().slots).toEqual(slots);
    });

    it('routes onSlotUpdate push event into the store', () => {
        let capturedCb: ((slots: SaveSlotMeta[]) => void) | undefined;
        const api = makeSavesApi(undefined, (cb) => {
            capturedCb = cb;
            return vi.fn();
        });

        bootstrapSaveStore(api, 'tactics');

        expect(capturedCb).toBeDefined();

        const newSlots = [makeSlot('slot-pushed', 20)];
        capturedCb!(newSlots);

        expect(useSaveStore.getState().slots).toEqual(newSlots);
    });

    it('clears isLoading with empty slots when list() rejects', async () => {
        const api = makeSavesApi(() => Promise.reject(new Error('network error')));

        bootstrapSaveStore(api, 'tactics');

        // Flush the full microtask chain: rejected Promise + .then() + .catch()
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(useSaveStore.getState().isLoading).toBe(false);
        expect(useSaveStore.getState().slots).toEqual([]);
    });

    it('registers an onRestoreStatus callback with the bridge', () => {
        const api = makeSavesApi();
        bootstrapSaveStore(api, 'tactics');
        expect(api.onRestoreStatus).toHaveBeenCalledOnce();
    });

    it('routes onRestoreStatus push events into the store via applyRestoreStatus', () => {
        let capturedCb: ((event: RestoreStatusEvent) => void) | undefined;
        const api = makeSavesApi(undefined, undefined, (cb) => {
            capturedCb = cb;
            return vi.fn();
        });

        bootstrapSaveStore(api, 'tactics');

        expect(capturedCb).toBeDefined();

        const event: RestoreStatusEvent = {
            state: 'waiting',
            gameId: 'tactics',
            matchId: 'match-1',
            lobbyCode: 'ABCD',
            pendingSeats: [playerId('p2'), playerId('p3')],
        };
        capturedCb!(event);

        expect(useSaveStore.getState().restore).toEqual(event);
        expect(useSaveStore.getState().restoreExpectedSeats).toBe(2);
    });

    it('calling the returned unsubscribe tears down both push subscriptions', () => {
        const unsubscribeSlots = vi.fn();
        const unsubscribeRestore = vi.fn();
        const api = makeSavesApi(
            undefined,
            () => unsubscribeSlots,
            () => unsubscribeRestore,
        );

        const stop = bootstrapSaveStore(api, 'tactics');
        stop();

        expect(unsubscribeSlots).toHaveBeenCalledOnce();
        expect(unsubscribeRestore).toHaveBeenCalledOnce();
    });
});
