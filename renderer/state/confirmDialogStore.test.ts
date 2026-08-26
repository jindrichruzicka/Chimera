/**
 * renderer/state/confirmDialogStore.test.ts
 *
 * Unit tests for the promise-resolving confirm store that backs the single
 * engine confirm surface (§4.37).
 *
 * Tests written first (TDD — red confirmed: the module did not exist before
 * this commit; vitest reported "Failed to load ./confirmDialogStore").
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createConfirmDialogStore,
    selectPendingConfirm,
    type ConfirmDialogStore,
} from './confirmDialogStore';

function make(): ConfirmDialogStore {
    return createConfirmDialogStore().getState();
}

describe('createConfirmDialogStore', () => {
    it('starts with an empty queue and no pending request', () => {
        const store = createConfirmDialogStore();
        expect(store.getState().queue).toEqual([]);
        expect(selectPendingConfirm(store.getState())).toBeNull();
    });

    it('queues a request and exposes it as the pending one', () => {
        const store = createConfirmDialogStore();
        void store.getState().request({ title: 'Overwrite?' });

        const pending = selectPendingConfirm(store.getState());
        expect(pending?.title).toBe('Overwrite?');
        expect(store.getState().queue).toHaveLength(1);
    });

    it('carries the optional body and labels through to the pending request', () => {
        const store = createConfirmDialogStore();
        void store.getState().request({
            title: 'Overwrite?',
            body: 'Your autosave will be replaced.',
            confirmLabel: 'Overwrite',
            cancelLabel: 'Keep it',
        });

        const pending = selectPendingConfirm(store.getState());
        expect(pending?.body).toBe('Your autosave will be replaced.');
        expect(pending?.confirmLabel).toBe('Overwrite');
        expect(pending?.cancelLabel).toBe('Keep it');
    });

    it('leaves the returned promise pending until the request is settled', async () => {
        const state = make();
        const settled = vi.fn();
        void state.request({ title: 'Overwrite?' }).then(settled);

        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
    });

    it('resolves true when the request is settled as accepted', async () => {
        const store = createConfirmDialogStore();
        const answer = store.getState().request({ title: 'Overwrite?' });
        const pending = selectPendingConfirm(store.getState());

        store.getState().settle(pending?.id ?? '', true);

        await expect(answer).resolves.toBe(true);
    });

    it('resolves false when the request is settled as declined', async () => {
        const store = createConfirmDialogStore();
        const answer = store.getState().request({ title: 'Overwrite?' });
        const pending = selectPendingConfirm(store.getState());

        store.getState().settle(pending?.id ?? '', false);

        await expect(answer).resolves.toBe(false);
    });

    it('drops the settled request from the queue', () => {
        const store = createConfirmDialogStore();
        void store.getState().request({ title: 'Overwrite?' });
        const pending = selectPendingConfirm(store.getState());

        store.getState().settle(pending?.id ?? '', true);

        expect(store.getState().queue).toEqual([]);
        expect(selectPendingConfirm(store.getState())).toBeNull();
    });

    it('shows one request at a time — the second becomes pending only after the first settles', async () => {
        const store = createConfirmDialogStore();
        const first = store.getState().request({ title: 'First' });
        const second = store.getState().request({ title: 'Second' });

        expect(store.getState().queue).toHaveLength(2);
        expect(selectPendingConfirm(store.getState())?.title).toBe('First');

        store.getState().settle(selectPendingConfirm(store.getState())?.id ?? '', true);
        await expect(first).resolves.toBe(true);
        expect(selectPendingConfirm(store.getState())?.title).toBe('Second');

        store.getState().settle(selectPendingConfirm(store.getState())?.id ?? '', false);
        await expect(second).resolves.toBe(false);
    });

    it('gives each request its own id', () => {
        const store = createConfirmDialogStore();
        void store.getState().request({ title: 'First' });
        void store.getState().request({ title: 'Second' });

        const [first, second] = store.getState().queue;
        expect(first?.id).not.toBe(second?.id);
    });

    it('settles a queued request that is not the visible head', async () => {
        const store = createConfirmDialogStore();
        void store.getState().request({ title: 'First' });
        const second = store.getState().request({ title: 'Second' });

        store.getState().settle(store.getState().queue[1]?.id ?? '', true);

        await expect(second).resolves.toBe(true);
        expect(store.getState().queue.map((entry) => entry.title)).toEqual(['First']);
    });

    it('ignores a settle for an unknown id', () => {
        const store = createConfirmDialogStore();
        void store.getState().request({ title: 'Overwrite?' });

        expect(() => {
            store.getState().settle('not-a-request', true);
        }).not.toThrow();
        expect(store.getState().queue).toHaveLength(1);
    });

    it('ignores a second settle for the same id', async () => {
        const store = createConfirmDialogStore();
        const answer = store.getState().request({ title: 'Overwrite?' });
        const id = selectPendingConfirm(store.getState())?.id ?? '';

        store.getState().settle(id, true);
        store.getState().settle(id, false);

        await expect(answer).resolves.toBe(true);
        expect(store.getState().queue).toEqual([]);
    });

    it('keeps instances isolated — a request on one store never reaches another', () => {
        const first = createConfirmDialogStore();
        const second = createConfirmDialogStore();

        void first.getState().request({ title: 'Overwrite?' });

        expect(second.getState().queue).toEqual([]);
    });
});

describe('createConfirmDialogStore — a settled request is released', () => {
    it('takes no store write and notifies no subscriber when an already-settled id is settled again', async () => {
        // The promise value alone cannot measure this: `resolve` is idempotent
        // by JS semantics, so a re-resolved promise still reports the first
        // answer. What the release actually buys is that the second settle
        // finds an UNKNOWN id and returns before touching the store.
        const store = createConfirmDialogStore();
        const answer = store.getState().request({ title: 'Overwrite?' });
        const id = selectPendingConfirm(store.getState())?.id ?? '';

        store.getState().settle(id, true);
        await expect(answer).resolves.toBe(true);

        const settledState = store.getState();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.getState().settle(id, false);
        unsubscribe();

        expect(listener).not.toHaveBeenCalled();
        expect(store.getState()).toBe(settledState);
    });

    it('releases every resolver it settles, so a drained queue retains none', async () => {
        const store = createConfirmDialogStore();
        const first = store.getState().request({ title: 'First' });
        const second = store.getState().request({ title: 'Second' });
        const [firstEntry, secondEntry] = store.getState().queue;

        store.getState().settle(firstEntry?.id ?? '', true);
        store.getState().settle(secondEntry?.id ?? '', false);
        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(false);

        const drainedState = store.getState();
        const listener = vi.fn();
        const unsubscribe = store.subscribe(listener);

        store.getState().settle(firstEntry?.id ?? '', false);
        store.getState().settle(secondEntry?.id ?? '', true);
        unsubscribe();

        expect(listener).not.toHaveBeenCalled();
        expect(store.getState()).toBe(drainedState);
    });
});
