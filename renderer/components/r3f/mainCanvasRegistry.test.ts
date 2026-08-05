// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerMainCanvas } from './mainCanvasRegistry';

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
    // Balance every registration so the module-level count carries nothing
    // into the next test.
    for (const dispose of disposers) {
        dispose();
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

function register(): () => void {
    const dispose = registerMainCanvas();
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

describe('mainCanvasRegistry', () => {
    it('never reports a single registered main', () => {
        register();
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('reports a second concurrent main once, and only after the deferral fires', () => {
        register();
        register();

        // Deferred: nothing may be reported synchronously — a same-frame
        // main-to-main handover (the incoming main registers before the
        // outgoing one releases) must resolve, not report.
        expect(loggedErrorNames()).toEqual([]);

        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMainGameCanvasError']);
    });

    it('reports once even when three mains register concurrently', () => {
        register();
        register();
        register();
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMainGameCanvasError']);
        // The count the message names is the fire-time count, not the count
        // at scheduling time.
        expect(loggedErrorMessages()[0]).toMatch(/^3 GameCanvas roots/);
    });

    it('re-arms after a fired report so a later extra main reports again', () => {
        register();
        register();
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMainGameCanvasError']);

        register();
        flushFrame();

        expect(loggedErrorNames()).toEqual([
            'DuplicateMainGameCanvasError',
            'DuplicateMainGameCanvasError',
        ]);
    });

    it('cancels the pending report when the count returns to one before it fires', () => {
        register();
        const releaseSecond = register();

        releaseSecond();
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('frees the slot on release so a later second main registers cleanly', () => {
        const releaseFirst = register();
        releaseFirst();

        register();
        flushFrame();

        expect(loggedErrorNames()).toEqual([]);
    });

    it('releases a slot exactly once however often one disposer is called', () => {
        register();
        const releaseSecond = register();

        releaseSecond();
        releaseSecond();

        // If the double call freed two slots, the registry would now be at
        // zero and this third main would not count as a duplicate.
        register();
        flushFrame();

        expect(loggedErrorNames()).toEqual(['DuplicateMainGameCanvasError']);
    });
});
