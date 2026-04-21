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

vi.mock('electron', () => ({
    app: {
        on: appOn,
        quit: appQuit,
        whenReady: appWhenReady,
    },
    BrowserWindow: FakeBrowserWindow,
}));

const { createMainWindow, registerAppLifecycle, resolveChimeraEnv } = await import('./index.js');

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
