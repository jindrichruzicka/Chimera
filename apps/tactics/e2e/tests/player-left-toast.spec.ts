/**
 * e2e/tests/player-left-toast.spec.ts — §4.30.
 *
 * End-to-end check of the *intentional* in-match leave signal over the real
 * LocalWebSocketProvider — the in-battle counterpart to presence-toast.spec.ts.
 * When the opponent client deliberately leaves a started match via the in-game
 * menu, it sends a graceful LEAVE; the host reads a `'normal'` close while the
 * snapshot is in-game and emits a `chimera:lobby:player-left` event over IPC —
 * which the renderer turns into the "{displayName} left game." toast.
 *
 * We assert on the durable IPC event (captured into an array) rather than the
 * transient on-screen toast, which auto-dismisses after 6s and would race the
 * test. The toast rendering itself is covered by the PlayerLeftToastBridge unit
 * test. A lobby-phase leave (no toast) is covered by the main-side gate plus the
 * existing host/client leave E2E (#743).
 *
 * Base fixture: direct-game.fixture bootstraps both windows directly into a
 * started Tactics match (no lobby UI), so this starts in-match — this spec
 * exercises only in-match behaviour and never the lobby → game transition.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/direct-game.fixture';
import { InGameMenuPage } from '../pages/InGameMenuPage';

const NAV_TIMEOUT_MS = 20_000;

interface PlayerLeftEvent {
    readonly playerId: string;
    readonly displayName: string;
}

interface PlayerLeftGlobal {
    readonly __chimera: {
        readonly lobby: {
            onOpponentLeftMatch(cb: (event: PlayerLeftEvent) => void): () => void;
            getLocalPlayerId(): Promise<string | null>;
        };
    };
    __playerLeftEvents?: PlayerLeftEvent[];
}

async function capturedLeftEvents(page: Page): Promise<readonly PlayerLeftEvent[]> {
    return page.evaluate(
        () => (globalThis as unknown as PlayerLeftGlobal).__playerLeftEvents ?? [],
    );
}

test.describe('In-match opponent leave (§4.30)', () => {
    test('host receives a "{name} left game." signal when the client leaves the battle', async ({
        hostWindow,
        clientWindow,
    }) => {
        // Capture the in-match leave events durably in the host renderer (the
        // toast itself is transient and would race the assertion).
        await hostWindow.evaluate(() => {
            const g = globalThis as unknown as PlayerLeftGlobal;
            g.__playerLeftEvents = [];
            g.__chimera.lobby.onOpponentLeftMatch((event) => {
                (g.__playerLeftEvents ??= []).push(event);
            });
        });

        const clientId = await clientWindow.evaluate(() =>
            (globalThis as unknown as PlayerLeftGlobal).__chimera.lobby.getLocalPlayerId(),
        );
        expect(clientId).not.toBeNull();

        // Client deliberately leaves the battle via the in-game menu. This sends a
        // graceful LEAVE → the host reads a 'normal' close (not a transient drop).
        const clientMenu = new InGameMenuPage(clientWindow);
        await clientMenu.openViaEscape();
        await clientMenu.confirmLeave();

        // The host receives a player-left event naming the departed client …
        await expect
            .poll(async () => (await capturedLeftEvents(hostWindow)).map((e) => e.playerId), {
                timeout: NAV_TIMEOUT_MS,
            })
            .toContain(clientId);

        // … carrying a non-empty display name (drives the "{name} left game." toast)
        // and emitted exactly once.
        const events = await capturedLeftEvents(hostWindow);
        expect(events).toHaveLength(1);
        expect(events[0]!.displayName.length).toBeGreaterThan(0);
    });
});
