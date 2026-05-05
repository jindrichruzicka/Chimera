import * as path from 'node:path';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import { CLEAN_EXIT_IPC_CHANNEL } from '@chimera/shared/constants.js';
import {
    registerGameHandlers,
    registerLobbyHandlers,
    registerSavesHandlers,
    registerSettingsHandlers,
    registerSystemHandlers,
    registerLogsHandlers,
    registerProfileHandlers,
} from './ipc/ipc-handlers.js';
import {
    createLogger,
    createPinoSink,
    createMemorySink,
    type Logger,
    type LoggerSink,
    type FlushableSink,
} from './logging/logger.js';
import { registerCrashReporter } from './logging/crash-reporter.js';
import { SaveManager } from './saves/SaveManager.js';
import { FileSaveRepository } from './saves/FileSaveRepository.js';
import { createSavesIpcPort } from './saves/SavesIpcAdapter.js';
import { toSlotId } from '../preload/api-types.js';
import { SettingsManager } from './settings/SettingsManager.js';
import { FileSettingsRepository } from './settings/FileSettingsRepository.js';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera/simulation/persistence/index.js';
import { tacticsSettingsSchema } from '@chimera/games/tactics/settings-schema.js';
import { SETTINGS_CHANGE_CHANNEL } from '../preload/apis/settings-api.js';
import { SAVES_SLOT_UPDATE_CHANNEL } from '../preload/apis/saves-api.js';
import { LobbyManager } from './lobby/LobbyManager.js';
import { StateBroadcaster } from './runtime/StateBroadcaster.js';
import { buildHostSessionPipeline } from './runtime/HostSessionPipeline.js';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    collectInitialPlayerSlots,
    resolveAgentSlot,
} from './runtime/HostedSessionAgents.js';
import { SessionCommitmentRuntime, SessionRuntime } from './runtime/SessionRuntime.js';
import { PlayerDirectory } from './profile/PlayerDirectory.js';
import { createProfileGate } from './profile/ProfileGate.js';
import { LocalWebSocketProvider } from '../../networking/provider/local/LocalWebSocketProvider.js';
import type {
    ClientTransport,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import { GAME_REVEAL_CHANNEL, GAME_SNAPSHOT_CHANNEL } from '../preload/apis/game-api.js';
import { LOBBY_UPDATE_CHANNEL } from '../preload/apis/lobby-api.js';
import { SYSTEM_CONNECTION_STATUS_CHANNEL } from '../preload/apis/system-api.js';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type { PlayerId } from '@chimera/simulation/engine/types.js';
import { gamePhase } from '@chimera/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    DefaultStateProjector,
    toCommitmentId,
    type CommitmentReveal,
} from '@chimera/simulation/projection/index.js';
import { AgentManager } from '@chimera/ai/engine/AgentManager.js';
import { HumanPlayerAgent } from '@chimera/ai/engine/PlayerAgent.js';
import { tacticsVisibilityRules } from '@chimera/games/tactics/visibility-rules.js';
import { SimulationHost } from './runtime/SimulationHost.js';
import { assertProductionDebugGuard } from './startup-guard.js';

export { CLEAN_EXIT_IPC_CHANNEL };

// ── HarnessFlags ──────────────────────────────────────────────────────────────

/**
 * Parsed harness flags from `process.argv`. Only populated when
 * `CHIMERA_DEV_HARNESS=1` is present in the environment.
 */
export interface HarnessFlags {
    readonly autoHost: boolean;
    readonly autoJoin: boolean;
    readonly port: number | undefined;
    readonly profileId: string | undefined;
    readonly game: string | undefined;
    readonly scenario: string | undefined;
}

/**
 * Parse the six harness flags from `argv` when `env.CHIMERA_DEV_HARNESS === '1'`.
 * Returns `null` (and silently ignores any flag-shaped args) when the env var
 * is absent or not `'1'`.
 *
 * Pure function — no I/O, no side effects; testable in isolation.
 */
export function parseHarnessFlags(
    argv: readonly string[],
    env: Readonly<Record<string, string | undefined>>,
): HarnessFlags | null {
    if (env['CHIMERA_DEV_HARNESS'] !== '1') return null;

    const has = (flag: string): boolean => argv.includes(flag);
    const val = (prefix: string): string | undefined => {
        const entry = argv.find((a) => a.startsWith(prefix));
        return entry !== undefined ? entry.slice(prefix.length) : undefined;
    };
    const numVal = (prefix: string): number | undefined => {
        const s = val(prefix);
        if (s === undefined) return undefined;
        const n = Number(s);
        return Number.isFinite(n) ? n : undefined;
    };

    return {
        autoHost: has('--dev-auto-host'),
        autoJoin: has('--dev-auto-join'),
        port: numVal('--dev-port='),
        profileId: val('--dev-profile-id='),
        game: val('--dev-game='),
        scenario: val('--dev-scenario='),
    };
}

/**
 * Narrow slice of `Electron.App` required by `registerAppLifecycle`.
 * Declared here so callers (and tests) are not forced to construct a full
 * `Electron.App` instance to exercise lifecycle behaviour.
 */
export interface AppLifecycleHost {
    on(event: 'window-all-closed' | 'activate', handler: () => void): unknown;
    quit(): void;
}

/**
 * Runtime mode flag surfaced to the renderer via `--chimera-env=...` on
 * `process.argv`. Anything outside this union falls back to `'production'`
 * (see `resolveChimeraEnv`).
 */
export type ChimeraEnv = 'development' | 'production';

export interface CreateMainWindowOptions {
    readonly preloadPath: string;
    /** Absolute path to the Next.js static-export entry HTML file. */
    readonly rendererEntry: string;
    readonly env: ChimeraEnv;
    /** Logger for did-fail-load events; always provided in production main() (Invariant #67). */
    readonly logger: Logger;
}

export interface RegisterAppLifecycleOptions {
    readonly app: AppLifecycleHost;
    readonly platform: NodeJS.Platform;
    readonly getOpenWindowCount: () => number;
    readonly createWindow: () => void;
}

export interface ResolveRuntimePathOptions {
    readonly moduleDirname: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}

export interface RuntimePaths {
    readonly preloadPath: string;
    readonly rendererEntry: string;
}

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;

/**
 * Resolve the `ChimeraEnv` runtime mode from the raw `CHIMERA_ENV` environment
 * variable. Unknown or missing values default to `'production'` so that an
 * unconfigured production build cannot accidentally expose developer-mode
 * behaviour (e.g. DevTools).
 */
export function resolveChimeraEnv(raw: string | undefined): ChimeraEnv {
    return raw === 'development' ? 'development' : 'production';
}

export function resolveRuntimePaths(options: ResolveRuntimePathOptions): RuntimePaths {
    const preloadPath = path.join(options.moduleDirname, '..', 'preload', 'api.js');
    const rendererEntry = path.join(
        options.moduleDirname,
        '..',
        '..',
        'renderer',
        'out',
        'index.html',
    );

    if (options.env['CHIMERA_E2E'] !== '1') {
        return { preloadPath, rendererEntry };
    }

    return {
        preloadPath: options.env['CHIMERA_E2E_PRELOAD_PATH'] ?? preloadPath,
        rendererEntry: options.env['CHIMERA_E2E_RENDERER_ENTRY'] ?? rendererEntry,
    };
}

/**
 * Narrow slice of `Electron.IpcMain` required to register the crash-status
 * handler. Declared locally so tests do not need a full `IpcMain`.
 */
export interface CleanExitIpcMain {
    handle(channel: string, handler: () => unknown): unknown;
}

export interface RegisterCleanExitIpcOptions {
    readonly ipcMain: CleanExitIpcMain;
    readonly wasCleanExit: boolean;
}

export interface RevealVerificationRuntime {
    verifyReveal(reveal: CommitmentReveal): unknown;
}

export interface RegisterClientRevealForwardingOptions {
    readonly transport: Pick<ClientTransport, 'onReveal'>;
    readonly commitmentRuntime: RevealVerificationRuntime;
    readonly sendRevealToRenderer: (reveal: CommitmentReveal) => void;
    readonly logger: Logger;
}

// ─── SaveManager lifecycle wiring ─────────────────────────────────────────────

import type { SaveSlotMeta } from '@chimera/simulation/persistence/SaveRepository.js';

/**
 * Narrow slice of `Electron.App` required by the SaveManager lifecycle hook.
 */
export interface SaveManagerLifecycleAppHost {
    on(event: 'before-quit', handler: () => void): unknown;
}

export interface RegisterSaveManagerLifecycleOptions {
    readonly app: SaveManagerLifecycleAppHost;
    readonly saveManager: {
        clearCleanExitFlag(): Promise<boolean>;
        markCleanExit(): Promise<void>;
        checkCrashRecovery(knownGameIds: readonly string[]): Promise<SaveSlotMeta | null>;
    };
    readonly knownGameIds: readonly string[];
}

export interface SaveManagerLifecycleResult {
    /** The autosave slot meta if the previous session crashed and a save was found; null otherwise. */
    readonly autosaveMeta: SaveSlotMeta | null;
    /**
     * `true` when the clean-exit flag was present at startup (graceful shutdown);
     * `false` when it was absent (crash or first run).
     */
    readonly wasCleanExit: boolean;
}

/**
 * Wire `SaveManager` into the application lifecycle:
 *   1. Clear the clean-exit flag at startup so the next launch detects a crash.
 *   2. Register `markCleanExit()` on `before-quit` for graceful shutdown.
 *   3. Run `checkCrashRecovery()` to detect an unclean previous exit.
 *
 * Returns `{ autosaveMeta }` — non-null when the previous session crashed and
 * an autosave was found. The caller can surface the "Resume last session" prompt
 * based on this value.
 */
export async function registerSaveManagerLifecycle(
    options: RegisterSaveManagerLifecycleOptions,
): Promise<SaveManagerLifecycleResult> {
    const { app: appHost, saveManager, knownGameIds } = options;

    // 1. Check if the previous session crashed (flag present = clean exit).
    //    Must happen BEFORE clearing the flag; otherwise the evidence is gone.
    const autosaveMeta = await saveManager.checkCrashRecovery(knownGameIds);

    // 2. Clear the flag and capture whether it was present (true = clean exit).
    const wasCleanExit = await saveManager.clearCleanExitFlag();

    // 3. Write the flag on graceful shutdown.
    appHost.on('before-quit', () => {
        void saveManager.markCleanExit();
    });

    return { autosaveMeta, wasCleanExit };
}

/**
 * Expose the captured clean-exit status to the renderer via a dedicated IPC
 * channel. The value is captured at startup (before any window opens) and
 * does not change over the lifetime of the process.
 */
export function registerCleanExitIpc(options: RegisterCleanExitIpcOptions): void {
    options.ipcMain.handle(CLEAN_EXIT_IPC_CHANNEL, () => options.wasCleanExit);
}

export function registerClientRevealForwarding(
    options: RegisterClientRevealForwardingOptions,
): Unsubscribe {
    const { transport, commitmentRuntime, sendRevealToRenderer, logger } = options;
    return transport.onReveal((wireReveal) => {
        const reveal: CommitmentReveal = {
            id: toCommitmentId(wireReveal.id),
            value: wireReveal.value,
            nonce: wireReveal.nonce,
        };
        try {
            commitmentRuntime.verifyReveal(reveal);
            sendRevealToRenderer(reveal);
        } catch (error) {
            if (error instanceof CommitmentVerificationError) {
                logger.warn('client reveal verification failed', {
                    commitmentId: wireReveal.id,
                    error: error.message,
                });
                return;
            }

            throw error;
        }
    });
}

/**
 * Construct the primary renderer `BrowserWindow` and load the Next.js static
 * export (`renderer/out/index.html`).
 *
 * Security invariants (see docs/executive-architecture/architecture-invariants.md, Invariants #3 and #4):
 *   - `nodeIntegration` MUST be `false`
 *   - `contextIsolation` MUST be `true`
 *
 * The preload script path and renderer entry are passed in rather than
 * resolved here so the caller controls filesystem layout and tests can
 * assert the wiring. The `--chimera-env=<env>` flag is injected via
 * `additionalArguments` so the renderer can read it from `process.argv`.
 */
export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
    const window = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            preload: options.preloadPath,
            additionalArguments: [`--chimera-env=${options.env}`],
        },
    });

    void window.loadFile(options.rendererEntry);

    // WARN-2: block all new-window / popup navigations
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // WARN-3: prevent in-page navigations to non-file URLs
    window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
        }
    });

    // WARN-6: log renderer load failures so silent white-screen bugs are diagnosable
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
        const msg = `[chimera] renderer failed to load: ${errorCode} ${errorDescription}`;
        options.logger.warn(msg);
    });

    if (options.env === 'development') {
        window.webContents.openDevTools();
    }

    return window;
}

/**
 * Install the app-lifecycle listeners required for correct cross-platform
 * behaviour:
 *   - `window-all-closed`: quit the app on win32/linux; on macOS the process
 *     stays alive until the user explicitly quits (Cmd-Q).
 *   - `activate`: re-create the main window when the dock icon is clicked
 *     and no windows are currently open (macOS).
 */
export function registerAppLifecycle(options: RegisterAppLifecycleOptions): void {
    const { app: appHost, platform, getOpenWindowCount, createWindow } = options;

    appHost.on('window-all-closed', () => {
        if (platform !== 'darwin') {
            appHost.quit();
        }
    });

    appHost.on('activate', () => {
        if (getOpenWindowCount() === 0) {
            createWindow();
        }
    });
}

/**
 * Construct the production {@link LoggerSink} used by the main process.
 *
 * Backed by Pino (§4.27): writes JSON-line entries to a daily rotating
 * `userData/logs/chimera-YYYY-MM-DD.log` file; prunes files older than
 * 14 days on startup. The `logsDir` is injected by `main()` so this
 * function is pure (and therefore unit-testable without touching Electron).
 */
function createProductionLoggerSink(logsDir: string): FlushableSink {
    return createPinoSink(logsDir);
}

/**
 * Entry-point orchestration. Kept as a distinct function so tests can import
 * the helpers above without triggering Electron lifecycle side effects.
 *
 * Preload path follows the convention declared in issue #2:
 *   `path.join(__dirname, '../preload/api.js')`
 *
 * Renderer entry follows issue #3:
 *   `path.join(__dirname, '../../renderer/out/index.html')`
 */
export async function main(): Promise<void> {
    // ── Invariant #27: CHIMERA_DEBUG + production guard ───────────────────────
    // Must be the very first check so no debug surface is initialised before
    // an illegal production+debug combination is caught.
    assertProductionDebugGuard(process.env);

    // ── Invariant 77: CHIMERA_DEV_HARNESS + production guard ──────────────────
    if (process.env['CHIMERA_DEV_HARNESS'] === '1' && process.env.NODE_ENV === 'production') {
        throw new Error('CHIMERA_DEV_HARNESS is enabled in a production build. Refusing to start.');
    }

    const { preloadPath, rendererEntry } = resolveRuntimePaths({
        moduleDirname: __dirname,
        env: process.env,
    });
    const env = resolveChimeraEnv(process.env['CHIMERA_ENV']);
    const userData = app.getPath('userData');

    // Shared in-memory ring buffer: used by the logs IPC `readRecent` handler
    // so the renderer can fetch recent entries for export/debug.
    const memorySink = createMemorySink();

    // Fan-out sink: entries go to both the Pino file sink and the in-memory
    // ring buffer so `chimera:logs:readRecent` has data to return.
    const pinoSink = createProductionLoggerSink(path.join(userData, 'logs'));
    const combinedSink: LoggerSink = {
        write(entry) {
            pinoSink.write(entry);
            memorySink.write(entry);
        },
    };

    // Construct the root main-process logger once (invariant 67). Child
    // loggers injected into each register*Handlers call so every namespace
    // is tagged with its own `module`.
    const logger: Logger = createLogger({
        source: { process: 'main', module: 'root' },
        sink: combinedSink,
    });

    // Register crash reporter early — before any window opens — so all
    // subsequent crashes are captured (Invariant 68).
    const crashLogger = logger.child({ module: 'crash' });
    registerCrashReporter({
        logger: crashLogger,
        crashesDir: path.join(userData, 'crashes'),
        flush: () => {
            pinoSink.flushSync();
        },
        getSnapshot: () => null, // F14 wires the live snapshot when simulation is running
        autosave: async () => {
            if (activeSession === null) {
                crashLogger.warn('autosave skipped: no active session at crash time');
                return;
            }
            await saveManager.autoSave(
                activeSession.captureSaveFile({ gameId: activeSession.gameId }),
            );
        },
    });

    // Create the SaveManager with FileSaveRepository (invariant #37: concrete
    // repository chosen here in main(); SaveManager itself never imports it).
    // Saves are stored under <userData>/saves/<gameId>/<slotId>.chimera.
    const saveManager = new SaveManager(
        new FileSaveRepository(
            new JsonSaveSerializer(),
            createDefaultMigrator(),
            path.join(userData, 'saves'),
        ),
        userData,
        logger.child({ module: 'saves' }),
    );

    // Wire the SaveManager lifecycle: checks crash recovery, clears the flag,
    // and registers the before-quit handler. Returns wasCleanExit for the IPC
    // channel so the renderer can prompt crash-recovery on startup, and
    // autosaveMeta for the chimera:saves:check-crash-recovery handler.
    const { wasCleanExit, autosaveMeta } = await registerSaveManagerLifecycle({
        app,
        saveManager,
        // 'tactics' is the only game registered at M1. When F18 adds more games,
        // extend this array to match the registerSchema(...) calls below.
        knownGameIds: ['tactics'],
    });
    const crashRecoveryStatus =
        autosaveMeta === null
            ? { needsRecovery: false, slotId: null }
            : { needsRecovery: true, slotId: toSlotId(autosaveMeta.slotId) };

    // Flush the async Pino sink on graceful shutdown so buffered log entries
    // reach disk before the process exits (§4.27).
    app.on('before-quit', () => {
        pinoSink.flushSync();
    });

    // Expose the crash-status to the renderer via a dedicated IPC channel.
    // Captured before any window opens so the renderer never races the handler.
    registerCleanExitIpc({ ipcMain, wasCleanExit });

    // Register the `chimera:system:*` channels (platform info, quit). Runs
    // before the first window opens so the renderer never races the handler
    // registration. Other preload namespaces land in later F02 tasks.
    registerSystemHandlers({
        ipcMain,
        app,
        platform: process.platform,
        electronVersion: process.versions.electron ?? '',
        logger: logger.child({ module: 'system' }),
    });

    // Build the LobbyManager once so both lobby IPC and game seat-switch IPC
    // use the same authoritative local-seat context.
    const lobbyLogger = logger.child({ module: 'lobby-manager' });

    // Shared ActionRegistry for all hosted sessions.  Engine actions are
    // always registered; game-specific actions (tactics, etc.) will be added
    // here when F18+ lands.  The registry is immutable after this point.
    const gameRegistry = new ActionRegistry();
    registerEngineActions(gameRegistry);

    // ProfileGate is the sole caller of ProfileSanitizer.admit().
    // Constructed here (the DIP wiring point) and injected into LobbyManager
    // so LobbyManager stays a pure orchestrator (Invariant #61).
    const playerDirectory = new PlayerDirectory();
    const profileGate = createProfileGate(playerDirectory);

    // The single live `SessionRuntime` for the currently-hosted session, or
    // `null` when no session is running.  Wired by the `onSessionHosted`
    // callback below and consumed by the saves IPC adapter to capture
    // SaveFiles (BLOCK-3) and apply restored files (WARN-2).
    let activeSession: SessionRuntime | null = null;

    // The single primary renderer window, captured when app.whenReady()
    // resolves.  Used to target IPC snapshot/reveal messages to the one
    // window that owns the game UI, instead of blasting every BrowserWindow
    // (e.g. detached DevTools) with private per-player projected data (WARN-1).
    let mainWindow: BrowserWindow | null = null;

    // M1: only `'tactics'` is registered.  Stamped on captured save files
    // and used as the qualified slot prefix.
    const HOSTED_GAME_ID = 'tactics';
    const HOSTED_GAME_VERSION = '0.1.0';

    const lobbyManager = new LobbyManager(
        new LocalWebSocketProvider(),
        lobbyLogger,
        (transport, metadata) => {
            const agentManager = new AgentManager({ logger: lobbyLogger });
            const broadcasterRef: { current: StateBroadcaster | null } = { current: null };

            // Build a SessionRuntime around the freshly-created pipeline so
            // the host-side `processAction` flow updates a single live
            // snapshot reference.  `captureSaveFile` (BLOCK-3) and
            // `applyRestoredFile` (WARN-2) read/write through this runtime.
            const initialPlayerSlots = collectInitialPlayerSlots(metadata);
            const initialSnapshot = buildInitialHostedSessionSnapshot({
                // 32-bit unsigned mask keeps `seed` an integer (Invariant #42).
                seed: Date.now() >>> 0,
                hostPlayerId: metadata.hostId,
                playerSlots: initialPlayerSlots,
                phase: gamePhase('lobby'),
            });
            // `pipeline`, `processAction`, and `clearUndoHistory` come from
            // the same factory; `processAction` adds the autosave fire-and-
            // forget hook on top of `pipeline.process` (Issue #375).
            const { processAction, clearUndoHistory, undoManager } = buildHostSessionPipeline(
                gameRegistry,
                (snap, to) => {
                    if (broadcasterRef.current === null) {
                        throw new Error(
                            'StateBroadcaster used before hosted session wiring completed',
                        );
                    }
                    broadcasterRef.current.broadcast(snap, to);
                },
                {
                    gameId: HOSTED_GAME_ID,
                    savePort: {
                        autoSave: async (gameId: string): Promise<void> => {
                            if (activeSession === null) return;
                            const file = activeSession.captureSaveFile({ gameId });
                            await saveManager.autoSave(file);
                        },
                    },
                    logger: lobbyLogger,
                },
            );

            // Per-session commitment runtime shared between the projector and
            // SessionRuntime so `commit()` envelopes are automatically included
            // in the next broadcasted PlayerSnapshot (BLOCK-1 fix, §4.6 / §8).
            const sessionCommitmentRuntime = new SessionCommitmentRuntime();

            const projector = new DefaultStateProjector(tacticsVisibilityRules, {
                getUndoMeta: (viewerId) => ({
                    canUndo: undoManager.canUndo(viewerId),
                    canRedo: undoManager.canRedo(viewerId),
                }),
                getPendingCommitments: () => sessionCommitmentRuntime.capturePendingCommitments(),
            });
            const simulationHost = new SimulationHost(agentManager, projector);
            // Wire StateBroadcaster + ActionPipeline (with InMemoryActionHistory
            // and InMemoryUndoManager) for the hosted session (issue #364).
            // Each hosted session gets a fresh history and undoManager so
            // undo state never bleeds between sessions.
            // Must be set before any pipeline.process()/processAction-triggered
            // broadcast can run; the callback above throws if this ordering is broken.
            broadcasterRef.current = new StateBroadcaster(transport, projector, lobbyLogger);
            const unsubscribeHostRenderer = broadcasterRef.current.registerRendererRecipient({
                viewerId: metadata.hostId,
                sendSnapshot: (snapshot) => {
                    const win = mainWindow;
                    if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                        win.webContents.send(GAME_SNAPSHOT_CHANNEL, snapshot);
                    }
                },
            });

            const sessionRuntime = new SessionRuntime({
                gameId: HOSTED_GAME_ID,
                gameVersion: HOSTED_GAME_VERSION,
                initialSnapshot,
                applyAction: processAction,
                commitmentRuntime: sessionCommitmentRuntime,
            });
            activeSession = sessionRuntime;

            // Track active players so clearUndoHistory can release their
            // per-player undo memory when the session closes.
            const activePlayers = new Set<PlayerId>(
                initialPlayerSlots.map((slot) => slot.playerId),
            );
            const assignedSlotIndexes = new Set<number>(
                initialPlayerSlots.map((slot) => slot.slotIndex),
            );
            // Guard: onGameStart must fire exactly once per session regardless
            // of player churn (WARN-1 fix — `>=` would re-fire on leave+rejoin).
            let gameStarted = false;

            const registerSlotAgent = (pid: PlayerId, slotIndex: number): void => {
                const agentSlot = resolveAgentSlot(metadata, slotIndex);
                if (agentSlot.kind === 'ai') {
                    simulationHost.registerAgent(
                        buildDefaultAIPlayerAgent({
                            playerId: pid,
                            initialSnapshot: sessionRuntime.getSnapshot(),
                            dispatch: (action) => {
                                sessionRuntime.applyAction(action);
                            },
                            logger: lobbyLogger,
                            omniscient: agentSlot.omniscient ?? false,
                        }),
                    );
                    return;
                }
                simulationHost.registerAgent(new HumanPlayerAgent(pid));
            };

            const nextHumanSlotIndex = (): number => {
                for (let slotIndex = 0; slotIndex < metadata.maxPlayers; slotIndex += 1) {
                    if (assignedSlotIndexes.has(slotIndex)) {
                        continue;
                    }
                    if (resolveAgentSlot(metadata, slotIndex).kind === 'human') {
                        assignedSlotIndexes.add(slotIndex);
                        return slotIndex;
                    }
                }
                return assignedSlotIndexes.size;
            };

            const tryStartGame = (): void => {
                if (!gameStarted && activePlayers.size >= metadata.maxPlayers) {
                    gameStarted = true;
                    simulationHost.onGameStart(sessionRuntime.getSnapshot());
                }
            };

            for (const slot of initialPlayerSlots) {
                registerSlotAgent(slot.playerId, slot.slotIndex);
            }
            tryStartGame();

            const unsubJoined = transport.onPlayerJoined(({ playerId: pid }) => {
                activePlayers.add(pid);
                registerSlotAgent(pid, nextHumanSlotIndex());
                // Once every expected player has joined and had their agent
                // registered, notify agents that the game has started
                // (Invariant #17: projection via host; agents must be fully
                // wired before onGameStart fires).
                tryStartGame();
            });
            const unsubLeft = transport.onPlayerLeft((pid) => {
                activePlayers.delete(pid);
            });

            // Drive the pipeline with every received `EngineAction`.  Each
            // action mutates the SessionRuntime's live snapshot via the
            // pipeline's `processAction`, and `engine:end_turn` triggers
            // autosave fire-and-forget (Issue #375).  Errors here are
            // swallowed so a single misbehaving client cannot crash the
            // host event loop; the pipeline already logs invalid actions.
            const unsubAction = transport.onActionReceived((_from, action) => {
                try {
                    sessionRuntime.applyAction(action);
                    // Fan-out to all registered agents after the tick advances
                    // (Invariant #17: routing through SimulationHost/AgentManager).
                    simulationHost.afterTick(sessionRuntime.getSnapshot());
                } catch (err) {
                    lobbyLogger.warn('hosted session: applyAction threw', {
                        actionType: action.type,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            });

            return () => {
                // Notify agents of session end before tearing down state.
                simulationHost.onGameEnd(sessionRuntime.getSnapshot(), { winner: null });
                unsubJoined();
                unsubLeft();
                unsubAction();
                clearUndoHistory([...activePlayers]);
                unsubscribeHostRenderer();
                broadcasterRef.current?.dispose();
                if (activeSession === sessionRuntime) {
                    activeSession = null;
                }
            };
        },
        (transport) => {
            const clientCommitments = new SessionCommitmentRuntime();
            const unsubSnapshotCommitments = transport.onSnapshotReceived((snapshot) => {
                if (snapshot.commitments !== undefined) {
                    clientCommitments.restorePendingCommitments(snapshot.commitments);
                }
            });
            const unsubReveal = registerClientRevealForwarding({
                transport,
                commitmentRuntime: clientCommitments,
                sendRevealToRenderer: (reveal) => {
                    BrowserWindow.getAllWindows().forEach((win) => {
                        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                            win.webContents.send(GAME_REVEAL_CHANNEL, reveal);
                        }
                    });
                },
                logger: lobbyLogger,
            });

            return () => {
                unsubSnapshotCommitments();
                unsubReveal();
            };
        },
        (state) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(LOBBY_UPDATE_CHANNEL, state);
                }
            });
        },
        (status) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(SYSTEM_CONNECTION_STATUS_CHANNEL, status);
                }
            });
        },
        profileGate,
        (snapshot) => {
            const win = mainWindow;
            if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(GAME_SNAPSHOT_CHANNEL, snapshot);
            }
        },
    );

    // Register the `chimera:game:*` channels. `switch-seat` delegates to the
    // same LobbyManager instance used by lobby IPC handlers.
    registerGameHandlers({
        ipcMain,
        seatSwitchManager: lobbyManager,
        logger: logger.child({ module: 'game' }),
    });

    // Register the `chimera:lobby:*` channels.
    registerLobbyHandlers({
        ipcMain,
        lobbyManager,
        logger: logger.child({ module: 'lobby' }),
    });

    // Register the `chimera:saves:*` channels backed by SaveManager.
    // The adapter converts the simulation-side SaveSlotMeta into the
    // preload-side shape, and `broadcastSlotsChanged` pushes the refreshed
    // slot list via `chimera:saves:slot-update` after every save / delete
    // so all open renderer windows stay coherent (§4.11, invariant #37).
    //
    // `captureSaveFile` reads the live snapshot from the active
    // `SessionRuntime` (see `onSessionHosted` above) and stamps a
    // `SaveFile` header.  When no session is active (e.g. `saves:save`
    // invoked from the lobby pre-host) the call rejects so the renderer
    // can surface the error rather than silently writing a half-built
    // file.
    //
    // `applyRestoredFile` writes the loaded `SaveFile.checkpoint` back into
    // the active session's snapshot (Invariant #24, WARN-2 fix).  When no
    // session is active the call is silently skipped — load can be
    // triggered before host start (e.g. "Resume last session" flow) and
    // the snapshot will be applied when the next session is hosted.
    const savesLogger = logger.child({ module: 'saves' });
    registerSavesHandlers({
        ipcMain,
        logger: savesLogger,
        saves: createSavesIpcPort({
            saveManager,
            captureSaveFile: (request) => {
                if (activeSession === null) {
                    return Promise.reject(
                        new Error(
                            'saves:save invoked with no active hosted session — ' +
                                'start a game before saving.',
                        ),
                    );
                }
                return Promise.resolve(activeSession.captureSaveFile(request));
            },
            applyRestoredFile: (file) => {
                if (activeSession === null) {
                    savesLogger.warn(
                        'saves:load received before any session was hosted; ' +
                            'snapshot will not be applied to the live session.',
                        { slotId: file.header.slotId },
                    );
                    return;
                }
                activeSession.applyRestoredFile(file);
            },
            logger: savesLogger,
            crashRecoveryStatus,
        }),
        broadcastSlotsChanged: (_gameId, slots) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(SAVES_SLOT_UPDATE_CHANNEL, slots);
                }
            });
        },
    });

    // Register the `chimera:settings:*` channels backed by SettingsManager.
    // FileSettingsRepository persists user overrides under `<userData>/settings/`.
    // TacticsSettings schema is registered here so getSettings('tactics')
    // returns full game defaults rather than bare engine defaults.
    // broadcastFn pushes chimera:settings:change to all open renderer windows
    // so multi-window coherence is maintained (BLOCK-2 fix).
    const settingsRepo = new FileSettingsRepository(path.join(userData, 'settings'));
    const settingsManager = new SettingsManager(
        settingsRepo,
        (gameId, settings) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(SETTINGS_CHANGE_CHANNEL, gameId, settings);
                }
            });
        },
        logger.child({ module: 'settings' }),
    );
    settingsManager.registerSchema(tacticsSettingsSchema);
    registerSettingsHandlers({
        ipcMain,
        logger: logger.child({ module: 'settings' }),
        settingsManager,
    });

    // Register the `chimera:logs:*` channels. The renderer emits structured
    // log entries via `window.__chimera.logs.emit()`; `readRecent` lets the
    // user export the last N entries from the in-memory ring buffer.
    registerLogsHandlers({
        ipcMain,
        logger: logger.child({ module: 'logs' }),
        memorySink,
        sink: combinedSink,
    });

    // Register the `chimera:profile:*` channels.  All profile state is
    // user-scoped and stateless — profile data never enters GameSnapshot,
    // PlayerSnapshot, or SaveFile (Invariant #59).
    registerProfileHandlers({
        ipcMain,
        logger: logger.child({ module: 'profile' }),
        playerDirectory,
    });

    const createWindow = (): void => {
        mainWindow = createMainWindow({ preloadPath, rendererEntry, env, logger });
    };

    void app.whenReady().then(() => {
        // WARN-4: deny all permission requests (camera, microphone, notifications, etc.).
        // Must be set after app.whenReady() — Electron 33 throws if session is
        // accessed before the app is ready.
        session.defaultSession.setPermissionRequestHandler(
            (_webContents, _permission, callback) => {
                callback(false);
            },
        );
        createWindow();
    });

    registerAppLifecycle({
        app,
        platform: process.platform,
        getOpenWindowCount: () => BrowserWindow.getAllWindows().length,
        createWindow,
    });
}

// Auto-bootstrap only when executed by Electron, not when imported by Vitest.
if (process.env['VITEST'] === undefined) {
    void main();
}
