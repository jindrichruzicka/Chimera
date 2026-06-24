/**
 * e2e/tests/presence-toast.spec.ts — §4.30 / #687.
 *
 * End-to-end check of the opponent-presence signal over the real
 * LocalWebSocketProvider: when the opponent client's process drops without a
 * graceful LEAVE (the app has no closeLobby on quit), the host reads a transient
 * disconnect ('timeout') and emits a `disconnected` presence event over IPC —
 * which the renderer turns into the "Player disconnected" toast.
 *
 * We assert on the durable IPC event (captured into an array) rather than the
 * transient on-screen toast, which auto-dismisses after 6s and would race the
 * test. The toast rendering itself is covered by the bridge unit test. The
 * "Player reconnected" and "Profile rejected" toasts are covered by unit/contract
 * tests — they are awkward to drive deterministically in E2E.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/game.fixture';

interface PresenceEvent {
    readonly playerId: string;
    readonly status: string;
}

interface PresenceGlobal {
    readonly __chimera: {
        readonly lobby: {
            onPlayerConnectionChanged(cb: (event: PresenceEvent) => void): () => void;
            getCurrentState(): Promise<{
                readonly players: readonly { readonly playerId: string }[];
            } | null>;
        };
    };
    __presenceEvents?: PresenceEvent[];
}

async function capturedStatuses(page: Page): Promise<readonly string[]> {
    return page.evaluate(() =>
        ((globalThis as unknown as PresenceGlobal).__presenceEvents ?? []).map((e) => e.status),
    );
}

async function rosterIds(page: Page): Promise<readonly string[]> {
    return page.evaluate(async () => {
        const state = await (
            globalThis as unknown as PresenceGlobal
        ).__chimera.lobby.getCurrentState();
        return state?.players.map((p) => p.playerId) ?? [];
    });
}

test.describe('Opponent presence (#687)', () => {
    test('host emits a "disconnected" presence event when the opponent client drops', async ({
        clientApp,
        clientWindow,
        hostWindow,
    }) => {
        // Capture presence events durably in the host renderer (the toast itself
        // is transient and would race the assertion).
        await hostWindow.evaluate(() => {
            const g = globalThis as unknown as PresenceGlobal;
            g.__presenceEvents = [];
            g.__chimera.lobby.onPlayerConnectionChanged((event) => {
                (g.__presenceEvents ??= []).push(event);
            });
        });

        const clientId = await clientWindow.evaluate(async () => {
            const state = await (
                globalThis as unknown as PresenceGlobal
            ).__chimera.lobby.getCurrentState();
            return state?.players.at(-1)?.playerId ?? null;
        });
        expect(clientId).not.toBeNull();

        // Graceful Electron close still drops the socket without a LEAVE (the app
        // has no closeLobby-on-quit), so the host reads a transient drop. close()
        // is reliably detected by the host (see reconnect.spec).
        await clientApp.close();

        // Host detects the drop: the opponent leaves the roster …
        await expect.poll(() => rosterIds(hostWindow), { timeout: 20_000 }).not.toContain(clientId);

        // … and a `disconnected` presence event was delivered to the renderer.
        await expect
            .poll(() => capturedStatuses(hostWindow), { timeout: 20_000 })
            .toContain('disconnected');
    });
});
