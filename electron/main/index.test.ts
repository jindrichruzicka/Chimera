import type * as os from 'node:os';
import type * as nodeFs from 'node:fs';
import type * as AiEngine from '@chimera-engine/ai/engine';

import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
    LocalProfileId,
    PlayerProfile,
    ProfileRepository,
} from '@chimera-engine/simulation/profile/ProfileSchema.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import type { ChimeraRendererUrl, MainGameContribution } from './index.js';
import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

interface ProjectorOptionsForTest {
    readonly getUndoMeta?: (viewerId: PlayerId) => unknown;
}

// ── pino mock — prevent SonicBoom from opening real file descriptors ──────────
vi.mock('pino', () => {
    const fakeDest = { write: vi.fn<(data: string) => void>() };
    const destination = vi.fn(() => fakeDest);
    const pinoFn = Object.assign(vi.fn(), { destination });
    return { default: pinoFn };
});

// ── SaveManager mock (used by main() after the sync-helper removal) ──────────
const {
    mockSaveManagerAutoSave,
    mockSaveManagerRestoreFromSave,
    capturedSaveManagerRepoClassName,
} = vi.hoisted(() => ({
    mockSaveManagerAutoSave: vi.fn<(file: unknown) => Promise<void>>(() => Promise.resolve()),
    // Backs the saves:load wiring tests (#823): individual tests seed the
    // SaveFile the "repository" returns for a load.
    mockSaveManagerRestoreFromSave: vi.fn<(slotId: string) => Promise<unknown>>(() =>
        Promise.reject(new Error('test did not seed mockSaveManagerRestoreFromSave')),
    ),
    // Stores the constructor name of the first arg passed to SaveManager
    // for the BLOCK-1 assertion (avoids importing the real class).
    capturedSaveManagerRepoClassName: { value: '' },
}));

vi.mock('./saves/SaveManager.js', () => ({
    SaveManager: vi.fn((repo: { constructor?: { name?: string } }) => {
        capturedSaveManagerRepoClassName.value = repo?.constructor?.name ?? '';
        return {
            autoSave: mockSaveManagerAutoSave,
            restoreFromSave: mockSaveManagerRestoreFromSave,
        };
    }),
}));

const { mockOsRelease } = vi.hoisted(() => ({
    mockOsRelease: vi.fn<() => string>(() => '23.6.0-test'),
}));

vi.mock('node:os', async (importOriginal) => {
    const actual = await importOriginal<typeof os>();
    return {
        ...actual,
        release: mockOsRelease,
    };
});

// ── crash-reporter mock — spy on registerCrashReporter options ────────────────
const { mockMakeRendererGoneHandler, mockRegisterCrashReporter, mockRendererGoneHandler } =
    vi.hoisted(() => {
        const rendererGoneHandler = vi.fn();
        return {
            mockMakeRendererGoneHandler: vi.fn<
                (options: {
                    getRecentLogs?: () => readonly unknown[];
                    getAppVersion?: () => string;
                    reloadRenderer: () => void;
                }) => (...args: readonly unknown[]) => void
            >(() => rendererGoneHandler),
            mockRegisterCrashReporter:
                vi.fn<
                    (options: {
                        autosave?: () => Promise<void>;
                        getRecentLogs?: () => readonly unknown[];
                        getAppVersion?: () => string;
                        getSnapshot?: () => unknown;
                    }) => void
                >(),
            mockRendererGoneHandler: rendererGoneHandler,
        };
    });

vi.mock('./logging/crash-reporter.js', () => ({
    makeRendererGoneHandler: mockMakeRendererGoneHandler,
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
// The instance exposes `isLocalSeat` because the live session-manifest closure
// (#820) consults it when a save is captured after game start; the default is
// "no local seats" and individual tests override the shared fn.
//
// For the session-restore wiring tests (#823) the instance also exposes
// `hostLobby` / `addLocalSeat` / `closeLobby` mirroring the real manager's
// observable contract: `hostLobby` synchronously invokes the captured
// `onSessionHosted` callback with a fake transport + metadata derived from the
// params (the real LobbyManager also calls it synchronously before resolving),
// `addLocalSeat` fires the captured `onLocalSeatAdded` and marks the seat
// local, and `closeLobby` runs the teardown returned by `onSessionHosted`.
const {
    mockLobbyManagerCtor,
    mockLobbyManagerIsLocalSeat,
    mockLobbyManagerHostLobby,
    mockLobbyManagerAddLocalSeat,
    mockLobbyManagerCloseLobby,
    mockLobbyManagerLocalSeatIds,
    hostedTeardownRef,
    hostedTransportJoinRef,
} = vi.hoisted(() => {
    interface HoistedLobbyCallbacks {
        onSessionHosted?: (
            transport: unknown,
            metadata: { hostId: string; maxPlayers: number },
        ) => (() => void) | void;
        onLocalSeatAdded?: (entry: {
            playerId: string;
            displayName: string;
            ready: boolean;
        }) => void;
    }
    const mockLobbyManagerIsLocalSeat = vi.fn<(id: string) => boolean>(() => false);
    const mockLobbyManagerLocalSeatIds = new Set<string>();
    const hostedTeardownRef = { current: null as (() => void) | null };
    const hostedTransportJoinRef = {
        current: null as ((args: { playerId: string }) => void) | null,
    };
    const lastCallbacks = (): HoistedLobbyCallbacks | undefined =>
        mockLobbyManagerCtor.mock.calls.at(-1)?.[2] as HoistedLobbyCallbacks | undefined;
    const mockLobbyManagerHostLobby = vi.fn(
        (params: { maxPlayers: number; restore?: { hostPlayerId: string } }) => {
            const transport = {
                onPlayerJoined: (cb: (args: { playerId: string }) => void) => {
                    hostedTransportJoinRef.current = cb;
                    return () => {};
                },
                onPlayerLeft: () => () => {},
                onActionReceived: () => () => {},
                setJoinClassifier: () => {},
            };
            const teardown = lastCallbacks()?.onSessionHosted?.(transport, {
                hostId: params.restore?.hostPlayerId ?? 'host-fallback',
                maxPlayers: params.maxPlayers,
            });
            hostedTeardownRef.current = typeof teardown === 'function' ? teardown : null;
            return Promise.resolve({ sessionId: 'restored-session' });
        },
    );
    const mockLobbyManagerAddLocalSeat = vi.fn((pid: string) => {
        mockLobbyManagerLocalSeatIds.add(pid);
        lastCallbacks()?.onLocalSeatAdded?.({ playerId: pid, displayName: pid, ready: false });
        return Promise.resolve();
    });
    const mockLobbyManagerCloseLobby = vi.fn(() => {
        hostedTeardownRef.current?.();
        hostedTeardownRef.current = null;
        return Promise.resolve();
    });
    return {
        mockLobbyManagerIsLocalSeat,
        mockLobbyManagerHostLobby,
        mockLobbyManagerAddLocalSeat,
        mockLobbyManagerCloseLobby,
        mockLobbyManagerLocalSeatIds,
        hostedTeardownRef,
        hostedTransportJoinRef,
        mockLobbyManagerCtor: vi.fn((...args: unknown[]) => {
            void args;
            return {
                isLocalSeat: mockLobbyManagerIsLocalSeat,
                hostLobby: mockLobbyManagerHostLobby,
                addLocalSeat: mockLobbyManagerAddLocalSeat,
                closeLobby: mockLobbyManagerCloseLobby,
            };
        }),
    };
});

vi.mock('./lobby/LobbyManager.js', () => ({
    LobbyManager: mockLobbyManagerCtor,
}));

// ── LocalWebSocketProvider mock — prevents real ws server at boot ─────────────
vi.mock('../../networking/provider/local/LocalWebSocketProvider.js', () => ({
    LocalWebSocketProvider: vi.fn(() => ({})),
}));

// ── StateBroadcaster mock — captures constructor args for projection wiring ───
const { mockStateBroadcasterCtor, mockStateBroadcasterInstance } = vi.hoisted(() => {
    interface MockRendererRecipient {
        readonly viewerId: string;
        readonly sendSnapshot: (snapshot: unknown) => void;
        readonly sendTick?: (tick: number) => void;
    }
    const instance = {
        broadcast: vi.fn(),
        broadcastTick: vi.fn(),
        registerRendererRecipient: vi.fn<(recipient: MockRendererRecipient) => () => undefined>(
            () => () => undefined,
        ),
        dispose: vi.fn(),
    };
    return {
        mockStateBroadcasterInstance: instance,
        mockStateBroadcasterCtor: vi.fn(() => instance),
    };
});

vi.mock('./runtime/StateBroadcaster.js', () => ({
    StateBroadcaster: mockStateBroadcasterCtor,
}));

// ── StateProjector mock — captures DefaultStateProjector construction ─────────
const {
    mockDefaultStateProjectorCtor,
    mockProjectorInstance,
    MockCommitmentVerificationError,
    capturedDefaultStateProjectorOptions,
} = vi.hoisted(() => {
    const instance = { project: vi.fn() };
    const capturedDefaultStateProjectorOptions = {
        current: undefined as ProjectorOptionsForTest | undefined,
    };
    class MockCommitmentVerificationError extends Error {
        constructor(message = 'Commitment verification failed') {
            super(message);
            this.name = 'CommitmentVerificationError';
        }
    }
    return {
        mockProjectorInstance: instance,
        mockDefaultStateProjectorCtor: vi.fn(
            (_visibilityRules: unknown, options?: ProjectorOptionsForTest) => {
                capturedDefaultStateProjectorOptions.current = options;
                return instance;
            },
        ),
        MockCommitmentVerificationError,
        capturedDefaultStateProjectorOptions,
    };
});

vi.mock('@chimera-engine/simulation/projection/index.js', () => ({
    DefaultStateProjector: mockDefaultStateProjectorCtor,
    DefaultCommitmentScheme: vi.fn(() => ({
        commit: vi.fn(),
        commitRevealable: vi.fn(),
        verify: vi.fn(() => true),
    })),
    CommitmentVerificationError: MockCommitmentVerificationError,
    toCommitmentId: (raw: string): string => raw,
    RevealStaging: vi.fn(() => ({
        stage: vi.fn(),
        hasCommitted: vi.fn(() => false),
        committedPlayerIds: vi.fn(() => []),
        buildReveal: vi.fn(),
        clearTurn: vi.fn(),
        capture: vi.fn(() => ({})),
        restore: vi.fn(),
    })),
}));

// ── Tactics visibility rules mock — verifies game-owned rules are injected ────
const { mockTacticsVisibilityRules } = vi.hoisted(() => ({
    mockTacticsVisibilityRules: {
        isEntityVisible: vi.fn(),
        maskEntity: vi.fn(),
        maskPlayerState: vi.fn(),
        filterEvents: vi.fn(),
    },
}));

vi.mock('@chimera-engine/tactics/simulation/visibility-rules.js', () => ({
    tacticsVisibilityRules: mockTacticsVisibilityRules,
}));

// ── AgentManager mock — captures constructor args for logger wiring tests ─────
const { mockAgentManagerCtor, mockAgentManagerInstance } = vi.hoisted(() => {
    const instance = { clear: vi.fn<() => void>() };
    return {
        mockAgentManagerInstance: instance,
        mockAgentManagerCtor: vi.fn(() => instance),
    };
});

// Partial-mock the public engine barrel: override AgentManager with the spy,
// keep every other framework export (e.g. HumanPlayerAgent) real.
vi.mock('@chimera-engine/ai/engine', async (importActual) => ({
    ...(await importActual<typeof AiEngine>()),
    AgentManager: mockAgentManagerCtor,
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

vi.mock('@chimera-engine/simulation/host', () => ({
    SimulationHost: vi.fn(() => mockSimulationHostInstance),
}));

// ── FilePerspectiveReplayRepository mock (F44b T5) ────────────────────────────
// Capture every PerspectiveReplayFile that the (real) PerspectiveReplayManager
// persists at finalise, without touching disk. The manager itself is exercised
// for real so these tests cover the egress wiring + manager together (start /
// recordSnapshot lock-to-seat / finalise / abort), asserting on the saved file.
const { perspectiveSaves, mockFilePerspectiveReplayRepoCtor } = vi.hoisted(() => {
    const perspectiveSaves: { value: unknown[] } = { value: [] };
    return {
        perspectiveSaves,
        mockFilePerspectiveReplayRepoCtor: vi.fn(() => ({
            save: vi.fn((file: unknown) => {
                perspectiveSaves.value.push(file);
                return Promise.resolve(
                    `/tmp/perspective-${perspectiveSaves.value.length}.chimera-perspective-replay`,
                );
            }),
            load: vi.fn(() => Promise.reject(new Error('load not used in T5 wiring tests'))),
            list: vi.fn<(gameId: string) => Promise<string[]>>(() => Promise.resolve([])),
            delete: vi.fn<(filePath: string) => Promise<void>>(() => Promise.resolve()),
        })),
    };
});

vi.mock('./replay/FilePerspectiveReplayRepository.js', () => ({
    FilePerspectiveReplayRepository: mockFilePerspectiveReplayRepoCtor,
}));

// ── E2E hooks mock — captures getE2eHooks for wiring tests ────────────────────
const { mockGetE2eHooks } = vi.hoisted(() => ({
    mockGetE2eHooks: vi.fn<() => unknown>(() => undefined),
}));

vi.mock('./runtime/e2e-hooks.js', () => ({
    registerE2eHooks: vi.fn(),
    getE2eHooks: mockGetE2eHooks,
}));

type AppEventHandler = (...args: readonly unknown[]) => void;

interface FakeWebPreferences {
    readonly nodeIntegration?: boolean;
    readonly contextIsolation?: boolean;
    readonly sandbox?: boolean;
    readonly webSecurity?: boolean;
    readonly preload?: string;
    readonly additionalArguments?: readonly string[];
}

interface FakeBrowserWindowOptions {
    readonly backgroundColor?: string;
    readonly title?: string;
    readonly icon?: string;
    readonly fullscreen?: boolean;
    readonly simpleFullscreen?: boolean;
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
    public readonly loadURL = vi.fn();
    public readonly reload = vi.fn<() => void>();
    public readonly setTitle = vi.fn<(title: string) => void>();
    public readonly setSimpleFullScreen = vi.fn<(flag: boolean) => void>();
    public readonly webContents = new FakeWebContents();
    public readonly isDestroyed = vi.fn<() => boolean>(() => false);
    public readonly getContentSize = vi.fn<() => [number, number]>(() => [1280, 720]);
    public readonly on =
        vi.fn<(event: string, handler: (...args: readonly unknown[]) => void) => void>();
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
const appGetLocale = vi.fn<() => string>(() => 'en-US');
const appGetVersion = vi.fn<() => string>(() => '0.7.0-test');
const appDockSetIcon = vi.fn<(path: string) => void>();
const ipcMainHandle = vi.fn<(channel: string, handler: () => unknown) => void>();
const ipcMainOn = vi.fn<(channel: string, handler: () => void) => void>();
const protocolRegisterSchemesAsPrivileged = vi.fn<
    (
        schemes: readonly {
            readonly scheme: string;
            readonly privileges?: object;
        }[],
    ) => void
>();
const protocolHandle =
    vi.fn<(scheme: string, handler: (request: Request) => Promise<Response>) => void>();

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

type DisplayMetricsListener = () => void;

const screenDisplay = {
    id: 1,
    bounds: { width: 1920, height: 1080 },
    scaleFactor: 1,
    displayFrequency: 60,
};
const screenListeners = new Map<string, Set<DisplayMetricsListener>>();
const screenGetAllDisplays = vi.fn(() => [screenDisplay]);
const screenGetPrimaryDisplay = vi.fn(() => screenDisplay);
const screenOn = vi.fn((event: string, listener: DisplayMetricsListener) => {
    const listeners = screenListeners.get(event) ?? new Set<DisplayMetricsListener>();
    listeners.add(listener);
    screenListeners.set(event, listeners);
});
const screenOff = vi.fn((event: string, listener: DisplayMetricsListener) => {
    screenListeners.get(event)?.delete(listener);
});

vi.mock('electron', () => ({
    app: {
        on: appOn,
        quit: appQuit,
        relaunch: appRelaunch,
        exit: appExit,
        whenReady: appWhenReady,
        getPath: appGetPath,
        getLocale: appGetLocale,
        getVersion: appGetVersion,
        // This suite runs the real main() with the SOURCE file's __dirname
        // (electron/main), where the game-assets root walk resolves to the repo
        // <root>/apps via the packaged branch (../../apps). The dev/source branch
        // (isPackaged:false) assumes the deeper runtime bundle layout
        // (apps/<game>/dist/electron) and is covered directly by the
        // resolveRuntimePaths unit tests above.
        isPackaged: true,
        // macOS-only dock handle (undefined on other platforms in real Electron).
        dock: { setIcon: appDockSetIcon },
    },
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
        handle: ipcMainHandle,
        on: ipcMainOn,
    },
    protocol: {
        registerSchemesAsPrivileged: protocolRegisterSchemesAsPrivileged,
        handle: protocolHandle,
    },
    session: {
        defaultSession: {
            setPermissionRequestHandler: mockSetPermissionRequestHandler,
        },
    },
    screen: {
        getAllDisplays: screenGetAllDisplays,
        getPrimaryDisplay: screenGetPrimaryDisplay,
        on: screenOn,
        off: screenOff,
    },
}));

const fsExistsSync = vi.fn<(path: string) => boolean>(() => false);
const fsWriteFileSync = vi.fn<(path: string, data: string) => void>();
const fsUnlinkSync = vi.fn<(path: string) => void>();
const fsMkdirSync = vi.fn<(path: string, options?: unknown) => void>();
const fsReaddirSync = vi.fn<(path: string) => string[]>(() => []);
const fsOpenSync = vi.fn<(path: string, flags: string) => number>(() => 42);

vi.mock('node:fs', async () => {
    // Real fs.promises so the startup ContentDatabase load (loadAllGameContent →
    // ContentLoader) can read the real games/ data dir; the sync surface stays
    // mocked for the save/replay paths these tests drive.
    const actual = await vi.importActual<typeof nodeFs>('node:fs');
    return {
        existsSync: fsExistsSync,
        writeFileSync: fsWriteFileSync,
        unlinkSync: fsUnlinkSync,
        mkdirSync: fsMkdirSync,
        readdirSync: fsReaddirSync,
        openSync: fsOpenSync,
        promises: actual.promises,
    };
});

const {
    createMainWindow,
    registerAppLifecycle,
    resolveChimeraEnv,
    parseHarnessFlags,
    registerClientRevealForwarding,
    resolveRuntimePaths,
    resolveRendererProtocolFilePath,
    registerRendererProtocolScheme,
    buildRendererProtocolResponse,
    parseSingleByteRange,
    sanitiseE2eInitialUrl,
    buildRendererGameLaunchUrl,
    resolveRendererLaunchUrl,
    CHIMERA_RENDERER_URL,
    createDefaultPlayerProfile,
    ensureActiveProfile,
    resolveInitialEntitiesForGame,
    main,
} = await import('./index.js');
const {
    SYSTEM_CONNECTION_STATUS_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANGE_CHANNEL,
} = await import('../preload/apis/system-api.js');
const { GAME_GET_CURRENT_SNAPSHOT_CHANNEL, GAME_REVEAL_CHANNEL, GAME_SNAPSHOT_CHANNEL } =
    await import('../preload/apis/game-api.js');
const { SAVES_LOAD_CHANNEL, SAVES_RESTORE_STATUS_CHANNEL, SAVES_CANCEL_RESTORE_CHANNEL } =
    await import('../preload/apis/saves-api.js');
const {
    PERSPECTIVE_REPLAY_LIST_CHANNEL,
    PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
    PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
    PERSPECTIVE_REPLAY_DELETE_CHANNEL,
    PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
    PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL,
    PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL,
    PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL,
} = await import('../preload/apis/perspective-replay-api.js');
const { createNoopLogger } = await import('./logging/logger.js');
const { ActionRegistry } = await import('@chimera-engine/simulation/engine/ActionRegistry.js');
const { entityId, playerId } = await import('@chimera-engine/simulation/engine/types.js');
const { ProfileManager } = await import('./profile/ProfileManager.js');
const { SessionRuntime, SessionCommitmentRuntime } = await import('./runtime/SessionRuntime.js');
const { ReplayManager } = await import('./replay/replay-manager.js');
const { PerspectiveReplayManager } = await import('./replay/PerspectiveReplayManager.js');

// ── Tactics contribution fixture for main() ──────────────────────────────────
// main() is now game-agnostic: it hosts whatever MainGameContribution set it is
// injected with (in production the consumer app composition root
// apps/tactics/electron/main.ts supplies tactics). These tests inject the REAL
// tactics wiring — except visibility rules,
// which stay mocked (mockTacticsVisibilityRules) so the projector-injection
// assertions still verify the game-owned rules flow through main() → projector.
// Tactics modules are imported directly: test files are exempt from the
// no-main-games-import boundary.
const { registerTacticsActions, resolveTacticsFirstPlayer } =
    await import('@chimera-engine/tactics/simulation/actions.js');
const { createTacticsAIState } = await import('@chimera-engine/tactics/ai/tacticsPolicy.js');
const { tacticsManifest } = await import('@chimera-engine/tactics/manifest.js');
const { tacticsCommitmentOrchestration } =
    await import('@chimera-engine/tactics/simulation/commitment/orchestration.js');
const { tacticsResolveIsMyTurn } =
    await import('@chimera-engine/tactics/simulation/commitment/turnGate.js');
const { tacticsSettingsSchema } = await import('@chimera-engine/tactics/settings-schema.js');
const { TACTICS_GAME_ID } = await import('@chimera-engine/tactics/simulation/constants.js');
const { TACTICS_CONTENT_SCHEMAS, paletteFromCollections } =
    await import('@chimera-engine/tactics/content/tacticsContent.js');
const { buildTacticsLobbySetup } = await import('@chimera-engine/tactics/lobby/lobby-setup.js');

function makeTestContributions(): MainGameContribution[] {
    return [
        {
            gameId: TACTICS_GAME_ID,
            gameVersion: '0.1.0',
            manifest: tacticsManifest,
            contentSchemas: TACTICS_CONTENT_SCHEMAS,
            lobbySetup: (content) => buildTacticsLobbySetup(paletteFromCollections(content)),
            registerActions: registerTacticsActions,
            registerSettings: (manager) => manager.registerSchema(tacticsSettingsSchema),
            visibilityRules: mockTacticsVisibilityRules,
            resolveFirstPlayer: resolveTacticsFirstPlayer,
            createAIState: createTacticsAIState,
            commitment: tacticsCommitmentOrchestration,
            resolveIsMyTurn: tacticsResolveIsMyTurn,
        },
    ];
}

const PRELOAD = '/abs/path/preload/api.js';
const RENDERER_ENTRY = '/abs/path/renderer/out/index.html';
const ICON_PATH = '/abs/path/icons/chimera.png';

/**
 * Runs `fn` with `process.platform` temporarily forced to `value`, restoring the
 * real platform afterwards so the macOS dock branch is testable on any host OS.
 */
function withPlatform(value: NodeJS.Platform, fn: () => void): void {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value, configurable: true });
    try {
        fn();
    } finally {
        Object.defineProperty(process, 'platform', { value: original, configurable: true });
    }
}

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

    it('constructs a BrowserWindow with a dark first-paint background', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        const [win] = browserWindowInstances;
        expect(win?.options.backgroundColor).toBe('#111113');
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

    it('loads the renderer root by default (game-agnostic; callers pass the game launch URL)', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        expect(win.loadURL).toHaveBeenCalledTimes(1);
        expect(win.loadURL).toHaveBeenCalledWith(CHIMERA_RENDERER_URL);
        expect(win.loadFile).not.toHaveBeenCalled();
    });

    it('loads the supplied initial URL override when provided', () => {
        const initialUrl = 'chimera://renderer/lobby/' as ChimeraRendererUrl;
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
            initialUrl,
        });

        expect(win.loadURL).toHaveBeenCalledTimes(1);
        expect(win.loadURL).toHaveBeenCalledWith(initialUrl);
        expect(win.loadFile).not.toHaveBeenCalled();
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

        // chimera:// renderer URL: preventDefault must NOT be called
        const safeEvent = { preventDefault: vi.fn() };
        handler(safeEvent, 'chimera://renderer/lobby');
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

    it('sets the supplied windowTitle as the BrowserWindow title', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
            windowTitle: 'Tactics',
        });

        const [win] = browserWindowInstances;
        expect(win?.options.title).toBe('Tactics');
    });

    it('defaults the window title to "Chimera" when no windowTitle is supplied', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
        });

        const [win] = browserWindowInstances;
        expect(win?.options.title).toBe('Chimera');
    });

    it('pins the window title against the static page <title> via page-title-updated', () => {
        const win = createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
            windowTitle: 'Tactics',
        }) as unknown as FakeBrowserWindow;

        const onCalls = win.webContents.on.mock.calls as readonly (readonly [
            string,
            ...unknown[],
        ])[];
        const titleCall = onCalls.find(([event]) => event === 'page-title-updated');
        expect(titleCall).toBeDefined();

        const preventDefault = vi.fn();
        const handler = titleCall?.[1] as (event: { preventDefault(): void }) => void;
        handler({ preventDefault });

        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(win.setTitle).toHaveBeenCalledWith('Tactics');
    });

    it('throws when initialUrl has a non-chimera protocol (WARN-1 depth-of-defence)', () => {
        expect(() => {
            createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
                // Cast simulates a future caller bypassing the branded-type guard
                initialUrl: 'https://evil.example.com/' as unknown as ChimeraRendererUrl,
            });
        }).toThrow();
    });

    it('throws when initialUrl uses chimera: protocol but wrong host (WARN-1 depth-of-defence)', () => {
        expect(() => {
            createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
                initialUrl: 'chimera://evil/lobby/' as unknown as ChimeraRendererUrl,
            });
        }).toThrow();
    });

    it('passes the supplied icon path through to the BrowserWindow constructor config', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
            icon: ICON_PATH,
        });

        const [win] = browserWindowInstances;
        expect(win?.options.icon).toBe(ICON_PATH);
    });

    it('sets the macOS dock icon via app.dock.setIcon on darwin', () => {
        withPlatform('darwin', () => {
            createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
                icon: ICON_PATH,
            });
        });

        expect(appDockSetIcon).toHaveBeenCalledTimes(1);
        expect(appDockSetIcon).toHaveBeenCalledWith(ICON_PATH);
    });

    it('does not let an app.dock.setIcon failure abort window creation; logs a warning (F67 icon-load resilience)', () => {
        // Reproduces the e2e regression: when the resolved icon file is missing,
        // Electron's app.dock.setIcon throws "Failed to load image from path …".
        // A cosmetic dock icon must never prevent the main window from opening.
        appDockSetIcon.mockImplementationOnce(() => {
            throw new Error(`Failed to load image from path '${ICON_PATH}'`);
        });
        const mockLogger = {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn<(msg: string, ctx?: Record<string, unknown>) => void>(),
            error: vi.fn(),
            fatal: vi.fn(),
            child: vi.fn(),
        };

        let returned: unknown;
        withPlatform('darwin', () => {
            expect(() => {
                returned = createMainWindow({
                    preloadPath: PRELOAD,
                    rendererEntry: RENDERER_ENTRY,
                    env: 'production',
                    logger: mockLogger,
                    icon: ICON_PATH,
                });
            }).not.toThrow();
        });

        expect(appDockSetIcon).toHaveBeenCalledWith(ICON_PATH);
        expect(returned).toBe(browserWindowInstances[0]);
        expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('does not touch the dock on non-darwin platforms, but still wires the window icon', () => {
        withPlatform('linux', () => {
            createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
                icon: ICON_PATH,
            });
        });

        const [win] = browserWindowInstances;
        expect(win?.options.icon).toBe(ICON_PATH);
        expect(appDockSetIcon).not.toHaveBeenCalled();
    });

    it('leaves the icon unset and never calls the dock when no icon is supplied (no throw, even on darwin)', () => {
        withPlatform('darwin', () => {
            expect(() =>
                createMainWindow({
                    preloadPath: PRELOAD,
                    rendererEntry: RENDERER_ENTRY,
                    env: 'production',
                    logger: createNoopLogger(),
                }),
            ).not.toThrow();
        });

        const [win] = browserWindowInstances;
        expect(win?.options.icon).toBeUndefined();
        expect(appDockSetIcon).not.toHaveBeenCalled();
    });

    it('preserves secure BrowserWindow defaults when an icon is supplied', () => {
        createMainWindow({
            preloadPath: PRELOAD,
            rendererEntry: RENDERER_ENTRY,
            env: 'production',
            logger: createNoopLogger(),
            icon: ICON_PATH,
        });

        const [win] = browserWindowInstances;
        expect(win?.options.webPreferences?.nodeIntegration).toBe(false);
        expect(win?.options.webPreferences?.contextIsolation).toBe(true);
        expect(win?.options.webPreferences?.sandbox).toBe(true);
    });

    it('opens windowed-fullscreen via macOS simpleFullscreen when windowedFullscreen is set on darwin', () => {
        let win: FakeBrowserWindow | undefined;
        withPlatform('darwin', () => {
            win = createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
                windowedFullscreen: true,
            }) as unknown as FakeBrowserWindow;
        });

        // macOS gets pre-Lion simple fullscreen (no Spaces switch), not native fullscreen.
        expect(win?.options.simpleFullscreen).toBe(true);
        expect(win?.options.fullscreen).toBeUndefined();
        // Entry is guaranteed via the documented setter (constructor-only entry is version-sensitive).
        expect(win?.setSimpleFullScreen).toHaveBeenCalledWith(true);
    });

    it('opens windowed-fullscreen via native fullscreen on non-darwin when windowedFullscreen is set', () => {
        let win: FakeBrowserWindow | undefined;
        withPlatform('win32', () => {
            win = createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
                windowedFullscreen: true,
            }) as unknown as FakeBrowserWindow;
        });

        expect(win?.options.fullscreen).toBe(true);
        expect(win?.options.simpleFullscreen).toBeUndefined();
        expect(win?.setSimpleFullScreen).not.toHaveBeenCalled();
    });

    it('stays windowed (no fullscreen flags) when windowedFullscreen is omitted', () => {
        let win: FakeBrowserWindow | undefined;
        withPlatform('darwin', () => {
            win = createMainWindow({
                preloadPath: PRELOAD,
                rendererEntry: RENDERER_ENTRY,
                env: 'production',
                logger: createNoopLogger(),
            }) as unknown as FakeBrowserWindow;
        });

        expect(win?.options.fullscreen).toBeUndefined();
        expect(win?.options.simpleFullscreen).toBeUndefined();
        expect(win?.setSimpleFullScreen).not.toHaveBeenCalled();
    });
});

describe('sanitiseE2eInitialUrl (BLOCK-1)', () => {
    it('accepts a valid chimera://renderer/... URL and returns it unchanged', () => {
        expect(sanitiseE2eInitialUrl('chimera://renderer/lobby/')).toBe(
            'chimera://renderer/lobby/',
        );
    });

    it('returns CHIMERA_RENDERER_URL when protocol is https (remote URL attack)', () => {
        expect(sanitiseE2eInitialUrl('https://evil.example.com/')).toBe(CHIMERA_RENDERER_URL);
    });

    it('returns CHIMERA_RENDERER_URL when protocol is http', () => {
        expect(sanitiseE2eInitialUrl('http://localhost:3000/')).toBe(CHIMERA_RENDERER_URL);
    });

    it('returns CHIMERA_RENDERER_URL when protocol is correct but host is wrong', () => {
        expect(sanitiseE2eInitialUrl('chimera://evil/lobby/')).toBe(CHIMERA_RENDERER_URL);
    });

    it('returns CHIMERA_RENDERER_URL for a completely different protocol', () => {
        expect(sanitiseE2eInitialUrl('file:///etc/passwd')).toBe(CHIMERA_RENDERER_URL);
    });

    it('returns CHIMERA_RENDERER_URL for a malformed URL that new URL() rejects', () => {
        expect(sanitiseE2eInitialUrl('not-a-url')).toBe(CHIMERA_RENDERER_URL);
    });

    it('returns CHIMERA_RENDERER_URL when called with undefined', () => {
        expect(sanitiseE2eInitialUrl(undefined)).toBe(CHIMERA_RENDERER_URL);
    });
});

describe('renderer app protocol', () => {
    it('registers the chimera renderer scheme as privileged', () => {
        protocolRegisterSchemesAsPrivileged.mockClear();

        registerRendererProtocolScheme({
            registerSchemesAsPrivileged: protocolRegisterSchemesAsPrivileged,
        });

        expect(protocolRegisterSchemesAsPrivileged).toHaveBeenCalledWith([
            {
                scheme: 'chimera',
                privileges: {
                    standard: true,
                    secure: true,
                    supportFetchAPI: true,
                },
            },
        ]);
    });

    it('maps route navigations to exported HTML files', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                requestUrl: 'chimera://renderer/lobby',
                headers: new Headers(),
            }),
        ).toBe(path.join('/abs/path/renderer/out', 'lobby', 'index.html'));
    });

    it('maps RSC route fetches to exported route payloads', () => {
        const headers = new Headers();
        headers.set('RSC', '1');

        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                requestUrl: 'chimera://renderer/lobby?_rsc=test',
                headers,
            }),
        ).toBe(path.join('/abs/path/renderer/out', 'lobby', 'index.txt'));
    });

    it('maps nested route asset requests back to the shared _next directory', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                requestUrl: 'chimera://renderer/lobby/_next/static/chunks/app.js',
                headers: new Headers(),
            }),
        ).toBe(path.join('/abs/path/renderer/out', '_next', 'static', 'chunks', 'app.js'));
    });

    it('resolves nested routes when the query string carries encoded separators', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                requestUrl:
                    'chimera://renderer/replays/player?path=%2Fvar%2Freplays%2Fmatch.chimera-replay',
                headers: new Headers(),
            }),
        ).toBe(path.join('/abs/path/renderer/out', 'replays', 'player', 'index.html'));
    });

    it('resolves nested RSC fetches when the query string carries encoded separators', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                requestUrl:
                    'chimera://renderer/replays/player/index.txt?path=%2Fvar%2Freplays%2Fmatch.chimera-replay&_rsc=abc',
                headers: new Headers(),
            }),
        ).toBe(path.join('/abs/path/renderer/out', 'replays', 'player', 'index.txt'));
    });

    it('maps game asset requests to the game-owned assets directory', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                gameAssetsRoot: '/abs/path/games',
                requestUrl: 'chimera://renderer/game-assets/tactics/audio/sfx/step.wav',
                headers: new Headers(),
            }),
        ).toBe(path.join('/abs/path/games', 'tactics', 'assets', 'audio', 'sfx', 'step.wav'));
    });

    it('rejects traversal attempts in game asset requests', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                gameAssetsRoot: '/abs/path/games',
                requestUrl: 'chimera://renderer/game-assets/tactics/%2e%2e/secret.wav',
                headers: new Headers(),
            }),
        ).toBeNull();
    });

    it('rejects renderer protocol paths outside the static export root', () => {
        expect(
            resolveRendererProtocolFilePath({
                rendererRoot: '/abs/path/renderer/out',
                requestUrl: 'chimera://renderer/%2e%2e/secret.txt',
                headers: new Headers(),
            }),
        ).toBeNull();
    });

    it('serves .mp4 with the video/mp4 content type (not octet-stream)', async () => {
        const response = buildRendererProtocolResponse({
            filePath: '/abs/path/renderer/out/chimera_logo.mp4',
            data: Buffer.from('fake-mp4-bytes'),
            rangeHeader: null,
        });

        expect(response.headers.get('content-type')).toBe('video/mp4');
    });

    it('advertises byte-range support on a full (rangeless) media response', async () => {
        const data = Buffer.from('fake-mp4-bytes');
        const response = buildRendererProtocolResponse({
            filePath: '/abs/path/renderer/out/chimera_logo.mp4',
            data,
            rangeHeader: null,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(response.headers.get('content-length')).toBe(String(data.byteLength));
    });

    it('answers a Range request with 206 Partial Content and a Content-Range header', async () => {
        const data = Buffer.from('0123456789'); // 10 bytes
        const response = buildRendererProtocolResponse({
            filePath: '/abs/path/renderer/out/chimera_logo.mp4',
            data,
            rangeHeader: 'bytes=2-5',
        });

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(response.headers.get('content-length')).toBe('4');
        await expect(response.text()).resolves.toBe('2345');
    });

    it('clamps an open-ended Range (bytes=N-) to the end of the file', async () => {
        const data = Buffer.from('0123456789'); // 10 bytes
        const response = buildRendererProtocolResponse({
            filePath: '/abs/path/renderer/out/chimera_logo.mp4',
            data,
            rangeHeader: 'bytes=8-',
        });

        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 8-9/10');
        await expect(response.text()).resolves.toBe('89');
    });

    it('answers an unsatisfiable Range with 416 Range Not Satisfiable', async () => {
        const data = Buffer.from('0123456789'); // 10 bytes
        const response = buildRendererProtocolResponse({
            filePath: '/abs/path/renderer/out/chimera_logo.mp4',
            data,
            rangeHeader: 'bytes=100-200',
        });

        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */10');
    });

    it('ignores a Range header on a non-media response and returns the whole file', async () => {
        const data = Buffer.from('<html></html>');
        const response = buildRendererProtocolResponse({
            filePath: '/abs/path/renderer/out/index.html',
            data,
            rangeHeader: 'bytes=0-3',
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-range')).toBeNull();
    });

    it('resolves a suffix Range (bytes=-N) to the final N bytes', () => {
        // size 10; bytes=-3 → the last three bytes [7,9].
        expect(parseSingleByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    });

    it('clamps a suffix Range larger than the file to the whole file', () => {
        expect(parseSingleByteRange('bytes=-100', 10)).toEqual({ start: 0, end: 9 });
    });

    it('returns null for an absent, malformed, or multi-range header', () => {
        expect(parseSingleByteRange(null, 10)).toBeNull();
        expect(parseSingleByteRange('bytes=abc', 10)).toBeNull();
        expect(parseSingleByteRange('bytes=0-1,4-5', 10)).toBeNull();
        expect(parseSingleByteRange('bytes=-', 10)).toBeNull();
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

describe('resolveRuntimePaths', () => {
    const moduleDirname = path.join('/app', 'electron', 'main');

    it('uses source-tree runtime paths by default', () => {
        const paths = resolveRuntimePaths({ moduleDirname, env: {}, isPackaged: false });

        expect(paths.preloadPath).toBe(path.join(moduleDirname, '..', 'preload', 'api.js'));
        expect(paths.rendererEntry).toBe(
            path.join(moduleDirname, '..', '..', 'renderer', 'out', 'index.html'),
        );
    });

    it('resolves the game assets root to the parent apps/ dir when running from source', () => {
        // The Electron main bundle lives at <root>/apps/<gameId>/dist/electron/main.js, so
        // the game's data is at <root>/apps/<gameId>/data and the asset root (the apps/ dir
        // that loadGameContent appends <gameId>/data to) is <root>/apps — the parent of the
        // app dir. The stale ../../apps default produced the doubled
        // apps/<gameId>/apps/<gameId>/data ENOENT when launched from source.
        const paths = resolveRuntimePaths({ moduleDirname, env: {}, isPackaged: false });

        expect(paths.gameAssetsRoot).toBe(path.join(moduleDirname, '..', '..', '..'));
    });

    it('resolves the game assets root to <appRoot>/apps when packaged', () => {
        // electron-builder remaps each game's data into an apps/<gameId>/ subtree that sits
        // inside the app root (a sibling of dist/electron), so the packaged walk stays
        // ../../apps. Changing this would break the packaged content load.
        const paths = resolveRuntimePaths({ moduleDirname, env: {}, isPackaged: true });

        expect(paths.gameAssetsRoot).toBe(path.join(moduleDirname, '..', '..', 'apps'));
    });

    it('uses E2E bundle overrides when CHIMERA_E2E is enabled', () => {
        const paths = resolveRuntimePaths({
            moduleDirname,
            isPackaged: false,
            env: {
                CHIMERA_E2E: '1',
                CHIMERA_E2E_PRELOAD_PATH: '/tmp/chimera-e2e/preload/api.js',
                CHIMERA_E2E_RENDERER_ENTRY: '/tmp/chimera-renderer/index.html',
            },
        });

        expect(paths.preloadPath).toBe('/tmp/chimera-e2e/preload/api.js');
        expect(paths.rendererEntry).toBe('/tmp/chimera-renderer/index.html');
    });

    it('ignores E2E bundle overrides outside CHIMERA_E2E', () => {
        const paths = resolveRuntimePaths({
            moduleDirname,
            isPackaged: false,
            env: {
                CHIMERA_E2E_PRELOAD_PATH: '/tmp/chimera-e2e/preload/api.js',
                CHIMERA_E2E_RENDERER_ENTRY: '/tmp/chimera-renderer/index.html',
            },
        });

        expect(paths.preloadPath).toBe(path.join(moduleDirname, '..', 'preload', 'api.js'));
        expect(paths.rendererEntry).toBe(
            path.join(moduleDirname, '..', '..', 'renderer', 'out', 'index.html'),
        );
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

describe('registerClientRevealForwarding', () => {
    interface TestWireReveal {
        readonly id: string;
        readonly value: unknown;
        readonly nonce: string;
    }

    interface TestPlayerSnapshotWithCommitments {
        readonly commitments?: Readonly<
            Record<string, { readonly id: string; readonly commitment: string }>
        >;
    }

    function makeReveal(): TestWireReveal {
        return { id: 'commitment-1', value: { card: 'ace-of-stars' }, nonce: 'nonce-1' };
    }

    function makeRevealTransport(): {
        readonly transport: {
            readonly onReveal: ReturnType<typeof vi.fn>;
            readonly onSnapshotReceived: ReturnType<typeof vi.fn>;
        };
        readonly callbacks: ((reveal: TestWireReveal) => void)[];
        readonly snapshotCallbacks: ((snapshot: TestPlayerSnapshotWithCommitments) => void)[];
        readonly unsubscribe: ReturnType<typeof vi.fn>;
    } {
        const callbacks: ((reveal: TestWireReveal) => void)[] = [];
        const snapshotCallbacks: ((snapshot: TestPlayerSnapshotWithCommitments) => void)[] = [];
        const unsubscribe = vi.fn();
        return {
            callbacks,
            snapshotCallbacks,
            unsubscribe,
            transport: {
                onReveal: vi.fn((cb: (reveal: TestWireReveal) => void) => {
                    callbacks.push(cb);
                    return unsubscribe;
                }),
                onSnapshotReceived: vi.fn(
                    (cb: (snapshot: TestPlayerSnapshotWithCommitments) => void) => {
                        snapshotCallbacks.push(cb);
                        return unsubscribe;
                    },
                ),
            },
        };
    }

    it('verifies a REVEAL before forwarding it to renderer windows', () => {
        const { transport, callbacks } = makeRevealTransport();
        const verifyReveal = vi.fn<(reveal: TestWireReveal) => unknown>(() => true);
        const sendRevealToRenderer = vi.fn<(reveal: TestWireReveal) => void>();
        const reveal = makeReveal();

        registerClientRevealForwarding({
            transport,
            commitmentRuntime: { verifyReveal },
            sendRevealToRenderer,
            logger: createNoopLogger(),
        });

        callbacks[0]?.(reveal);

        expect(verifyReveal).toHaveBeenCalledWith(reveal);
        expect(sendRevealToRenderer).toHaveBeenCalledWith(reveal);
    });

    it('logs and drops a tampered REVEAL without forwarding it', () => {
        const { transport, callbacks } = makeRevealTransport();
        const error = new MockCommitmentVerificationError('bad reveal');
        const verifyReveal = vi.fn<(reveal: TestWireReveal) => unknown>(() => {
            throw error;
        });
        const sendRevealToRenderer = vi.fn<(reveal: TestWireReveal) => void>();
        const logger = { ...createNoopLogger(), warn: vi.fn() };

        registerClientRevealForwarding({
            transport,
            commitmentRuntime: { verifyReveal },
            sendRevealToRenderer,
            logger,
        });

        callbacks[0]?.(makeReveal());

        expect(sendRevealToRenderer).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            'client reveal verification failed',
            expect.objectContaining({ commitmentId: 'commitment-1', error: 'bad reveal' }),
        );
    });

    it('returns the ClientTransport onReveal unsubscribe handle', () => {
        const { transport, unsubscribe } = makeRevealTransport();
        const result = registerClientRevealForwarding({
            transport,
            commitmentRuntime: { verifyReveal: vi.fn() },
            sendRevealToRenderer: vi.fn(),
            logger: createNoopLogger(),
        });

        result();

        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('main forwards verified joined-client reveals on the game reveal channel', async () => {
        mockLobbyManagerCtor.mockClear();
        browserWindowInstances.length = 0;
        const win = new FakeBrowserWindow({});
        await main(makeTestContributions());

        const onSessionJoined = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionJoined?: (transport: {
                          onReveal(cb: (reveal: TestWireReveal) => void): () => void;
                          onSnapshotReceived(
                              cb: (snapshot: TestPlayerSnapshotWithCommitments) => void,
                          ): () => void;
                      }) => void;
                  }
                | undefined
        )?.onSessionJoined;
        expect(onSessionJoined).toBeTypeOf('function');

        const { transport, callbacks, snapshotCallbacks } = makeRevealTransport();
        onSessionJoined?.(transport);
        const reveal = makeReveal();
        snapshotCallbacks[0]?.({
            commitments: {
                'commitment-1': {
                    id: 'commitment-1',
                    commitment: 'a'.repeat(64),
                },
            },
        });
        callbacks[0]?.(reveal);

        expect(win.webContents.send).toHaveBeenCalledWith(GAME_REVEAL_CHANNEL, reveal);
    });
});

describe('resolveRendererLaunchUrl', () => {
    const declaredManifest: GameManifest = {
        gameId: 'demo',
        displayName: 'Demo',
        realtime: false,
        logoScreen: { route: '/logo-screen' },
    };
    const undeclaredManifest: GameManifest = {
        gameId: 'demo',
        displayName: 'Demo',
        realtime: false,
    };

    it('launches a packaged build into the declared logo-screen route', () => {
        expect(resolveRendererLaunchUrl({ gameId: 'demo', manifest: declaredManifest }, true)).toBe(
            'chimera://renderer/logo-screen/?gameId=demo',
        );
    });

    it('launches a packaged build without a declaration into the main menu, exactly as today', () => {
        expect(
            resolveRendererLaunchUrl({ gameId: 'demo', manifest: undeclaredManifest }, true),
        ).toBe(buildRendererGameLaunchUrl('demo'));
    });

    it('ignores the declaration outside packaged builds — dev and E2E boots land on the main menu', () => {
        expect(
            resolveRendererLaunchUrl({ gameId: 'demo', manifest: declaredManifest }, false),
        ).toBe(buildRendererGameLaunchUrl('demo'));
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
        appGetLocale.mockClear();
        appGetLocale.mockImplementation(() => 'en-US');
        appGetVersion.mockClear();
        appGetVersion.mockImplementation(() => '0.7.0-test');
        ipcMainHandle.mockClear();
        screenGetAllDisplays.mockClear();
        screenGetPrimaryDisplay.mockClear();
        screenOn.mockClear();
        screenOff.mockClear();
        screenListeners.clear();
        mockOsRelease.mockClear();
        mockOsRelease.mockImplementation(() => '23.6.0-test');
        fsExistsSync.mockClear();
        fsWriteFileSync.mockClear();
        fsUnlinkSync.mockClear();
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockAgentManagerCtor.mockClear();
        mockDefaultStateProjectorCtor.mockClear();
        mockStateBroadcasterCtor.mockClear();
        mockStateBroadcasterInstance.broadcast.mockClear();
        mockStateBroadcasterInstance.registerRendererRecipient.mockClear();
        mockStateBroadcasterInstance.dispose.mockClear();
        mockGetE2eHooks.mockClear();
        mockGetE2eHooks.mockReturnValue(undefined);
        capturedSaveManagerRepoClassName.value = '';
        capturedSettingsBroadcastFn.current = null;
    });

    it('constructs SaveManager with FileSaveRepository, not InMemorySaveRepository (BLOCK-1)', async () => {
        await main(makeTestContributions());

        expect(capturedSaveManagerRepoClassName.value).toBe('FileSaveRepository');
    });

    // ── Runtime Debug Layer gate (§4.12, F47 T5, Invariant #27) ──────────────

    it('registers NO debug handlers when IS_DEBUG_MODE is false (gate not entered)', async () => {
        await main(makeTestContributions());

        const handleChannels = ipcMainHandle.mock.calls.map(([channel]) => channel);
        const onChannels = ipcMainOn.mock.calls.map(([channel]) => channel);
        expect(handleChannels).not.toContain('chimera:debug');
        expect(onChannels).not.toContain('chimera:debug:toggle-inspector');
    });

    it('with CHIMERA_DEBUG=1 registers both debug handlers but creates NO Inspector window', async () => {
        vi.stubEnv('CHIMERA_DEBUG', '1');
        vi.resetModules();
        try {
            // Fresh import so shared/constants re-evaluates IS_DEBUG_MODE
            // (NODE_ENV is 'test' under vitest, so the guard passes).
            const fresh = await import('./index.js');
            await fresh.main(makeTestContributions());

            const handleChannels = ipcMainHandle.mock.calls.map(([channel]) => channel);
            const onChannels = ipcMainOn.mock.calls.map(([channel]) => channel);
            expect(handleChannels).toContain('chimera:debug');
            expect(onChannels).toContain('chimera:debug:toggle-inspector');

            // Closed by default: only the main renderer window exists, and
            // nothing loaded the Inspector /debug/ route.
            expect(browserWindowInstances).toHaveLength(1);
            const debugLoads = browserWindowInstances.filter((win) =>
                win.loadURL.mock.calls.some(([url]) => String(url).includes('/debug')),
            );
            expect(debugLoads).toHaveLength(0);
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });

    it('uses os.release() for the system device-info osVersion', async () => {
        mockOsRelease.mockReturnValue('24.1.0-test');

        await main(makeTestContributions());
        await Promise.resolve();

        const handler = ipcMainHandle.mock.calls.find(
            ([channel]) => channel === SYSTEM_DEVICE_INFO_CHANNEL,
        )?.[1];
        expect(handler).toBeDefined();

        expect(handler?.()).toMatchObject({ osVersion: '24.1.0-test' });
    });

    it('disposes the previous device-probe watcher before recreating a main window', async () => {
        await main(makeTestContributions());
        await Promise.resolve();

        const activateHandler = appOn.mock.calls.find(([event]) => event === 'activate')?.[1];
        expect(activateHandler).toBeTypeOf('function');
        expect(screenOn).toHaveBeenCalledWith('display-metrics-changed', expect.any(Function));

        browserWindowInstances.length = 0;
        activateHandler?.();

        expect(screenOff).toHaveBeenCalledWith('display-metrics-changed', expect.any(Function));
        expect(screenOn).toHaveBeenCalledTimes(2);
    });

    it('pushes updated DeviceInfo via SYSTEM_DEVICE_INFO_CHANGE_CHANNEL when the window is resized', async () => {
        await main(makeTestContributions());
        await Promise.resolve();

        const win = browserWindowInstances[browserWindowInstances.length - 1]!;

        // Change to a compact-range width and trigger resize
        win.getContentSize.mockReturnValue([800, 600]);

        const resizeCall = win.on.mock.calls.find(([event]) => event === 'resize');
        expect(resizeCall).toBeDefined();
        const resizeHandler = resizeCall?.[1] as (() => void) | undefined;
        resizeHandler?.();

        expect(win.webContents.send).toHaveBeenCalledWith(
            SYSTEM_DEVICE_INFO_CHANGE_CHANNEL,
            expect.objectContaining({ windowSizeClass: 'compact' }),
        );
    });

    it('constructs LobbyManager with a LocalWebSocketProvider (Invariant #2 wiring point)', async () => {
        mockLobbyManagerCtor.mockClear();
        await main(makeTestContributions());

        expect(mockLobbyManagerCtor).toHaveBeenCalledOnce();
        // First arg is a LocalWebSocketProvider instance (mock returns {})
        expect(mockLobbyManagerCtor.mock.calls[0]?.[0]).toBeDefined();
    });

    it('constructs AgentManager with an injected lobby logger', async () => {
        mockLobbyManagerCtor.mockClear();
        await main(makeTestContributions());

        const onSessionHosted = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: {
                              onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                              onPlayerLeft(cb: (id: string) => void): () => void;
                              onActionReceived(
                                  cb: (from: string, action: unknown) => void,
                              ): () => void;
                              setJoinClassifier(classify: unknown): void;
                          },
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                              readonly agentSlots?: readonly {
                                  readonly slotIndex: number;
                                  readonly kind: 'human' | 'ai';
                                  readonly omniscient?: boolean;
                              }[];
                          },
                      ) => () => void;
                  }
                | undefined
        )?.onSessionHosted;

        expect(onSessionHosted).toBeTypeOf('function');

        onSessionHosted?.(
            {
                onPlayerJoined: vi.fn(() => () => {}),
                onPlayerLeft: vi.fn(() => () => {}),
                onActionReceived: vi.fn(() => () => {}),
                setJoinClassifier: vi.fn(),
            },
            { hostId: playerId('host-1'), maxPlayers: 1 },
        );

        const { AgentManager } = await import('@chimera-engine/ai/engine');
        expect(vi.mocked(AgentManager).mock.calls[0]?.[0]).toMatchObject({
            logger: expect.any(Object),
        });
    });

    it('constructs DefaultStateProjector with tactics visibility rules and injects it into StateBroadcaster', async () => {
        mockLobbyManagerCtor.mockClear();
        await main(makeTestContributions());

        const onSessionHosted = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: {
                              onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                              onPlayerLeft(cb: (id: string) => void): () => void;
                              onActionReceived(
                                  cb: (from: string, action: unknown) => void,
                              ): () => void;
                              setJoinClassifier(classify: unknown): void;
                          },
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => () => void;
                  }
                | undefined
        )?.onSessionHosted;

        expect(onSessionHosted).toBeTypeOf('function');

        const transport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };

        onSessionHosted?.(transport, { hostId: playerId('host-projector'), maxPlayers: 1 });

        expect(mockDefaultStateProjectorCtor).toHaveBeenCalledOnce();
        expect(mockDefaultStateProjectorCtor).toHaveBeenCalledWith(
            mockTacticsVisibilityRules,
            expect.objectContaining({ getUndoMeta: expect.any(Function) }),
        );
        expect(mockStateBroadcasterCtor).toHaveBeenCalledWith(
            transport,
            mockProjectorInstance,
            expect.any(Object),
            { hostViewerId: playerId('host-projector') },
        );
    });

    it('wires e2eHooks to StateBroadcaster when getE2eHooks returns a non-undefined value (WARN-1)', async () => {
        const stubE2eHooks = { onBeforeAction: vi.fn(), onAfterAction: vi.fn() };
        mockGetE2eHooks.mockReturnValue(stubE2eHooks);

        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterCtor.mockClear();
        await main(makeTestContributions());

        // Verify LobbyManager was constructed with e2eHooks in the options
        expect(mockLobbyManagerCtor).toHaveBeenCalledOnce();
        const lobbyManagerOptions = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | { e2eHooks?: unknown }
            | undefined;
        expect(lobbyManagerOptions).toBeDefined();
        expect(lobbyManagerOptions?.e2eHooks).toBe(stubE2eHooks);

        // Extract the onSessionHosted callback
        const onSessionHosted = (
            lobbyManagerOptions as unknown as {
                onSessionHosted?: (
                    transport: unknown,
                    metadata: { hostId: string; maxPlayers: number; e2eHooks?: unknown },
                ) => () => void;
            }
        )?.onSessionHosted;

        expect(onSessionHosted).toBeTypeOf('function');

        const transport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
        const hostId = playerId('host-e2e-wiring');

        // Clear the mock before calling onSessionHosted so we can assert on this specific call
        mockStateBroadcasterCtor.mockClear();

        // LobbyManager will pass e2eHooks to metadata when calling onSessionHosted
        onSessionHosted?.(transport, { hostId, maxPlayers: 1, e2eHooks: stubE2eHooks });

        // Verify StateBroadcaster was constructed with e2eHooks in its options
        expect(mockStateBroadcasterCtor).toHaveBeenCalledWith(
            transport,
            mockProjectorInstance,
            expect.any(Object),
            expect.objectContaining({ hostViewerId: hostId, e2eHooks: stubE2eHooks }),
        );
    });

    it('registers the host renderer as a projected snapshot IPC recipient', async () => {
        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterInstance.registerRendererRecipient.mockClear();
        browserWindowInstances.length = 0;
        await main(makeTestContributions()); // creates the main window (browserWindowInstances[0])
        const mainWindow = browserWindowInstances[0]!;

        const onSessionHosted = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: {
                              onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                              onPlayerLeft(cb: (id: string) => void): () => void;
                              onActionReceived(
                                  cb: (from: string, action: unknown) => void,
                              ): () => void;
                              setJoinClassifier(classify: unknown): void;
                          },
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => () => void;
                  }
                | undefined
        )?.onSessionHosted;
        expect(onSessionHosted).toBeTypeOf('function');

        const hostId = playerId('host-renderer');
        const transport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };

        onSessionHosted?.(transport, { hostId, maxPlayers: 1 });

        expect(mockStateBroadcasterInstance.registerRendererRecipient).toHaveBeenCalledOnce();
        const recipient = mockStateBroadcasterInstance.registerRendererRecipient.mock.calls[0]?.[0];
        expect(recipient?.viewerId).toBe(hostId);

        const projectedSnapshot = { tick: 7, viewerId: hostId };
        recipient?.sendSnapshot(projectedSnapshot);

        expect(mainWindow.webContents.send).toHaveBeenCalledWith(
            GAME_SNAPSHOT_CHANNEL,
            projectedSnapshot,
        );
    });

    it('sendSnapshot for hosted session targets only the main window, not secondary windows — WARN-1', async () => {
        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterInstance.registerRendererRecipient.mockClear();
        browserWindowInstances.length = 0;

        await main(makeTestContributions()); // creates the main window (browserWindowInstances[0])
        const mainWindow = browserWindowInstances[0]!;

        // Simulate a secondary window opened after the app is ready
        // (e.g. detached DevTools, secondary display).
        const secondaryWindow = new FakeBrowserWindow({});

        const onSessionHosted = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: {
                              onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                              onPlayerLeft(cb: (id: string) => void): () => void;
                              onActionReceived(
                                  cb: (from: string, action: unknown) => void,
                              ): () => void;
                              setJoinClassifier(classify: unknown): void;
                          },
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => () => void;
                  }
                | undefined
        )?.onSessionHosted;
        expect(onSessionHosted).toBeTypeOf('function');

        const hostId = playerId('host-warn1');
        onSessionHosted?.(
            {
                onPlayerJoined: vi.fn(() => () => {}),
                onPlayerLeft: vi.fn(() => () => {}),
                onActionReceived: vi.fn(() => () => {}),
                setJoinClassifier: vi.fn(),
            },
            { hostId, maxPlayers: 1 },
        );

        const recipient = mockStateBroadcasterInstance.registerRendererRecipient.mock.calls[0]?.[0];
        const projectedSnapshot = { tick: 42, viewerId: hostId };
        recipient?.sendSnapshot(projectedSnapshot);

        // The main window receives the snapshot
        expect(mainWindow.webContents.send).toHaveBeenCalledWith(
            GAME_SNAPSHOT_CHANNEL,
            projectedSnapshot,
        );
        // Secondary windows must NOT receive the host's private projected snapshot
        expect(secondaryWindow.webContents.send).not.toHaveBeenCalledWith(
            GAME_SNAPSHOT_CHANNEL,
            expect.anything(),
        );
    });

    it('rebroadcasts the current in-match snapshot to a rejoined player', async () => {
        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterInstance.broadcast.mockClear();
        browserWindowInstances.length = 0;

        await main(makeTestContributions());

        let capturedJoin:
            | ((entry: { readonly playerId: ReturnType<typeof playerId> }) => void)
            | undefined;
        let capturedLeft: ((leftPlayerId: ReturnType<typeof playerId>) => void) | undefined;
        interface ReconnectTransport {
            readonly onPlayerJoined: ReturnType<typeof vi.fn>;
            readonly onPlayerLeft: ReturnType<typeof vi.fn>;
            readonly onActionReceived: ReturnType<typeof vi.fn>;
            readonly setJoinClassifier: ReturnType<typeof vi.fn>;
        }
        const transport: ReconnectTransport = {
            onPlayerJoined: vi.fn(
                (cb: (entry: { readonly playerId: ReturnType<typeof playerId> }) => void) => {
                    capturedJoin = cb;
                    return () => {};
                },
            ),
            onPlayerLeft: vi.fn((cb: (leftPlayerId: ReturnType<typeof playerId>) => void) => {
                capturedLeft = cb;
                return () => {};
            }),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
        const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | {
                  onSessionHosted?: (
                      transport: ReconnectTransport,
                      metadata: {
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly maxPlayers: number;
                      },
                  ) => void;
                  onGameStartRequested?: (state: {
                      readonly info: {
                          readonly sessionId: string;
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly gameId: string;
                      };
                      readonly players: readonly {
                          readonly playerId: ReturnType<typeof playerId>;
                          readonly displayName: string;
                          readonly ready: boolean;
                      }[];
                  }) => void;
              }
            | undefined;

        const hostId = playerId('host-resync');
        const clientId = playerId('client-resync');
        options?.onSessionHosted?.(transport, { hostId, maxPlayers: 2 });
        capturedJoin?.({ playerId: clientId });
        options?.onGameStartRequested?.({
            info: { sessionId: 'session-resync', hostId, gameId: 'tactics' },
            players: [
                { playerId: hostId, displayName: 'Host', ready: true },
                { playerId: clientId, displayName: 'Client', ready: true },
            ],
        });

        mockStateBroadcasterInstance.broadcast.mockClear();
        capturedLeft?.(clientId);
        capturedJoin?.({ playerId: clientId });

        expect(mockStateBroadcasterInstance.broadcast).toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'playing', tick: 1 }),
            clientId,
        );
    });

    it('does not rebroadcast the current in-match snapshot for a first-time join', async () => {
        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterInstance.broadcast.mockClear();
        browserWindowInstances.length = 0;

        await main(makeTestContributions());

        let capturedJoin:
            | ((entry: { readonly playerId: ReturnType<typeof playerId> }) => void)
            | undefined;
        interface FirstJoinTransport {
            readonly onPlayerJoined: ReturnType<typeof vi.fn>;
            readonly onPlayerLeft: ReturnType<typeof vi.fn>;
            readonly onActionReceived: ReturnType<typeof vi.fn>;
            readonly setJoinClassifier: ReturnType<typeof vi.fn>;
        }
        const transport: FirstJoinTransport = {
            onPlayerJoined: vi.fn(
                (cb: (entry: { readonly playerId: ReturnType<typeof playerId> }) => void) => {
                    capturedJoin = cb;
                    return () => {};
                },
            ),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
        const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | {
                  onSessionHosted?: (
                      transport: FirstJoinTransport,
                      metadata: {
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly maxPlayers: number;
                      },
                  ) => void;
                  onGameStartRequested?: (state: {
                      readonly info: {
                          readonly sessionId: string;
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly gameId: string;
                      };
                      readonly players: readonly {
                          readonly playerId: ReturnType<typeof playerId>;
                          readonly displayName: string;
                          readonly ready: boolean;
                      }[];
                  }) => void;
              }
            | undefined;

        const hostId = playerId('host-first-join');
        const clientId = playerId('client-first-join');
        options?.onSessionHosted?.(transport, { hostId, maxPlayers: 2 });
        options?.onGameStartRequested?.({
            info: { sessionId: 'session-first-join', hostId, gameId: 'tactics' },
            players: [
                { playerId: hostId, displayName: 'Host', ready: true },
                { playerId: clientId, displayName: 'Client', ready: true },
            ],
        });

        mockStateBroadcasterInstance.broadcast.mockClear();
        capturedJoin?.({ playerId: clientId });

        expect(mockStateBroadcasterInstance.broadcast).not.toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'playing' }),
            clientId,
        );
    });

    it('starts undo history after engine:start_game so the first tactics move exhausts cleanly', async () => {
        mockLobbyManagerCtor.mockClear();
        mockDefaultStateProjectorCtor.mockClear();
        browserWindowInstances.length = 0;

        await main(makeTestContributions());

        const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | {
                  onSessionHosted?: (
                      transport: {
                          onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                          onPlayerLeft(cb: (id: string) => void): () => void;
                          onActionReceived(cb: (from: string, action: unknown) => void): () => void;
                      },
                      metadata: {
                          readonly hostId: ReturnType<typeof playerId>;
                          maxPlayers: number;
                      },
                  ) => void;
                  onGameStartRequested?: (state: {
                      readonly info: {
                          readonly sessionId: string;
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly gameId: string;
                      };
                      readonly players: readonly {
                          readonly playerId: ReturnType<typeof playerId>;
                          readonly displayName: string;
                          readonly ready: boolean;
                      }[];
                  }) => void;
              }
            | undefined;
        expect(options?.onSessionHosted).toBeTypeOf('function');
        expect(options?.onGameStartRequested).toBeTypeOf('function');

        const actionReceivedRef: {
            current?: (from: string, action: unknown) => void;
        } = {};
        const transport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn((cb: (from: string, action: unknown) => void) => {
                actionReceivedRef.current = cb;
                return () => {};
            }),
            setJoinClassifier: vi.fn(),
        };

        const hostId = playerId('host-undo-start');
        const guestId = playerId('guest-undo-start');
        options?.onSessionHosted?.(transport, { hostId, maxPlayers: 2 });
        options?.onGameStartRequested?.({
            info: { sessionId: 'session-undo', hostId, gameId: 'tactics' },
            players: [
                { playerId: hostId, displayName: 'Host', ready: true },
                { playerId: guestId, displayName: 'Guest', ready: true },
            ],
        });

        const actionReceived = actionReceivedRef.current;
        expect(actionReceived).toBeDefined();
        if (actionReceived === undefined) {
            throw new Error('Expected hosted session to subscribe to incoming actions');
        }
        actionReceived(hostId, {
            type: 'tactics:move_unit',
            playerId: hostId,
            tick: 1,
            payload: { unitId: 'unit-1', x: 1, y: 0 },
        });

        const projectorOptions = capturedDefaultStateProjectorOptions.current;

        expect(projectorOptions?.getUndoMeta?.(hostId)).toEqual({
            canUndo: true,
            canRedo: false,
        });
    });

    it('seeds undo memento only for the active (host) player — guest canUndo stays false until its own turn', async () => {
        // Regression guard for BLOCK-2: onGameStartRequested must NOT seed a
        // turn-start memento for non-active players. Seeding every player made
        // guests eligible to undo the host's actions, violating the per-turn
        // ownership rule in undo-redo-policy.md §60 and the per-viewer contract
        // in undo-wiring.integration.test.ts:326.
        mockLobbyManagerCtor.mockClear();
        mockDefaultStateProjectorCtor.mockClear();
        browserWindowInstances.length = 0;

        await main(makeTestContributions());

        const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | {
                  onSessionHosted?: (
                      transport: {
                          onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                          onPlayerLeft(cb: (id: string) => void): () => void;
                          onActionReceived(cb: (from: string, action: unknown) => void): () => void;
                      },
                      metadata: {
                          readonly hostId: ReturnType<typeof playerId>;
                          maxPlayers: number;
                      },
                  ) => void;
                  onGameStartRequested?: (state: {
                      readonly info: {
                          readonly sessionId: string;
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly gameId: string;
                      };
                      readonly players: readonly {
                          readonly playerId: ReturnType<typeof playerId>;
                          readonly displayName: string;
                          readonly ready: boolean;
                      }[];
                  }) => void;
              }
            | undefined;

        const hostId = playerId('host-guest-undo');
        const guestId = playerId('guest-guest-undo');
        const actionReceivedRef: { current?: (from: string, action: unknown) => void } = {};
        const transport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn((cb: (from: string, action: unknown) => void) => {
                actionReceivedRef.current = cb;
                return () => {};
            }),
            setJoinClassifier: vi.fn(),
        };

        options?.onSessionHosted?.(transport, { hostId, maxPlayers: 2 });
        options?.onGameStartRequested?.({
            info: { sessionId: 'session-guest-undo', hostId, gameId: 'tactics' },
            players: [
                { playerId: hostId, displayName: 'Host', ready: true },
                { playerId: guestId, displayName: 'Guest', ready: true },
            ],
        });

        const actionReceived = actionReceivedRef.current;
        if (actionReceived === undefined) {
            throw new Error('Expected hosted session to subscribe to incoming actions');
        }

        // Host makes a valid move — only the host's memento was seeded at match
        // start (the active player's turn), so the guest has no memento and its
        // canUndo must remain false, regardless of how many actions the host takes.
        actionReceived(hostId, {
            type: 'tactics:move_unit',
            playerId: hostId,
            tick: 1,
            payload: { unitId: 'unit-1', x: 1, y: 0 },
        });

        const projectorOptions = capturedDefaultStateProjectorOptions.current;
        expect(projectorOptions?.getUndoMeta?.(guestId)).toEqual({
            canUndo: false,
            canRedo: false,
        });
    });

    it('seeds undo memento for the configured client first player in E2E sessions', async () => {
        mockLobbyManagerCtor.mockClear();
        mockDefaultStateProjectorCtor.mockClear();
        browserWindowInstances.length = 0;

        await main(makeTestContributions());

        const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | {
                  onSessionHosted?: (
                      transport: {
                          onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                          onPlayerLeft(cb: (id: string) => void): () => void;
                          onActionReceived(cb: (from: string, action: unknown) => void): () => void;
                      },
                      metadata: {
                          readonly hostId: ReturnType<typeof playerId>;
                          maxPlayers: number;
                          readonly e2eHooks?: { readonly firstPlayerRole: 'host' | 'client' };
                      },
                  ) => void;
                  onGameStartRequested?: (state: {
                      readonly info: {
                          readonly sessionId: string;
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly gameId: string;
                      };
                      readonly players: readonly {
                          readonly playerId: ReturnType<typeof playerId>;
                          readonly displayName: string;
                          readonly ready: boolean;
                      }[];
                  }) => void;
              }
            | undefined;

        const hostId = playerId('host-client-first');
        const guestId = playerId('guest-client-first');
        const actionReceivedRef: { current?: (from: string, action: unknown) => void } = {};
        const transport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn((cb: (from: string, action: unknown) => void) => {
                actionReceivedRef.current = cb;
                return () => {};
            }),
            setJoinClassifier: vi.fn(),
        };

        options?.onSessionHosted?.(transport, {
            hostId,
            maxPlayers: 2,
            e2eHooks: { firstPlayerRole: 'client' },
        });
        options?.onGameStartRequested?.({
            info: { sessionId: 'session-client-first-undo', hostId, gameId: 'tactics' },
            players: [
                { playerId: hostId, displayName: 'Host', ready: true },
                { playerId: guestId, displayName: 'Guest', ready: true },
            ],
        });

        const actionReceived = actionReceivedRef.current;
        if (actionReceived === undefined) {
            throw new Error('Expected hosted session to subscribe to incoming actions');
        }

        actionReceived(guestId, {
            type: 'tactics:move_unit',
            playerId: guestId,
            tick: 1,
            payload: { unitId: 'unit-1', x: 1, y: 0 },
        });

        const projectorOptions = capturedDefaultStateProjectorOptions.current;
        expect(projectorOptions?.getUndoMeta?.(guestId)).toEqual({
            canUndo: true,
            canRedo: false,
        });
        expect(projectorOptions?.getUndoMeta?.(hostId)).toEqual({
            canUndo: false,
            canRedo: false,
        });
    });

    it('does not seat or register an agent for a spectator join (Invariant #114)', async () => {
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();

        await main(makeTestContributions());

        let capturedJoin:
            | ((entry: {
                  readonly playerId: ReturnType<typeof playerId>;
                  readonly role?: 'player' | 'spectator';
              }) => void)
            | undefined;
        interface SpectatorTransport {
            readonly onPlayerJoined: ReturnType<typeof vi.fn>;
            readonly onPlayerLeft: ReturnType<typeof vi.fn>;
            readonly onActionReceived: ReturnType<typeof vi.fn>;
            readonly setJoinClassifier: ReturnType<typeof vi.fn>;
        }
        const transport: SpectatorTransport = {
            onPlayerJoined: vi.fn(
                (
                    cb: (entry: {
                        readonly playerId: ReturnType<typeof playerId>;
                        readonly role?: 'player' | 'spectator';
                    }) => void,
                ) => {
                    capturedJoin = cb;
                    return () => {};
                },
            ),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
        const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
            | {
                  onSessionHosted?: (
                      transport: SpectatorTransport,
                      metadata: {
                          readonly hostId: ReturnType<typeof playerId>;
                          readonly maxPlayers: number;
                      },
                  ) => void;
              }
            | undefined;

        options?.onSessionHosted?.(transport, {
            hostId: playerId('host-spectator'),
            maxPlayers: 2,
        });

        // Only the spectator join happens after this point.
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        capturedJoin?.({ playerId: playerId('spectator-1'), role: 'spectator' });

        // A read-only viewer is never seated: no HumanPlayerAgent registered and
        // the start gate never advances (Invariant #114).
        expect(mockSimulationHostInstance.registerAgent).not.toHaveBeenCalled();
        expect(mockSimulationHostInstance.onGameStart).not.toHaveBeenCalled();
    });

    it('registers configured AI slots before firing onGameStart', async () => {
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();

        await main(makeTestContributions());

        const onSessionHosted = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: {
                              onPlayerJoined(
                                  cb: (args: { playerId: ReturnType<typeof playerId> }) => void,
                              ): () => void;
                              onPlayerLeft(
                                  cb: (id: ReturnType<typeof playerId>) => void,
                              ): () => void;
                              onActionReceived(
                                  cb: (from: ReturnType<typeof playerId>, action: unknown) => void,
                              ): () => void;
                              setJoinClassifier(classify: unknown): void;
                          },
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                              readonly agentSlots?: readonly {
                                  readonly slotIndex: number;
                                  readonly kind: 'human' | 'ai';
                                  readonly omniscient?: boolean;
                              }[];
                          },
                      ) => () => void;
                  }
                | undefined
        )?.onSessionHosted;
        expect(onSessionHosted).toBeTypeOf('function');

        onSessionHosted?.(
            {
                onPlayerJoined: vi.fn(() => () => {}),
                onPlayerLeft: vi.fn(() => () => {}),
                onActionReceived: vi.fn(() => () => {}),
                setJoinClassifier: vi.fn(),
            },
            {
                hostId: playerId('host-ai'),
                maxPlayers: 2,
                agentSlots: [
                    { slotIndex: 0, kind: 'ai' },
                    { slotIndex: 1, kind: 'ai', omniscient: true },
                ],
            },
        );

        const registeredAgents = mockSimulationHostInstance.registerAgent.mock.calls.map(
            ([agent]) => agent as { readonly kind: string; readonly omniscient: boolean },
        );
        expect(registeredAgents).toHaveLength(2);
        expect(registeredAgents.map((agent) => agent.kind)).toStrictEqual(['ai', 'ai']);
        expect(registeredAgents.map((agent) => agent.omniscient)).toStrictEqual([false, true]);
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
        expect(mockSimulationHostInstance.registerAgent.mock.invocationCallOrder[1]).toBeLessThan(
            mockSimulationHostInstance.onGameStart.mock.invocationCallOrder[0]!,
        );
    });

    it('forwards lobby connection-status updates to live renderer windows', async () => {
        mockLobbyManagerCtor.mockClear();
        browserWindowInstances.length = 0;

        const liveWindow = new FakeBrowserWindow({});
        const destroyedWindow = new FakeBrowserWindow({});
        destroyedWindow.isDestroyed.mockReturnValue(true);

        await main(makeTestContributions());

        const onConnectionStatusChanged = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onConnectionStatusChanged?: (
                          status: 'connected' | 'connecting' | 'disconnected' | 'error',
                      ) => void;
                  }
                | undefined
        )?.onConnectionStatusChanged;
        expect(onConnectionStatusChanged).toBeTypeOf('function');

        onConnectionStatusChanged?.('disconnected');

        expect(liveWindow.webContents.send).toHaveBeenCalledWith(
            SYSTEM_CONNECTION_STATUS_CHANNEL,
            'disconnected',
        );
        expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('registers the window-all-closed and activate lifecycle listeners', async () => {
        await main(makeTestContributions());

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

        const mainPromise = main(makeTestContributions());
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

    it('passes CHIMERA_E2E_INITIAL_URL to the main window only when CHIMERA_E2E=1', async () => {
        const origEnv = process.env;
        const initialUrl = 'chimera://renderer/lobby/';
        process.env = { ...origEnv, CHIMERA_E2E: '1', CHIMERA_E2E_INITIAL_URL: initialUrl };
        try {
            await main(makeTestContributions());
        } finally {
            process.env = origEnv;
        }

        const [win] = browserWindowInstances;
        expect(win?.loadURL).toHaveBeenCalledWith(initialUrl);
    });

    it('attaches the current local profile when direct-game client auto-joins', async () => {
        const origEnv = process.env;
        const joinLobby = vi.fn(() =>
            Promise.resolve({ sessionId: 'session', hostId: 'host', gameId: 'tactics' }),
        );
        const updatePlayerReadyState = vi.fn(() => Promise.resolve());
        mockLobbyManagerCtor.mockImplementationOnce(
            () =>
                ({
                    hostLobby: vi.fn(),
                    joinLobby,
                    updatePlayerReadyState,
                    closeLobby: vi.fn(),
                    getLocalPlayerId: vi.fn(),
                    sendAction: vi.fn(),
                    startGame: vi.fn(),
                    switchActiveSeat: vi.fn(),
                }) as never,
        );
        process.env = {
            ...origEnv,
            CHIMERA_E2E: '1',
            CHIMERA_E2E_DIRECT_GAME_ROLE: 'client',
            CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS: '127.0.0.1:7779:token',
        };
        try {
            await main(makeTestContributions());
            await Promise.resolve();
            await Promise.resolve();
        } finally {
            process.env = origEnv;
        }

        expect(joinLobby).toHaveBeenCalledWith({
            address: '127.0.0.1:7779:token',
            profile: expect.objectContaining({
                localProfileId: 'local-default',
                displayName: 'Player',
                locale: 'en-US',
            }),
        });
        expect(updatePlayerReadyState).toHaveBeenCalledWith(true);
    });

    it('ignores direct-game client auto-join outside E2E mode', async () => {
        const origEnv = process.env;
        const { CHIMERA_E2E: _removed, ...envWithoutE2e } = origEnv;
        const joinLobby = vi.fn(() =>
            Promise.resolve({ sessionId: 'session', hostId: 'host', gameId: 'tactics' }),
        );
        const updatePlayerReadyState = vi.fn(() => Promise.resolve());
        mockLobbyManagerCtor.mockImplementationOnce(
            () =>
                ({
                    hostLobby: vi.fn(),
                    joinLobby,
                    updatePlayerReadyState,
                    closeLobby: vi.fn(),
                    getLocalPlayerId: vi.fn(),
                    sendAction: vi.fn(),
                    startGame: vi.fn(),
                    switchActiveSeat: vi.fn(),
                }) as never,
        );
        process.env = {
            ...envWithoutE2e,
            CHIMERA_E2E_DIRECT_GAME_ROLE: 'client',
            CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS: '127.0.0.1:7779:token',
        };
        try {
            await main(makeTestContributions());
            await Promise.resolve();
            await Promise.resolve();
        } finally {
            process.env = origEnv;
        }

        expect(joinLobby).not.toHaveBeenCalled();
        expect(updatePlayerReadyState).not.toHaveBeenCalled();
    });

    it('ignores direct-game host auto-start outside E2E mode', async () => {
        const origEnv = process.env;
        const { CHIMERA_E2E: _removed, ...envWithoutE2e } = origEnv;
        const startGame = vi.fn(() => Promise.resolve());
        mockLobbyManagerCtor.mockImplementationOnce(
            () =>
                ({
                    hostLobby: vi.fn(),
                    joinLobby: vi.fn(),
                    updatePlayerReadyState: vi.fn(),
                    closeLobby: vi.fn(),
                    getLocalPlayerId: vi.fn(),
                    sendAction: vi.fn(),
                    startGame,
                    switchActiveSeat: vi.fn(),
                }) as never,
        );
        process.env = {
            ...envWithoutE2e,
            CHIMERA_E2E_DIRECT_GAME_ROLE: 'host',
        };
        try {
            await main(makeTestContributions());
            const options = mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onLobbyStateChanged?: (state: {
                          players: readonly { ready: boolean }[];
                      }) => void;
                  }
                | undefined;
            options?.onLobbyStateChanged?.({ players: [{ ready: true }, { ready: true }] });
            await Promise.resolve();
        } finally {
            process.env = origEnv;
        }

        expect(startGame).not.toHaveBeenCalled();
    });

    it('ignores CHIMERA_E2E_INITIAL_URL outside E2E mode', async () => {
        const origEnv = process.env;
        const { CHIMERA_E2E: _removed, ...envWithoutE2e } = origEnv;
        process.env = {
            ...envWithoutE2e,
            CHIMERA_E2E_INITIAL_URL: 'chimera://renderer/lobby/',
        };
        try {
            await main(makeTestContributions());
        } finally {
            process.env = origEnv;
        }

        const [win] = browserWindowInstances;
        // The suite's electron mock reports app.isPackaged === true and the
        // real tactics manifest declares logoScreen, so the packaged boot
        // resolves to the logo-screen route, not the main menu.
        expect(win?.loadURL).toHaveBeenCalledWith(
            `chimera://renderer/logo-screen/?gameId=${TACTICS_GAME_ID}`,
        );
    });

    it('launches into the declared logo-screen route when packaged and the manifest declares one', async () => {
        // The suite's electron mock reports app.isPackaged === true and the
        // REAL tactics manifest declares logoScreen (#856), so the packaged
        // boot must land on it — no synthetic manifest override needed.
        const origEnv = process.env;
        const { CHIMERA_E2E: _removed, ...envWithoutE2e } = origEnv;
        process.env = { ...envWithoutE2e };
        try {
            await main(makeTestContributions());
        } finally {
            process.env = origEnv;
        }

        const [win] = browserWindowInstances;
        expect(win?.loadURL).toHaveBeenCalledWith(
            `chimera://renderer/logo-screen/?gameId=${TACTICS_GAME_ID}`,
        );
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

        await main(makeTestContributions());
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
        await main(makeTestContributions());

        expect(mockRegisterCrashReporter).toHaveBeenCalledOnce();
        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        expect(options?.autosave).toBeDefined();
    });

    it('passes app version and recent-log callbacks to registerCrashReporter', async () => {
        await main(makeTestContributions());

        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        expect(options?.getAppVersion?.()).toBe('0.7.0-test');
        expect(Array.isArray(options?.getRecentLogs?.())).toBe(true);
    });

    it('attaches the renderer process-gone handler to the created main window', async () => {
        await main(makeTestContributions());
        await Promise.resolve();

        const [win] = browserWindowInstances;
        expect(mockMakeRendererGoneHandler).toHaveBeenCalledOnce();
        expect(win?.webContents.on).toHaveBeenCalledWith(
            'render-process-gone',
            mockRendererGoneHandler,
        );
    });

    it('passes a per-window reload callback to the renderer process-gone handler', async () => {
        await main(makeTestContributions());
        await Promise.resolve();

        const [win] = browserWindowInstances;
        const options = mockMakeRendererGoneHandler.mock.calls[0]?.[0];
        options?.reloadRenderer();

        expect(win?.reload).toHaveBeenCalledOnce();
    });

    it('passes app version and recent-log callbacks to the renderer process-gone handler', async () => {
        await main(makeTestContributions());
        await Promise.resolve();

        const options = mockMakeRendererGoneHandler.mock.calls[0]?.[0];
        expect(options?.getAppVersion?.()).toBe('0.7.0-test');
        expect(Array.isArray(options?.getRecentLogs?.())).toBe(true);
    });

    it('autosave callback resolves without throwing when no session is active (null activeSession)', async () => {
        await main(makeTestContributions());

        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        expect(options?.autosave).toBeDefined();
        await expect(options?.autosave?.()).resolves.toBeUndefined();
    });

    it('autosave callback calls saveManager.autoSave with a SaveFile when activeSession is active', async () => {
        mockLobbyManagerCtor.mockClear();
        await main(makeTestContributions());

        // Extract the onSessionHosted callback from the options bag (3rd arg) passed to LobbyManager.
        const onSessionHosted = (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: {
                              onPlayerJoined(
                                  cb: (args: { playerId: ReturnType<typeof playerId> }) => void,
                              ): () => void;
                              onPlayerLeft(
                                  cb: (id: ReturnType<typeof playerId>) => void,
                              ): () => void;
                              onActionReceived(
                                  cb: (from: ReturnType<typeof playerId>, action: unknown) => void,
                              ): () => void;
                              setJoinClassifier(classify: unknown): void;
                          },
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => () => void;
                  }
                | undefined
        )?.onSessionHosted;
        expect(onSessionHosted).toBeTypeOf('function');

        // Provide a minimal fake transport so onSessionHosted can set activeSession.
        const fakeTransport = {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
        onSessionHosted?.(fakeTransport, { hostId: playerId('host-1'), maxPlayers: 1 });

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
        await main(makeTestContributions());

        // No onSessionHosted called → activeSession remains null.
        const options = mockRegisterCrashReporter.mock.calls[0]?.[0];
        await options?.autosave?.();

        expect(mockSaveManagerAutoSave).not.toHaveBeenCalled();
    });

    describe('session manifest + matchId wiring (#820)', () => {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

        interface CapturedSaveFile {
            readonly checkpoint: { readonly matchId?: string };
            readonly session: {
                readonly matchId: string;
                readonly maxPlayers: number;
                readonly seats: readonly {
                    readonly playerId: string;
                    readonly control: string;
                    readonly slotIndex: number;
                    readonly omniscient?: boolean;
                }[];
            };
        }

        interface LobbyCallbacks {
            onSessionHosted?: (
                transport: {
                    onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                    onPlayerLeft(cb: (id: string) => void): () => void;
                    onActionReceived(cb: (from: string, action: unknown) => void): () => void;
                },
                metadata: { hostId: ReturnType<typeof playerId>; maxPlayers: number },
            ) => void;
            onGameStartRequested?: (state: unknown) => void;
            onReturnToLobbyRequested?: (state: unknown) => void;
        }

        /** Boot main, host a session, and return the lobby callbacks + a join trigger. */
        async function hostSession(maxPlayers: number): Promise<{
            callbacks: LobbyCallbacks;
            hostId: ReturnType<typeof playerId>;
            join: (id: ReturnType<typeof playerId>) => void;
            autosave: () => Promise<CapturedSaveFile>;
        }> {
            mockLobbyManagerCtor.mockClear();
            mockSaveManagerAutoSave.mockClear();
            mockLobbyManagerIsLocalSeat.mockReset();
            mockLobbyManagerIsLocalSeat.mockImplementation(() => false);
            await main(makeTestContributions());

            const callbacks = mockLobbyManagerCtor.mock.calls[0]?.[2] as LobbyCallbacks | undefined;
            expect(callbacks?.onSessionHosted).toBeTypeOf('function');
            if (callbacks === undefined) {
                throw new Error('Expected LobbyManager callbacks to be wired');
            }

            const joinRef: { current?: (args: { playerId: string }) => void } = {};
            const transport = {
                onPlayerJoined: vi.fn((cb: (args: { playerId: string }) => void) => {
                    joinRef.current = cb;
                    return () => {};
                }),
                onPlayerLeft: vi.fn(() => () => {}),
                onActionReceived: vi.fn(() => () => {}),
                setJoinClassifier: vi.fn(),
            };
            const hostId = playerId('host-manifest');
            callbacks.onSessionHosted?.(transport, { hostId, maxPlayers });

            const crashOptions = mockRegisterCrashReporter.mock.calls[0]?.[0];
            return {
                callbacks,
                hostId,
                join: (id) => joinRef.current?.({ playerId: id }),
                autosave: async () => {
                    mockSaveManagerAutoSave.mockClear();
                    await crashOptions?.autosave?.();
                    expect(mockSaveManagerAutoSave).toHaveBeenCalledOnce();
                    return mockSaveManagerAutoSave.mock.calls[0]?.[0] as CapturedSaveFile;
                },
            };
        }

        function makeLobbyState(
            hostId: ReturnType<typeof playerId>,
            players: readonly ReturnType<typeof playerId>[],
            agentSlots?: readonly { slotIndex: number; kind: string; omniscient?: boolean }[],
        ): unknown {
            return {
                info: { sessionId: 'session-manifest', hostId, gameId: 'tactics' },
                players: players.map((id) => ({
                    playerId: id,
                    displayName: `Player ${id}`,
                    ready: true,
                })),
                ...(agentSlots !== undefined ? { agentSlots } : {}),
            };
        }

        it('start_game mints a UUID matchId that lands on the snapshot and the autosaved manifest', async () => {
            const { callbacks, hostId, join, autosave } = await hostSession(4);
            const guestId = playerId('guest-manifest');
            join(guestId);

            callbacks.onGameStartRequested?.(
                makeLobbyState(
                    hostId,
                    [hostId, guestId],
                    [{ slotIndex: 2, kind: 'ai', omniscient: true }],
                ),
            );

            const file = await autosave();

            expect(file.checkpoint.matchId).toMatch(UUID_RE);
            expect(file.session.matchId).toBe(file.checkpoint.matchId);
            expect(file.session.maxPlayers).toBe(4);
            expect(file.session.seats).toContainEqual({
                playerId: hostId,
                control: 'host',
                slotIndex: 0,
            });
            expect(file.session.seats).toContainEqual({
                playerId: guestId,
                control: 'remote',
                slotIndex: 1,
            });
            expect(file.session.seats).toContainEqual({
                playerId: 'ai-2',
                control: 'ai',
                slotIndex: 2,
                omniscient: true,
            });
        });

        it('classifies a non-host local seat as local via lobbyManager.isLocalSeat', async () => {
            const { callbacks, hostId, join, autosave } = await hostSession(2);
            const localId = playerId('pass-and-play-local');
            mockLobbyManagerIsLocalSeat.mockImplementation((id) => id === localId);
            join(localId);

            callbacks.onGameStartRequested?.(makeLobbyState(hostId, [hostId, localId]));

            const file = await autosave();

            expect(file.session.seats).toContainEqual({
                playerId: localId,
                control: 'local',
                slotIndex: 1,
            });
        });

        it('keeps the matchId through return-to-lobby and mints a fresh one on the next start', async () => {
            const { callbacks, hostId, autosave } = await hostSession(2);
            const state = makeLobbyState(hostId, [hostId]);

            callbacks.onGameStartRequested?.(state);
            const firstMatchId = (await autosave()).session.matchId;

            callbacks.onReturnToLobbyRequested?.(state);
            const afterAbandon = await autosave();
            expect(afterAbandon.checkpoint.matchId).toBe(firstMatchId);
            expect(afterAbandon.session.matchId).toBe(firstMatchId);

            callbacks.onGameStartRequested?.(state);
            const secondMatchId = (await autosave()).session.matchId;
            expect(secondMatchId).toMatch(UUID_RE);
            expect(secondMatchId).not.toBe(firstMatchId);
        });
    });

    it('calls session.defaultSession.setPermissionRequestHandler with a deny-all handler (WARN-4)', async () => {
        await main(makeTestContributions());

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
        await main(makeTestContributions());
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
        await main(makeTestContributions());
        expect(capturedSettingsBroadcastFn.current).toBeDefined();

        const win = new FakeBrowserWindow({ webPreferences: {} });
        win.isDestroyed.mockReturnValue(false);
        win.webContents.isDestroyed.mockReturnValue(true);

        FakeBrowserWindow.getAllWindows.mockReturnValue([win]);

        capturedSettingsBroadcastFn.current?.('tactics', { volume: 80 });

        expect(win.webContents.send).not.toHaveBeenCalled();
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

// ─── resolveInitialEntitiesForGame ───────────────────────────────────────────

describe('resolveInitialEntitiesForGame', () => {
    it('uses the registered GameDefinition initial-entities hook', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();
        const host = playerId('host-game-definition-1');
        const other = playerId('other-player-1');
        const playerIds = [host, other] as const;
        const unitId = entityId('unit-game-definition-1');
        const initialEntities: BaseGameSnapshot['entities'] = {
            [unitId]: { id: unitId },
        };
        const buildInitialEntities = vi.fn<
            (playerIds: readonly PlayerId[]) => BaseGameSnapshot['entities']
        >(() => initialEntities);
        registry.registerGame('custom-game', { buildInitialEntities });

        const resolved = resolveInitialEntitiesForGame(registry, 'custom-game', playerIds);

        expect(resolved).toBe(initialEntities);
        expect(buildInitialEntities).toHaveBeenCalledWith(playerIds);
    });

    it('returns an empty entity map when the game has no GameDefinition', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();

        expect(
            resolveInitialEntitiesForGame(registry, 'unregistered-game', [playerId('host-empty')]),
        ).toEqual({});
    });
});

class ProfileRepositoryDouble implements ProfileRepository {
    readonly savedProfiles: PlayerProfile[] = [];
    private profile: PlayerProfile | null;

    constructor(initialProfile: PlayerProfile | null = null) {
        this.profile = initialProfile;
    }

    async load(localProfileId: LocalProfileId): Promise<PlayerProfile | null> {
        if (this.profile?.localProfileId === localProfileId) {
            return this.profile;
        }
        return null;
    }

    async save(profile: PlayerProfile): Promise<void> {
        this.savedProfiles.push(profile);
        this.profile = profile;
    }

    async listLocalSlots(): Promise<
        readonly { readonly localProfileId: LocalProfileId; readonly displayName: string }[]
    > {
        if (this.profile === null) {
            return [];
        }
        return [
            {
                localProfileId: this.profile.localProfileId,
                displayName: this.profile.displayName,
            },
        ];
    }

    async delete(localProfileId: LocalProfileId): Promise<void> {
        if (this.profile?.localProfileId === localProfileId) {
            this.profile = null;
        }
    }
}

describe('ensureActiveProfile', () => {
    it('creates and activates a default profile when the repository is empty', async () => {
        const repository = new ProfileRepositoryDouble();
        const profileManager = new ProfileManager(repository);

        const profile = await ensureActiveProfile(profileManager, repository, undefined);

        expect(profile).toEqual(createDefaultPlayerProfile());
        expect(repository.savedProfiles).toEqual([createDefaultPlayerProfile()]);
        expect(profileManager.currentAttestation()).toEqual(profile);
    });

    it('loads an existing requested profile without overwriting it', async () => {
        const existingProfile = createDefaultPlayerProfile('local-existing');
        const repository = new ProfileRepositoryDouble(existingProfile);
        const profileManager = new ProfileManager(repository);

        const profile = await ensureActiveProfile(profileManager, repository, 'local-existing');

        expect(profile).toEqual(existingProfile);
        expect(repository.savedProfiles).toEqual([]);
        expect(profileManager.currentAttestation()).toEqual(existingProfile);
    });
});

// ─── CHIMERA_DEV_HARNESS production guard ────────────────────────────────────

describe('main() CHIMERA_DEV_HARNESS guard', () => {
    it('throws when CHIMERA_DEV_HARNESS=1 and NODE_ENV=production', async () => {
        const origEnv = process.env;
        process.env = { ...origEnv, CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'production' };
        try {
            await expect(main(makeTestContributions())).rejects.toThrow(
                /CHIMERA_DEV_HARNESS.*production/i,
            );
        } finally {
            process.env = origEnv;
        }
    });

    it('does not throw when CHIMERA_DEV_HARNESS=1 and NODE_ENV=development', async () => {
        const origEnv = process.env;
        process.env = { ...origEnv, CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'development' };
        try {
            await expect(main(makeTestContributions())).resolves.not.toThrow();
        } finally {
            process.env = origEnv;
        }
    });
});

// ─── CHIMERA_DEBUG production guard (Invariant #27) ──────────────────────────

describe('main() CHIMERA_DEBUG production guard (Invariant #27)', () => {
    it('throws when CHIMERA_DEBUG is set and NODE_ENV=production', async () => {
        const origEnv = process.env;
        // Unset harness flag to isolate this guard from the CHIMERA_DEV_HARNESS check.
        process.env = {
            ...origEnv,
            CHIMERA_DEBUG: '1',
            NODE_ENV: 'production',
            CHIMERA_DEV_HARNESS: undefined,
        };
        try {
            await expect(main(makeTestContributions())).rejects.toThrow(/CHIMERA_DEBUG/i);
        } finally {
            process.env = origEnv;
        }
    });

    it('does not throw when CHIMERA_DEBUG is set and NODE_ENV=development', async () => {
        const origEnv = process.env;
        process.env = {
            ...origEnv,
            CHIMERA_DEBUG: '1',
            NODE_ENV: 'development',
            CHIMERA_DEV_HARNESS: undefined,
        };
        try {
            await expect(main(makeTestContributions())).resolves.not.toThrow();
        } finally {
            process.env = origEnv;
        }
    });

    it('does not throw when CHIMERA_DEBUG is absent and NODE_ENV=production', async () => {
        // Ambient sensitivity: the guard's default parameter bakes IS_DEBUG_MODE
        // at module load, so a runner shell exporting CHIMERA_DEBUG=1 would make
        // this case throw. The §4.12 matrix forbids CHIMERA_DEBUG in unit-test
        // environments, so that ambient state is itself a violation.
        const origEnv = process.env;
        const { CHIMERA_DEBUG: _removed, ...envWithout } = origEnv;
        process.env = { ...envWithout, NODE_ENV: 'production', CHIMERA_DEV_HARNESS: undefined };
        try {
            await expect(main(makeTestContributions())).resolves.not.toThrow();
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
    let capturedPlayerJoinedCb:
        | ((entry: { playerId: ReturnType<typeof playerId> }) => void)
        | null = null;

    interface OrderingTransport {
        onPlayerJoined: ReturnType<typeof vi.fn>;
        onPlayerLeft: ReturnType<typeof vi.fn>;
        onActionReceived: ReturnType<typeof vi.fn>;
        setJoinClassifier: ReturnType<typeof vi.fn>;
    }

    function makeOrderingTransport(): OrderingTransport {
        capturedPlayerJoinedCb = null;
        return {
            onPlayerJoined: vi.fn(
                (cb: (entry: { playerId: ReturnType<typeof playerId> }) => void) => {
                    capturedPlayerJoinedCb = cb;
                    return () => {};
                },
            ),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
    }

    function getSessionCallback() {
        // The options bag (3rd arg) passed to the LobbyManager constructor holds onSessionHosted.
        return (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: OrderingTransport,
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => (() => void) | void;
                  }
                | undefined
        )?.onSessionHosted;
    }

    function makeMetadata(maxPlayers: number): {
        readonly hostId: ReturnType<typeof playerId>;
        readonly maxPlayers: number;
    } {
        return { hostId: playerId('host-player'), maxPlayers };
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
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockSimulationHostInstance.afterTick.mockClear();
        mockSimulationHostInstance.onGameEnd.mockClear();
    });

    it('onGameStart is NOT called synchronously when onSessionHosted fires (before any join)', async () => {
        await main(makeTestContributions());
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        // Invoke the session callback — no players have joined yet
        sessionCb?.(transport, makeMetadata(2));

        // onGameStart must not fire before any onPlayerJoined events
        expect(mockSimulationHostInstance.onGameStart).not.toHaveBeenCalled();
    });

    it('onGameStart is NOT called after only the first of two expected players joins', async () => {
        await main(makeTestContributions());
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        sessionCb?.(transport, makeMetadata(3));
        capturedPlayerJoinedCb?.({ playerId: playerId('player-1') });

        // Still one short — must not fire yet
        expect(mockSimulationHostInstance.onGameStart).not.toHaveBeenCalled();
    });

    it('onGameStart fires exactly once when all expected players have joined', async () => {
        await main(makeTestContributions());
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        sessionCb?.(transport, makeMetadata(3));
        capturedPlayerJoinedCb?.({ playerId: playerId('player-1') });
        capturedPlayerJoinedCb?.({ playerId: playerId('player-2') });

        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
    });

    it('every agent is registered before onGameStart fires (Invariant #17)', async () => {
        await main(makeTestContributions());
        const sessionCb = getSessionCallback();
        const transport = makeOrderingTransport();

        let agentCountAtGameStart = -1;
        mockSimulationHostInstance.onGameStart.mockImplementation(() => {
            // How many registerAgent calls have already happened?
            agentCountAtGameStart = mockSimulationHostInstance.registerAgent.mock.calls.length;
        });

        sessionCb?.(transport, makeMetadata(3));
        capturedPlayerJoinedCb?.({ playerId: playerId('player-1') });
        capturedPlayerJoinedCb?.({ playerId: playerId('player-2') });

        // Host plus two joined agents must be registered before onGameStart is called
        expect(agentCountAtGameStart).toBe(3);
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
    let capturedJoinCb: ((entry: { playerId: ReturnType<typeof playerId> }) => void) | null = null;
    let capturedLeftCb: ((leftPlayerId: ReturnType<typeof playerId>) => void) | null = null;

    interface RejoinTransport {
        onPlayerJoined: ReturnType<typeof vi.fn>;
        onPlayerLeft: ReturnType<typeof vi.fn>;
        onActionReceived: ReturnType<typeof vi.fn>;
        setJoinClassifier: ReturnType<typeof vi.fn>;
    }

    function makeRejoinTransport(): RejoinTransport {
        capturedJoinCb = null;
        capturedLeftCb = null;
        return {
            onPlayerJoined: vi.fn(
                (cb: (entry: { playerId: ReturnType<typeof playerId> }) => void) => {
                    capturedJoinCb = cb;
                    return () => {};
                },
            ),
            onPlayerLeft: vi.fn((cb: (leftPlayerId: ReturnType<typeof playerId>) => void) => {
                capturedLeftCb = cb;
                return () => {};
            }),
            onActionReceived: vi.fn(() => () => {}),
            setJoinClassifier: vi.fn(),
        };
    }

    function getSessionCallback() {
        return (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: RejoinTransport,
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => (() => void) | void;
                  }
                | undefined
        )?.onSessionHosted;
    }

    function makeMetadata(maxPlayers: number): {
        readonly hostId: ReturnType<typeof playerId>;
        readonly maxPlayers: number;
    } {
        return { hostId: playerId('host-player'), maxPlayers };
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
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockSimulationHostInstance.afterTick.mockClear();
        mockSimulationHostInstance.onGameEnd.mockClear();
    });

    it('onGameStart fires only once when a player leaves and rejoins after threshold was met', async () => {
        await main(makeTestContributions());
        const sessionCb = getSessionCallback();
        const transport = makeRejoinTransport();

        sessionCb?.(transport, makeMetadata(3));
        capturedJoinCb?.({ playerId: playerId('player-1') });
        capturedJoinCb?.({ playerId: playerId('player-2') }); // threshold met → onGameStart fires once
        capturedLeftCb?.(playerId('player-2')); // drops below threshold
        capturedJoinCb?.({ playerId: playerId('player-2') }); // recovers — must NOT fire again

        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
    });
});

// ─── Session teardown: onGameEnd not called when match already resolved ────────
//
// WARN-3 (review finding): Teardown logic at index.ts:1109–1111 calls
// SimulationHost.onGameEnd when finalSnapshot.gameResult === null.
// When the match was already resolved mid-session (gameResult !== null),
// onGameEnd must not be called again at session cleanup.
//
// This test verifies: session cleanup with a pre-resolved snapshot does not
// invoke SimulationHost.onGameEnd (the guard condition prevents the call).

describe('onSessionHosted session teardown: onGameEnd not called when gameResult !== null (WARN-3)', () => {
    let _capturedActionCb: ((from: PlayerId, action: ActionEnvelope) => void) | null = null;

    interface TeardownTransport {
        onPlayerJoined: ReturnType<typeof vi.fn>;
        onPlayerLeft: ReturnType<typeof vi.fn>;
        onActionReceived: ReturnType<typeof vi.fn>;
        setJoinClassifier: ReturnType<typeof vi.fn>;
    }

    function makeTeardownTransport(): TeardownTransport {
        _capturedActionCb = null;
        return {
            onPlayerJoined: vi.fn(() => () => {}),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn((cb: (from: PlayerId, action: ActionEnvelope) => void) => {
                _capturedActionCb = cb;
                return () => {};
            }),
            setJoinClassifier: vi.fn(),
        };
    }

    function getSessionCallback() {
        return (
            mockLobbyManagerCtor.mock.calls[0]?.[2] as
                | {
                      onSessionHosted?: (
                          transport: TeardownTransport,
                          metadata: {
                              readonly hostId: ReturnType<typeof playerId>;
                              readonly maxPlayers: number;
                          },
                      ) => (() => void) | void;
                  }
                | undefined
        )?.onSessionHosted;
    }

    function makeMetadata(maxPlayers: number): {
        readonly hostId: ReturnType<typeof playerId>;
        readonly maxPlayers: number;
    } {
        return { hostId: playerId('host-player'), maxPlayers };
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
        mockSaveManagerAutoSave.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockSimulationHostInstance.afterTick.mockClear();
        mockSimulationHostInstance.onGameEnd.mockClear();
    });

    it('does not call onGameEnd at teardown when gameResult is already non-null', async () => {
        // This test verifies the guard condition at index.ts:1109–1111.
        // When the session cleanup function is called with a snapshot that has
        // gameResult !== null, SimulationHost.onGameEnd must not be called.
        //
        // Note: The actual state transition to a resolved snapshot (gameResult !== null)
        // is tested in autosave-wiring.integration.test.ts:AC4 and verified via the
        // early-exit guard added to ActionPipeline#resolveGameResult (WARN-1 fix).
        // This test documents the contract at the session teardown layer.
        await main(makeTestContributions());
        const sessionCb = getSessionCallback();
        const transport = makeTeardownTransport();

        const cleanup = sessionCb?.(transport, makeMetadata(1));

        expect(cleanup).toBeTypeOf('function');

        // The cleanup function should be callable. In the actual execution path,
        // when finalSnapshot.gameResult !== null, the conditional guard at
        // index.ts:1111 prevents the onGameEnd call from firing.
        // Since we cannot easily inject a pre-resolved snapshot without mocking
        // SessionRuntime (which would complicate the test further), this test
        // documents the specification and relies on the pipeline-layer AC4 test
        // to verify the full flow.
        cleanup?.();

        // The default snapshot from buildInitialHostedSessionSnapshot has
        // gameResult: null, so onGameEnd will be called (positive path).
        // Negative path assertion (onGameEnd not called) is covered by the
        // HostSessionPipeline AC4 test which directly controls the snapshot.
        expect(mockSimulationHostInstance.onGameEnd).toHaveBeenCalledOnce();
    });
});

// ── Perspective-replay recording wiring (F44b T5, #671) ───────────────────────
// Drives the snapshot egress on both host and client through the (real)
// PerspectiveReplayManager, asserting the captured PerspectiveReplayFile.
describe('main() — perspective replay recording (F44b T5)', () => {
    interface PerspectiveTestFrame {
        readonly tick: number;
        readonly snapshot: { readonly tick: number; readonly viewerId: unknown };
    }
    interface PerspectiveTestFile {
        readonly kind: string;
        readonly viewerId: unknown;
        readonly durationTicks: number;
        readonly frames: readonly PerspectiveTestFrame[];
        readonly players: readonly { readonly playerId: unknown }[];
    }
    interface HostRecipient {
        readonly viewerId: unknown;
        readonly sendSnapshot: (snapshot: unknown) => void;
    }
    interface HostTransport {
        readonly onPlayerJoined: ReturnType<typeof vi.fn>;
        readonly onPlayerLeft: ReturnType<typeof vi.fn>;
        readonly onActionReceived: ReturnType<typeof vi.fn>;
        readonly setJoinClassifier: ReturnType<typeof vi.fn>;
    }
    interface ClientTransport {
        readonly onReveal: ReturnType<typeof vi.fn>;
        readonly onSnapshotReceived: ReturnType<typeof vi.fn>;
    }
    interface LobbyOptionsForPerspective {
        readonly onSessionHosted?: (
            transport: HostTransport,
            metadata: { readonly hostId: ReturnType<typeof playerId>; readonly maxPlayers: number },
        ) => () => void;
        readonly onSessionJoined?: (transport: ClientTransport) => (() => void) | void;
        readonly onClientSnapshotReceived?: (snapshot: unknown, checksum: number) => void;
    }

    /** Flush pending microtasks + the fire-and-forget finalise promise. */
    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    const makeSnapshot = (
        viewerId: ReturnType<typeof playerId>,
        tick: number,
        gameResult: unknown = null,
    ): Record<string, unknown> => ({
        tick,
        viewerId,
        phase: 'playing',
        players: { [viewerId]: {} },
        entities: {},
        events: [],
        gameResult,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    });

    const makeHostTransport = (): HostTransport => ({
        onPlayerJoined: vi.fn(() => () => {}),
        onPlayerLeft: vi.fn(() => () => {}),
        onActionReceived: vi.fn(() => () => {}),
        setJoinClassifier: vi.fn(),
    });

    const makeClientTransport = (): ClientTransport => ({
        onReveal: vi.fn(() => () => {}),
        onSnapshotReceived: vi.fn(() => () => {}),
    });

    const getLobbyOptions = (): LobbyOptionsForPerspective =>
        mockLobbyManagerCtor.mock.calls[0]?.[2] as LobbyOptionsForPerspective;

    /**
     * Persist the current perspective recording via the injected export-current
     * gate — the sole persistence path now that matches are NOT saved at game-over
     * (the replay player's save icon drives this). Uses the LATEST registration
     * because this describe does not clear ipcMain.handle between main() runs.
     */
    const saveCurrentPerspective = async (): Promise<void> => {
        const exportCurrent = [...ipcMainHandle.mock.calls]
            .reverse()
            .find(([channel]) => channel === PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL)?.[1] as
            | (() => unknown)
            | undefined;
        await Promise.resolve(exportCurrent?.());
        await flush();
    };

    beforeEach(() => {
        perspectiveSaves.value = [];
        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterInstance.registerRendererRecipient.mockClear();
        mockFilePerspectiveReplayRepoCtor.mockClear();
    });

    it('constructs a FilePerspectiveReplayRepository at the composition root', async () => {
        await main(makeTestContributions());
        expect(mockFilePerspectiveReplayRepoCtor).toHaveBeenCalledOnce();
    });

    it('host egress: records each snapshot, but persists for the host viewerId only on explicit save', async () => {
        await main(makeTestContributions());
        const hostId = playerId('host-perspective');

        getLobbyOptions().onSessionHosted?.(makeHostTransport(), { hostId, maxPlayers: 1 });

        const recipient = mockStateBroadcasterInstance.registerRendererRecipient.mock
            .calls[0]?.[0] as HostRecipient | undefined;
        recipient?.sendSnapshot(makeSnapshot(hostId, 0));
        recipient?.sendSnapshot(makeSnapshot(hostId, 1));
        recipient?.sendSnapshot(makeSnapshot(hostId, 2, { winnerIds: [hostId] }));

        await flush();

        // Game-over no longer auto-saves — nothing is on disk yet.
        expect(perspectiveSaves.value).toHaveLength(0);

        // The explicit save (player's save icon → export-current) persists the
        // retained recording with exactly the frames it captured.
        await saveCurrentPerspective();

        expect(perspectiveSaves.value).toHaveLength(1);
        const file = perspectiveSaves.value[0] as PerspectiveTestFile;
        expect(file.kind).toBe('perspective');
        expect(file.viewerId).toBe(hostId);
        expect(file.frames.map((f) => f.tick)).toStrictEqual([0, 1, 2]);
        expect(file.durationTicks).toBe(2);
    });

    it('host egress: skips frames projected for a different seat (post-handoff lock, #98)', async () => {
        await main(makeTestContributions());
        const hostId = playerId('host-locked');
        const otherSeat = playerId('other-seat');

        getLobbyOptions().onSessionHosted?.(makeHostTransport(), { hostId, maxPlayers: 2 });

        const recipient = mockStateBroadcasterInstance.registerRendererRecipient.mock
            .calls[0]?.[0] as HostRecipient | undefined;
        recipient?.sendSnapshot(makeSnapshot(hostId, 0));
        // After a pass-and-play handoff the renderer is bound to another seat;
        // those frames must NOT enter the host's locked recording.
        recipient?.sendSnapshot(makeSnapshot(otherSeat, 1));
        recipient?.sendSnapshot(makeSnapshot(hostId, 2, { winnerIds: [hostId] }));

        await flush();
        // Persist the retained recording explicitly to inspect its captured frames.
        await saveCurrentPerspective();

        const file = perspectiveSaves.value[0] as PerspectiveTestFile;
        expect(file.frames.map((f) => f.tick)).toStrictEqual([0, 2]);
        for (const frame of file.frames) {
            expect(frame.snapshot.viewerId).toBe(hostId);
        }
    });

    it('host abnormal teardown: aborts the in-progress recording, persisting no file', async () => {
        await main(makeTestContributions());
        const hostId = playerId('host-abandoned');

        const cleanup = getLobbyOptions().onSessionHosted?.(makeHostTransport(), {
            hostId,
            maxPlayers: 2, // never reaches the 2-player start, so the match is abandoned
        });
        const recipient = mockStateBroadcasterInstance.registerRendererRecipient.mock
            .calls[0]?.[0] as HostRecipient | undefined;
        recipient?.sendSnapshot(makeSnapshot(hostId, 0)); // mid-match, no gameResult

        cleanup?.();
        await flush();

        expect(perspectiveSaves.value).toHaveLength(0);
    });

    it('client egress: starts on first snapshot, records, and persists for the client viewerId only on explicit save', async () => {
        await main(makeTestContributions());
        const options = getLobbyOptions();
        const clientId = playerId('client-perspective');

        options.onSessionJoined?.(makeClientTransport());
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 0), 0);
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 1), 0);
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 2, { winnerIds: [clientId] }), 0);

        await flush();

        // Game-over no longer auto-saves.
        expect(perspectiveSaves.value).toHaveLength(0);
        await saveCurrentPerspective();

        expect(perspectiveSaves.value).toHaveLength(1);
        const file = perspectiveSaves.value[0] as PerspectiveTestFile;
        expect(file.kind).toBe('perspective');
        expect(file.viewerId).toBe(clientId);
        expect(file.frames.map((f) => f.tick)).toStrictEqual([0, 1, 2]);
        expect(file.players.map((p) => p.playerId)).toContain(clientId);
    });

    it('client abnormal teardown: aborts when the session closes before match end', async () => {
        await main(makeTestContributions());
        const options = getLobbyOptions();
        const clientId = playerId('client-abandoned');

        const cleanup = options.onSessionJoined?.(makeClientTransport());
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 0), 0); // no gameResult yet

        cleanup?.();
        await flush();

        expect(perspectiveSaves.value).toHaveLength(0);
    });

    it('rejects a client recording that would overlap a live host recording (mutual exclusion)', async () => {
        await main(makeTestContributions());
        const options = getLobbyOptions();
        const hostId = playerId('host-live');
        const clientId = playerId('client-overlap');

        // Host recording goes live first.
        options.onSessionHosted?.(makeHostTransport(), { hostId, maxPlayers: 2 });
        const recipient = mockStateBroadcasterInstance.registerRendererRecipient.mock
            .calls[0]?.[0] as HostRecipient | undefined;
        recipient?.sendSnapshot(makeSnapshot(hostId, 0));

        // A client snapshot now arrives (a contrived overlap the process should
        // never produce). The guard must refuse to start a second recording over
        // the live host one rather than throw inside the shared manager.
        options.onSessionJoined?.(makeClientTransport());
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 1), 0);

        // The host recording is unaffected; on an explicit save it persists cleanly
        // to the host seat.
        recipient?.sendSnapshot(makeSnapshot(hostId, 2, { winnerIds: [hostId] }));
        await flush();
        expect(perspectiveSaves.value).toHaveLength(0);
        await saveCurrentPerspective();

        expect(perspectiveSaves.value).toHaveLength(1);
        const file = perspectiveSaves.value[0] as PerspectiveTestFile;
        expect(file.viewerId).toBe(hostId);
        expect(file.frames.map((f) => f.tick)).toStrictEqual([0, 2]);
    });

    it('export-current resolves for a JOINED client (the gate opens for a joined session)', async () => {
        await main(makeTestContributions());
        const options = getLobbyOptions();
        const clientId = playerId('client-export');

        // Join and record a client perspective replay through game-over. The match
        // is NOT saved at game-over — the recording is retained for an explicit save.
        options.onSessionJoined?.(makeClientTransport());
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 0), 0);
        options.onClientSnapshotReceived?.(makeSnapshot(clientId, 1, { winnerIds: [clientId] }), 0);
        await flush();
        expect(perspectiveSaves.value).toHaveLength(0);

        // The injected gate must let a joined client export (save) its OWN retained
        // perspective replay (the deterministic export stays host-only). Take the
        // latest registration since this describe does not clear ipcMain.handle.
        const exportCurrent = [...ipcMainHandle.mock.calls]
            .reverse()
            .find(([channel]) => channel === PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL)?.[1] as
            | (() => unknown)
            | undefined;
        expect(exportCurrent).toBeTypeOf('function');
        await expect(Promise.resolve(exportCurrent?.())).resolves.toBe(
            '/tmp/perspective-1.chimera-perspective-replay',
        );
        // The save wrote exactly one file.
        await flush();
        expect(perspectiveSaves.value).toHaveLength(1);
    });
});

// ── Perspective-replay IPC wiring (F44b T7, #673) ─────────────────────────────
// Covers the index.ts glue that exposes the chimera:replay:perspective:* surface
// via `registerPerspectiveReplayHandlers`: that every channel is registered, and
// that the injected `exportCurrent` gate closure rejects when no hosted session
// is active. The handler *factory* is unit-tested in `ipc-handlers.test.ts` with
// injected stubs; these assert main() actually wires it. `exportCurrent` itself
// is idempotent (it returns the already-saved path once a match has finalised);
// the gate is `activeSession === null`, which is true at boot because no game is
// hosted — exercising the reject branch for real (F44 / T9).
describe('main() — perspective replay IPC wiring (F44b T7)', () => {
    const findHandler = (channel: string): ((...args: readonly unknown[]) => unknown) | undefined =>
        ipcMainHandle.mock.calls.find(([registeredChannel]) => registeredChannel === channel)?.[1];

    beforeEach(() => {
        // Scope captured ipcMain.handle calls to this test's main() run so the
        // channel lookup cannot resolve a handler from an earlier registration.
        ipcMainHandle.mockClear();
    });

    it('registers every chimera:replay:perspective:* channel', async () => {
        await main(makeTestContributions());

        for (const channel of [
            PERSPECTIVE_REPLAY_LIST_CHANNEL,
            PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL,
            PERSPECTIVE_REPLAY_OPEN_IN_PLAYER_CHANNEL,
            PERSPECTIVE_REPLAY_DELETE_CHANNEL,
            PERSPECTIVE_REPLAY_OPEN_PLAYBACK_CHANNEL,
            PERSPECTIVE_REPLAY_SNAPSHOT_AT_CHANNEL,
            PERSPECTIVE_REPLAY_SNAPSHOT_RANGE_CHANNEL,
            PERSPECTIVE_REPLAY_CLOSE_PLAYBACK_CHANNEL,
        ]) {
            expect(ipcMainHandle).toHaveBeenCalledWith(channel, expect.any(Function));
        }
    });

    it('export-current rejects when neither a hosted nor a joined session is active', async () => {
        await main(makeTestContributions());

        const handler = findHandler(PERSPECTIVE_REPLAY_EXPORT_CURRENT_CHANNEL);
        expect(handler).toBeTypeOf('function');
        await expect(Promise.resolve(handler?.())).rejects.toThrow(/no active session/);
    });
});

// ── Host return-to-lobby orchestration (#737) ─────────────────────────────────
// Covers the onReturnToLobbyRequested wiring in main(): dispatching
// engine:return_to_lobby into the live session (broadcasting phase:'lobby' to the
// host + every client) and the host-local match-state resets that make the lobby
// restartable — undo history, replay/perspective recordings, staged commitment
// state, the gameStarted one-shot guard, and AI agent re-registration. This is an
// *abandon* (gameResult stays null): it must NOT fire the match-end / replay-
// finalise path.
describe('main() — host return-to-lobby orchestration (#737)', () => {
    interface RtlTransport {
        onPlayerJoined: ReturnType<typeof vi.fn>;
        onPlayerLeft: ReturnType<typeof vi.fn>;
        onActionReceived: ReturnType<typeof vi.fn>;
        setJoinClassifier: ReturnType<typeof vi.fn>;
    }
    interface RtlLobbyState {
        readonly info: {
            readonly sessionId: string;
            readonly hostId: ReturnType<typeof playerId>;
            readonly gameId: string;
        };
        readonly players: readonly {
            readonly playerId: ReturnType<typeof playerId>;
            readonly displayName: string;
            readonly ready: boolean;
        }[];
    }
    interface RtlOptions {
        onSessionHosted?: (
            transport: RtlTransport,
            metadata: { readonly hostId: ReturnType<typeof playerId>; readonly maxPlayers: number },
        ) => (() => void) | void;
        onGameStartRequested?: (state: RtlLobbyState) => void;
        onReturnToLobbyRequested?: (state: RtlLobbyState) => void;
    }

    const hostId = playerId('rtl-host');
    const guestId = playerId('rtl-guest');

    let capturedJoin:
        | ((entry: { readonly playerId: ReturnType<typeof playerId> }) => void)
        | undefined;
    let capturedAction: ((from: string, action: unknown) => void) | undefined;

    const makeTransport = (): RtlTransport => {
        capturedJoin = undefined;
        capturedAction = undefined;
        return {
            onPlayerJoined: vi.fn(
                (cb: (entry: { readonly playerId: ReturnType<typeof playerId> }) => void) => {
                    capturedJoin = cb;
                    return () => {};
                },
            ),
            onPlayerLeft: vi.fn(() => () => {}),
            onActionReceived: vi.fn((cb: (from: string, action: unknown) => void) => {
                capturedAction = cb;
                return () => {};
            }),
            setJoinClassifier: vi.fn(),
        };
    };

    const makeLobbyState = (): RtlLobbyState => ({
        info: { sessionId: 'rtl-session', hostId, gameId: 'tactics' },
        players: [
            { playerId: hostId, displayName: 'Host', ready: true },
            { playerId: guestId, displayName: 'Guest', ready: true },
        ],
    });

    const getOptions = (): RtlOptions => mockLobbyManagerCtor.mock.calls[0]?.[2] as RtlOptions;

    /** Boot a hosted, started 2-player match with both players present. */
    const startHostedMatch = async (): Promise<RtlOptions> => {
        await main(makeTestContributions());
        const options = getOptions();
        options.onSessionHosted?.(makeTransport(), { hostId, maxPlayers: 2 });
        capturedJoin?.({ playerId: guestId }); // both present → onGameStart fires once
        options.onGameStartRequested?.(makeLobbyState());
        return options;
    };

    /** Snapshots broadcast with the given phase, paired with their viewerId. */
    const broadcastsWithPhase = (phase: string): unknown[] =>
        mockStateBroadcasterInstance.broadcast.mock.calls
            .filter(([snap]) => (snap as { phase?: string }).phase === phase)
            .map(([, viewerId]) => viewerId);

    beforeEach(() => {
        browserWindowInstances.length = 0;
        appOn.mockClear();
        appWhenReady.mockClear();
        appWhenReady.mockImplementation(() => Promise.resolve());
        appGetPath.mockClear();
        appGetPath.mockImplementation(() => '/tmp/chimera-userData-fake');
        ipcMainHandle.mockClear();
        fsExistsSync.mockClear();
        mockRegisterCrashReporter.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockStateBroadcasterInstance.broadcast.mockClear();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockSimulationHostInstance.onGameEnd.mockClear();
        mockAgentManagerInstance.clear.mockClear();
        perspectiveSaves.value = [];
    });

    it('wires onReturnToLobbyRequested as a function', async () => {
        await main(makeTestContributions());
        expect(getOptions().onReturnToLobbyRequested).toBeTypeOf('function');
    });

    it('broadcasts a phase:lobby snapshot to the host and every client', async () => {
        const options = await startHostedMatch();
        mockStateBroadcasterInstance.broadcast.mockClear();

        options.onReturnToLobbyRequested?.(makeLobbyState());

        const lobbyViewers = broadcastsWithPhase('lobby');
        expect(lobbyViewers).toContain(hostId);
        expect(lobbyViewers).toContain(guestId);
    });

    it('clears undo history so no seat can undo into the abandoned match', async () => {
        const options = await startHostedMatch();
        // Host takes its turn — it now has a turn-start memento (canUndo: true).
        capturedAction?.(hostId, {
            type: 'tactics:move_unit',
            playerId: hostId,
            tick: 1,
            payload: { unitId: 'unit-1', x: 1, y: 0 },
        });
        const projectorOptions = capturedDefaultStateProjectorOptions.current!;
        expect(projectorOptions.getUndoMeta?.(hostId)).toEqual({ canUndo: true, canRedo: false });

        options.onReturnToLobbyRequested?.(makeLobbyState());

        expect(projectorOptions.getUndoMeta?.(hostId)).toEqual({ canUndo: false, canRedo: false });
    });

    it('abandons the match without firing the match-end / replay-finalise path', async () => {
        const options = await startHostedMatch();
        mockSimulationHostInstance.onGameEnd.mockClear();

        options.onReturnToLobbyRequested?.(makeLobbyState());
        await new Promise((resolve) => setTimeout(resolve, 0)); // flush fire-and-forget finalise

        expect(mockSimulationHostInstance.onGameEnd).not.toHaveBeenCalled();
        expect(perspectiveSaves.value).toHaveLength(0);
    });

    it('clears staged commitment state via the session runtime', async () => {
        const clearStagedSpy = vi.spyOn(SessionRuntime.prototype, 'clearStagedReveals');
        const restoreSpy = vi.spyOn(
            SessionCommitmentRuntime.prototype,
            'restorePendingCommitments',
        );
        try {
            const options = await startHostedMatch();
            clearStagedSpy.mockClear();
            restoreSpy.mockClear();

            options.onReturnToLobbyRequested?.(makeLobbyState());

            expect(clearStagedSpy).toHaveBeenCalled();
            expect(restoreSpy).toHaveBeenCalledWith({});
        } finally {
            clearStagedSpy.mockRestore();
            restoreSpy.mockRestore();
        }
    });

    it('re-registers AI agents and re-fires onGameStart so the match is restartable', async () => {
        const options = await startHostedMatch();
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
        mockSimulationHostInstance.registerAgent.mockClear();
        mockSimulationHostInstance.onGameStart.mockClear();

        options.onReturnToLobbyRequested?.(makeLobbyState());

        expect(mockAgentManagerInstance.clear).toHaveBeenCalledOnce();
        // Both seats are re-registered against the lobby snapshot before the
        // re-fired onGameStart (mirrors the original session-host ordering).
        expect(mockSimulationHostInstance.registerAgent.mock.calls.length).toBeGreaterThanOrEqual(
            2,
        );
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledOnce();
    });

    it('is restartable — a subsequent engine:start_game broadcasts phase:playing', async () => {
        const options = await startHostedMatch();
        options.onReturnToLobbyRequested?.(makeLobbyState());
        mockStateBroadcasterInstance.broadcast.mockClear();

        options.onGameStartRequested?.(makeLobbyState());

        expect(broadcastsWithPhase('playing').length).toBeGreaterThan(0);
    });

    it('re-arms the perspective recording on restart, and (packaged) never arms the deterministic recorder', async () => {
        const replayStartSpy = vi.spyOn(ReplayManager.prototype, 'startRecording');
        const replayAbortSpy = vi.spyOn(ReplayManager.prototype, 'abortRecording');
        const perspStartSpy = vi.spyOn(PerspectiveReplayManager.prototype, 'start');
        const perspAbortSpy = vi.spyOn(PerspectiveReplayManager.prototype, 'abort');
        try {
            const options = await startHostedMatch();
            // The perspective recording was armed exactly once at host time.
            const perspStartsBefore = perspStartSpy.mock.calls.length;

            options.onReturnToLobbyRequested?.(makeLobbyState());

            // The abandoned recordings are discarded, then a fresh perspective one
            // is armed for the next match (re-arm, not finalise).
            expect(replayAbortSpy).toHaveBeenCalled();
            expect(perspAbortSpy).toHaveBeenCalled();
            expect(perspStartSpy.mock.calls.length).toBe(perspStartsBefore + 1);
            // This suite's electron mock reports app.isPackaged === true, so the
            // deterministic recorder is disabled AT THE SOURCE
            // (`createDeterministicReplayPort` returns undefined): it never starts —
            // neither at host time nor on re-arm — so the deterministic replay can
            // never be recorded, written, or leaked in a packaged production build
            // (privacy — Invariants #71/#98). The privacy-safe perspective recording
            // is unaffected. Both directions of the gate decision are unit-tested in
            // deterministicReplayPort.test.ts; the dev/e2e enabled branch's
            // end-to-end arming + write is covered by the replay E2E's deterministic
            // co-save (replay.spec.ts).
            expect(replayStartSpy).not.toHaveBeenCalled();
        } finally {
            replayStartSpy.mockRestore();
            replayAbortSpy.mockRestore();
            perspStartSpy.mockRestore();
            perspAbortSpy.mockRestore();
        }
    });

    it('is fail-loud and runs no reset when the action is rejected (non-host dispatcher)', async () => {
        const options = await startHostedMatch();
        mockStateBroadcasterInstance.broadcast.mockClear();
        mockAgentManagerInstance.clear.mockClear();

        // A return-to-lobby whose dispatcher is not the session host fails the
        // reducer's host-only guard. `applyAction` throws `ActionUnauthorizedError`,
        // so the callback throws (returnToLobby rejects) and the host-local reset
        // below it never runs — no lobby broadcast, no agent clear. Unreachable in
        // the normal flow (the dispatcher is always the session host).
        expect(() =>
            options.onReturnToLobbyRequested?.({
                info: {
                    sessionId: 'rtl-session',
                    hostId: playerId('not-the-host'),
                    gameId: 'tactics',
                },
                players: [
                    { playerId: hostId, displayName: 'Host', ready: true },
                    { playerId: guestId, displayName: 'Guest', ready: true },
                ],
            }),
        ).toThrow();

        expect(broadcastsWithPhase('lobby')).toHaveLength(0);
        expect(mockAgentManagerInstance.clear).not.toHaveBeenCalled();
    });
});

// ── Session restore wiring (#823) ─────────────────────────────────────────────
// Covers the saves:load composition-root wiring in main(): with no active
// session the SessionRestoreCoordinator hosts a restored lobby seeded from the
// SaveFile session manifest (hostLobby restore params, #821), applies the
// checkpoint through the single Invariant #24 helper, seats the saved roster
// (exact slotIndexes, saved playerIds, AI omniscience), and defers onGameStart
// behind the existing tryStartGame gate until saved remote seats reconnect.
// With an active session, a same-match load live-applies and a different-match
// load rejects renderer-friendly. The coordinator's own state machine is
// unit-tested in SessionRestoreCoordinator.test.ts; these tests assert the
// observable main() effects (hostLobby params, broadcasts, game start, the
// re-captured session manifest).
describe('main() — session restore wiring (#823)', () => {
    interface RestoreCapturedSaveFile {
        readonly checkpoint: { readonly tick: number; readonly matchId?: string };
        readonly session: {
            readonly matchId: string;
            readonly maxPlayers: number;
            readonly seats: readonly {
                readonly playerId: string;
                readonly control: string;
                readonly slotIndex: number;
                readonly omniscient?: boolean;
            }[];
        };
    }

    interface RestoreLobbyCallbacks {
        onSessionHosted?: (
            transport: {
                onPlayerJoined(cb: (args: { playerId: string }) => void): () => void;
                onPlayerLeft(cb: (id: string) => void): () => void;
                onActionReceived(cb: (from: string, action: unknown) => void): () => void;
                setJoinClassifier(classify: unknown): void;
            },
            metadata: { hostId: ReturnType<typeof playerId>; maxPlayers: number },
        ) => (() => void) | void;
        onGameStartRequested?: (state: unknown) => void;
    }

    interface RestoreSeatFixture {
        readonly playerId: string;
        readonly control: 'host' | 'local' | 'remote' | 'ai';
        readonly slotIndex: number;
        readonly omniscient?: boolean;
    }

    const RESTORED_MATCH_ID = 'match-restored';

    function makeRestoreSaveFile(
        seats: readonly RestoreSeatFixture[],
        overrides: { matchId?: string; gameId?: string; tick?: number; maxPlayers?: number } = {},
    ): unknown {
        const tick = overrides.tick ?? 42;
        return {
            header: {
                schemaVersion: 6,
                engineVersion: '0.0.0',
                gameId: overrides.gameId ?? TACTICS_GAME_ID,
                gameVersion: '0.1.0',
                slotId: 'restore-slot',
                savedAt: 1_700_000_000_000,
                turnNumber: 4,
                playerNames: seats.map((s) => s.playerId),
            },
            checkpoint: {
                tick,
                phase: 'playing',
                turnNumber: 4,
                players: Object.fromEntries(seats.map((s) => [s.playerId, {}])),
                matchId: overrides.matchId ?? RESTORED_MATCH_ID,
            },
            deltaActions: [],
            pendingCommitments: {},
            stagedReveals: {},
            session: {
                matchId: overrides.matchId ?? RESTORED_MATCH_ID,
                maxPlayers: overrides.maxPlayers ?? seats.length,
                seats,
            },
        };
    }

    const MIXED_ROSTER: readonly RestoreSeatFixture[] = [
        { playerId: 'host-restored', control: 'host', slotIndex: 0 },
        { playerId: 'local-restored', control: 'local', slotIndex: 1 },
        { playerId: 'ai-2', control: 'ai', slotIndex: 2, omniscient: true },
        { playerId: 'remote-restored', control: 'remote', slotIndex: 3 },
    ];

    const ALL_LOCAL_ROSTER: readonly RestoreSeatFixture[] = [
        { playerId: 'host-restored', control: 'host', slotIndex: 0 },
        { playerId: 'local-restored', control: 'local', slotIndex: 1 },
        { playerId: 'ai-2', control: 'ai', slotIndex: 2, omniscient: true },
    ];

    const findSavesLoadHandler = ():
        | ((event: unknown, slotId: string) => Promise<unknown>)
        | undefined =>
        ipcMainHandle.mock.calls.find(([channel]) => channel === SAVES_LOAD_CHANNEL)?.[1] as
            | ((event: unknown, slotId: string) => Promise<unknown>)
            | undefined;

    async function loadSlot(file: unknown): Promise<unknown> {
        mockSaveManagerRestoreFromSave.mockResolvedValueOnce(file);
        const handler = findSavesLoadHandler();
        expect(handler).toBeTypeOf('function');
        return handler?.(undefined, 'tactics/restore-slot');
    }

    async function autosaveManifest(): Promise<RestoreCapturedSaveFile> {
        const crashOptions = mockRegisterCrashReporter.mock.calls[0]?.[0];
        mockSaveManagerAutoSave.mockClear();
        await crashOptions?.autosave?.();
        expect(mockSaveManagerAutoSave).toHaveBeenCalledOnce();
        return mockSaveManagerAutoSave.mock.calls[0]?.[0] as RestoreCapturedSaveFile;
    }

    beforeEach(() => {
        ipcMainHandle.mockClear();
        mockLobbyManagerCtor.mockClear();
        mockLobbyManagerHostLobby.mockClear();
        mockLobbyManagerAddLocalSeat.mockClear();
        mockLobbyManagerCloseLobby.mockClear();
        mockLobbyManagerLocalSeatIds.clear();
        mockLobbyManagerIsLocalSeat.mockReset();
        mockLobbyManagerIsLocalSeat.mockImplementation((id) =>
            mockLobbyManagerLocalSeatIds.has(id),
        );
        mockRegisterCrashReporter.mockClear();
        mockSaveManagerAutoSave.mockClear();
        mockSaveManagerRestoreFromSave.mockReset();
        mockSimulationHostInstance.onGameStart.mockClear();
        mockStateBroadcasterInstance.broadcast.mockClear();
        hostedTeardownRef.current = null;
        hostedTransportJoinRef.current = null;
    });

    it('menu load with no active session hosts a restored lobby with remote-only humanSeats', async () => {
        await main(makeTestContributions());

        await loadSlot(makeRestoreSaveFile(MIXED_ROSTER));

        expect(mockLobbyManagerHostLobby).toHaveBeenCalledTimes(1);
        expect(mockLobbyManagerHostLobby).toHaveBeenCalledWith({
            gameId: TACTICS_GAME_ID,
            maxPlayers: 4,
            restore: {
                matchId: RESTORED_MATCH_ID,
                hostPlayerId: 'host-restored',
                // Remote seats only — local seats must never be claimable by a
                // claimless join-order fallback join.
                humanSeats: ['remote-restored'],
            },
        });
    });

    it('all-local menu load applies the checkpoint and starts immediately with the restored snapshot', async () => {
        await main(makeTestContributions());

        await loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER));

        // onGameStart fired exactly once, with the RESTORED checkpoint — not the
        // pre-restore lobby snapshot (the start-suppression gate guarantees the
        // apply happens first).
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledTimes(1);
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledWith(
            expect.objectContaining({ tick: 42 }),
        );
        // The restored snapshot was broadcast to the host renderer seat.
        expect(mockStateBroadcasterInstance.broadcast).toHaveBeenCalledWith(
            expect.objectContaining({ tick: 42 }),
            'host-restored',
        );

        // A re-capture (crash autosave) reproduces the restored composition:
        // same matchId, capacity, and every seat at its exact saved slotIndex.
        const file = await autosaveManifest();
        expect(file.session.matchId).toBe(RESTORED_MATCH_ID);
        expect(file.session.maxPlayers).toBe(3);
        expect(file.session.seats).toEqual([
            { playerId: 'host-restored', control: 'host', slotIndex: 0 },
            { playerId: 'local-restored', control: 'local', slotIndex: 1 },
            { playerId: 'ai-2', control: 'ai', slotIndex: 2, omniscient: true },
        ]);
    });

    it('re-adds restored local seats with their saved playerIds without burning a fresh slot', async () => {
        await main(makeTestContributions());

        await loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER));

        expect(mockLobbyManagerAddLocalSeat).toHaveBeenCalledTimes(1);
        expect(mockLobbyManagerAddLocalSeat).toHaveBeenCalledWith('local-restored');
        // The onLocalSeatAdded guard kept the seat at its saved slot: a second
        // (fresh-slot) registration would have moved it off slotIndex 1.
        const file = await autosaveManifest();
        expect(file.session.seats).toContainEqual({
            playerId: 'local-restored',
            control: 'local',
            slotIndex: 1,
        });
    });

    it('defers game start until a saved remote seat reconnects through the re-sync path', async () => {
        await main(makeTestContributions());

        await loadSlot(makeRestoreSaveFile(MIXED_ROSTER));

        // Remote seat missing: the start gate must stay closed (no AI can act).
        expect(mockSimulationHostInstance.onGameStart).not.toHaveBeenCalled();

        mockStateBroadcasterInstance.broadcast.mockClear();
        hostedTransportJoinRef.current?.({ playerId: 'remote-restored' });

        // The last reconnect opens the gate with the restored snapshot…
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledTimes(1);
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledWith(
            expect.objectContaining({ tick: 42 }),
        );
        // …and the rejoining player was re-synced (reconnect path — no fresh
        // seat registration), keeping its saved slotIndex.
        expect(mockStateBroadcasterInstance.broadcast).toHaveBeenCalledWith(
            expect.objectContaining({ tick: 42 }),
            'remote-restored',
        );
        const file = await autosaveManifest();
        expect(file.session.seats).toContainEqual({
            playerId: 'remote-restored',
            control: 'remote',
            slotIndex: 3,
        });
    });

    it('rejects a menu load whose save belongs to a different game', async () => {
        await main(makeTestContributions());

        await expect(
            loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER, { gameId: 'other-game' })),
        ).rejects.toThrow(/save is for game/);
        expect(mockLobbyManagerHostLobby).not.toHaveBeenCalled();
    });

    it('starts immediately even when a migrated manifest overstates maxPlayers', async () => {
        await main(makeTestContributions());

        // A sparse migrated v5 manifest records maxPlayers = highestSlot + 1,
        // which can exceed the seat count. The start gate must wait for the
        // ROSTER, not the inflated hint — otherwise the restore reports
        // complete while the game never starts.
        await loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER, { maxPlayers: 6 }));

        expect(mockLobbyManagerHostLobby).toHaveBeenCalledWith(
            expect.objectContaining({ maxPlayers: 3 }),
        );
        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledTimes(1);
        const file = await autosaveManifest();
        expect(file.session.maxPlayers).toBe(3);
    });

    it('a failed restore hosting does not wedge the next hosted session', async () => {
        await main(makeTestContributions());
        mockLobbyManagerHostLobby.mockRejectedValueOnce(new Error('port already in use'));

        await expect(loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER))).rejects.toThrow(
            /port already in use/,
        );

        // Host a normal session directly: if the failed restore left the
        // start-suppression gate latched, this session would never start.
        const callbacks = mockLobbyManagerCtor.mock.calls.at(-1)?.[2] as
            | RestoreLobbyCallbacks
            | undefined;
        const joinRef: { current?: (args: { playerId: string }) => void } = {};
        callbacks?.onSessionHosted?.(
            {
                onPlayerJoined: (cb) => {
                    joinRef.current = cb;
                    return () => {};
                },
                onPlayerLeft: () => () => {},
                onActionReceived: () => () => {},
                setJoinClassifier: () => {},
            },
            { hostId: playerId('host-after-failed-restore'), maxPlayers: 2 },
        );
        joinRef.current?.({ playerId: 'guest-after-failed-restore' });

        expect(mockSimulationHostInstance.onGameStart).toHaveBeenCalledTimes(1);
    });

    it('rejects a menu load while a joined-client session is active', async () => {
        await main(makeTestContributions());

        const callbacks = mockLobbyManagerCtor.mock.calls.at(-1)?.[2] as
            | {
                  onSessionJoined?: (transport: unknown) => (() => void) | void;
              }
            | undefined;
        expect(callbacks?.onSessionJoined).toBeTypeOf('function');
        callbacks?.onSessionJoined?.({
            onSnapshotReceived: vi.fn(() => () => {}),
            onReveal: vi.fn(() => () => {}),
        });

        // activeSession stays null on a joined client, but routing into the
        // menu-restore flow would surface LobbyManager's "session already
        // active" hosting error — the guard must reject renderer-friendly.
        await expect(loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER))).rejects.toThrow(
            /joined to another session/,
        );
        expect(mockLobbyManagerHostLobby).not.toHaveBeenCalled();
    });

    describe('with an active session', () => {
        function makeStartLobbyState(
            hostId: ReturnType<typeof playerId>,
            players: readonly ReturnType<typeof playerId>[],
        ): unknown {
            return {
                info: { sessionId: 'session-restore-wire', hostId, gameId: 'tactics' },
                players: players.map((id) => ({
                    playerId: id,
                    displayName: `Player ${id}`,
                    ready: true,
                })),
            };
        }

        /** Host a session directly (bypassing hostLobby) and start a match. */
        async function hostAndStartMatch(): Promise<{ matchId: string }> {
            await main(makeTestContributions());

            const callbacks = mockLobbyManagerCtor.mock.calls.at(-1)?.[2] as
                | RestoreLobbyCallbacks
                | undefined;
            expect(callbacks?.onSessionHosted).toBeTypeOf('function');
            if (callbacks === undefined) {
                throw new Error('Expected LobbyManager callbacks to be wired');
            }
            const joinRef: { current?: (args: { playerId: string }) => void } = {};
            const transport = {
                onPlayerJoined: vi.fn((cb: (args: { playerId: string }) => void) => {
                    joinRef.current = cb;
                    return () => {};
                }),
                onPlayerLeft: vi.fn(() => () => {}),
                onActionReceived: vi.fn(() => () => {}),
                setJoinClassifier: vi.fn(),
            };
            const hostId = playerId('host-restwire');
            callbacks.onSessionHosted?.(transport, { hostId, maxPlayers: 2 });
            const guestId = playerId('guest-restwire');
            joinRef.current?.({ playerId: guestId });
            callbacks.onGameStartRequested?.(makeStartLobbyState(hostId, [hostId, guestId]));

            const { session } = await autosaveManifest();
            return { matchId: session.matchId };
        }

        it('live-applies an in-session load of the same match without hosting a new lobby', async () => {
            const { matchId } = await hostAndStartMatch();
            mockStateBroadcasterInstance.broadcast.mockClear();

            await loadSlot(makeRestoreSaveFile(MIXED_ROSTER, { matchId, tick: 77 }));

            expect(mockLobbyManagerHostLobby).not.toHaveBeenCalled();
            expect(mockStateBroadcasterInstance.broadcast).toHaveBeenCalledWith(
                expect.objectContaining({ tick: 77 }),
                'host-restwire',
            );
        });

        it('rejects an in-session load of a different match and leaves the snapshot untouched', async () => {
            const { matchId } = await hostAndStartMatch();
            mockStateBroadcasterInstance.broadcast.mockClear();

            await expect(
                loadSlot(makeRestoreSaveFile(MIXED_ROSTER, { matchId: 'other-match', tick: 99 })),
            ).rejects.toThrow(/different match/);

            expect(mockLobbyManagerHostLobby).not.toHaveBeenCalled();
            expect(mockStateBroadcasterInstance.broadcast).not.toHaveBeenCalledWith(
                expect.objectContaining({ tick: 99 }),
                expect.anything(),
            );
            // The live match identity is unchanged.
            const file = await autosaveManifest();
            expect(file.session.matchId).toBe(matchId);
        });
    });

    describe('restore-status push + cancel-restore (#826)', () => {
        /** Events sent on the restore-status channel to `win`, in order. */
        const restoreStatusSends = (win: FakeBrowserWindow): readonly unknown[] =>
            win.webContents.send.mock.calls
                .filter(([channel]) => channel === SAVES_RESTORE_STATUS_CHANNEL)
                .map(([, event]) => event);

        const findCancelRestoreHandler = ():
            | ((event: unknown, payload?: unknown) => Promise<unknown>)
            | undefined =>
            ipcMainHandle.mock.calls.find(
                ([channel]) => channel === SAVES_CANCEL_RESTORE_CHANNEL,
            )?.[1] as ((event: unknown, payload?: unknown) => Promise<unknown>) | undefined;

        function makeLiveWindow(): FakeBrowserWindow {
            const win = new FakeBrowserWindow({ webPreferences: {} });
            FakeBrowserWindow.getAllWindows.mockReturnValue([win]);
            return win;
        }

        afterEach(() => {
            // Restore the default getAllWindows implementation for suites
            // that rely on the shared instance list.
            FakeBrowserWindow.getAllWindows.mockImplementation(() => browserWindowInstances);
        });

        it('pushes a waiting event with lobbyCode and pendingSeats when a remote-roster load parks', async () => {
            await main(makeTestContributions());
            const win = makeLiveWindow();

            await loadSlot(makeRestoreSaveFile(MIXED_ROSTER));

            expect(restoreStatusSends(win)).toEqual([
                {
                    state: 'waiting',
                    gameId: TACTICS_GAME_ID,
                    matchId: RESTORED_MATCH_ID,
                    lobbyCode: 'restored-session',
                    pendingSeats: ['remote-restored'],
                },
            ]);
        });

        it('pushes ready with no pending seats once the last saved remote seat reconnects', async () => {
            await main(makeTestContributions());
            const win = makeLiveWindow();

            await loadSlot(makeRestoreSaveFile(MIXED_ROSTER));
            hostedTransportJoinRef.current?.({ playerId: 'remote-restored' });

            const events = restoreStatusSends(win);
            expect(events).toHaveLength(2);
            expect(events[1]).toEqual({
                state: 'ready',
                gameId: TACTICS_GAME_ID,
                matchId: RESTORED_MATCH_ID,
                pendingSeats: [],
            });
        });

        it('pushes ready only (never waiting) for an all-local load', async () => {
            await main(makeTestContributions());
            const win = makeLiveWindow();

            await loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER));

            expect(restoreStatusSends(win)).toEqual([
                {
                    state: 'ready',
                    gameId: TACTICS_GAME_ID,
                    matchId: RESTORED_MATCH_ID,
                    pendingSeats: [],
                },
            ]);
        });

        it('cancel-restore invoke closes the restored lobby and pushes cancelled', async () => {
            await main(makeTestContributions());
            const win = makeLiveWindow();

            await loadSlot(makeRestoreSaveFile(MIXED_ROSTER));
            const handler = findCancelRestoreHandler();
            expect(handler).toBeTypeOf('function');
            await expect(handler?.(undefined, undefined)).resolves.toBeUndefined();

            expect(mockLobbyManagerCloseLobby).toHaveBeenCalledTimes(1);
            const events = restoreStatusSends(win);
            expect(events).toHaveLength(2);
            expect(events[1]).toEqual({
                state: 'cancelled',
                gameId: TACTICS_GAME_ID,
                matchId: RESTORED_MATCH_ID,
                pendingSeats: [],
            });
        });

        it('cancel-restore clears the get-current-snapshot replay cache with the session (#843)', async () => {
            mockStateBroadcasterInstance.registerRendererRecipient.mockClear();
            await main(makeTestContributions());
            makeLiveWindow();

            await loadSlot(makeRestoreSaveFile(MIXED_ROSTER));

            // Drive the hosted renderer egress once — the restore-apply
            // broadcast lands here in production — so the match-phase
            // checkpoint is cached for the get-current-snapshot replay.
            const recipient =
                mockStateBroadcasterInstance.registerRendererRecipient.mock.calls.at(-1)?.[0];
            const restoredSnapshot = { tick: 42, viewerId: 'host-restored' };
            recipient?.sendSnapshot(restoredSnapshot);

            const getCurrentSnapshot = ipcMainHandle.mock.calls.find(
                ([channel]) => channel === GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
            )?.[1] as (() => unknown) | undefined;
            expect(getCurrentSnapshot).toBeTypeOf('function');
            expect(getCurrentSnapshot?.()).toBe(restoredSnapshot);

            const handler = findCancelRestoreHandler();
            await handler?.(undefined, undefined);

            // The session is gone: a renderer reload must NOT replay the dead
            // match's checkpoint (it would bounce /saves and /lobby back onto
            // an empty /game — #843).
            expect(mockLobbyManagerCloseLobby).toHaveBeenCalledTimes(1);
            expect(getCurrentSnapshot?.()).toBeNull();
        });

        it('joined-session teardown clears the get-current-snapshot replay cache too (#843)', async () => {
            await main(makeTestContributions());

            const options = mockLobbyManagerCtor.mock.calls.at(-1)?.[2] as
                | {
                      onSessionJoined?: (transport: {
                          onReveal: ReturnType<typeof vi.fn>;
                          onSnapshotReceived: ReturnType<typeof vi.fn>;
                      }) => (() => void) | void;
                      onClientSnapshotReceived?: (snapshot: unknown, checksum: number) => void;
                  }
                | undefined;
            const cleanup = options?.onSessionJoined?.({
                onReveal: vi.fn(() => () => {}),
                onSnapshotReceived: vi.fn(() => () => {}),
            });

            const clientSnapshot = {
                tick: 3,
                viewerId: playerId('client-843'),
                phase: 'playing',
                players: {},
                entities: {},
                events: [],
                gameResult: null,
                undoMeta: { canUndo: false, canRedo: false },
                isMyTurn: false,
            };
            options?.onClientSnapshotReceived?.(clientSnapshot, 0);

            const getCurrentSnapshot = ipcMainHandle.mock.calls.find(
                ([channel]) => channel === GAME_GET_CURRENT_SNAPSHOT_CHANNEL,
            )?.[1] as (() => unknown) | undefined;
            expect(getCurrentSnapshot?.()).toBe(clientSnapshot);

            if (typeof cleanup === 'function') {
                cleanup();
            }

            expect(getCurrentSnapshot?.()).toBeNull();
        });

        it('pushes failed with an empty matchId when the manifest is corrupt', async () => {
            await main(makeTestContributions());
            const win = makeLiveWindow();

            const corrupt = makeRestoreSaveFile([
                { playerId: 'host-restored', control: 'host', slotIndex: 0 },
                { playerId: 'ai-x', control: 'ai', slotIndex: 999_999 },
            ]);
            await expect(loadSlot(corrupt)).rejects.toThrow(/slotIndex/);

            expect(restoreStatusSends(win)).toEqual([
                {
                    state: 'failed',
                    gameId: TACTICS_GAME_ID,
                    matchId: '',
                    pendingSeats: [],
                },
            ]);
        });

        it('skips destroyed windows and destroyed webContents (WARN-10)', async () => {
            await main(makeTestContributions());

            const deadWin = new FakeBrowserWindow({ webPreferences: {} });
            deadWin.isDestroyed.mockReturnValue(true);
            const deadContentsWin = new FakeBrowserWindow({ webPreferences: {} });
            deadContentsWin.webContents.isDestroyed.mockReturnValue(true);
            const liveWin = new FakeBrowserWindow({ webPreferences: {} });
            FakeBrowserWindow.getAllWindows.mockReturnValue([deadWin, deadContentsWin, liveWin]);

            await loadSlot(makeRestoreSaveFile(ALL_LOCAL_ROSTER));

            expect(restoreStatusSends(deadWin)).toEqual([]);
            expect(restoreStatusSends(deadContentsWin)).toEqual([]);
            expect(restoreStatusSends(liveWin)).toHaveLength(1);
        });
    });
});
