import { describe, it, expect, vi, beforeEach } from 'vitest';

type AppEventHandler = (...args: readonly unknown[]) => void;

interface FakeWebPreferences {
    readonly nodeIntegration?: boolean;
    readonly contextIsolation?: boolean;
    readonly preload?: string;
    readonly additionalArguments?: readonly string[];
}

interface FakeBrowserWindowOptions {
    readonly webPreferences?: FakeWebPreferences;
}

const browserWindowInstances: FakeBrowserWindow[] = [];

class FakeWebContents {
    public readonly openDevTools = vi.fn();
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
const appWhenReady = vi.fn<() => Promise<void>>(() => Promise.resolve());
const appGetPath = vi.fn<(name: string) => string>(() => '/tmp/chimera-userData-fake');
const ipcMainHandle = vi.fn<(channel: string, handler: () => unknown) => void>();
const ipcMainOn = vi.fn<(channel: string, handler: () => void) => void>();

vi.mock('electron', () => ({
    app: {
        on: appOn,
        quit: appQuit,
        whenReady: appWhenReady,
        getPath: appGetPath,
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
        handle: ipcMainHandle,
        on: ipcMainOn,
    },
}));

const fsExistsSync = vi.fn<(path: string) => boolean>(() => false);
const fsWriteFileSync = vi.fn<(path: string, data: string) => void>();
const fsUnlinkSync = vi.fn<(path: string) => void>();

vi.mock('node:fs', () => ({
    existsSync: fsExistsSync,
    writeFileSync: fsWriteFileSync,
    unlinkSync: fsUnlinkSync,
}));

const {
    createMainWindow,
    registerAppLifecycle,
    resolveChimeraEnv,
    checkCleanExitFlag,
    writeCleanExitFlag,
    registerCleanExitHook,
    registerCleanExitIpc,
    registerSaveManagerLifecycle,
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

interface FakeFs {
    readonly files: Map<string, string>;
    existsSync: (p: string) => boolean;
    writeFileSync: (p: string, data: string) => void;
    unlinkSync: (p: string) => void;
}

function makeFakeFs(initial: readonly string[] = []): FakeFs {
    const files = new Map<string, string>();
    for (const p of initial) files.set(p, '');
    return {
        files,
        existsSync: (p) => files.has(p),
        writeFileSync: (p, data) => {
            files.set(p, data);
        },
        unlinkSync: (p) => {
            files.delete(p);
        },
    };
}

const FLAG_PATH = '/abs/path/userData/lastCleanExit.flag';

describe('checkCleanExitFlag', () => {
    it('returns wasCleanExit: true when the flag file exists', () => {
        const fs = makeFakeFs([FLAG_PATH]);

        const result = checkCleanExitFlag({ flagPath: FLAG_PATH, fs });

        expect(result.wasCleanExit).toBe(true);
    });

    it('returns wasCleanExit: false when the flag file is absent', () => {
        const fs = makeFakeFs();

        const result = checkCleanExitFlag({ flagPath: FLAG_PATH, fs });

        expect(result.wasCleanExit).toBe(false);
    });

    it('deletes the flag file after reading so the next launch starts clean', () => {
        const fs = makeFakeFs([FLAG_PATH]);

        checkCleanExitFlag({ flagPath: FLAG_PATH, fs });

        expect(fs.files.has(FLAG_PATH)).toBe(false);
    });

    it('does not throw when the flag is absent and no delete is needed', () => {
        const fs = makeFakeFs();

        expect(() => checkCleanExitFlag({ flagPath: FLAG_PATH, fs })).not.toThrow();
    });
});

describe('writeCleanExitFlag', () => {
    it('writes the flag file at the configured path', () => {
        const fs = makeFakeFs();

        writeCleanExitFlag({ flagPath: FLAG_PATH, fs });

        expect(fs.files.has(FLAG_PATH)).toBe(true);
    });

    it('is idempotent: writing twice leaves a single flag', () => {
        const fs = makeFakeFs();

        writeCleanExitFlag({ flagPath: FLAG_PATH, fs });
        writeCleanExitFlag({ flagPath: FLAG_PATH, fs });

        expect(fs.files.has(FLAG_PATH)).toBe(true);
    });
});

describe('registerCleanExitHook', () => {
    it('writes the flag when before-quit fires', () => {
        const fs = makeFakeFs();
        const beforeQuitHandlers: (() => void)[] = [];
        const host = {
            on: vi.fn((event: string, handler: () => void) => {
                if (event === 'before-quit') beforeQuitHandlers.push(handler);
            }),
        };

        registerCleanExitHook({ app: host, flagPath: FLAG_PATH, fs });
        beforeQuitHandlers.forEach((h) => h());

        expect(fs.files.has(FLAG_PATH)).toBe(true);
    });

    it('registers the before-quit listener exactly once', () => {
        const fs = makeFakeFs();
        const host = { on: vi.fn() };

        registerCleanExitHook({ app: host, flagPath: FLAG_PATH, fs });

        const events = host.on.mock.calls.map(([event]) => event);
        expect(events.filter((e) => e === 'before-quit')).toHaveLength(1);
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
        fsExistsSync.mockImplementation(() => false);
        fsWriteFileSync.mockClear();
        fsUnlinkSync.mockClear();
    });

    it('consults the clean-exit flag under app.getPath("userData")', () => {
        main();

        expect(appGetPath).toHaveBeenCalledWith('userData');
        expect(fsExistsSync).toHaveBeenCalledTimes(1);
        const [checkedPath] = fsExistsSync.mock.calls[0] ?? [];
        expect(checkedPath).toMatch(/lastCleanExit\.flag$/);
    });

    it('registers the clean-exit IPC handler before opening any window', () => {
        main();

        expect(ipcMainHandle).toHaveBeenCalledWith(
            'chimera:system:was-clean-exit',
            expect.any(Function),
        );
        // whenReady resolves asynchronously; at the synchronous end of main()
        // no window must have been created yet.
        expect(browserWindowInstances).toHaveLength(0);
    });

    it('registers the before-quit clean-exit hook', () => {
        main();

        expect(appOn).toHaveBeenCalledWith('before-quit', expect.any(Function));
    });

    it('registers the window-all-closed and activate lifecycle listeners', () => {
        main();

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

        main();

        expect(browserWindowInstances).toHaveLength(0);
        resolveReady();
        await Promise.resolve();

        expect(browserWindowInstances).toHaveLength(1);
        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.contextIsolation).toBe(true);
        expect(win?.options.webPreferences?.nodeIntegration).toBe(false);
    });

    it('propagates wasCleanExit=true when the flag is present on disk', async () => {
        fsExistsSync.mockImplementation(() => true);
        const handlers = new Map<string, () => unknown>();
        ipcMainHandle.mockImplementation((channel, handler) => {
            handlers.set(channel, handler);
        });

        main();

        expect(fsUnlinkSync).toHaveBeenCalledTimes(1);
        const handler = handlers.get('chimera:system:was-clean-exit');
        expect(handler).toBeDefined();
        await expect(Promise.resolve(handler?.())).resolves.toBe(true);
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

        main();
        resolveReady();
        await Promise.resolve();

        const [win] = browserWindowInstances;
        // Invariant: the preload entry is the composed bridge in
        // `electron/preload/api.ts` (compiled to `api.js`). Accepting any
        // other filename would mean the renderer is wired to a bridge that
        // is not the one guarded by the typed ChimeraAPI surface.
        expect(win?.options.webPreferences?.preload).toMatch(/[/\\]preload[/\\]api\.js$/);
    });
});

// ─── registerSaveManagerLifecycle ────────────────────────────────────────────

describe('registerSaveManagerLifecycle', () => {
    it('calls clearCleanExitFlag() once at startup', async () => {
        const saveManager = {
            clearCleanExitFlag: vi.fn<() => Promise<void>>(() => Promise.resolve()),
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
                clearCleanExitFlag: vi.fn(() => Promise.resolve()),
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
                clearCleanExitFlag: vi.fn(() => Promise.resolve()),
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
                clearCleanExitFlag: vi.fn(() => Promise.resolve()),
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
                clearCleanExitFlag: vi.fn(() => Promise.resolve()),
                markCleanExit: vi.fn(() => Promise.resolve()),
                checkCrashRecovery: vi.fn(() => Promise.resolve(meta)),
            },
            knownGameIds: ['tactics'],
        });

        expect(result.autosaveMeta).toStrictEqual(meta);
    });

    it('checks crash recovery BEFORE clearing the clean-exit flag (order invariant — BLOCK-2)', async () => {
        const callOrder: string[] = [];
        const saveManager = {
            clearCleanExitFlag: vi.fn(() => {
                callOrder.push('clear');
                return Promise.resolve();
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
