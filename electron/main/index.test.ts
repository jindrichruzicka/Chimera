import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── pino mock — prevent SonicBoom from opening real file descriptors ──────────
vi.mock('pino', () => {
    const fakeDest = { write: vi.fn<(data: string) => void>() };
    const destination = vi.fn(() => fakeDest);
    const pinoFn = Object.assign(vi.fn(), { destination });
    return { default: pinoFn };
});

// ── SaveManager mock (used by main() after the sync-helper removal) ──────────
const {
    mockSaveManagerClearFlag,
    mockSaveManagerMarkExit,
    mockSaveManagerCheckCrash,
    capturedSaveManagerRepoClassName,
} = vi.hoisted(() => ({
    mockSaveManagerClearFlag: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    mockSaveManagerMarkExit: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    mockSaveManagerCheckCrash: vi.fn<(ids: readonly string[]) => Promise<null>>(() =>
        Promise.resolve(null),
    ),
    // Stores the constructor name of the first arg passed to SaveManager
    // for the BLOCK-1 assertion (avoids importing the real class).
    capturedSaveManagerRepoClassName: { value: '' },
}));

vi.mock('./SaveManager.js', () => ({
    SaveManager: vi.fn((repo: { constructor?: { name?: string } }) => {
        capturedSaveManagerRepoClassName.value = repo?.constructor?.name ?? '';
        return {
            clearCleanExitFlag: mockSaveManagerClearFlag,
            markCleanExit: mockSaveManagerMarkExit,
            checkCrashRecovery: mockSaveManagerCheckCrash,
        };
    }),
}));

// ── crash-reporter mock — spy on registerCrashReporter options ────────────────
const { mockRegisterCrashReporter } = vi.hoisted(() => ({
    mockRegisterCrashReporter: vi.fn<(options: { autosave?: () => Promise<void> }) => void>(),
}));

vi.mock('./crash-reporter.js', () => ({
    registerCrashReporter: mockRegisterCrashReporter,
}));

type AppEventHandler = (...args: readonly unknown[]) => void;

interface FakeWebPreferences {
    readonly nodeIntegration?: boolean;
    readonly contextIsolation?: boolean;
    readonly webSecurity?: boolean;
    readonly preload?: string;
    readonly additionalArguments?: readonly string[];
}

interface FakeBrowserWindowOptions {
    readonly webPreferences?: FakeWebPreferences;
}

const browserWindowInstances: FakeBrowserWindow[] = [];

class FakeWebContents {
    public readonly openDevTools = vi.fn();
    public readonly setWindowOpenHandler =
        vi.fn<(handler: (details: { url: string }) => { action: string }) => void>();
    public readonly on =
        vi.fn<(event: string, handler: (...args: readonly unknown[]) => void) => void>();
}

class FakeBrowserWindow {
    public readonly options: FakeBrowserWindowOptions;
    public readonly loadFile = vi.fn();
    public readonly webContents = new FakeWebContents();
    constructor(options: FakeBrowserWindowOptions) {
        this.options = options;
        browserWindowInstances.push(this);
    }
    public static getAllWindows = vi.fn((): readonly FakeBrowserWindow[] => browserWindowInstances);
}

const appOn = vi.fn<(event: string, handler: AppEventHandler) => void>();
const appQuit = vi.fn<() => void>();
const appRelaunch = vi.fn<() => void>();
const appExit = vi.fn<(code: number) => void>();
const appWhenReady = vi.fn<() => Promise<void>>(() => Promise.resolve());
const appGetPath = vi.fn<(name: string) => string>(() => '/tmp/chimera-userData-fake');
const ipcMainHandle = vi.fn<(channel: string, handler: () => unknown) => void>();
const ipcMainOn = vi.fn<(channel: string, handler: () => void) => void>();

const mockSetPermissionRequestHandler =
    vi.fn<
        (
            handler: (
                webContents: unknown,
                permission: string,
                callback: (allow: boolean) => void,
            ) => void,
        ) => void
    >();

vi.mock('electron', () => ({
    app: {
        on: appOn,
        quit: appQuit,
        relaunch: appRelaunch,
        exit: appExit,
        whenReady: appWhenReady,
        getPath: appGetPath,
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
        handle: ipcMainHandle,
        on: ipcMainOn,
    },
    session: {
        defaultSession: {
            setPermissionRequestHandler: mockSetPermissionRequestHandler,
        },
    },
}));

const fsExistsSync = vi.fn<(path: string) => boolean>(() => false);
const fsWriteFileSync = vi.fn<(path: string, data: string) => void>();
const fsUnlinkSync = vi.fn<(path: string) => void>();
const fsMkdirSync = vi.fn<(path: string, options?: unknown) => void>();
const fsReaddirSync = vi.fn<(path: string) => string[]>(() => []);
const fsOpenSync = vi.fn<(path: string, flags: string) => number>(() => 42);

vi.mock('node:fs', () => ({
    existsSync: fsExistsSync,
    writeFileSync: fsWriteFileSync,
    unlinkSync: fsUnlinkSync,
    mkdirSync: fsMkdirSync,
    readdirSync: fsReaddirSync,
    openSync: fsOpenSync,
}));

const {
    createMainWindow,
    registerAppLifecycle,
    resolveChimeraEnv,
    registerCleanExitIpc,
    registerSaveManagerLifecycle,
    parseHarnessFlags,
    main,
} = await import('./index.js');

const PRELOAD = '/abs/path/preload/api.js';
const RENDERER_ENTRY = '/abs/path/renderer/out/index.html';

describe('createMainWindow', () => {
    beforeEach(() => {
        browserWindowInstances.length = 0;
    });

    it('constructs a BrowserWindow with contextIsolation: true', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        expect(browserWindowInstances).toHaveLength(1);
        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.contextIsolation).toBe(true);
    });

    it('constructs a BrowserWindow with webSecurity: true (WARN-5)', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.webSecurity).toBe(true);
    });

    it('constructs a BrowserWindow with nodeIntegration: false', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.nodeIntegration).toBe(false);
    });

    it('wires the supplied preload path into webPreferences', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.preload).toBe(PRELOAD);
    });

    it('returns the constructed BrowserWindow', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        expect(win).toBeInstanceOf(FakeBrowserWindow);
    });

    it('injects --chimera-env=development into additionalArguments when env is development', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'development',
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.additionalArguments).toContain(
            '--chimera-env=development',
        );
    });

    it('injects --chimera-env=production into additionalArguments when env is production', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.additionalArguments).toContain(
            '--chimera-env=production',
        );
    });

    it('loads the renderer entry HTML file via loadFile', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        expect(win.loadFile).toHaveBeenCalledTimes(1);
        expect(win.loadFile).toHaveBeenCalledWith(RENDERER_ENTRY);
    });

    it('opens DevTools when env is development', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'development',
        });

        expect(win.webContents.openDevTools).toHaveBeenCalledTimes(1);
    });

    it('does not open DevTools when env is production', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        });

        expect(win.webContents.openDevTools).not.toHaveBeenCalled();
    });

    it('calls setWindowOpenHandler with a handler that returns { action: "deny" } (WARN-2)', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        }) as unknown as FakeBrowserWindow;

        expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1);
        const handler = win.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as
            | ((details: { url: string }) => { action: string })
            | undefined;
        expect(handler?.({ url: 'https://evil.example.com' })).toEqual({ action: 'deny' });
    });

    it('prevents navigation to external URLs via will-navigate (WARN-3)', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        }) as unknown as FakeBrowserWindow;

        // Find the will-navigate handler registered via webContents.on
        const onCalls = win.webContents.on.mock.calls as readonly (readonly [
            string,
            ...unknown[],
        ])[];
        const willNavCall = onCalls.find(([event]) => event === 'will-navigate');
        expect(willNavCall).toBeDefined();

        // External URL: preventDefault must be called
        const preventDefault = vi.fn();
        const externalEvent = { preventDefault };
        const handler = willNavCall?.[1] as (
            event: { preventDefault(): void },
            url: string,
        ) => void;
        handler(externalEvent, 'https://evil.example.com/');
        expect(preventDefault).toHaveBeenCalledTimes(1);

        // file:// URL: preventDefault must NOT be called
        const safeEvent = { preventDefault: vi.fn() };
        handler(safeEvent, 'file:///renderer/out/index.html');
        expect(safeEvent.preventDefault).not.toHaveBeenCalled();
    });

    it('registers a did-fail-load handler on webContents (WARN-6)', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
        }) as unknown as FakeBrowserWindow;

        const onCalls = win.webContents.on.mock.calls as readonly (readonly [
            string,
            ...unknown[],
        ])[];
        const failLoadCall = onCalls.find(([event]) => event === 'did-fail-load');
        expect(failLoadCall).toBeDefined();
    });
});

describe('resolveChimeraEnv', () => {
    it('returns "development" when CHIMERA_ENV=development', () => {
        expect(resolveChimeraEnv('development')).toBe('development');
    });

    it('returns "production" when CHIMERA_ENV=production', () => {
        expect(resolveChimeraEnv('production')).toBe('production');
    });

    it('defaults to "production" when CHIMERA_ENV is undefined', () => {
        expect(resolveChimeraEnv(undefined)).toBe('production');
    });

    it('defaults to "production" for an unrecognised value', () => {
        expect(resolveChimeraEnv('staging')).toBe('production');
    });
});

describe('registerAppLifecycle', () => {
    const handlers = new Map<string, AppEventHandler>();

    beforeEach(() => {
        handlers.clear();
        appOn.mockImplementation((event, handler) => {
            handlers.set(event, handler);
        });
    });

    it('quits the app on window-all-closed when platform is linux', () => {
        registerAppLifecycle({
            app: { on: appOn, quit: appQuit },
            platform: 'linux',
            getOpenWindowCount: () => 0,
            createWindow: vi.fn(),
        });

        handlers.get('window-all-closed')?.();

        expect(appQuit).toHaveBeenCalledTimes(1);
    });

    it('quits the app on window-all-closed when platform is win32', () => {
        registerAppLifecycle({
            app: { on: appOn, quit: appQuit },
            platform: 'win32',
            getOpenWindowCount: () => 0,
            createWindow: vi.fn(),
        });

        handlers.get('window-all-closed')?.();

        expect(appQuit).toHaveBeenCalledTimes(1);
    });

    it('does not quit on window-all-closed when platform is darwin', () => {
        registerAppLifecycle({
            app: { on: appOn, quit: appQuit },
            platform: 'darwin',
            getOpenWindowCount: () => 0,
            createWindow: vi.fn(),
        });

        handlers.get('window-all-closed')?.();

        expect(appQuit).not.toHaveBeenCalled();
    });

    it('re-creates a window on activate when no windows are open', () => {
        const createWindow = vi.fn();
        registerAppLifecycle({
            app: { on: appOn, quit: appQuit },
            platform: 'darwin',
            getOpenWindowCount: () => 0,
            createWindow,
        });

        handlers.get('activate')?.();

        expect(createWindow).toHaveBeenCalledTimes(1);
    });

    it('does not create a window on activate when one is already open', () => {
        const createWindow = vi.fn();
        registerAppLifecycle({
            app: { on: appOn, quit: appQuit },
            platform: 'darwin',
            getOpenWindowCount: () => 1,
            createWindow,
        });

        handlers.get('activate')?.();

        expect(createWindow).not.toHaveBeenCalled();
    });

    it('registers exactly the window-all-closed and activate listeners', () => {
        registerAppLifecycle({
            app: { on: appOn, quit: appQuit },
            platform: 'darwin',
            getOpenWindowCount: () => 0,
            createWindow: vi.fn(),
        });

        const registeredEvents = appOn.mock.calls.map(([event]) => event);
        expect(registeredEvents).toEqual(expect.arrayContaining(['window-all-closed', 'activate']));
    });
});

describe('registerCleanExitIpc', () => {
    it('registers chimera:system:was-clean-exit handler returning the captured flag', async () => {
        const handlers = new Map<string, () => unknown>();
        const ipcMain = {
            handle: vi.fn((channel: string, handler: () => unknown) => {
                handlers.set(channel, handler);
            }),
        };

        registerCleanExitIpc({ ipcMain, wasCleanExit: true });

        const handler = handlers.get('chimera:system:was-clean-exit');
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.())).resolves.toBe(true);
    });

    it('returns false when startup observed a missing flag', async () => {
        const handlers = new Map<string, () => unknown>();
        const ipcMain = {
            handle: vi.fn((channel: string, handler: () => unknown) => {
                handlers.set(channel, handler);
            }),
        };

        registerCleanExitIpc({ ipcMain, wasCleanExit: false });

        const handler = handlers.get('chimera:system:was-clean-exit');
        await expect(Promise.resolve(handler?.())).resolves.toBe(false);
    });
});

describe('main', () => {
    beforeEach(() => {
        browserWindowInstances.length = 0;
        appOn.mockClear();
        appQuit.mockClear();
        appWhenReady.mockClear();
        appWhenReady.mockImplementation(() => Promise.resolve());
        appGetPath.mockClear();
        appGetPath.mockImplementation(() => '/tmp/chimera-userData-fake');
        ipcMainHandle.mockClear();
        fsExistsSync.mockClear();
        fsWriteFileSync.mockClear();
        fsUnlinkSync.mockClear();
        mockSaveManagerClearFlag.mockClear();
        mockSaveManagerClearFlag.mockImplementation(() => Promise.resolve(false));
        mockSaveManagerMarkExit.mockClear();
        mockSaveManagerCheckCrash.mockClear();
        mockSaveManagerCheckCrash.mockImplementation(() => Promise.resolve(null));
        mockRegisterCrashReporter.mockClear();
        capturedSaveManagerRepoClassName.value = '';
    });

    it('constructs SaveManager with FileSaveRepository, not InMemorySaveRepository (BLOCK-1)', async () => {
        await main();

        expect(capturedSaveManagerRepoClassName.value).toBe('FileSaveRepository');
    });

    it('does not call fsExistsSync — only the async SaveManager path owns the clean-exit flag', async () => {
        await main();
        expect(fsExistsSync).not.toHaveBeenCalled();
    });

    it('registers the clean-exit IPC handler before opening any window', async () => {
        await main();

        expect(ipcMainHandle).toHaveBeenCalledWith(
            'chimera:system:was-clean-exit',
            expect.any(Function),
        );
    });

    it('registers the before-quit clean-exit hook via SaveManager', async () => {
        await main();

        expect(appOn).toHaveBeenCalledWith('before-quit', expect.any(Function));
    });

    it('registers the window-all-closed and activate lifecycle listeners', async () => {
        await main();

        const events = appOn.mock.calls.map(([event]) => event);
        expect(events).toContain('window-all-closed');
        expect(events).toContain('activate');
    });

    it('creates the main window when whenReady resolves', async () => {
        let resolveReady: () => void = () => {
            // assigned synchronously below
        };
        appWhenReady.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveReady = resolve;
                }),
        );

        const mainPromise = main();
        // Await main() so app.whenReady() has been called and resolveReady
        // is wired to the real promise resolve before we trigger it.
        await mainPromise;

        expect(browserWindowInstances).toHaveLength(0);
        resolveReady();
        await Promise.resolve();

        expect(browserWindowInstances).toHaveLength(1);
        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.contextIsolation).toBe(true);
        expect(win?.options.webPreferences?.nodeIntegration).toBe(false);
    });

    it('propagates wasCleanExit=true when SaveManager.clearCleanExitFlag returns true', async () => {
        mockSaveManagerClearFlag.mockImplementation(() => Promise.resolve(true));
        const handlers = new Map<string, () => unknown>();
        ipcMainHandle.mockImplementation((channel, handler) => {
            handlers.set(channel, handler);
        });

        await main();

        const handler = handlers.get('chimera:system:was-clean-exit');
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.())).resolves.toBe(true);
    });

    it('propagates wasCleanExit=false when SaveManager.clearCleanExitFlag returns false', async () => {
        mockSaveManagerClearFlag.mockImplementation(() => Promise.resolve(false));
        const handlers = new Map<string, () => unknown>();
        ipcMainHandle.mockImplementation((channel, handler) => {
            handlers.set(channel, handler);
        });

        await main();

        const handler = handlers.get('chimera:system:was-clean-exit');
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.())).resolves.toBe(false);
    });

    it('wires the BrowserWindow preload script to electron/preload/api.js', async () => {
        let resolveReady: () => void = () => {
            // assigned synchronously below
        };
        appWhenReady.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    resolveReady = resolve;
                }),
        );

        await main();
        // app.whenReady() has now been called; resolveReady is wired.
        resolveReady();
        await Promise.resolve();

        const [win] = browserWindowInstances;
        // Invariant: the preload entry is the composed bridge in
        // `electron/preload/api.ts` (compiled to `api.js`). Accepting any
        // other filename would mean the renderer is wired to a bridge that
        // is not the one guarded by the typed ChimeraAPI surface.
        expect(win?.options.webPreferences?.preload).toMatch(/[/\\]preload[/\\]api\.js$/);
    });

    it('passes a non-undefined autosave callback to registerCrashReporter', async () => {
        await main();

        expect(mockRegisterCrashReporter).toHaveBeenCalledOnce();
        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        expect(options?.autosave).toBeDefined();
    });

    it('autosave callback resolves without throwing (TODO F18 stub)', async () => {
        await main();

        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        expect(options?.autosave).toBeDefined();
        await expect(options?.autosave?.()).resolves.toBeUndefined();
    });

    it('calls checkCrashRecovery with ["tactics"] as knownGameIds (BLOCK-2)', async () => {
        await main();

        expect(mockSaveManagerCheckCrash).toHaveBeenCalledWith(['tactics']);
    });

    it('calls session.defaultSession.setPermissionRequestHandler with a deny-all handler (WARN-4)', async () => {
        await main();

        expect(mockSetPermissionRequestHandler).toHaveBeenCalledTimes(1);
        const handler = mockSetPermissionRequestHandler.mock.calls[0]?.[0] as
            | ((
                  webContents: unknown,
                  permission: string,
                  callback: (allow: boolean) => void,
              ) => void)
            | undefined;
        expect(handler).toBeDefined();

        // All permissions must be denied
        const callback = vi.fn<(allow: boolean) => void>();
        handler?.({}, 'microphone', callback);
        expect(callback).toHaveBeenCalledWith(false);

        callback.mockClear();
        handler?.({}, 'notifications', callback);
        expect(callback).toHaveBeenCalledWith(false);
    });
});

// ─── registerSaveManagerLifecycle ────────────────────────────────────────────

describe('registerSaveManagerLifecycle', () => {
    it('calls clearCleanExitFlag() once at startup', async () => {
        const saveManager = {
            clearCleanExitFlag: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
            markCleanExit: vi.fn<() => Promise<void>>(() => Promise.resolve()),
            checkCrashRecovery: vi.fn<(gameIds: readonly string[]) => Promise<null>>(() =>
                Promise.resolve(null),
            ),
        };
        const fakeApp = { on: vi.fn() };

        await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager,
            knownGameIds: [],
        });

        expect(saveManager.clearCleanExitFlag).toHaveBeenCalledTimes(1);
    });

    it('registers markCleanExit on before-quit', async () => {
        const markCleanExit = vi.fn<() => Promise<void>>(() => Promise.resolve());
        const beforeQuitHandlers: (() => void)[] = [];
        const fakeApp = {
            on: vi.fn((event: string, handler: () => void) => {
                if (event === 'before-quit') beforeQuitHandlers.push(handler);
            }),
        };

        await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager: {
                clearCleanExitFlag: vi.fn(() => Promise.resolve(false)),
                markCleanExit,
                checkCrashRecovery: vi.fn(() => Promise.resolve(null)),
            },
            knownGameIds: [],
        });

        expect(beforeQuitHandlers).toHaveLength(1);
        beforeQuitHandlers[0]?.();
        await Promise.resolve();
        expect(markCleanExit).toHaveBeenCalledTimes(1);
    });

    it('calls checkCrashRecovery with the supplied knownGameIds', async () => {
        const checkCrashRecovery = vi.fn<(ids: readonly string[]) => Promise<null>>(() =>
            Promise.resolve(null),
        );
        const fakeApp = { on: vi.fn() };

        await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager: {
                clearCleanExitFlag: vi.fn(() => Promise.resolve(false)),
                markCleanExit: vi.fn(() => Promise.resolve()),
                checkCrashRecovery,
            },
            knownGameIds: ['tactics', 'chess'],
        });

        expect(checkCrashRecovery).toHaveBeenCalledWith(['tactics', 'chess']);
    });

    it('returns autosaveMeta: null when checkCrashRecovery returns null', async () => {
        const fakeApp = { on: vi.fn() };

        const result = await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager: {
                clearCleanExitFlag: vi.fn(() => Promise.resolve(false)),
                markCleanExit: vi.fn(() => Promise.resolve()),
                checkCrashRecovery: vi.fn(() => Promise.resolve(null)),
            },
            knownGameIds: [],
        });

        expect(result.autosaveMeta).toBeNull();
    });

    it('returns autosaveMeta with the slot info when an autosave is detected', async () => {
        const meta = {
            slotId: 'tactics/autosave',
            gameId: 'tactics',
            savedAt: 1_000_000,
            turnNumber: 3,
            playerNames: ['Alice', 'Bob'] as readonly string[],
            schemaVersion: 1,
            sizeBytes: 512,
        };
        const fakeApp = { on: vi.fn() };

        const result = await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager: {
                clearCleanExitFlag: vi.fn(() => Promise.resolve(false)),
                markCleanExit: vi.fn(() => Promise.resolve()),
                checkCrashRecovery: vi.fn(() => Promise.resolve(meta)),
            },
            knownGameIds: ['tactics'],
        });

        expect(result.autosaveMeta).toStrictEqual(meta);
    });

    it('returns wasCleanExit: true when clearCleanExitFlag returns true', async () => {
        const fakeApp = { on: vi.fn() };

        const result = await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager: {
                clearCleanExitFlag: vi.fn(() => Promise.resolve(true)),
                markCleanExit: vi.fn(() => Promise.resolve()),
                checkCrashRecovery: vi.fn(() => Promise.resolve(null)),
            },
            knownGameIds: [],
        });

        expect(result.wasCleanExit).toBe(true);
    });

    it('returns wasCleanExit: false when clearCleanExitFlag returns false', async () => {
        const fakeApp = { on: vi.fn() };

        const result = await registerSaveManagerLifecycle({
            app: fakeApp,
            saveManager: {
                clearCleanExitFlag: vi.fn(() => Promise.resolve(false)),
                markCleanExit: vi.fn(() => Promise.resolve()),
                checkCrashRecovery: vi.fn(() => Promise.resolve(null)),
            },
            knownGameIds: [],
        });

        expect(result.wasCleanExit).toBe(false);
    });

    it('checks crash recovery BEFORE clearing the clean-exit flag (order invariant — BLOCK-2)', async () => {
        const callOrder: string[] = [];
        const saveManager = {
            clearCleanExitFlag: vi.fn(() => {
                callOrder.push('clear');
                return Promise.resolve(false);
            }),
            markCleanExit: vi.fn(() => Promise.resolve()),
            checkCrashRecovery: vi.fn(() => {
                callOrder.push('check');
                return Promise.resolve(null);
            }),
        };
        const fakeApp = { on: vi.fn() };

        await registerSaveManagerLifecycle({ app: fakeApp, saveManager, knownGameIds: [] });

        expect(callOrder).toStrictEqual(['check', 'clear']);
    });
});

// ─── parseHarnessFlags ────────────────────────────────────────────────────────

describe('parseHarnessFlags', () => {
    it('returns null when CHIMERA_DEV_HARNESS is absent', () => {
        const result = parseHarnessFlags(
            ['node', 'electron/main/index.js', '--dev-auto-host', '--dev-port=7777'],
            {},
        );
        expect(result).toBeNull();
    });

    it('returns null when CHIMERA_DEV_HARNESS is not "1"', () => {
        const result = parseHarnessFlags(['node', 'electron/main/index.js', '--dev-auto-host'], {
            CHIMERA_DEV_HARNESS: '0',
        });
        expect(result).toBeNull();
    });

    it('parses --dev-auto-host flag when CHIMERA_DEV_HARNESS=1', () => {
        const result = parseHarnessFlags(['node', 'electron/main/index.js', '--dev-auto-host'], {
            CHIMERA_DEV_HARNESS: '1',
        });
        expect(result?.autoHost).toBe(true);
    });

    it('parses --dev-port=7777 when CHIMERA_DEV_HARNESS=1', () => {
        const result = parseHarnessFlags(['node', 'electron/main/index.js', '--dev-port=7777'], {
            CHIMERA_DEV_HARNESS: '1',
        });
        expect(result?.port).toBe(7777);
    });

    it('parses --dev-auto-join flag when CHIMERA_DEV_HARNESS=1', () => {
        const result = parseHarnessFlags(['node', 'electron/main/index.js', '--dev-auto-join'], {
            CHIMERA_DEV_HARNESS: '1',
        });
        expect(result?.autoJoin).toBe(true);
    });

    it('parses --dev-game=tactics when CHIMERA_DEV_HARNESS=1', () => {
        const result = parseHarnessFlags(['node', 'electron/main/index.js', '--dev-game=tactics'], {
            CHIMERA_DEV_HARNESS: '1',
        });
        expect(result?.game).toBe('tactics');
    });
});

// ─── CHIMERA_DEV_HARNESS production guard ────────────────────────────────────

describe('main() CHIMERA_DEV_HARNESS guard', () => {
    it('throws when CHIMERA_DEV_HARNESS=1 and NODE_ENV=production', async () => {
        const origEnv = process.env;
        process.env = { ...origEnv, CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'production' };
        try {
            await expect(main()).rejects.toThrow(/CHIMERA_DEV_HARNESS.*production/i);
        } finally {
            process.env = origEnv;
        }
    });

    it('does not throw when CHIMERA_DEV_HARNESS=1 and NODE_ENV=development', async () => {
        const origEnv = process.env;
        process.env = { ...origEnv, CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'development' };
        try {
            await expect(main()).resolves.not.toThrow();
        } finally {
            process.env = origEnv;
        }
    });
});
