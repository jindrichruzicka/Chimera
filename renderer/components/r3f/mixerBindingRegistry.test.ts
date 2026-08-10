// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D } from 'three';

import { readMixerBinding, registerMixerBinding } from './mixerBindingRegistry';

let logEmit: ReturnType<typeof vi.fn>;
let rafCallbacks: Map<number, (timestamp: number) => void>;
let nextRafHandle: number;
let disposers: (() => void)[];

beforeEach(() => {
    logEmit = vi.fn();
    vi.stubGlobal('__chimera', { logs: { emit: logEmit } });
    // The registry defers its report by a frame; keep rAF off jsdom's
    // timer-backed implementation so the deferral is flushable here.
    rafCallbacks = new Map();
    nextRafHandle = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void): number => {
        const handle = nextRafHandle++;
        rafCallbacks.set(handle, callback);
        return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
        rafCallbacks.delete(handle);
    });
    disposers = [];
});

afterEach(() => {
    // Balance every registration. The entries are per-root and the roots are
    // per-case, so nothing could leak between cases — but a disposer left
    // uncalled would leave a pending report to fire inside the NEXT case's
    // flush, which is a failure mode worth not having.
    for (const dispose of disposers) {
        dispose();
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function register(root: Object3D, binderName: string): () => void {
    const dispose = registerMixerBinding(root, binderName);
    disposers.push(dispose);
    return dispose;
}

/** Fire one frame, which is what the deferred duplicate report waits for. */
function flushFrame(): void {
    const due = [...rafCallbacks.values()];
    rafCallbacks.clear();
    for (const callback of due) {
        callback(0);
    }
}

/** Names of error-level entries the renderer log bridge received. */
function loggedErrorNames(): (string | undefined)[] {
    return logEmit.mock.calls
        .map((call) => call[0] as { level: string; error?: { name?: string } })
        .filter((entry) => entry.level === 'error')
        .map((entry) => entry.error?.name);
}

/** Messages of the error-level entries, in emission order. */
function loggedErrorMessages(): (string | undefined)[] {
    return logEmit.mock.calls
        .map((call) => call[0] as { level: string; error?: { message?: string } })
        .filter((entry) => entry.level === 'error')
        .map((entry) => entry.error?.message);
}

describe('mixerBindingRegistry', () => {
    it('never reports a single binder on a root', () => {
        register(new Object3D(), 'useModelAnimation');
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('reports a second binder on ONE root once, and only after the deferral fires', () => {
        const root = new Object3D();
        register(root, 'useModelAnimation');
        register(root, 'useClipPlayer');

        // Deferred: nothing may be reported synchronously — a pair that
        // overlaps and then resolves must not report, which is the cancel case
        // further down.
        expect(loggedErrorNames()).toEqual([]);

        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMixerBindingError']);
    });

    it('names every binder concurrently bound to the root', () => {
        const root = new Object3D();
        register(root, 'useModelAnimation');
        register(root, 'useClipPlayer');
        flushFrame();

        const message = String(loggedErrorMessages()[0]);
        expect(message).toContain('useModelAnimation');
        expect(message).toContain('useClipPlayer');
    });

    it('reports nothing for two binders on two DIFFERENT roots', () => {
        // The axis that separates this registry from `mainCanvasRegistry`: the
        // count is per root, and a scene with two animated models is ordinary.
        register(new Object3D(), 'useClipPlayer');
        register(new Object3D(), 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('reports once even when three binders claim one root concurrently', () => {
        const root = new Object3D();
        register(root, 'useModelAnimation');
        register(root, 'useClipPlayer');
        register(root, 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMixerBindingError']);
        // The count the message names is the fire-time count, not the count at
        // scheduling time.
        expect(loggedErrorMessages()[0]).toMatch(/^3 animation hooks/u);
    });

    it('cancels the pending report when the count returns to one before it fires', () => {
        const root = new Object3D();
        register(root, 'useModelAnimation');
        const releaseSecond = register(root, 'useClipPlayer');

        releaseSecond();
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('re-arms after a fired report so a later extra binder reports again', () => {
        const root = new Object3D();
        register(root, 'useModelAnimation');
        register(root, 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMixerBindingError']);

        register(root, 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual([
            'DuplicateMixerBindingError',
            'DuplicateMixerBindingError',
        ]);
    });

    it('frees the slot on release so a later second binder registers cleanly', () => {
        const root = new Object3D();
        const releaseFirst = register(root, 'useModelAnimation');
        releaseFirst();

        register(root, 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('releases a slot exactly once however often one disposer is called', () => {
        const root = new Object3D();
        register(root, 'useModelAnimation');
        const releaseSecond = register(root, 'useClipPlayer');

        releaseSecond();
        releaseSecond();

        // If the double call freed two slots, the registry would now be empty
        // and this third binder would not count as a duplicate.
        register(root, 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMixerBindingError']);
    });

    it('drops the entry entirely once the last binder releases', () => {
        const root = new Object3D();
        const release = register(root, 'useClipPlayer');
        expect(readMixerBinding(root)).toEqual({ count: 1, binders: ['useClipPlayer'] });

        release();

        // A lingering zero-count entry and a deleted one behave identically at
        // every other seam, so this is the only place a leak is visible.
        expect(readMixerBinding(root)).toBeNull();
    });

    it('forgets a released binder name, so a later report names only the live ones', () => {
        const root = new Object3D();
        const releaseFirst = register(root, 'useModelAnimation');
        register(root, 'useClipPlayer');
        releaseFirst();
        register(root, 'useClipPlayer');
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMixerBindingError']);
        // Asserted on the ledger rather than on the message: the message's own
        // remedy sentence names both hooks, so a `not.toContain` over the whole
        // string could never pass however correct the list was.
        expect(readMixerBinding(root)?.binders).toEqual(['useClipPlayer', 'useClipPlayer']);
        // …and on the parenthesised list the message builds from it.
        expect(String(loggedErrorMessages()[0])).toContain('(useClipPlayer, useClipPlayer)');
    });

    it('answers null for a root nothing ever bound', () => {
        expect(readMixerBinding(new Object3D())).toBeNull();
    });
});
