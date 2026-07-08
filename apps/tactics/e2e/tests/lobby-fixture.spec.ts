import { launchE2eElectronApplication } from '../fixtures/electron.fixture';
import { test, expect } from '../fixtures/lobby.fixture';

test.describe('lobby fixture', () => {
    test('launches host and client as isolated role-specific processes', async ({
        hostApp,
        clientApp,
        hostWindow,
        clientWindow,
    }) => {
        const [hostPid, clientPid, hostRole, clientRole, hostPort, clientPort] = await Promise.all([
            hostApp.evaluate(() => process.pid),
            clientApp.evaluate(() => process.pid),
            hostApp.evaluate(() => process.env['CHIMERA_ROLE']),
            clientApp.evaluate(() => process.env['CHIMERA_ROLE']),
            hostApp.evaluate(() => process.env['CHIMERA_PORT']),
            clientApp.evaluate(() => process.env['CHIMERA_PORT']),
        ]);

        expect(hostPid).not.toBe(clientPid);
        expect(hostRole).toBe('host');
        expect(clientRole).toBe('client');
        expect(hostPort).toBe('7779');
        expect(clientPort).toBe('7779');
        // The /lobby route renders through the fixed-position chrome-less Modal,
        // so <body> has a zero-height box — assert the dialog itself rendered.
        await expect(hostWindow.getByTestId('lobby-dialog')).toBeVisible();
        await expect(clientWindow.getByTestId('lobby-dialog')).toBeVisible();
    });

    test('can reuse the multiplayer port after fixture teardown', async () => {
        // First cycle: launch, verify, then explicitly close to simulate fixture teardown.
        const firstHost = await launchE2eElectronApplication({ port: '7779', role: 'host' });
        const firstClient = await launchE2eElectronApplication({ port: '7779', role: 'client' });
        const firstHostPid = await firstHost.evaluate(() => process.pid);
        const firstClientPid = await firstClient.evaluate(() => process.pid);
        try {
            await firstHost.close();
        } finally {
            await firstClient.close();
        }

        // Second cycle: the OS must have released the port so a fresh pair can bind it.
        // If the port were still held, Electron would fail to start or the window would not render.
        const secondHost = await launchE2eElectronApplication({ port: '7779', role: 'host' });
        const secondClient = await launchE2eElectronApplication({ port: '7779', role: 'client' });
        try {
            const [secondHostWindow, secondClientWindow] = await Promise.all([
                secondHost.firstWindow(),
                secondClient.firstWindow(),
            ]);
            await secondHostWindow.waitForLoadState('domcontentloaded');
            await secondClientWindow.waitForLoadState('domcontentloaded');

            // Distinct processes — confirms fresh launch, not recycled ones.
            const [secondHostPid, secondClientPid] = await Promise.all([
                secondHost.evaluate(() => process.pid),
                secondClient.evaluate(() => process.pid),
            ]);
            expect(secondHostPid).not.toBe(firstHostPid);
            expect(secondClientPid).not.toBe(firstClientPid);

            // Windows rendered — proves the processes successfully bound to port 7779.
            await expect(secondHostWindow.locator('body')).toBeVisible();
            await expect(secondClientWindow.locator('body')).toBeVisible();
        } finally {
            try {
                await secondHost.close();
            } finally {
                await secondClient.close();
            }
        }
    });
});
