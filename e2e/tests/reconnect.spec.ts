import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/game.fixture';
import { getSimulationTick } from '../helpers/ipc-spy';
import { captureRelaunchConfig, relaunchElectronApplication } from '../helpers/relaunch';
import { GamePage } from '../pages/GamePage';

const TICK_TOLERANCE = 2;

interface ReconnectTicket {
    readonly address: string;
    readonly playerId: string;
}

interface RendererLobbyState {
    readonly info: { readonly sessionId: string };
    readonly players: readonly { readonly playerId: string }[];
}

interface RendererChimeraBridge {
    readonly lobby: {
        getCurrentState(): Promise<RendererLobbyState | null>;
        getLocalPlayerId(): Promise<string | null>;
    };
}

type RendererGlobal = typeof globalThis & { readonly __chimera: RendererChimeraBridge };

async function localPlayerId(page: Page): Promise<string> {
    const playerId = await page.evaluate(() =>
        (globalThis as RendererGlobal).__chimera.lobby.getLocalPlayerId(),
    );
    if (playerId === null) {
        throw new Error('Client local player ID was not available');
    }
    return playerId;
}

async function reconnectTicket(page: Page): Promise<ReconnectTicket> {
    const [state, playerId] = await Promise.all([
        page.evaluate(() => (globalThis as RendererGlobal).__chimera.lobby.getCurrentState()),
        localPlayerId(page),
    ]);
    if (state === null) {
        throw new Error('Client lobby state was not available');
    }
    return { address: state.info.sessionId, playerId };
}

async function primeRelaunchReconnectEnv(
    app: ElectronApplication,
    ticket: ReconnectTicket,
): Promise<void> {
    await app.evaluate((_electron, reconnect) => {
        process.env['CHIMERA_E2E_DIRECT_MATCH_ROLE'] = 'client';
        process.env['CHIMERA_E2E_DIRECT_MATCH_JOIN_ADDRESS'] = reconnect.address;
        process.env['CHIMERA_E2E_RECONNECT_PLAYER_ID'] = reconnect.playerId;
    }, ticket);
}

async function connectedPlayerIds(page: Page): Promise<readonly string[]> {
    return page.evaluate(async () => {
        const state = await (globalThis as RendererGlobal).__chimera.lobby.getCurrentState();
        return state?.players.map((entry) => entry.playerId) ?? [];
    });
}

test.describe('Client reconnect', () => {
    test('client reconnects after Electron relaunch', async ({
        hostApp,
        clientApp,
        hostWindow,
        clientWindow,
    }) => {
        const ticket = await reconnectTicket(clientWindow);
        await primeRelaunchReconnectEnv(clientApp, ticket);
        const relaunchConfig = await captureRelaunchConfig(clientApp);
        const originalClientPlayerId = ticket.playerId;
        const originalClientMatch = new GamePage(clientWindow);
        await expect(originalClientMatch.canvas).toBeVisible();

        await clientApp.close();
        await expect
            .poll(() => connectedPlayerIds(hostWindow))
            .not.toContain(originalClientPlayerId);

        const relaunchedClientApp = await relaunchElectronApplication(relaunchConfig, {
            CHIMERA_ROLE: 'client',
        });

        try {
            const relaunchedClientWindow = await relaunchedClientApp.firstWindow();
            await relaunchedClientWindow.waitForLoadState('domcontentloaded');

            await expect
                .poll(() =>
                    relaunchedClientWindow.evaluate(() =>
                        (globalThis as RendererGlobal).__chimera.lobby.getLocalPlayerId(),
                    ),
                )
                .toBe(originalClientPlayerId);
            await expect
                .poll(() => connectedPlayerIds(hostWindow))
                .toContain(originalClientPlayerId);

            await expect(relaunchedClientWindow.getByTestId('connection-status')).toHaveAttribute(
                'data-status',
                'connected',
                { timeout: 30_000 },
            );

            const relaunchedClientMatch = new GamePage(relaunchedClientWindow);
            await expect(relaunchedClientMatch.canvas).toBeVisible({ timeout: 30_000 });

            await expect
                .poll(async () => {
                    const [hostTick, clientTick] = await Promise.all([
                        getSimulationTick(hostApp),
                        relaunchedClientMatch.currentTick(),
                    ]);
                    return Math.abs(hostTick - clientTick);
                })
                .toBeLessThanOrEqual(TICK_TOLERANCE);
        } finally {
            await relaunchedClientApp.close();
        }
    });
});
