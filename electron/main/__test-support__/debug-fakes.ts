/**
 * electron/main/__test-support__/debug-fakes.ts
 *
 * Shared in-process doubles for the Runtime Debug Layer bridge (§4.12):
 * a fake Inspector window and its web contents, used by both the
 * debug-bridge unit tests and the debug-wiring integration tests.
 */

import type {
    DebugWebContentsLike,
    DebugWindowLike,
    InspectorWebContentsLike,
    InspectorWindowLike,
} from '../debug-bridge.js';

let nextWebContentsId = 1;

export class FakeWebContents implements DebugWebContentsLike {
    readonly id: number;
    readonly sent: { channel: string; payload: unknown }[] = [];
    destroyed = false;

    constructor() {
        this.id = nextWebContentsId++;
    }

    send(channel: string, payload: unknown): void {
        this.sent.push({ channel, payload });
    }

    isDestroyed(): boolean {
        return this.destroyed;
    }
}

export class FakeInspectorWindow implements DebugWindowLike {
    readonly webContents = new FakeWebContents();
    closeCalls = 0;
    #closedHandlers: (() => void)[] = [];
    #destroyed = false;

    on(event: 'closed', handler: () => void): void {
        if (event === 'closed') {
            this.#closedHandlers.push(handler);
        }
    }

    close(): void {
        this.closeCalls += 1;
        this.emitClosed();
    }

    /** Simulates the window finishing its close (user X-click or close()). */
    emitClosed(): void {
        this.#destroyed = true;
        this.webContents.destroyed = true;
        for (const handler of this.#closedHandlers) {
            handler();
        }
    }

    isDestroyed(): boolean {
        return this.#destroyed;
    }
}

/**
 * Full-surface web-contents fake for `createInspectorWindow` tests: records
 * `loadURL` calls and lets tests emit the navigation lifecycle events the
 * default Inspector window factory wires up.
 */
export class FakeInspectorWebContents extends FakeWebContents implements InspectorWebContentsLike {
    readonly loadedUrls: string[] = [];
    windowOpenHandler: (() => { action: 'deny' }) | null = null;
    readonly #listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    setWindowOpenHandler(handler: () => { action: 'deny' }): void {
        this.windowOpenHandler = handler;
    }

    on(event: string, listener: (...args: never[]) => void): void {
        const existing = this.#listeners.get(event) ?? [];
        this.#listeners.set(event, [...existing, listener as (...args: unknown[]) => void]);
    }

    loadURL(url: string): Promise<void> {
        this.loadedUrls.push(url);
        return Promise.resolve();
    }

    /** Emits `will-navigate`; returns whether a listener prevented it. */
    emitWillNavigate(url: string): boolean {
        let prevented = false;
        const event = {
            preventDefault: (): void => {
                prevented = true;
            },
        };
        for (const listener of this.#listeners.get('will-navigate') ?? []) {
            listener(event, url);
        }
        return prevented;
    }

    emitDidNavigate(url: string, httpResponseCode: number, httpStatusText: string): void {
        for (const listener of this.#listeners.get('did-navigate') ?? []) {
            listener({}, url, httpResponseCode, httpStatusText);
        }
    }

    emitDidFailLoad(
        errorCode: number,
        errorDescription: string,
        validatedUrl: string,
        isMainFrame: boolean,
    ): void {
        for (const listener of this.#listeners.get('did-fail-load') ?? []) {
            listener({}, errorCode, errorDescription, validatedUrl, isMainFrame);
        }
    }
}

/** Window fake whose web contents carries the full Inspector event surface. */
export class FakeFullInspectorWindow implements InspectorWindowLike {
    readonly webContents = new FakeInspectorWebContents();
    #destroyed = false;

    on(event: 'closed', _handler: () => void): void {
        void event;
    }

    close(): void {
        this.#destroyed = true;
        this.webContents.destroyed = true;
    }

    isDestroyed(): boolean {
        return this.#destroyed;
    }
}
