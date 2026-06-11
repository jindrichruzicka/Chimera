/**
 * electron/main/__test-support__/debug-fakes.ts
 *
 * Shared in-process doubles for the Runtime Debug Layer bridge (§4.12):
 * a fake Inspector window and its web contents, used by both the
 * debug-bridge unit tests and the debug-wiring integration tests.
 */

import type { DebugWebContentsLike, DebugWindowLike } from '../debug-bridge.js';

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
