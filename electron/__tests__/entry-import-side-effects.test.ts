/**
 * electron/__tests__/entry-import-side-effects.test.ts
 *
 * Locks the "no side effects on import" property of the `@chimera-engine/electron`
 * package entry (`./main` → electron/main/index.ts), the electron-side analogue
 * of the side-effect-free barrel assertions shipped by @chimera-engine/simulation
 * (#759) and @chimera-engine/networking (#768/contract-barrel-side-effects.test.ts).
 *
 * `@chimera-engine/electron` is not a pure-contract barrel — its entry exports the
 * `main()` Electron bootstrap. The equivalent "inert import" guarantee is
 * therefore behavioural: importing the entry must DEFINE the bootstrap without
 * RUNNING it. No Electron app lifecycle may fire at module-load time — no
 * `app.whenReady()`, no lifecycle listeners, no IPC registration, no window
 * creation, no protocol/session wiring. All of that lives inside `main()`,
 * which the consumer app's composition root (apps/tactics/electron/main.ts)
 * invokes explicitly.
 *
 * This is what makes the package a thin, composable wrapper (issue #779, F62):
 * a consumer that merely imports `@chimera-engine/electron/main` gets the bootstrap as
 * a value, not an app that boots itself as a side effect of being required.
 */

import { describe, it, expect, vi } from 'vitest';

// Spies on every Electron entry point a boot would touch. None may fire while
// the module is merely being imported — they are asserted uncalled below.
const appWhenReady = vi.fn(() => Promise.resolve());
const appOn = vi.fn();
const appRequestSingleInstanceLock = vi.fn(() => true);
const ipcMainHandle = vi.fn();
const ipcMainOn = vi.fn();
const browserWindowCtor = vi.fn();
const protocolRegisterSchemesAsPrivileged = vi.fn();
const protocolHandle = vi.fn();
const setPermissionRequestHandler = vi.fn();

class FakeBrowserWindow {
    constructor(...args: unknown[]) {
        browserWindowCtor(...args);
    }
}

vi.mock('electron', () => ({
    app: {
        on: appOn,
        whenReady: appWhenReady,
        requestSingleInstanceLock: appRequestSingleInstanceLock,
        quit: vi.fn(),
        relaunch: vi.fn(),
        exit: vi.fn(),
        getPath: vi.fn(() => '/tmp/chimera-entry-side-effects'),
        getLocale: vi.fn(() => 'en-US'),
        getVersion: vi.fn(() => '0.0.0-test'),
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: { handle: ipcMainHandle, on: ipcMainOn },
    protocol: {
        registerSchemesAsPrivileged: protocolRegisterSchemesAsPrivileged,
        handle: protocolHandle,
    },
    session: { defaultSession: { setPermissionRequestHandler } },
    screen: {
        getAllDisplays: vi.fn(() => []),
        getPrimaryDisplay: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
}));

describe('@chimera-engine/electron entry — no side effects on import (issue #779)', () => {
    it('exports the main() bootstrap as a value without running it', async () => {
        const mod = await import('../main/index.js');

        // The entry exposes the bootstrap…
        expect(typeof mod.main).toBe('function');

        // …but importing it must not have started the app. Every lifecycle,
        // IPC, window, and protocol entry point stays untouched until a
        // composition root calls main() explicitly.
        expect(appWhenReady).not.toHaveBeenCalled();
        expect(appOn).not.toHaveBeenCalled();
        expect(appRequestSingleInstanceLock).not.toHaveBeenCalled();
        expect(ipcMainHandle).not.toHaveBeenCalled();
        expect(ipcMainOn).not.toHaveBeenCalled();
        expect(browserWindowCtor).not.toHaveBeenCalled();
        expect(protocolRegisterSchemesAsPrivileged).not.toHaveBeenCalled();
        expect(protocolHandle).not.toHaveBeenCalled();
        expect(setPermissionRequestHandler).not.toHaveBeenCalled();
    });
});
