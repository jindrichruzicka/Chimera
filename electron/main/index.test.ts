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
    mockSaveManagerAutoSave,
    capturedSaveManagerRepoClassName,
} = vi.hoisted(() => ({
    mockSaveManagerClearFlag: vi.fn<() => Promise<boolean>>(() => Promise.resolve(false)),
    mockSaveManagerMarkExit: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    mockSaveManagerCheckCrash: vi.fn<(ids: readonly string[]) => Promise<null>>(() =>
        Promise.resolve(null),
    ),
    mockSaveManagerAutoSave: vi.fn<(file: unknown) => Promise<void>>(() => Promise.resolve()),
    // Stores the constructor name of the first arg passed to SaveManager
    // for the BLOCK-1 assertion (avoids importing the real class).
    capturedSaveManagerRepoClassName: { value: '' },
}));

vi.mock('./saves/SaveManager.js', () => ({
    SaveManager: vi.fn((repo: { constructor?: { name?: string } }) => {
        capturedSaveManagerRepoClassName.value = repo?.constructor?.name ?? '';
        return {
            clearCleanExitFlag: mockSaveManagerClearFlag,
            markCleanExit: mockSaveManagerMarkExit,
            checkCrashRecovery: mockSaveManagerCheckCrash,
            autoSave: mockSaveManagerAutoSave,
        };
    }),
}));

// ── crash-reporter mock — spy on registerCrashReporter options ────────────────
const { mockRegisterCrashReporter } = vi.hoisted(() => ({
    mockRegisterCrashReporter: vi.fn<(options: { autosave?: () => Promise<void> }) => void>(),
}));

vi.mock('./logging/crash-reporter.js', () => ({
    registerCrashReporter: mockRegisterCrashReporter,
}));

// ── SettingsManager mock — captures the broadcastFn for isDestroyed guard tests ─
type SettingsBroadcastFn = (gameId: string, settings: unknown) => void;

const { capturedSettingsBroadcastFn } = vi.hoisted(() => ({
    capturedSettingsBroadcastFn: { current: null as SettingsBroadcastFn | null },
}));

vi.mock('./settings/SettingsManager.js', () => ({
    SettingsManager: vi.fn((_repo: unknown, broadcastFn: SettingsBroadcastFn) => {
        capturedSettingsBroadcastFn.current = broadcastFn;
        return {
            registerSchema: vi.fn(),
        };
    }),
}));

// ── LobbyManager mock — captures constructor args for wiring assertions ────────
const { mockLobbyManagerCtor } = vi.hoisted(() => ({
    mockLobbyManagerCtor: vi.fn(),
}));

vi.mock('./lobby/LobbyManager.js', () => ({
    LobbyManager: mockLobbyManagerCtor,
}));

// ── LocalWebSocketProvider mock — prevents real ws server at boot ─────────────
vi.mock('../../networking/provider/local/LocalWebSocketProvider.js', () => ({
    LocalWebSocketProvider: vi.fn(() => ({})),
}));

// ── StateBroadcaster mock — verifies it is imported from the module ───────────
vi.mock('./runtime/StateBroadcaster.js', () => ({
    StateBroadcaster: vi.fn(() => ({})),
}));

// ── SimulationHost mock — captures lifecycle calls for agent-ordering tests ───
const { mockSimulationHostInstance } = vi.hoisted(() => ({
    mockSimulationHostInstance: {
        registerAgent: vi.fn<(agent: unknown) => void>(),
        onGameStart: vi.fn<(snap: unknown) => void>(),
        afterTick: vi.fn<(snap: unknown) => void>(),
        onGameEnd: vi.fn<(snap: unknown, result: unknown) => void>(),
    },
}));

vi.mock('./runtime/SimulationHost.js', () => ({
    SimulationHost: vi.fn(() => mockSimulationHostInstance),
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
    public readonly isDestroyed = vi.fn<() => boolean>(() => false);
    public readonly send = vi.fn<(channel: string, ...args: readonly unknown[]) => void>();
}

class FakeBrowserWindow {
    public readonly options: FakeBrowserWindowOptions;
    public readonly loadFile = vi.fn();
    public readonly webContents = new FakeWebContents();
    public readonly isDestroyed = vi.fn<() => boolean>(() => false);
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
const { SYSTEM_CONNECTION_STATUS_CHANNEL } = await import('../preload/apis/system-api.js');
const { createNoopLogger } = await import('./logging/logger.js');

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
            logger: createNoopLogger(),
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
            logger: createNoopLogger(),
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.webSecurity).toBe(true);
    });

    it('constructs a BrowserWindow with nodeIntegration: false', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.nodeIntegration).toBe(false);
    });

    it('wires the supplied preload path into webPreferences', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.preload).toBe(PRELOAD);
    });

    it('returns the constructed BrowserWindow', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        expect(win).toBeInstanceOf(FakeBrowserWindow);
    });

    it('injects --chimera-env=development into additionalArguments when env is development', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'development',
            logger: createNoopLogger(),
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
            logger: createNoopLogger(),
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
            logger: createNoopLogger(),
        });

        expect(win.loadFile).toHaveBeenCalledTimes(1);
        expect(win.loadFile).toHaveBeenCalledWith(RENDERER_ENTRY);
    });

    it('opens DevTools when env is development', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'development',
            logger: createNoopLogger(),
        });

        expect(win.webContents.openDevTools).toHaveBeenCalledTimes(1);
    });

    it('does not open DevTools when env is production', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        expect(win.webContents.openDevTools).not.toHaveBeenCalled();
    });

    it('calls setWindowOpenHandler with a handler that returns { action: "deny" } (WARN-2)', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
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
            logger: createNoopLogger(),
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
            logger: createNoopLogger(),
        }) as unknown as FakeBrowserWindow;

        const onCalls = win.webContents.on.mock.calls as readonly (readonly [
            string,
            ...unknown[],
        ])[];
        const failLoadCall = onCalls.find(([event]) => event === 'did-fail-load');
        expect(failLoadCall).toBeDefined();
    });

    it('calls logger.warn when renderer fails to load (Invariant #67 fix)', () => {
        const mockLogger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn<(msg: string, ctx?: Record<string, unknown>) => void>(),
            error: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(),
        };

        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: mockLogger,
        }) as unknown as FakeBrowserWindow;

        // Find and invoke the did-fail-load handler
        const onCalls = win.webContents.on.mock.calls as readonly (readonly [
            string,
            ...unknown[],
        ])[];
        const failLoadCall = onCalls.find(([event]) => event === 'did-fail-load');
        const handler = failLoadCall?.[1] as (
            event: unknown,
            errorCode: number,
            errorDescription: string,
        ) => void;

        handler({}, 500, 'ERR_INVALID_URL');

        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[chimera] renderer failed to load: 500 ERR_INVALID_URL',
        );
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
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        capturedSaveManagerRepoClassName.value = '';
        capturedSettingsBroadcastFn.current = null;
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

    it('constructs LobbyManager with a LocalWebSocketProvider (Invariant #2 wiring point)', async () => {
        mockLobbyManagerCtor.mockClear();
        await main();

        expect(mockLobbyManagerCtor).toHaveBeenCalledOnce();
        // First arg is a LocalWebSocketProvider instance (mock returns {})
        expect(mockLobbyManagerCtor.mock.calls[0]?.[0]).toBeDefined();
    });

    it('forwards lobby connection-status updates to live renderer windows', async () => {
        mockLobbyManagerCtor.mockClear();
        browserWindowInstances.length = 0;

        const liveWindow = new FakeBrowserWindow({});
        const destroyedWindow = new FakeBrowserWindow({});
        destroyedWindow.isDestroyed.mockReturnValue(true);

        await main();

        const onConnectionStatusChanged = mockLobbyManagerCtor.mock.calls[0]?.[5] as
            | ((status: 'connected' | 'connecting' | 'disconnected' | 'error') => void)
            | undefined;
        expect(onConnectionStatusChanged).toBeTypeOf('function');

        onConnectionStatusChanged?.('disconnected');

        expect(liveWindow.webContents.send).toHaveBeenCalledWith(
            SYSTEM_CONNECTION_STATUS_CHANNEL,
            'disconnected',
        );
        expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
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

    it('autosave callback resolves without throwing when no session is active (null activeSession)', async () => {
        await main();

        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        expect(options?.autosave).toBeDefined();
        await expect(options?.autosave?.()).resolves.toBeUndefined();
    });

    it('autosave callback calls saveManager.autoSave with a SaveFile when activeSession is active', async () => {
        mockLobbyManagerCtor.mockClear();
        await main();

        // Extract the onSessionHosted callback (3rd arg, index 2) passed to LobbyManager.
        const onSessionHosted = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | ((transport: {
                  onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                  onPlayerLeft(cb: (id: string) => void): () => void;
                  onActionReceived(cb: (from: string, action: unknown) => void): () => void;
              }) => () => void)
            | undefined;
        expect(onSessionHosted).toBeTypeOf('function');

        // Provide a minimal fake transport so onSessionHosted can set activeSession.
        const fakeTransport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
        };
        onSessionHosted?.(fakeTransport);

        // Now the autosave callback should route through the active session.
        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        await options?.autosave?.();

        expect(mockSaveManagerAutoSave).toHaveBeenCalledOnce();
        const calledWithFile = mockSaveManagerAutoSave.mock.calls[0]?.[0] as {
            header: { gameId: string };
        };
        expect(calledWithFile?.header?.gameId).toBe('tactics');
    });

    it('autosave callback does not call saveManager.autoSave when no session is active', async () => {
        await main();

        // No onSessionHosted called → activeSession remains null.
        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        await options?.autosave?.();

        expect(mockSaveManagerAutoSave).not.toHaveBeenCalled();
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

    it('skips webContents.send when the window isDestroyed (WARN-10)', async () => {
        await main();
        expect(capturedSettingsBroadcastFn.current).toBeDefined();

        // Set up two fake windows: one destroyed, one alive
        const deadWin = new FakeBrowserWindow({ webPreferences: {} });
        deadWin.isDestroyed.mockReturnValue(true);
        const liveWin = new FakeBrowserWindow({ webPreferences: {} });
        liveWin.isDestroyed.mockReturnValue(false);

        FakeBrowserWindow.getAllWindows.mockReturnValue([deadWin, liveWin]);

        capturedSettingsBroadcastFn.current?.('tactics', { volume: 80 });

        expect(deadWin.webContents.send).not.toHaveBeenCalled();
        expect(liveWin.webContents.send).toHaveBeenCalledTimes(1);
    });

    it('skips webContents.send when webContents isDestroyed (WARN-10)', async () => {
        await main();
        expect(capturedSettingsBroadcastFn.current).toBeDefined();

        const win = new FakeBrowserWindow({ webPreferences: {} });
        win.isDestroyed.mockReturnValue(false);
        win.webContents.isDestroyed.mockReturnValue(true);

        FakeBrowserWindow.getAllWindows.mockReturnValue([win]);

        capturedSettingsBroadcastFn.current?.('tactics', { volume: 80 });

        expect(win.webContents.send).not.toHaveBeenCalled();
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

// ─── agent ordering: onGameStart deferred until all expected players join ─────
//
// Issue #416: onGameStart was called synchronously inside onSessionHosted,
// before any onPlayerJoined events fired — so zero agents were registered at
// that point, violating SimulationHost.ts lines 82–85 contract.
//
// Fix: onGameStart is driven from within onPlayerJoined, guarded by
//   activePlayers.size >= maxPlayers (the expected player count).
//
// Invariant #17: all game state projections must route through SimulationHost /
//   AgentManager; onGameStart must fire after agents are fully wired.

describe('onSessionHosted agent-ordering: onGameStart deferred until all expected players join (Issue #416)', () => {
    let capturedPlayerJoinedCb: ((entry: { playerId: string }) => void) | null = null;

    interface OrderingTransport {
        onPlayerJoined: ReturnType<typeof vi.fn>;
        onPlayerLeft: ReturnType<typeof vi.fn>;
        onActionReceived: ReturnType<typeof vi.fn>;
    }

    function makeOrderingTransport(): OrderingTransport {
        capturedPlayerJoinedCb = null;
        return {
            onPlayerJoined: vi.fn((cb: (entry: { playerId: string }) => void) => {
                capturedPlayerJoinedCb = cb;
                return () => {};
            }),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
        };
    }

    function getSessionCallback() {
        // The 3rd arg passed to the LobbyManager constructor is the onSessionHosted callback.
        return mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | ((transport: OrderingTransport, maxPlayers: number) => (() => void) | void)
            | undefined;
    }

    beforeEach(() => {
        browserWindowInstances.length = 0;
        appOn.mockClear();
        appWhenReady.mockClear();
        appWhenReady.mockImplementation(() => Promise.resolve());
        appGetPath.mockClear();
        appGetPath.mockImplementation(() => '/tmp/chimera-userData-fake');
        ipcMainHandle.mockClear();
        fsExistsSync.mockClear();
        mockSaveManagerClearFlag.mockClear();
        mockSaveManagerClearFlag.mockImplementation(() => Promise.resolve(false));
        mockSaveManagerMarkExit.mockClear();
        mockSaveManagerCheckCrash.mockClear();
        mockSaveManagerCheckCrash.mockImplementation(() => Promise.resolve(null));
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockSimulationHostInstance.afterTick.mockClear();
        mockSimulationHostInstance.onGameEnd.mockClear();
    });

    it('onGameStart is NOT called synchronously when onSessionHosted fires (before any join)', async () => {
        await main();
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        // Invoke the session callback — no players have joined yet
        sessionCb?.(transport, 2);

        // onGameStart must not fire before any onPlayerJoined events
        expect(mockSimulationHostInstance.onGameStart).not.toHaveBeenCalled();
    });

    it('onGameStart is NOT called after only the first of two expected players joins', async () => {
        await main();
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        sessionCb?.(transport, 2);
        capturedPlayerJoinedCb?.({ playerId: 'player-1' });

        // Still one short — must not fire yet
        expect(mockSimulationHostInstance.onGameStart).not.toHaveBeenCalled();
    });

    it('onGameStart fires exactly once when all expected players have joined', async () => {
        await main();
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        sessionCb?.(transport, 2);
        capturedPlayerJoinedCb?.({ playerId: 'player-1' });
        capturedPlayerJoinedCb?.({ playerId: 'player-2' });

        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
    });

    it('every agent is registered before onGameStart fires (Invariant #17)', async () => {
        await main();
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        let agentCountAtGameStart = -1;
        mockSimulationHostInstance.onGameStart.mockImplementation(() => {
            // How many registerAgent calls have already happened?
            agentCountAtGameStart = mockSimulationHostInstance.registerAgent.mock.calls.length;
        });

        sessionCb?.(transport, 2);
        capturedPlayerJoinedCb?.({ playerId: 'player-1' });
        capturedPlayerJoinedCb?.({ playerId: 'player-2' });

        // Both agents must be registered before onGameStart is called
        expect(agentCountAtGameStart).toBe(2);
    });
});

// ─── onGameStart fires at most once: leave-then-rejoin guard ──────────────────
//
// WARN-1 / WARN-2 (review findings): the `>=` threshold allows onGameStart to
// re-fire when a player leaves and then rejoins after the count recovers.
// This describe block is the regression test that drove the fix (gameStarted flag).
//
// Fix: index.ts now uses `let gameStarted = false` inside onSessionHosted so
// onGameStart is called at most once per session, regardless of churn.

describe('onSessionHosted agent-ordering: onGameStart fires at most once on leave-then-rejoin (WARN-1 guard)', () => {
    let capturedJoinCb: ((entry: { playerId: string }) => void) | null = null;
    let capturedLeftCb: ((playerId: string) => void) | null = null;

    interface RejoinTransport {
        onPlayerJoined: ReturnType<typeof vi.fn>;
        onPlayerLeft: ReturnType<typeof vi.fn>;
        onActionReceived: ReturnType<typeof vi.fn>;
    }

    function makeRejoinTransport(): RejoinTransport {
        capturedJoinCb = null;
        capturedLeftCb = null;
        return {
            onPlayerJoined: vi.fn((cb: (entry: { playerId: string }) => void) => {
                capturedJoinCb = cb;
                return () => {};
            }),
            onPlayerLeft: vi.fn((cb: (playerId: string) => void) => {
                capturedLeftCb = cb;
                return () => {};
            }),
            onActionReceived: vi.fn(() => () => {}),
        };
    }

    function getSessionCallback() {
        return mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | ((transport: RejoinTransport, maxPlayers: number) => (() => void) | void)
            | undefined;
    }

    beforeEach(() => {
        browserWindowInstances.length = 0;
        appOn.mockClear();
        appWhenReady.mockClear();
        appWhenReady.mockImplementation(() => Promise.resolve());
        appGetPath.mockClear();
        appGetPath.mockImplementation(() => '/tmp/chimera-userData-fake');
        ipcMainHandle.mockClear();
        fsExistsSync.mockClear();
        mockSaveManagerClearFlag.mockClear();
        mockSaveManagerClearFlag.mockImplementation(() => Promise.resolve(false));
        mockSaveManagerMarkExit.mockClear();
        mockSaveManagerCheckCrash.mockClear();
        mockSaveManagerCheckCrash.mockImplementation(() => Promise.resolve(null));
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockSimulationHostInstance.afterTick.mockClear();
        mockSimulationHostInstance.onGameEnd.mockClear();
    });

    it('onGameStart fires only once when a player leaves and rejoins after threshold was met', async () => {
        await main();
        const sessionCb = getSessionCallback();
        const transport = makeRejoinTransport();

        sessionCb?.(transport, 2);
        capturedJoinCb?.({ playerId: 'player-1' });
        capturedJoinCb?.({ playerId: 'player-2' }); // threshold met → onGameStart fires once
        capturedLeftCb?.('player-2'); // drops below threshold
        capturedJoinCb?.({ playerId: 'player-2' }); // recovers — must NOT fire again

        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
    });
});
