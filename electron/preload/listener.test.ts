// electron/preload/listener.test.ts
//
// Unit tests for the shared push-channel subscription helpers. The five
// namespace factories already exercise the helpers end-to-end through
// their own tests (registration on the correct channel, Unsubscribe
// removes only the wrapped listener, multi-subscription isolation). This
// file sits one level lower and pins the helper contract directly so a
// future bug in `subscribePush` or `subscribeValidatedPush` has a single,
// clear point of failure rather than surfacing as a cascade across every
// namespace suite.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
    subscribePush,
    subscribeValidatedPush,
    type IpcListener,
    type PushListenerPort,
} from './listener.js';
import { PreloadIpcValidationError } from './schemas.js';

/**
 * Recording stub for {@link PushListenerPort}. Captures every registered
 * listener per channel so each test can both invoke them (to drive the
 * payload forwarding path) and assert registration counts (to prove that
 * `subscribe*` / `Unsubscribe` touch exactly the right set entries).
 */
function makePortStub(): {
    readonly port: PushListenerPort;
    readonly listeners: Map<string, Set<IpcListener>>;
} {
    const listeners = new Map<string, Set<IpcListener>>();
    const port: PushListenerPort = {
        on: (channel, listener) => {
            const set = listeners.get(channel) ?? new Set<IpcListener>();
            set.add(listener);
            listeners.set(channel, set);
        },
        removeListener: (channel, listener) => {
            listeners.get(channel)?.delete(listener);
        },
    };
    return { port, listeners };
}

const TEST_CHANNEL = 'chimera:test:push';

describe('subscribePush', () => {
    it('registers a single listener on the supplied channel', () => {
        const stub = makePortStub();
        const cb = vi.fn<(payload: string) => void>();

        subscribePush<string>(stub.port, TEST_CHANNEL, cb);

        expect(stub.listeners.get(TEST_CHANNEL)?.size).toBe(1);
    });

    it('forwards the first positional argument (after the event) to the callback', () => {
        const stub = makePortStub();
        const cb = vi.fn<(payload: { x: number }) => void>();

        subscribePush<{ x: number }>(stub.port, TEST_CHANNEL, cb);

        const listener = [...(stub.listeners.get(TEST_CHANNEL) ?? [])][0];
        listener?.({ sender: 'fake-webcontents' }, { x: 7 });

        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith({ x: 7 });
    });

    it('returns an Unsubscribe that removes only the wrapped listener', () => {
        const stub = makePortStub();
        const cbA = vi.fn<(payload: number) => void>();
        const cbB = vi.fn<(payload: number) => void>();

        const unsubA = subscribePush<number>(stub.port, TEST_CHANNEL, cbA);
        subscribePush<number>(stub.port, TEST_CHANNEL, cbB);

        expect(stub.listeners.get(TEST_CHANNEL)?.size).toBe(2);

        unsubA();

        // Only `cbA`'s wrapped listener was removed.
        expect(stub.listeners.get(TEST_CHANNEL)?.size).toBe(1);

        // And deliveries to the remaining listener still reach `cbB`.
        for (const listener of stub.listeners.get(TEST_CHANNEL) ?? []) {
            listener({}, 42);
        }
        expect(cbA).not.toHaveBeenCalled();
        expect(cbB).toHaveBeenCalledOnce();
        expect(cbB).toHaveBeenCalledWith(42);
    });

    it('supports many subscriptions on the same channel without interference', () => {
        const stub = makePortStub();
        const calls: number[] = [];

        subscribePush<number>(stub.port, TEST_CHANNEL, (n) => calls.push(n * 10));
        subscribePush<number>(stub.port, TEST_CHANNEL, (n) => calls.push(n * 100));

        for (const listener of stub.listeners.get(TEST_CHANNEL) ?? []) {
            listener({}, 3);
        }
        expect(calls.sort()).toEqual([30, 300]);
    });
});

describe('subscribeValidatedPush', () => {
    // Minimal schema for these tests — the ActionRejection case is covered
    // by game-api.test.ts; here we only verify the helper's contract.
    const PayloadSchema = z.object({
        reason: z.string().min(1),
        tick: z.number().int(),
    });
    type Payload = z.infer<typeof PayloadSchema>;

    it('forwards a validated payload to the callback', () => {
        const stub = makePortStub();
        const cb = vi.fn<(payload: Payload) => void>();

        subscribeValidatedPush<Payload>(stub.port, TEST_CHANNEL, PayloadSchema, cb);

        const listener = [...(stub.listeners.get(TEST_CHANNEL) ?? [])][0];
        listener?.({}, { reason: 'ok', tick: 7 });

        expect(cb).toHaveBeenCalledOnce();
        expect(cb).toHaveBeenCalledWith({ reason: 'ok', tick: 7 });
    });

    it('throws PreloadIpcValidationError naming the channel when payload is malformed', () => {
        const stub = makePortStub();
        const cb = vi.fn<(payload: Payload) => void>();

        subscribeValidatedPush<Payload>(stub.port, TEST_CHANNEL, PayloadSchema, cb);
        const listener = [...(stub.listeners.get(TEST_CHANNEL) ?? [])][0];

        expect.assertions(4);
        try {
            listener?.({}, { reason: '', tick: 7 });
        } catch (error) {
            expect(error).toBeInstanceOf(PreloadIpcValidationError);
            expect((error as PreloadIpcValidationError).channel).toBe(TEST_CHANNEL);
        }
        // Non-integer tick also throws.
        try {
            listener?.({}, { reason: 'r', tick: 1.5 });
        } catch (error) {
            expect(error).toBeInstanceOf(PreloadIpcValidationError);
        }
        // And the callback saw none of the malformed payloads.
        expect(cb).not.toHaveBeenCalled();
    });

    it('returns an Unsubscribe that removes only the wrapped listener', () => {
        const stub = makePortStub();
        const cb = vi.fn<(payload: Payload) => void>();

        const unsubscribe = subscribeValidatedPush<Payload>(
            stub.port,
            TEST_CHANNEL,
            PayloadSchema,
            cb,
        );
        expect(stub.listeners.get(TEST_CHANNEL)?.size).toBe(1);

        unsubscribe();
        expect(stub.listeners.get(TEST_CHANNEL)?.size).toBe(0);
    });

    it('supports multiple independent validated subscriptions', () => {
        const stub = makePortStub();
        const cbA = vi.fn<(payload: Payload) => void>();
        const cbB = vi.fn<(payload: Payload) => void>();

        const unsubA = subscribeValidatedPush<Payload>(stub.port, TEST_CHANNEL, PayloadSchema, cbA);
        subscribeValidatedPush<Payload>(stub.port, TEST_CHANNEL, PayloadSchema, cbB);

        for (const listener of stub.listeners.get(TEST_CHANNEL) ?? []) {
            listener({}, { reason: 'ok', tick: 1 });
        }
        expect(cbA).toHaveBeenCalledOnce();
        expect(cbB).toHaveBeenCalledOnce();

        cbA.mockClear();
        cbB.mockClear();
        unsubA();

        for (const listener of stub.listeners.get(TEST_CHANNEL) ?? []) {
            listener({}, { reason: 'ok', tick: 2 });
        }
        expect(cbA).not.toHaveBeenCalled();
        expect(cbB).toHaveBeenCalledOnce();
    });
});
