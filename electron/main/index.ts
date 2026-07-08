import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { networkInterfaces, release as getOsRelease } from 'node:os';
import {
    app,
    BrowserWindow,
    ipcMain,
    protocol as electronProtocol,
    screen as electronScreen,
    session,
} from 'electron';
import { IS_DEBUG_MODE } from '@chimera-engine/simulation/foundation/constants.js';
// Type-only import — erased at compile time, so the debug-bridge module graph
// stays out of the production bundle (Invariant #27); the runtime import is
// the dynamic one behind the IS_DEBUG_MODE gate in main().
import type { DebugBridge } from './debug-bridge.js';
import {
    MalformedAssetRefError,
    parseAssetRef,
} from '@chimera-engine/simulation/foundation/asset-ref-parse.js';
import {
    registerGameHandlers,
    registerLobbyHandlers,
    registerContentHandlers,
    registerSavesHandlers,
    registerSettingsHandlers,
    registerSystemHandlers,
    registerLogsHandlers,
    registerProfileHandlers,
    registerReplayHandlers,
    registerPerspectiveReplayHandlers,
    registerChatHandlers,
    toRestoreStatusEvent,
} from './ipc/ipc-handlers.js';
import {
    createLogger,
    createPinoSink,
    createMemorySink,
    type Logger,
    type LoggerSink,
    type FlushableSink,
} from './logging/logger.js';
import { makeRendererGoneHandler, registerCrashReporter } from './logging/crash-reporter.js';
import { LogRingBufferSink } from './logging/log-ring-buffer-sink.js';
import { SaveManager } from './saves/SaveManager.js';
import { FileSaveRepository } from './saves/FileSaveRepository.js';
import { createSavesIpcPort } from './saves/SavesIpcAdapter.js';
import { ProfileManager } from './profile/ProfileManager.js';
import { FileProfileRepository } from './profile/FileProfileRepository.js';
import { FileSessionTicketStore } from './session/FileSessionTicketStore.js';
import { createSnapshotTicketRecorder } from './session/snapshot-ticket-recorder.js';
import type {
    PlayerLeftMatchEvent,
    ReplayNavigateKind,
    ReplayNavigatePayload,
} from '../preload/api-types.js';
import { SettingsManager } from './settings/SettingsManager.js';
import { FileSettingsRepository } from './settings/FileSettingsRepository.js';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
    type SaveFile,
    type SaveSeat,
    type SaveSessionManifest,
} from '@chimera-engine/simulation/persistence/index.js';
import { createMainGameRegistry, type MainGameContribution } from './game/mainGameRegistry.js';
import { SETTINGS_CHANGE_CHANNEL } from '../preload/apis/settings-api.js';
import {
    SAVES_RESTORE_STATUS_CHANNEL,
    SAVES_SLOT_UPDATE_CHANNEL,
} from '../preload/apis/saves-api.js';
import { REPLAY_NAVIGATE_CHANNEL, REPLAY_EXPORTED_CHANNEL } from '../preload/apis/replay-api.js';
import { LobbyManager } from './lobby/LobbyManager.js';
import { createResolveLobbySetup, buildSetupFromLobbyState } from './lobby/lobbySetupRegistry.js';
import { loadAllGameContent, toGameContent } from './content/loadGameContent.js';
import { resolveAppIcon } from './app-icon.js';
import type { ContentDatabase } from '@chimera-engine/simulation/content/index.js';
import type { GameContent } from '@chimera-engine/simulation/foundation/game-content-contract.js';
import {
    DEFAULT_WINDOW_TITLE,
    resolveTickerHz,
    resolveWindowTitle,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { StateBroadcaster } from './runtime/StateBroadcaster.js';
import { RealtimeTicker } from './runtime/RealtimeTicker.js';
import { buildHostSessionPipeline, type ReplayPort } from './runtime/HostSessionPipeline.js';
import { runRevealSync } from './runtime/RevealOrchestrator.js';
import { FileReplayRepository } from './replay/FileReplayRepository.js';
import { ReplayManager } from './replay/replay-manager.js';
import {
    ReplayPlaybackManager,
    createVisibilityRulesResolver,
} from './replay/replay-playback-manager.js';
import { PerspectiveReplayManager } from './replay/PerspectiveReplayManager.js';
import type { PerspectiveReplayStartHeader } from './replay/PerspectiveReplayManager.js';
import { PerspectiveReplayPlaybackManager } from './replay/PerspectiveReplayPlaybackManager.js';
import { FilePerspectiveReplayRepository } from './replay/FilePerspectiveReplayRepository.js';
import { CompressedPerspectiveReplaySerializer } from './replay/CompressedReplaySerializer.js';
import { JsonReplaySerializer, ReplayMigrator } from '@chimera-engine/simulation/replay/index.js';
import type { PerspectiveReplayFrame } from '@chimera-engine/simulation/replay/index.js';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    buildReplayPlayers,
    collectGameStartAiPlayerSlots,
    collectInitialPlayerSlots,
    createSyntheticAIPlayerId,
    resolveAgentSlot,
} from './runtime/HostedSessionAgents.js';
import {
    SessionCommitmentRuntime,
    SessionRuntime,
    type E2eSessionRuntime,
} from './runtime/SessionRuntime.js';
import { wireDefaultSceneActions } from './runtime/SceneActionWiring.js';
import { SessionRestoreCoordinator } from './runtime/SessionRestoreCoordinator.js';
import { PlayerDirectory } from './profile/PlayerDirectory.js';
import { createProfileGate } from './profile/ProfileGate.js';
import { ChatRelay } from './ChatRelay.js';
import { ChatHub } from './ChatHub.js';
import { LocalWebSocketProvider } from '@chimera-engine/networking/provider/local/LocalWebSocketProvider.js';
import type {
    ClientTransport,
    LobbyAgentSlot,
    LobbyPlayerEntry,
    LobbyState,
    Unsubscribe,
    PlayerSnapshot as WirePlayerSnapshot,
} from '@chimera-engine/networking';
import {
    GAME_REVEAL_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_TICK_CHANNEL,
} from '../preload/apis/game-api.js';
import {
    LOBBY_UPDATE_CHANNEL,
    LOBBY_PLAYER_CONNECTION_CHANNEL,
    LOBBY_PLAYER_LEFT_CHANNEL,
    LOBBY_PROFILE_REJECTED_CHANNEL,
} from '../preload/apis/lobby-api.js';
import { CHAT_MESSAGE_CHANNEL } from '../preload/apis/chat-api.js';
import {
    SYSTEM_CONNECTION_STATUS_CHANNEL,
    SYSTEM_DEVICE_INFO_CHANGE_CHANNEL,
} from '../preload/apis/system-api.js';
import {
    createDeviceProbeWatcher,
    type DeviceProbeWatcher,
    type ScreenPort,
} from './device-probe.js';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera-engine/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    DefaultStateProjector,
    toCommitmentId,
    type CommitmentReveal,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/projection/index.js';
import { AgentManager, HumanPlayerAgent } from '@chimera-engine/ai/engine';
import { SimulationHost } from '@chimera-engine/simulation/host';
import {
    registerE2eHooks,
    getE2eHooks,
    type E2eFirstPlayerRole,
    type E2eHooks,
} from './runtime/e2e-hooks.js';
import { assertProductionDebugGuard, assertProductionDevHarnessGuard } from './startup-guard.js';
import { buildAssetRef, type TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import {
    localProfileId,
    type PlayerProfile,
    type ProfileRepository,
} from '@chimera-engine/simulation/profile/ProfileSchema.js';
import {
    buildRendererGameLaunchUrl,
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
    CHIMERA_RENDERER_URL,
    type ChimeraRendererUrl,
} from './renderer-url.js';

export {
    buildRendererGameLaunchUrl,
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
    CHIMERA_RENDERER_URL,
};
export type { ChimeraRendererUrl };
export type { MainGameContribution };

export const DEFAULT_LOCAL_PROFILE_ID = 'local-default';
const BOOTSTRAP_BACKGROUND_COLOR = '#111113';
const LOCAL_SEAT_HANDOFF_DELAY_MS = 150;

/**
 * Bridge a wire-level {@link WirePlayerSnapshot} (the networking-brand snapshot a
 * joined client receives over transport) to the simulation `PlayerSnapshot` the
 * perspective recorder consumes. The two declarations describe the *same*
 * projected payload and converge once `simulation/snapshot.ts` lands (see the
 * "Wire-level snapshot type" note in `MultiplayerProvider.ts`); until then this
 * is the single, documented home for that boundary cast — no shape change
 * crosses it. The host path needs no such bridge: it already holds a simulation
 * `PlayerSnapshot` straight from the projector.
 */
function asProjectedSnapshot(wire: WirePlayerSnapshot): PlayerSnapshot {
    return wire as unknown as PlayerSnapshot;
}

/**
 * Egress seam for perspective-replay recording (§4.28, ADR F44b, T5). Mirrors
 * the role `ReplayPort` plays for the deterministic recorder, but is driven from
 * the snapshot *egress* (host renderer + joined-client) rather than the pipeline:
 * it records only already-projected `PlayerSnapshot`s and never re-runs the
 * simulation or reads `seed` (invariant #98). Recording locks to the seat active
 * at `start`; later frames for other seats are skipped by the manager behind it.
 *
 * The two egress paths (host renderer, joined client) are mutually exclusive —
 * a process either hosts or joins, never both — so at most one recording is ever
 * live. That assumption is asserted, not assumed: each start site checks
 * `isRecording()` first and refuses to start over a live recording.
 */
interface PerspectiveReplayPort {
    /** Whether a recording is already in progress (asserts host/client exclusion). */
    isRecording(): boolean;
    /** Begin recording for the single locked `viewerId` in `header`. */
    start(header: PerspectiveReplayStartHeader): void;
    /** Append one projected frame (the manager enforces the lock + tick order). */
    recordSnapshot(frame: PerspectiveReplayFrame): void;
    /** Finalise and persist the recording at match end. */
    finalise(): Promise<void>;
    /** Discard an in-progress recording on abnormal teardown (idempotent). */
    abort(): void;
}

export function createDefaultPlayerProfile(
    rawLocalProfileId: string = DEFAULT_LOCAL_PROFILE_ID,
): PlayerProfile {
    return {
        localProfileId: localProfileId(rawLocalProfileId),
        displayName: 'Player',
        avatar: { kind: 'builtin', ref: buildAssetRef<TextureAsset>('avatar', 'default') },
        locale: 'en-US',
    };
}

function resolveLocalProfileId(rawLocalProfileId: string | undefined): string {
    const trimmed = rawLocalProfileId?.trim();
    return trimmed === undefined || trimmed.length === 0 ? DEFAULT_LOCAL_PROFILE_ID : trimmed;
}

export async function ensureActiveProfile(
    profileManager: ProfileManager,
    repository: ProfileRepository,
    rawLocalProfileId: string | undefined,
): Promise<PlayerProfile> {
    const resolvedProfileId = resolveLocalProfileId(rawLocalProfileId);
    const profileId = localProfileId(resolvedProfileId);
    const existingProfile = await repository.load(profileId);
    if (existingProfile === null) {
        await repository.save(createDefaultPlayerProfile(resolvedProfileId));
    }
    return profileManager.getLocal(profileId);
}

export function resolveInitialEntitiesForGame(
    gameRegistry: ActionRegistry<BaseGameSnapshot>,
    gameId: string,
    playerIds: readonly PlayerId[],
): BaseGameSnapshot['entities'] {
    return gameRegistry.resolveGame(gameId)?.buildInitialEntities?.(playerIds) ?? {};
}

export function resolveFirstPlayerFromLobbyState(
    state: LobbyState,
    firstPlayerRole: E2eFirstPlayerRole,
): PlayerId {
    if (firstPlayerRole === 'host') {
        return state.info.hostId;
    }

    return (
        state.players.find((entry) => entry.playerId !== state.info.hostId)?.playerId ??
        state.info.hostId
    );
}

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
    /**
     * Optional deep-link override.  Must be a validated {@link ChimeraRendererUrl};
     * passing an unvalidated `string` is a compile-error.  Use
     * `sanitiseE2eInitialUrl` to obtain a value of this type.
     */
    readonly initialUrl?: ChimeraRendererUrl;
    readonly env: ChimeraEnv;
    /** Logger for did-fail-load events; always provided in production main() (Invariant #67). */
    readonly logger: Logger;
    /**
     * OS window title. Resolved from the hosted game's manifest
     * ({@link resolveWindowTitle}); defaults to {@link DEFAULT_WINDOW_TITLE}.
     */
    readonly windowTitle?: string;
    /**
     * Absolute filesystem path to the application/window icon. When provided it
     * is wired into the {@link BrowserWindow} `icon` and, on macOS, the dock
     * icon. When omitted, Electron keeps its stock icon. Resolution from the
     * bundled default Chimera asset or a game's `GameManifest` override happens
     * at the call site (F67 T2); this layer only applies an already-resolved
     * absolute path.
     */
    readonly icon?: string;
    /**
     * Open the window in borderless "windowed fullscreen" covering the primary
     * display (macOS: `simpleFullscreen` — fills the screen with no separate
     * Space/animation; Windows/Linux: native `fullscreen`). Enabled only for
     * packaged production runs — never dev, never E2E (computed at the call
     * site from `env` + `CHIMERA_E2E`). Default false.
     */
    readonly windowedFullscreen?: boolean;
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
    /**
     * `app.isPackaged`. The packaged layout (electron-builder) and the
     * run-from-source layout nest the Electron main bundle at different depths
     * relative to the game's `data`/`assets`, so the {@link RuntimePaths.gameAssetsRoot}
     * walk differs between them. See {@link resolveRuntimePaths}.
     */
    readonly isPackaged: boolean;
}

export interface RuntimePaths {
    readonly preloadPath: string;
    readonly rendererEntry: string;
    readonly gameAssetsRoot: string;
}

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 800;

export interface RendererProtocolHeaders {
    get(name: string): string | null;
}

export interface ResolveRendererProtocolFilePathOptions {
    readonly rendererRoot: string;
    readonly gameAssetsRoot?: string;
    readonly requestUrl: string;
    readonly headers: RendererProtocolHeaders;
}

export interface RegisterRendererProtocolOptions {
    readonly protocol: Pick<typeof electronProtocol, 'handle'>;
    readonly rendererRoot: string;
    readonly gameAssetsRoot: string;
    readonly logger: Logger;
}

export interface RegisterRendererProtocolSchemeOptions {
    readonly registerSchemesAsPrivileged: typeof electronProtocol.registerSchemesAsPrivileged;
}

export function registerRendererProtocolScheme(
    options: RegisterRendererProtocolSchemeOptions,
): void {
    options.registerSchemesAsPrivileged([
        {
            scheme: CHIMERA_RENDERER_PROTOCOL,
            privileges: {
                standard: true,
                secure: true,
                supportFetchAPI: true,
            },
        },
    ]);
}

// Register the renderer scheme as privileged at module load (must run before
// `app.whenReady`). Guarded like the bootstrap: skipped under Vitest, where
// `electron` is mocked per-test, so importing this module (e.g. via the
// composition root `apps/tactics/electron/main.ts`) is side-effect-free in unit tests.
if (process.env['VITEST'] === undefined) {
    registerRendererProtocolScheme(electronProtocol);
}

const RSC_CONTENT_TYPE = 'text/x-component; charset=utf-8';
const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

const CONTENT_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
    '.css': 'text/css; charset=utf-8',
    '.html': HTML_CONTENT_TYPE,
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.ogg': 'audio/ogg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.txt': RSC_CONTENT_TYPE,
    '.wav': 'audio/wav',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
};

function isRendererProtocolRscRequest(url: URL, headers: RendererProtocolHeaders): boolean {
    return url.searchParams.has('_rsc') || headers.get('RSC') === '1';
}

function isWithinDirectory(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normaliseRendererProtocolPath(url: URL, headers: RendererProtocolHeaders): string | null {
    if (
        url.protocol !== `${CHIMERA_RENDERER_PROTOCOL}:` ||
        url.hostname !== CHIMERA_RENDERER_HOST
    ) {
        return null;
    }

    if (/%2e|%2f|%5c/i.test(url.pathname)) {
        return null;
    }

    let routePath: string;
    try {
        routePath = decodeURIComponent(url.pathname);
    } catch {
        return null;
    }

    if (routePath.includes('\\')) {
        return null;
    }

    const nestedNextPathIndex = routePath.indexOf('/_next/');
    if (nestedNextPathIndex > 0) {
        routePath = routePath.slice(nestedNextPathIndex);
    }

    if (routePath === '' || routePath === '/') {
        return '/index.html';
    }

    if (routePath.startsWith('/_next/')) {
        return routePath;
    }

    const isRsc = isRendererProtocolRscRequest(url, headers);
    const extension = path.posix.extname(routePath);

    if (extension === '.txt' && !routePath.endsWith('/index.txt')) {
        return `${routePath.slice(0, -'.txt'.length)}/index.txt`;
    }

    if (routePath.endsWith('/')) {
        return `${routePath}index.${isRsc ? 'txt' : 'html'}`;
    }

    if (extension === '') {
        return `${routePath}/index.${isRsc ? 'txt' : 'html'}`;
    }

    return routePath;
}

function resolveRendererGameAssetFilePath(gameAssetsRoot: string, url: URL): string | null {
    if (
        url.protocol !== `${CHIMERA_RENDERER_PROTOCOL}:` ||
        url.hostname !== CHIMERA_RENDERER_HOST ||
        !url.pathname.startsWith('/game-assets/')
    ) {
        return null;
    }

    let routePath: string;
    try {
        routePath = decodeURIComponent(url.pathname);
    } catch {
        return null;
    }

    if (routePath.includes('\\')) {
        return null;
    }

    const assetRef = routePath.slice('/game-assets/'.length);
    try {
        const { gameId, relativePath } = parseAssetRef(assetRef);
        const root = path.resolve(gameAssetsRoot);
        const gameAssetRoot = path.resolve(root, gameId, 'assets');
        const candidate = path.resolve(gameAssetRoot, relativePath);
        return isWithinDirectory(gameAssetRoot, candidate) ? candidate : null;
    } catch (error: unknown) {
        if (error instanceof MalformedAssetRefError) {
            return null;
        }
        throw error;
    }
}

export function resolveRendererProtocolFilePath(
    options: ResolveRendererProtocolFilePathOptions,
): string | null {
    // Guard against encoded traversal sequences in the request *path* only. The
    // query string legitimately carries URL-encoded separators (e.g. the replay
    // player route receives an encoded absolute filesystem path via `?path=`),
    // so testing the full URL here would reject valid nested-route navigations.
    const queryStart = options.requestUrl.indexOf('?');
    const rawPathPortion =
        queryStart === -1 ? options.requestUrl : options.requestUrl.slice(0, queryStart);
    if (/%2e|%2f|%5c/i.test(rawPathPortion)) {
        return null;
    }

    let url: URL;
    try {
        url = new URL(options.requestUrl);
    } catch {
        return null;
    }

    if (url.pathname.startsWith('/game-assets/')) {
        if (options.gameAssetsRoot === undefined) {
            return null;
        }
        return resolveRendererGameAssetFilePath(options.gameAssetsRoot, url);
    }

    const protocolPath = normaliseRendererProtocolPath(url, options.headers);
    if (protocolPath === null) {
        return null;
    }

    const root = path.resolve(options.rendererRoot);
    const candidate = path.resolve(root, `.${protocolPath}`);
    return isWithinDirectory(root, candidate) ? candidate : null;
}

function contentTypeForPath(filePath: string): string {
    return CONTENT_TYPES_BY_EXTENSION[path.extname(filePath)] ?? 'application/octet-stream';
}

function codeFromError(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return undefined;
    }

    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}

async function handleRendererProtocolRequest(
    rendererRoot: string,
    gameAssetsRoot: string,
    logger: Logger,
    request: Request,
): Promise<Response> {
    const filePath = resolveRendererProtocolFilePath({
        rendererRoot,
        gameAssetsRoot,
        requestUrl: request.url,
        headers: request.headers,
    });

    if (filePath === null) {
        return new Response('Not found', { status: 404 });
    }

    try {
        const data = await readFile(filePath);
        return new Response(data, {
            status: 200,
            headers: {
                'content-type': contentTypeForPath(filePath),
            },
        });
    } catch (error) {
        const code = codeFromError(error);
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return new Response('Not found', { status: 404 });
        }

        logger.warn('renderer protocol failed to read static asset', {
            path: filePath,
            error: error instanceof Error ? error.message : String(error),
        });
        return new Response('Internal server error', { status: 500 });
    }
}

export function registerRendererProtocol(options: RegisterRendererProtocolOptions): void {
    const rendererRoot = path.resolve(options.rendererRoot);
    const gameAssetsRoot = path.resolve(options.gameAssetsRoot);
    options.protocol.handle(CHIMERA_RENDERER_PROTOCOL, (request) =>
        handleRendererProtocolRequest(rendererRoot, gameAssetsRoot, options.logger, request),
    );
}

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
    // Game content/assets are read at `<gameAssetsRoot>/<gameId>/data` (and
    // `/assets`) by loadGameContent / app-icon. The bundle sits at
    // `<app>/dist/electron/main.js`, so two levels up (`appDir`) is the app dir.
    //
    // Packaged (electron-builder): each game's `data`/`assets` are remapped INTO
    // an `apps/<gameId>/` subtree that is a sibling of `dist/` inside the app
    // root, so the asset root is `<appDir>/apps` (see apps/<game>/electron-builder.yml).
    //
    // Run-from-source (dev / `electron apps/<game>`): the app dir IS
    // `<root>/apps/<gameId>`, the bundle is nested one level deeper, and the
    // game's `data` is at `<root>/apps/<gameId>/data`, so the asset root (the
    // `apps/` dir) is the PARENT of the app dir. Using the packaged `../../apps`
    // walk here overshoots to `apps/<gameId>/apps`, the ENOENT seen when
    // launching the dev app from source (relocation gap from F63 #783).
    const appDir = path.join(options.moduleDirname, '..', '..');
    const gameAssetsRoot = options.isPackaged ? path.join(appDir, 'apps') : path.dirname(appDir);

    if (options.env['CHIMERA_E2E'] !== '1') {
        return { preloadPath, rendererEntry, gameAssetsRoot };
    }

    return {
        preloadPath: options.env['CHIMERA_E2E_PRELOAD_PATH'] ?? preloadPath,
        rendererEntry: options.env['CHIMERA_E2E_RENDERER_ENTRY'] ?? rendererEntry,
        gameAssetsRoot: options.env['CHIMERA_E2E_GAME_ASSETS_ROOT'] ?? gameAssetsRoot,
    };
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
 * Validate a CHIMERA_E2E_INITIAL_URL value from the environment.
 *
 * Security invariant (BLOCK-1): the env var is untrusted input — accept only
 * URLs whose protocol is `chimera:` and whose host is `renderer`.  Any other
 * value (remote https, wrong host, malformed string, undefined) falls back to
 * `CHIMERA_RENDERER_URL` (the renderer root, distinct from the production launch
 * URL built per hosted game by `buildRendererGameLaunchUrl`) so a BrowserWindow
 * can never load a remote URL via the E2E path.
 */
export function sanitiseE2eInitialUrl(raw: string | undefined): ChimeraRendererUrl {
    if (raw === undefined) {
        return CHIMERA_RENDERER_URL;
    }
    try {
        const parsed = new URL(raw);
        if (
            parsed.protocol === `${CHIMERA_RENDERER_PROTOCOL}:` &&
            parsed.hostname === CHIMERA_RENDERER_HOST
        ) {
            return raw as ChimeraRendererUrl;
        }
    } catch {
        // malformed URL — fall through to default
    }
    return CHIMERA_RENDERER_URL;
}

/**
 * Construct the primary renderer `BrowserWindow` and load the Next.js static
 * export through the `chimera://renderer` protocol.
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
    const resolvedTitle = options.windowTitle ?? DEFAULT_WINDOW_TITLE;
    // "Windowed fullscreen" (borderless, covers the display) for packaged
    // production only. On macOS use pre-Lion `simpleFullscreen` so the window
    // fills the screen WITHOUT switching to a separate Space (native fullscreen
    // would animate into its own desktop); on Windows/Linux native `fullscreen`
    // already yields a borderless window over the taskbar. `width`/`height` stay
    // as the restore size for when the window leaves fullscreen.
    const isDarwin = process.platform === 'darwin';
    const fullscreen = options.windowedFullscreen === true;
    const window = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        backgroundColor: BOOTSTRAP_BACKGROUND_COLOR,
        title: resolvedTitle,
        // Only set `icon` when supplied so the no-icon case leaves Electron's
        // stock icon untouched (F67 T1).
        ...(options.icon !== undefined ? { icon: options.icon } : {}),
        ...(fullscreen ? (isDarwin ? { simpleFullscreen: true } : { fullscreen: true }) : {}),
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

    // On macOS, guarantee entry into simple fullscreen via the documented setter;
    // relying on the constructor option alone to enter has been version-sensitive.
    if (fullscreen && isDarwin) {
        window.setSimpleFullScreen(true);
    }

    // macOS shows the app icon in the dock, not just the window chrome; the
    // `BrowserWindow` `icon` alone does not cover it. `app.dock` exists only on
    // darwin (`Dock | undefined`), so guard on the platform and chain defensively.
    // `setIcon` throws ("Failed to load image from path …") when the icon file is
    // missing; a cosmetic dock icon must never abort window creation, so swallow
    // and warn rather than letting it bubble out of createMainWindow (WARN-6 idiom).
    if (options.icon !== undefined && process.platform === 'darwin') {
        try {
            app.dock?.setIcon(options.icon);
        } catch (err) {
            options.logger.warn(
                `[chimera] createMainWindow: failed to set dock icon "${options.icon}": ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
        }
    }

    const urlToLoad = options.initialUrl ?? CHIMERA_RENDERER_URL;
    // Defense-in-depth: validate protocol and host even though the branded type
    // already enforces this statically.  Guards against callers that bypass the
    // type via `as`.
    const parsed = new URL(urlToLoad);
    if (
        parsed.protocol !== `${CHIMERA_RENDERER_PROTOCOL}:` ||
        parsed.hostname !== CHIMERA_RENDERER_HOST
    ) {
        throw new Error(
            `[chimera] createMainWindow: refusing to load untrusted URL "${urlToLoad}". ` +
                `Only ${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/… is permitted (WARN-1).`,
        );
    }
    void window.loadURL(urlToLoad);

    // WARN-2: block all new-window / popup navigations
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // WARN-3: prevent in-page navigations outside the renderer app protocol.
    window.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(`${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/`)) {
            event.preventDefault();
        }
    });

    // Pin the OS window title to the resolved (manifest-driven) title. The
    // static Next.js export bakes a `<title>Chimera</title>` (renderer/app/
    // layout.tsx); without this, Chromium's `page-title-updated` would overwrite
    // our title with the page's on every load/navigation.
    window.webContents.on('page-title-updated', (event) => {
        event.preventDefault();
        window.setTitle(resolvedTitle);
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
export async function main(contributions: readonly MainGameContribution[]): Promise<void> {
    // ── Invariant #27: CHIMERA_DEBUG + production guard ───────────────────────
    // Must be the very first check so no debug surface is initialised before
    // an illegal production+debug combination is caught.
    assertProductionDebugGuard(process.env);

    // ── Invariant 77: CHIMERA_DEV_HARNESS + production guard ──────────────────
    assertProductionDevHarnessGuard(process.env);

    // Derive the host-side game registry from the contributions injected by the
    // consumer app composition root (apps/tactics/electron/main.ts) — the host names
    // no game, it indexes
    // whatever set it is given. Built before any consumer so the registerActions
    // loop below registers the game into ActionRegistry before the tick loop
    // starts (Invariant #10).
    const {
        mainGameRegistry,
        hostedGame,
        gameVersions,
        visibilityRulesByGameId,
        contentSchemasByGameId,
        lobbySetupByGameId,
    } = createMainGameRegistry(contributions);
    const rendererLaunchUrl = buildRendererGameLaunchUrl(hostedGame.gameId);

    const { preloadPath, rendererEntry, gameAssetsRoot } = resolveRuntimePaths({
        moduleDirname: __dirname,
        env: process.env,
        isPackaged: app.isPackaged,
    });
    const env = resolveChimeraEnv(process.env['CHIMERA_ENV']);
    const userData = app.getPath('userData');
    const harnessFlags = parseHarnessFlags(process.argv, process.env);

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
    const crashLogSink = new LogRingBufferSink(combinedSink);

    // Construct the root main-process logger once (invariant 67). Child
    // loggers injected into each register*Handlers call so every namespace
    // is tagged with its own `module`.
    const logger: Logger = createLogger({
        source: { process: 'main', module: 'root' },
        sink: crashLogSink,
    });

    // ── Content database load (§4.8, Invariant #14) ───────────────────────────
    // Load every registered game's content directory into an immutable
    // ContentDatabase before the lobby/tick loop comes up. A failure is fatal —
    // the app must not start with invalid content. The engine stays agnostic:
    // each game supplies its own schemas through its injected contribution
    // (`MainGameContribution.contentSchemas`, #788), derived above into
    // `contentSchemasByGameId` — the host names no game.
    let contentDbs: Map<string, ContentDatabase>;
    try {
        contentDbs = await loadAllGameContent(gameAssetsRoot, contentSchemasByGameId);
    } catch (err: unknown) {
        logger.error(
            'fatal: game content failed to load',
            err instanceof Error ? err : new Error(String(err)),
        );
        throw err;
    }

    // Plain, agnostic accessor used by both the lobby-setup composition and the
    // generic content IPC handler. Returns `undefined` for a game with no content.
    const getGameContent = (gameId: string): GameContent | undefined => {
        const db = contentDbs.get(gameId);
        return db === undefined ? undefined : toGameContent(db);
    };

    // Game-aware resolver injected into LobbyManager: closes each game's
    // injected lobby-setup builder over its loaded content (Invariant #2). The
    // builders come from the game contributions (`lobbySetupByGameId`), so the
    // host names no game.
    const resolveLobbySetup = createResolveLobbySetup(getGameContent, lobbySetupByGameId);

    // The single live `SessionRuntime` for the currently-hosted session, or
    // `null` when no session is running. Declared before crash-reporter wiring
    // so crash dumps can include the current authoritative snapshot.
    let activeSession: SessionRuntime | null = null;

    // The matchId of the currently-running match (F68, #820), or `null` before
    // the first `engine:start_game` of the session. Minted in
    // `onGameStartRequested` and read lazily by the live session-manifest
    // closure built in `onSessionHosted` — shared main() scope because those
    // are sibling LobbyManager callbacks. Deliberately NOT reset on
    // return-to-lobby (the snapshot keeps its matchId, so a post-abandon
    // autosave still correlates to the last match); the next start mints a
    // fresh id, and session teardown clears it.
    let currentMatchId: string | null = null;

    // Register crash reporter early — before any window opens — so all
    // subsequent crashes are captured (Invariant 68).
    const crashLogger = logger.child({ module: 'crash' });
    const crashesDir = path.join(userData, 'crashes');
    registerCrashReporter({
        logger: crashLogger,
        crashesDir,
        flush: () => {
            pinoSink.flushSync();
        },
        getSnapshot: () => activeSession?.getSnapshot() ?? null,
        getRecentLogs: () => crashLogSink.drain(),
        getAppVersion: () => app.getVersion(),
        autosave: autosaveActiveSessionBeforeCrash,
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
        logger.child({ module: 'saves' }),
    );

    // ReplayManager owns live-match recording and replay persistence (§4.28,
    // F44). Concrete repository/serializer/migrator are chosen here at the DIP
    // wiring point; the manager itself imports none of them. Replays are stored
    // under <userData>/replays/<gameId>/<uuid>.chimera-replay (atomic write).
    // The manager re-childs the logger to module 'replay-manager' internally
    // (invariant #67), so the root logger is passed directly.
    const replayDir = path.join(userData, 'replays');
    const replayManager = new ReplayManager(
        new FileReplayRepository(new JsonReplaySerializer(), replayDir),
        new ReplayMigrator(),
        {
            engineVersion: app.getVersion(),
            gameVersions,
        },
        logger,
    );

    // PerspectiveReplayManager owns *perspective* replay recording — the
    // privacy-preserving counterpart that captures only already-projected
    // PlayerSnapshots for a single locked viewerId (§4.28, ADR F44b, invariant
    // #98). Wired here at the DIP point alongside ReplayManager; the egress paths
    // (host renderer + joined-client) drive it through `perspectiveReplayPort`
    // below. Files land under <userData>/perspective-replays/<gameId>/<uuid>.
    // Compressed (keyframe + delta) serialization keeps the snapshot stream small.
    // The manager re-childs the logger to 'perspective-replay-manager' internally
    // (invariant #67), so the root logger is passed directly.
    const perspectiveReplayDir = path.join(userData, 'perspective-replays');
    const perspectiveReplayManager = new PerspectiveReplayManager(
        new FilePerspectiveReplayRepository(
            new CompressedPerspectiveReplaySerializer(),
            perspectiveReplayDir,
            logger,
        ),
        { engineVersion: app.getVersion() },
        logger,
    );

    // Egress seam for perspective recording, driven on both the host renderer
    // path and the joined-client path. A single shared manager is safe because a
    // process is either hosting or joined (never both), so only one recording is
    // ever in progress (the same assumption `replayManager` relies on). Both
    // start sites assert that exclusion via `isRecording()` so a future overlap
    // surfaces as a precise diagnostic rather than a swallowed "already in
    // progress" throw.
    const perspectiveReplayPort: PerspectiveReplayPort = {
        isRecording: () => perspectiveReplayManager.isRecording(),
        start: (header) => perspectiveReplayManager.start(header),
        recordSnapshot: (frame) => perspectiveReplayManager.recordSnapshot(frame),
        finalise: async () => {
            await perspectiveReplayManager.finalise();
        },
        abort: () => perspectiveReplayManager.abort(),
    };

    // Flush the async Pino sink on graceful shutdown so buffered log entries
    // reach disk before the process exits (§4.27).
    let deviceProbeWatcher: DeviceProbeWatcher | null = null;
    app.on('before-quit', () => {
        pinoSink.flushSync();
        deviceProbeWatcher?.dispose();
    });

    // Register the `chimera:system:*` channels (platform info, quit, relaunch,
    // device info). Runs before the first window opens so the renderer never
    // races the handler registration.
    registerSystemHandlers({
        ipcMain,
        app,
        platform: process.platform,
        electronVersion: process.versions.electron ?? '',
        logger: logger.child({ module: 'system' }),
        isE2e: process.env['CHIMERA_E2E'] === '1',
        getDeviceInfo: () => deviceProbeWatcher?.getCurrentInfo(),
    });

    // Runtime Debug Layer (§4.12, F47 T5). The bridge module is loaded ONLY
    // via this dynamic import behind the dot-access IS_DEBUG_MODE constant so
    // the bundler's define replacement constant-folds the branch and
    // tree-shakes the whole debug graph in production (Invariant #27).
    // Sessions attach per-hosted-session inside `onSessionHosted` below; the
    // Inspector window itself stays closed until the first toggle IPC.
    let debugBridge: DebugBridge | undefined = undefined;
    if (IS_DEBUG_MODE) {
        const { startDebugBridge } = await import('./debug-bridge.js');
        const { buildNetworkDiagnostics } = await import('./network-diagnostics.js');
        debugBridge = startDebugBridge({
            ipcMain,
            logger: logger.child({ module: 'debug-bridge' }),
            debugPreloadPath: path.join(path.dirname(preloadPath), 'debug-api.js'),
            // Late-bound: `lobbyManager` is constructed below, and this closure
            // runs only at IPC-request time, by which point it is assigned. The
            // builder reads host/OS facts, so diagnostics resolve while hosting
            // in the lobby with no game session attached (§6, §11).
            getNetworkDiagnostics: () =>
                buildNetworkDiagnostics({
                    networkInterfaces: () => networkInterfaces(),
                    getHostPort: () => lobbyManager.getHostPort(),
                }),
        });
    }

    // Build the LobbyManager once so both lobby IPC and game seat-switch IPC
    // use the same authoritative local-seat context.
    const lobbyLogger = logger.child({ module: 'lobby-manager' });

    // Shared ActionRegistry for all hosted sessions.  Engine + scene actions are
    // always registered; each registered game contributes its own actions through
    // the composition registry (`mainGameRegistry`).  The registry is immutable
    // after this point.
    const gameRegistry = new ActionRegistry();
    registerEngineActions(gameRegistry);
    wireDefaultSceneActions(gameRegistry);
    for (const game of Object.values(mainGameRegistry)) {
        game.registerActions(gameRegistry);
    }

    // ProfileGate is the sole caller of ProfileSanitizer.admit().
    // Constructed here (the DIP wiring point) and injected into LobbyManager
    // so LobbyManager stays a pure orchestrator (Invariant #61).
    const playerDirectory = new PlayerDirectory();
    const profileGate = createProfileGate(playerDirectory);

    // ChatRelay is the sole gate between an inbound CHAT side-channel message and
    // its rebroadcast (Invariant #73). Constructed here (the DIP wiring point)
    // and injected into LobbyManager. `teamOf` is left at its default until team
    // membership is modelled on the host, so `team`-scope routing is inert today.
    const chatRelay = new ChatRelay(lobbyLogger, playerDirectory);
    const profileRepository = new FileProfileRepository(path.join(userData, 'profiles'));
    const profileManager = new ProfileManager(profileRepository);
    await ensureActiveProfile(profileManager, profileRepository, harnessFlags?.profileId);

    // Session wiring callbacks consumed by the saves IPC adapter to capture
    // SaveFiles (BLOCK-3) and apply restored files (WARN-2).
    let dispatchRendererAction: ((action: ActionEnvelope) => void) | null = null;
    let saveInitialTurnMemento: ((playerId: PlayerId) => void) | null = null;
    let handleHostedLocalSeatAdded: ((entry: LobbyPlayerEntry) => void) | null = null;
    let broadcastRestoredSnapshot: (() => void) | null = null;
    // Host-local match-state reset for return-to-lobby (#737). Assigned inside
    // `onSessionHosted` (the `saveInitialTurnMemento` pattern) so the sibling
    // `onReturnToLobbyRequested` callback can reuse that scope's closures; null
    // when no hosted session is live.
    let resetActiveSessionToLobby: (() => void) | null = null;
    // Seats lobby-added AI agents from the LIVE lobby `agentSlots` at game-start
    // (#730 follow-up). Assigned inside `onSessionHosted` (the
    // `saveInitialTurnMemento` pattern) so `onGameStartRequested` can register the
    // AI agents and learn their synthetic player ids; null when no hosted session
    // is live. AI is added to the lobby AFTER hosting, so the host-time
    // `metadata.agentSlots` is empty — this re-derives the roster at start.
    let seatLobbyAgentsForGameStart:
        | ((agentSlots: readonly LobbyAgentSlot[]) => readonly PlayerId[])
        | null = null;
    // Mirrors the live lobby AI roster into the hosted session as `addAi()`
    // mutates it during the lobby (#833). Assigned inside `onSessionHosted` (the
    // `seatLobbyAgentsForGameStart` pattern) so `onLobbyStateChanged` can keep
    // the human-slot authority (`nextHumanSlotIndex`) aware of `addAi()` AI
    // seats; without it a human joining AFTER an AI is added is handed the AI's
    // slot index. Null when no hosted session is live.
    let syncLiveAgentSlots: ((agentSlots: readonly LobbyAgentSlot[]) => void) | null = null;
    // Reconciles the host slot ledger when an AI is removed from the lobby roster
    // — `removeAi()` or the join-overflow auto-remove (#838). Assigned inside
    // `onSessionHosted` (the `syncLiveAgentSlots` pattern) so `onAiSlotRemoved`
    // can drive it from outside; null when no hosted session is live.
    let removeAiSeat: ((slotIndex: number) => void) | null = null;
    // Seats a restored save's roster into the freshly hosted session (F68 #823).
    // Assigned inside `onSessionHosted` (the `seatLobbyAgentsForGameStart`
    // pattern) so the SessionRestoreCoordinator can drive seating from outside;
    // null when no hosted session is live.
    let seatRestoredRoster: ((seats: readonly SaveSeat[]) => Promise<void>) | null = null;
    // Suppresses `tryStartGame` between restore-hosting and roster completion:
    // `onSessionHosted` fires a start attempt DURING `hostLobby` and local-seat
    // re-adds fire more, all before the checkpoint is applied — without this
    // gate a small roster could start the game on the pre-restore lobby
    // snapshot. Raised by the coordinator's hostLobby port, cleared at the tail
    // of `seatRestoredRoster` (which then retries the start itself).
    let restoreSeatingActive = false;

    // Joined-client perspective recording state (F44b T5). Non-null only inside a
    // joined session: `onSessionJoined` arms it, the cleanup fn disarms it, and
    // `onClientSnapshotReceived` lazily starts recording on the first snapshot
    // (the client has no session-start header — `viewerId` is read off the first
    // projected snapshot, which is always the local seat). Set back to null once
    // the match ends so trailing snapshots neither re-start nor record after
    // game-over. Host recording is independent (scoped inside `onSessionHosted`).
    let clientPerspective: { started: boolean } | null = null;

    // Whether a joined-client session is currently live. Unlike `clientPerspective`
    // (nulled at game-over so trailing snapshots don't re-record), this stays true
    // for the whole joined session — `onSessionJoined` sets it, the cleanup fn
    // clears it. It gates the perspective `exportCurrent` so the client can save
    // its OWN retained perspective replay from the post-game summary after the match
    // ends (the recording is not persisted until then; the deterministic export
    // remains host-only via `activeSession`).
    let joinedSessionActive = false;

    // The single primary renderer window, captured when app.whenReady()
    // resolves.  Used to target IPC snapshot/reveal messages to the one
    // window that owns the game UI, instead of blasting every BrowserWindow
    // (e.g. detached DevTools) with private per-player projected data (WARN-1).
    let mainWindow: BrowserWindow | null = null;

    // The most recently projected PlayerSnapshot sent to the main window.
    // Exposed via `chimera:game:get-current-snapshot` so the renderer can
    // replay a snapshot that arrived before its IPC listener was registered
    // (direct-game E2E start, renderer reload mid-session).
    // Typed as `unknown` since the IPC boundary serialises to JSON and the
    // simulation-layer branded types are incompatible with the preload types.
    let lastSentPlayerSnapshot: unknown = null;

    // The single game the host runs (M1 single-game lifecycle), sourced from the
    // game registry rather than named here.  Stamped on captured save files and
    // used as the qualified slot prefix.
    const HOSTED_GAME_ID = hostedGame.gameId;
    const HOSTED_GAME_VERSION = hostedGame.gameVersion;
    // Captured once so the conditional spread below narrows `db` correctly under
    // exactOptionalPropertyTypes. Absent for a game that declares no content.
    const hostedContentDb = contentDbs.get(HOSTED_GAME_ID);

    // Session tickets remember which seat this client held per match (F68 #822)
    // so the next joinLobby can present them as JOIN claims and reclaim the
    // seat on a restored session (#821). Concrete store chosen here (invariant
    // #37); tickets hold opaque ids only and never cross IPC (Inv #59/#60).
    const sessionTicketLogger = logger.child({ module: 'session-tickets' });
    const sessionTicketStore = new FileSessionTicketStore(
        path.join(userData, 'session-tickets.json'),
        sessionTicketLogger,
    );
    const recordSessionTicket = createSnapshotTicketRecorder({
        store: sessionTicketStore,
        gameId: HOSTED_GAME_ID,
        logger: sessionTicketLogger,
    });

    // Register E2E hooks at the wiring point so no module-level side effects
    // are needed in SimulationHost.ts (WARN-1 / §2 DIP).
    registerE2eHooks(process.env);
    const resolvedE2eHooks = getE2eHooks();
    let activeE2eHooks: E2eHooks | undefined = undefined;

    // ChatHub is the recipient-side terminus for the local player (§4.29): it
    // owns the bounded history buffer + mute set and pushes delivered messages to
    // the renderer. Chat is private-capable, so it targets the primary game window
    // only (mirroring snapshot egress, WARN-1) rather than every BrowserWindow.
    const chatHub = new ChatHub({
        logger: lobbyLogger,
        onMessage: (message) => {
            const win = mainWindow;
            if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(CHAT_MESSAGE_CHANNEL, message);
            }
        },
    });

    // Wire the CHIMERA_E2E-only `deliverChat` hook to the ChatHub sink so chat
    // E2E specs can drive the renderer 500-entry rolling-buffer cap through the
    // real ChatHub → CHAT_MESSAGE_CHANNEL → chatStore → ChatPanel path, bypassing
    // the relay + rate limit (both irrelevant to the cap). No-op when CHIMERA_E2E
    // is absent (resolvedE2eHooks is undefined).
    if (resolvedE2eHooks !== undefined) {
        resolvedE2eHooks.deliverChat = (message) => {
            chatHub.deliverLocal(message);
        };
    }

    const lobbyManager = new LobbyManager(new LocalWebSocketProvider(), lobbyLogger, {
        ...(resolvedE2eHooks !== undefined ? { e2eHooks: resolvedE2eHooks } : {}),
        // Inject the game lobby-setup resolver from the composition-root registry
        // so the manager can seed host-authored defaults without importing
        // `games/*` (Invariant #2). Empty registry → no-op seeding (#706).
        resolveLobbySetup,
        // Present this client's remembered seats as JOIN claims (F68 #822).
        // `undefined` when no ticket matches the hosted game — a fresh client
        // must omit the key entirely to keep the host's claimless join-order
        // fallback available (#821); the provider sanitizes and caps the list.
        resolveJoinClaims: async () => {
            const tickets = await sessionTicketStore.claims();
            const relevant = tickets.filter((ticket) => ticket.gameId === HOSTED_GAME_ID);
            return relevant.length > 0
                ? relevant.map((ticket) => ({
                      matchId: ticket.matchId,
                      playerId: ticket.playerId,
                  }))
                : undefined;
        },
        onSessionHosted: (transport, metadata) => {
            activeE2eHooks = metadata.e2eHooks;
            const agentManager = new AgentManager({ logger: lobbyLogger });
            const broadcasterRef: { current: StateBroadcaster | null } = { current: null };
            const simulationHostRef: { current: SimulationHost | null } = { current: null };

            // Build a SessionRuntime around the freshly-created pipeline so
            // the host-side `processAction` flow updates a single live
            // snapshot reference.  `captureSaveFile` (BLOCK-3) and
            // `applyRestoredFile` (WARN-2) read/write through this runtime.
            const initialPlayerSlots = collectInitialPlayerSlots(metadata);
            const initialPlayerIds = initialPlayerSlots.map((slot) => slot.playerId);
            const initialEntities = resolveInitialEntitiesForGame(
                gameRegistry,
                HOSTED_GAME_ID,
                initialPlayerIds,
            );

            // 32-bit unsigned mask keeps `seed` an integer (Invariant #42).
            // Captured once so the same value seeds both the live snapshot and
            // the replay header (replay reconstructs initial state from it).
            const sessionSeed = Date.now() >>> 0;
            const initialSnapshot = buildInitialHostedSessionSnapshot({
                seed: sessionSeed,
                hostPlayerId: metadata.hostId,
                playerSlots: initialPlayerSlots,
                phase: gamePhase('lobby'),
                ...(Object.keys(initialEntities).length > 0 ? { initialEntities } : {}),
            });

            // Live-match replay recording adapter (F44 / T4, Issue #658).
            // Delegates to the shared `ReplayManager`; `recordAction` is driven by
            // the pipeline, `startRecording` by the composition root just below. The
            // match is NOT persisted at game-over — the recording is retained and
            // written only on an explicit save (`replayManager.exportCurrentMatch`),
            // or discarded via `abortRecording` at teardown (§4.28).
            const replayPort: ReplayPort = {
                startRecording: (header) => replayManager.startRecording(header),
                recordAction: (entry) => replayManager.recordAction(entry),
            };

            // Runtime Debug Layer per-session attach (§4.12, F47 T5).
            // Both getters are lazy: `projector` and `replay` are declared
            // further down in this closure and are only dereferenced from IPC
            // query handling, which cannot run before this synchronous body
            // completes (TDZ-safe). No-op `undefined` outside debug mode.
            const debugPort = debugBridge?.attachSession({
                getProjector: () => projector,
                getReplay: () => replay,
            });

            // `pipeline`, `processAction`, and `clearUndoHistory` come from
            // the same factory; `processAction` adds the autosave fire-and-
            // forget hook on top of `pipeline.process` (Issue #375).
            const { processAction, clearUndoHistory, undoManager, replay } =
                buildHostSessionPipeline(
                    gameRegistry,
                    (snap, to) => {
                        if (broadcasterRef.current === null) {
                            throw new Error(
                                'StateBroadcaster used before hosted session wiring completed',
                            );
                        }
                        broadcasterRef.current.broadcast(snap, to);
                    },
                    (tick, to) => {
                        if (broadcasterRef.current === null) {
                            throw new Error(
                                'StateBroadcaster used before hosted session wiring completed',
                            );
                        }
                        broadcasterRef.current.broadcastTick(tick, to);
                    },
                    {
                        gameId: HOSTED_GAME_ID,
                        savePort: {
                            autoSave: async (
                                gameId: string,
                                snapshot: BaseGameSnapshot,
                            ): Promise<void> => {
                                if (activeSession === null) return;
                                const file = activeSession.captureSaveFile({ gameId }, snapshot);
                                await saveManager.autoSave(file);
                            },
                        },
                        gameEndPort: {
                            onGameEnd: (snapshot, result) => {
                                simulationHostRef.current?.onGameEnd(snapshot, result);
                            },
                        },
                        replayPort,
                        logger: lobbyLogger,
                        // Inject the loaded ContentDatabase into PipelineContext.db so
                        // reducers can read this game's content (Invariant #46: absent
                        // when the game declares none).
                        ...(hostedContentDb === undefined ? {} : { db: hostedContentDb }),
                        ...(debugPort === undefined ? {} : { debugPort }),
                    },
                );

            // Renderer-egress gate for the host's *perspective* recording (F44b
            // T5): `sendHostedRendererSnapshot` appends a frame only while this is
            // true. Declared here so `startSessionRecordings` can re-arm it.
            let hostPerspectiveActive = false;

            // Begin (or re-arm) both host-side recordings. Extracted so
            // return-to-lobby (#737) can restart recording for a fresh match —
            // otherwise the restarted match would run with no replay and no host
            // perspective recording. Called once now that `seed` and `gameConfig`
            // are resolved, and again from `resetActiveSessionToLobby`.
            //
            // The replay `gameConfig` mirrors the inputs to
            // `buildInitialHostedSessionSnapshot` so a replay can reconstruct the
            // same initial snapshot from seed + config (see
            // `createBaseReplayInitialSnapshot`). The recording is NOT persisted at
            // match end — it is retained in memory and written only on an explicit
            // save from the replay player, or discarded (`abortRecording`) on session
            // close / return-to-lobby. A startup failure must not break hosting (each
            // recorder has its own try/catch so one's failure never suppresses the
            // other).
            //
            // The return-to-lobby reset and teardown always `abortRecording()` before
            // re-arming, so a retained finished-but-unsaved recording is cleared first
            // and `startRecording` below never trips its "already in progress" guard.
            const startSessionRecordings = (): void => {
                const playerDirectorySnapshot = playerDirectory.snapshot();
                try {
                    replayPort.startRecording({
                        engineVersion: app.getVersion(),
                        gameId: HOSTED_GAME_ID,
                        gameVersion: HOSTED_GAME_VERSION,
                        gameConfig: {
                            hostPlayerId: metadata.hostId,
                            playerIds: initialPlayerIds,
                            phase: 'lobby',
                            ...(Object.keys(initialEntities).length > 0 ? { initialEntities } : {}),
                        },
                        seed: sessionSeed,
                        recordedAt: new Date().toISOString(),
                        // Source display names from the host PlayerDirectory (all
                        // connected clients' sanitised profiles). Synthetic AI slots
                        // and not-yet-registered clients fall back to the stringified
                        // playerId — cosmetic replay metadata only, never gameplay
                        // state (invariant #59 unaffected).
                        players: buildReplayPlayers(
                            initialPlayerSlots,
                            (id) => playerDirectorySnapshot[id]?.displayName,
                        ),
                    });
                } catch (err: unknown) {
                    lobbyLogger.error(
                        'replay startRecording failed',
                        err instanceof Error ? err : new Error(String(err)),
                        { gameId: HOSTED_GAME_ID },
                    );
                }

                // The host's *perspective* recording is locked to the seat the
                // renderer is bound to at start (`metadata.hostId`, see
                // `bindHostRendererRecipient` below); after a pass-and-play handoff
                // the egress sees snapshots for other seats, which the manager skips
                // by the lock (invariant #98).
                if (perspectiveReplayPort.isRecording()) {
                    // Host/joined-client exclusion violated: another recording is
                    // already live. Skip rather than start over it (which would
                    // throw inside the manager) so the assumption fails loudly.
                    lobbyLogger.error(
                        'perspective replay overlap: a recording was already in progress at host start',
                        new Error(
                            'host/joined-client perspective recording mutual-exclusion violated',
                        ),
                        { gameId: HOSTED_GAME_ID },
                    );
                } else {
                    try {
                        perspectiveReplayPort.start({
                            formatVersion: 1,
                            kind: 'perspective',
                            engineVersion: app.getVersion(),
                            gameId: HOSTED_GAME_ID,
                            gameVersion: HOSTED_GAME_VERSION,
                            viewerId: metadata.hostId,
                            recordedAt: new Date().toISOString(),
                            players: buildReplayPlayers(
                                initialPlayerSlots,
                                (id) => playerDirectorySnapshot[id]?.displayName,
                            ),
                        });
                        hostPerspectiveActive = true;
                    } catch (err: unknown) {
                        lobbyLogger.error(
                            'perspective replay start failed',
                            err instanceof Error ? err : new Error(String(err)),
                            { gameId: HOSTED_GAME_ID },
                        );
                    }
                }
            };
            startSessionRecordings();

            // Per-session commitment runtime shared between the projector and
            // SessionRuntime so `commit()` envelopes are automatically included
            // in the next broadcasted PlayerSnapshot (BLOCK-1 fix, §4.6 / §8).
            const sessionCommitmentRuntime = new SessionCommitmentRuntime();

            const projector = new DefaultStateProjector(hostedGame.visibilityRules, {
                getUndoMeta: (viewerId) => ({
                    canUndo: undoManager.canUndo(viewerId),
                    canRedo: undoManager.canRedo(viewerId),
                }),
                getPendingCommitments: () => sessionCommitmentRuntime.capturePendingCommitments(),
                // Simultaneous turn modes (e.g. a commitment battle mode) override
                // `isMyTurn` so every not-yet-committed seat is active in parallel;
                // absent ⇒ the projector keeps its single-active default.
                ...(hostedGame.resolveIsMyTurn === undefined
                    ? {}
                    : { resolveIsMyTurn: hostedGame.resolveIsMyTurn }),
            });
            const simulationHost = new SimulationHost(agentManager, projector);
            simulationHostRef.current = simulationHost;
            // Wire StateBroadcaster + ActionPipeline (with InMemoryActionHistory
            // and InMemoryUndoManager) for the hosted session (issue #364).
            // Each hosted session gets a fresh history and undoManager so
            // undo state never bleeds between sessions.
            // Must be set before any pipeline.process()/processAction-triggered
            // broadcast can run; the callback above throws if this ordering is broken.
            const broadcasterOptions =
                metadata.e2eHooks === undefined
                    ? { hostViewerId: metadata.hostId }
                    : { hostViewerId: metadata.hostId, e2eHooks: metadata.e2eHooks };
            broadcasterRef.current = new StateBroadcaster(
                transport,
                projector,
                lobbyLogger,
                broadcasterOptions,
            );

            // Live session-composition provider for captured saves (F68, #820):
            // one seat per registered player, classified host → ai (by agent
            // slot) → local (`lobbyManager.isLocalSeat`) → remote. Returns
            // `null` before the first `engine:start_game` (no match to
            // describe), letting `captureSaveFile` fall back to its
            // checkpoint-derived manifest. Invoked lazily at save time, so
            // referencing `playerSlotIndexById`/`resolveLiveAgentSlot`
            // (declared below) and the late-bound `lobbyManager` is safe —
            // same pattern as the debugPort getters.
            const getSessionManifest = (): SaveSessionManifest | null => {
                if (currentMatchId === null) {
                    return null;
                }
                const seats: SaveSeat[] = [...playerSlotIndexById.entries()].map(
                    ([pid, slotIndex]) => {
                        const agentSlot = resolveLiveAgentSlot(slotIndex);
                        if (agentSlot.kind === 'ai') {
                            return {
                                playerId: pid,
                                control: 'ai',
                                slotIndex,
                                ...(agentSlot.omniscient === true ? { omniscient: true } : {}),
                            };
                        }
                        if (pid === metadata.hostId) {
                            return { playerId: pid, control: 'host', slotIndex };
                        }
                        if (lobbyManager.isLocalSeat(pid)) {
                            return { playerId: pid, control: 'local', slotIndex };
                        }
                        return { playerId: pid, control: 'remote', slotIndex };
                    },
                );
                seats.sort((a, b) => a.slotIndex - b.slotIndex);
                return {
                    matchId: currentMatchId,
                    maxPlayers: metadata.maxPlayers,
                    seats,
                };
            };

            const sessionRuntime = new SessionRuntime({
                gameId: HOSTED_GAME_ID,
                gameVersion: HOSTED_GAME_VERSION,
                initialSnapshot,
                applyAction: processAction,
                commitmentRuntime: sessionCommitmentRuntime,
                getSessionManifest,
            });
            activeSession = sessionRuntime;
            if (metadata.e2eHooks !== undefined) {
                // Cast to the narrow E2E interface — dispatchTick is private on
                // SessionRuntime so production callers cannot reach it.
                // This is the sole permitted path (WARN-1 fix, §ISP).
                // @chimera-review: as unknown as E2eSessionRuntime is safe here;
                //   the concrete class implements the method; it is only hidden
                //   from the public type surface.
                const e2eRuntime = sessionRuntime as unknown as E2eSessionRuntime;
                metadata.e2eHooks.dispatchTick = () => {
                    e2eRuntime.dispatchTick(metadata.hostId);
                    simulationHost.afterTick(sessionRuntime.getSnapshot());
                };
            }

            // Real-time heartbeat (§4.2.1, #89). A game whose manifest opts into
            // `realtime` is driven by a wall-clock RealtimeTicker that dispatches
            // `engine:tick` through the normal pipeline at the manifest's
            // tickRateMs (converted to Hz); a turn-/action-driven game (e.g.
            // tactics, realtime:false) gets a null ticker and is unchanged.
            //
            // The dispatch is LEAN — applyAction + afterTick only — so it never
            // runs runHostAction's turn-based follow-ups (auto-end-turn,
            // commitment reveal) on every heartbeat. An AI seat made active by a
            // tick still decides via afterTick → tickAll and routes its own
            // actions back through runHostAction. The envelope mirrors
            // SessionRuntime.dispatchTick exactly: the per-tick seed comes from
            // the snapshot, never wall-clock time (determinism, Invariant #2).
            const tickerHz = resolveTickerHz(hostedGame.manifest);
            const realtimeTicker =
                tickerHz === null
                    ? null
                    : new RealtimeTicker({
                          hz: tickerHz,
                          getEnvelope: () => ({
                              type: 'engine:tick',
                              playerId: metadata.hostId,
                              tick: sessionRuntime.getSnapshot().tick,
                              payload: { seed: sessionRuntime.getSnapshot().seed },
                          }),
                          dispatch: (envelope) => {
                              sessionRuntime.applyAction(envelope);
                              simulationHost.afterTick(sessionRuntime.getSnapshot());
                          },
                      });

            const sendHostedRendererSnapshot = (snapshot: PlayerSnapshot): void => {
                lastSentPlayerSnapshot = snapshot;
                // Live egress first: recording must never break the renderer IPC
                // path, so the snapshot is sent before any recorder work runs
                // (symmetric with the joined-client path in
                // `onClientSnapshotReceived`).
                const win = mainWindow;
                if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(GAME_SNAPSHOT_CHANNEL, snapshot);
                }
                // Perspective recording (F44b T5): append this projected frame while
                // the match is live. At game-over, stop appending (lock the frame
                // set) but do NOT persist — the recording is retained in memory and
                // written only on an explicit save from the replay player; an unsaved
                // match is discarded by `perspectiveReplayPort.abort()` at teardown
                // (§4.28). The manager skips frames for any seat other than the locked
                // one (post-handoff), so no call-site filtering is needed.
                if (hostPerspectiveActive) {
                    perspectiveReplayPort.recordSnapshot({ tick: snapshot.tick, snapshot });
                    if (snapshot.gameResult !== null) {
                        hostPerspectiveActive = false;
                    }
                }
            };
            const sendHostedRendererTick = (tick: number): void => {
                const win = mainWindow;
                if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(GAME_TICK_CHANNEL, tick);
                }
            };
            // Push a host-verified commitment reveal to the host's own renderer
            // (F54 / T9). The host never receives its own 'broadcast' over the
            // transport, so the board's reveal playback needs this direct path —
            // symmetric with the joined-client `sendRevealToRenderer` wiring.
            const sendRevealToHostRenderer = (reveal: CommitmentReveal): void => {
                const win = mainWindow;
                if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(GAME_REVEAL_CHANNEL, reveal);
                }
            };
            let boundHostRendererViewerId: PlayerId | null = null;
            let unsubscribeHostRenderer: Unsubscribe = () => undefined;
            const bindHostRendererRecipient = (viewerId: PlayerId): void => {
                if (boundHostRendererViewerId === viewerId) {
                    return;
                }
                unsubscribeHostRenderer();
                boundHostRendererViewerId = viewerId;
                if (broadcasterRef.current === null) {
                    return;
                }
                unsubscribeHostRenderer = broadcasterRef.current.registerRendererRecipient({
                    viewerId,
                    sendSnapshot: sendHostedRendererSnapshot,
                    sendTick: sendHostedRendererTick,
                });
            };
            const projectHostedRendererForSeat = (viewerId: PlayerId): void => {
                bindHostRendererRecipient(viewerId);
                broadcasterRef.current?.broadcast(sessionRuntime.getSnapshot(), viewerId);
            };
            bindHostRendererRecipient(metadata.hostId);
            broadcastRestoredSnapshot = () => {
                projectHostedRendererForSeat(boundHostRendererViewerId ?? metadata.hostId);
            };

            const switchHostedRendererSeat = async (viewerId: PlayerId): Promise<void> => {
                await lobbyManager.switchActiveSeat(viewerId);
                projectHostedRendererForSeat(viewerId);
            };
            let pendingSeatHandoffTimer: ReturnType<typeof setTimeout> | null = null;
            const scheduleAutoLocalSeatHandoff = (action: ActionEnvelope): void => {
                if (action.type !== 'engine:end_turn') {
                    return;
                }
                const nextPlayerId = sessionRuntime.getSnapshot().turnClock?.activePlayerId;
                if (nextPlayerId === undefined) {
                    return;
                }
                if (!lobbyManager.isLocalSeat(nextPlayerId)) {
                    return;
                }
                if (lobbyManager.getLocalPlayerId() === nextPlayerId) {
                    return;
                }

                pendingSeatHandoffTimer = setTimeout(() => {
                    pendingSeatHandoffTimer = null;
                    void switchHostedRendererSeat(nextPlayerId).catch((err: unknown) => {
                        lobbyLogger.warn('hosted session: auto seat handoff failed', {
                            playerId: nextPlayerId,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    });
                }, LOCAL_SEAT_HANDOFF_DELAY_MS);
            };
            // Commitment battle mode side effects (F54 / T9), shared by BOTH the
            // host's own renderer-action path (`dispatchRendererAction`) and remote
            // clients' `transport.onActionReceived`. Without sharing, a host-
            // triggered commit/End-Turn would never stage its buffer nor reveal —
            // only client-triggered ones would (#730).
            const commitmentOrchestration = hostedGame.commitment;
            const stageCommitmentIfAccepted = (action: ActionEnvelope): void => {
                if (commitmentOrchestration === undefined) {
                    return;
                }
                // Stage ONLY a commit the pipeline accepted (`stageOnCommit` checks
                // the authoritative `committedTurns` marker on the post-apply
                // snapshot). A rejected/out-of-mode commit never stages a reveal nor
                // projects a phantom envelope; the buffer stays off the snapshot
                // (#3/#8).
                const staged = commitmentOrchestration.stageOnCommit(
                    action,
                    sessionRuntime.getSnapshot(),
                );
                if (staged !== null) {
                    sessionRuntime.commitTurn(staged.playerId, staged.value);
                }
            };
            const revealIfCommitmentEndTurn = (action: ActionEnvelope): void => {
                // On the commitment-mode End Turn (every seat has committed), reveal +
                // apply each staged turn in the deterministic order so every viewer
                // converges (T9). No-op for sequential turns.
                if (!commitmentOrchestration?.shouldReveal(action, sessionRuntime.getSnapshot())) {
                    return;
                }
                runRevealSync({
                    orchestration: commitmentOrchestration,
                    session: sessionRuntime,
                    sendReveal: (target, wireReveal) => {
                        transport.sendReveal(target, wireReveal);
                        // The host's own renderer is a viewer too but never receives
                        // its own 'broadcast' over the transport, so push the
                        // (already host-verified) reveal to it directly.
                        sendRevealToHostRenderer({
                            id: toCommitmentId(wireReveal.id),
                            value: wireReveal.value,
                            nonce: wireReveal.nonce,
                        });
                    },
                });
                simulationHost.afterTick(sessionRuntime.getSnapshot());
            };
            const autoEndTurnIfReady = (action: ActionEnvelope): void => {
                // A commit that completed the set (every seat committed for the turn)
                // auto-advances the turn and reveals — the player's single End Turn
                // (= commit) is the only confirmation a turn needs (#730 UX). The
                // host synthesises `engine:end_turn` for the active seat, reading the
                // LIVE post-commit snapshot: the commit already bumped the tick, and a
                // stale tick would `StaleActionError` (mirrors `runRevealSync`). That
                // end_turn then satisfies `shouldReveal`, so the reveal fires once.
                if (
                    commitmentOrchestration?.shouldAutoEndTurn?.(
                        action,
                        sessionRuntime.getSnapshot(),
                    ) !== true
                ) {
                    return;
                }
                const snap = sessionRuntime.getSnapshot();
                const activePlayerId = snap.turnClock?.activePlayerId;
                if (activePlayerId === undefined) {
                    return;
                }
                const endTurnAction: ActionEnvelope = {
                    type: 'engine:end_turn',
                    playerId: activePlayerId,
                    tick: snap.tick,
                    payload: {},
                };
                sessionRuntime.applyAction(endTurnAction);
                simulationHost.afterTick(sessionRuntime.getSnapshot());
                scheduleAutoLocalSeatHandoff(endTurnAction);
                revealIfCommitmentEndTurn(endTurnAction);
            };

            // The host-side per-action fan-out, shared by the host's own renderer
            // actions (`dispatchRendererAction`), remote clients
            // (`transport.onActionReceived`), and AI seats (`dispatchAiAction`).
            // `afterTick` re-ticks every registered agent, so an AI seat made
            // active by `action` decides and dispatches its own next action here.
            const runHostAction = (action: ActionEnvelope): void => {
                sessionRuntime.applyAction(action);
                stageCommitmentIfAccepted(action);
                simulationHost.afterTick(sessionRuntime.getSnapshot());
                scheduleAutoLocalSeatHandoff(action);
                revealIfCommitmentEndTurn(action);
                autoEndTurnIfReady(action);
            };
            dispatchRendererAction = runHostAction;

            // Drive an active AI seat to the end of its turn (#730 follow-up).
            // Tactics is turn-based with an action-driven clock — there is no
            // wall-clock tick loop — so nothing pumps an AI agent once it becomes
            // active: it would act once per human action and stall mid-turn.
            // Routing the AI's dispatched actions back through `runHostAction`
            // re-runs the fan-out (`afterTick` → `tickAll`), re-ticking the AI so
            // it spends its whole turn (and, in commitment mode, fires the
            // commit/reveal hooks) before control returns. The recursion is bounded
            // — the policy terminates each turn (stamina-capped; commits once) and
            // an AI seat is the last-iterated agent for the shipping 1-AI roster —
            // and the depth cap is a safety net against a non-terminating policy.
            //
            // Commitment-mode limitation: an AI seat dispatches its move/attack
            // actions straight through the pipeline (it has no local buffer like the
            // renderer), so they apply and broadcast immediately rather than staying
            // hidden until reveal. The single authoritative snapshot stays
            // consistent and the AI still commits and advances the turn, but
            // commitment SECRECY is not enforced for AI seats. Host-side AI
            // buffering is a follow-up beyond this smoke scope.
            const AI_DRIVE_MAX_DEPTH = 512;
            let aiDriveDepth = 0;
            const dispatchAiAction = (action: ActionEnvelope): void => {
                if (aiDriveDepth >= AI_DRIVE_MAX_DEPTH) {
                    lobbyLogger.error(
                        'hosted session: AI drive depth cap hit; dropping action',
                        new Error('AI drive depth cap exceeded'),
                        { actionType: action.type },
                    );
                    return;
                }
                aiDriveDepth += 1;
                try {
                    runHostAction(action);
                } finally {
                    aiDriveDepth -= 1;
                }
            };
            saveInitialTurnMemento = (playerIdForMemento) => {
                undoManager.saveTurnMemento(sessionRuntime.getSnapshot(), playerIdForMemento);
            };

            // Track active players so clearUndoHistory can release their
            // per-player undo memory when the session closes.
            const activePlayers = new Set<PlayerId>(
                initialPlayerSlots.map((slot) => slot.playerId),
            );
            const assignedSlotIndexes = new Set<number>(
                initialPlayerSlots.map((slot) => slot.slotIndex),
            );
            // Records each player's slot index as it is registered so the
            // return-to-lobby reset (#737) can rebuild fresh agents for the exact
            // current roster after `agentManager.clear()`.
            const playerSlotIndexById = new Map<PlayerId, number>();
            // Guard: onGameStart must fire exactly once per session regardless
            // of player churn (WARN-1 fix — `>=` would re-fire on leave+rejoin).
            let gameStarted = false;

            // The live AI roster for this session. Seeded from the (host-time,
            // usually empty) `metadata.agentSlots` and re-pointed at the current
            // lobby `agentSlots` when the game starts (#730 follow-up). Slot/agent
            // resolution below consults this so a return-to-lobby restart re-seats
            // the same AI roster.
            let currentAgentSlots: readonly LobbyAgentSlot[] = metadata.agentSlots ?? [];
            const resolveLiveAgentSlot = (slotIndex: number): LobbyAgentSlot =>
                resolveAgentSlot({ ...metadata, agentSlots: currentAgentSlots }, slotIndex);

            const registerSlotAgent = (pid: PlayerId, slotIndex: number): void => {
                playerSlotIndexById.set(pid, slotIndex);
                const agentSlot = resolveLiveAgentSlot(slotIndex);
                if (agentSlot.kind === 'ai') {
                    simulationHost.registerAgent(
                        buildDefaultAIPlayerAgent({
                            playerId: pid,
                            initialSnapshot: sessionRuntime.getSnapshot(),
                            dispatch: dispatchAiAction,
                            logger: lobbyLogger,
                            omniscient: agentSlot.omniscient ?? false,
                            createState: hostedGame.createAIState,
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
                    if (resolveLiveAgentSlot(slotIndex).kind === 'human') {
                        assignedSlotIndexes.add(slotIndex);
                        return slotIndex;
                    }
                }
                return assignedSlotIndexes.size;
            };

            const tryStartGame = (): void => {
                // Mid-restore the roster is incomplete and the checkpoint may not
                // be applied yet — `seatRestoredRoster` retries once seating is
                // done (F68 #823).
                if (restoreSeatingActive) {
                    return;
                }
                if (!gameStarted && activePlayers.size >= metadata.maxPlayers) {
                    gameStarted = true;
                    simulationHost.onGameStart(sessionRuntime.getSnapshot());
                    // Begin the wall-clock heartbeat for real-time games (no-op for
                    // turn-based games, whose ticker is null). Idempotent start().
                    realtimeTicker?.start();
                }
            };

            // Host-local match-state reset for return-to-lobby (#737). The
            // `engine:return_to_lobby` dispatch (in `onReturnToLobbyRequested`)
            // already reset the *snapshot* to the lobby phase and broadcast it;
            // this releases the per-session host state so the lobby is cleanly
            // restartable. It must NOT close the lobby or fire the match-end /
            // replay-finalise path (the action keeps `gameResult` null).
            resetActiveSessionToLobby = (): void => {
                // Halt the heartbeat while returning to lobby; `tryStartGame` at
                // the end of this reset re-starts it once every seat re-joins.
                realtimeTicker?.stop();
                // Per-session host-local state must not bleed into the next
                // match (host-local state-ownership theme, Invariant #3).
                clearUndoHistory([...activePlayers]);
                // Discard, don't finalise: returning to lobby without saving must
                // drop the recording — whether the match was abandoned mid-play or
                // finished-but-unsaved (matches are no longer persisted at game-over;
                // the replay player's save icon is the sole gate). `abort()` is
                // idempotent (a no-op if the user already saved, clearing it), so it
                // runs unconditionally rather than only while a recording is "active".
                replayManager.abortRecording();
                hostPerspectiveActive = false;
                perspectiveReplayPort.abort();
                // Re-arm both recordings for the next match so a restarted match
                // records a fresh replay + host perspective rather than running
                // dark. Safe after the aborts above: the prior recording is cleared
                // (or, for a just-finished match whose fire-and-forget finalise is
                // still saving, gracefully dropped — see `startSessionRecordings`).
                startSessionRecordings();
                // Clear any staged commitment-mode state so a restart starts clean.
                sessionRuntime.clearStagedReveals();
                sessionCommitmentRuntime.restorePendingCommitments({});
                // Re-arm the one-shot guard and rebuild fresh agents for the next
                // match: AgentManager dedups by playerId and the AI brains carry
                // state-machine/scheduler state from the abandoned match, so a
                // clean restart requires clear-then-re-register. `tryStartGame`
                // then re-fires `onGameStart` with the lobby snapshot once every
                // expected seat is present — mirroring the original session start.
                gameStarted = false;
                agentManager.clear();
                // Copy the entries first: `registerSlotAgent` re-writes the map.
                for (const [pid, slotIndex] of [...playerSlotIndexById]) {
                    registerSlotAgent(pid, slotIndex);
                }
                tryStartGame();
            };

            const broadcastCurrentGameSnapshot = (viewerId: PlayerId): void => {
                const snapshot = sessionRuntime.getSnapshot();
                if (snapshot.phase === gamePhase('lobby')) {
                    return;
                }
                broadcasterRef.current?.broadcast(snapshot, viewerId);
            };

            handleHostedLocalSeatAdded = (entry): void => {
                // A restored local seat was already registered at its SAVED
                // slotIndex by `seatRestoredRoster` before `addLocalSeat` fired
                // this callback — re-registering here would burn a fresh slot
                // (F68 #823). Fresh pass-and-play seats are never pre-active.
                if (activePlayers.has(entry.playerId)) {
                    return;
                }
                activePlayers.add(entry.playerId);
                registerSlotAgent(entry.playerId, nextHumanSlotIndex());
                tryStartGame();
            };

            // Seat the lobby-added AI roster at game-start (#730 follow-up). The UI
            // adds AI AFTER hosting, so the host-time `metadata.agentSlots` is empty
            // and `collectInitialPlayerSlots` above never seated them. Re-point the
            // live roster at the current lobby `agentSlots`, register a fresh AI
            // agent for each (idempotent — `AgentManager` dedups by playerId and we
            // skip seats already active, so a return-to-lobby restart is safe), and
            // return the synthetic ids so `onGameStartRequested` can seed them into
            // `engine:start_game` (units + players-map seat + turn rotation).
            seatLobbyAgentsForGameStart = (liveAgentSlots): readonly PlayerId[] => {
                currentAgentSlots = liveAgentSlots;
                const aiSlots = collectGameStartAiPlayerSlots(liveAgentSlots);
                for (const slot of aiSlots) {
                    if (activePlayers.has(slot.playerId)) {
                        continue;
                    }
                    activePlayers.add(slot.playerId);
                    assignedSlotIndexes.add(slot.slotIndex);
                    registerSlotAgent(slot.playerId, slot.slotIndex);
                }
                return aiSlots.map((slot) => slot.playerId);
            };

            // Keep the live AI roster in sync with the lobby as `addAi()` mutates
            // it (#833) — only while still in the lobby. `nextHumanSlotIndex`
            // gates human joins on `resolveLiveAgentSlot(...).kind === 'human'`,
            // so without this a human joining AFTER an AI is added would be
            // handed the AI's slot index. Guarded to the lobby phase: a restored
            // session seats its AI roster from the SAVED seats via
            // `seatRestoredRoster` (the LobbyManager's own `agentSlots` stay
            // empty), and reconnecting remotes rejoin post-checkpoint (in-game
            // phase), so syncing then would wipe the restored roster.
            syncLiveAgentSlots = (liveAgentSlots): void => {
                if (sessionRuntime.getSnapshot().phase !== gamePhase('lobby')) {
                    return;
                }
                currentAgentSlots = liveAgentSlots;
            };

            // Seat a restored save's roster (F68 #823). Driven by the
            // SessionRestoreCoordinator AFTER the checkpoint is applied, so
            // every agent registers over the restored snapshot. Mirrors
            // `seatLobbyAgentsForGameStart`: re-points `currentAgentSlots` at
            // the saved AI roster (so `registerSlotAgent` resolves kind +
            // omniscience, and a re-save reproduces the manifest), then seeds
            // the seating state from the saved seats at their EXACT slot
            // indexes. ALL seats join `registeredPlayers` so a returning
            // remote takes the reconnect re-sync path in `onPlayerJoined`;
            // only host/ai/local seats join `activePlayers` — missing remotes
            // keep the `tryStartGame` gate closed until they reconnect.
            seatRestoredRoster = async (seats): Promise<void> => {
                try {
                    currentAgentSlots = seats
                        .filter((seatEntry) => seatEntry.control === 'ai')
                        .map((seatEntry) => ({
                            slotIndex: seatEntry.slotIndex,
                            kind: 'ai' as const,
                            ...(seatEntry.omniscient === true ? { omniscient: true } : {}),
                        }));
                    // Rebuild slot assignments from the saved roster — the hosting
                    // preamble seated the host at slot 0, which the manifest's own
                    // host seat re-asserts below.
                    assignedSlotIndexes.clear();
                    for (const seatEntry of seats) {
                        assignedSlotIndexes.add(seatEntry.slotIndex);
                        registeredPlayers.add(seatEntry.playerId);
                        registerSlotAgent(seatEntry.playerId, seatEntry.slotIndex);
                        if (seatEntry.control !== 'remote') {
                            activePlayers.add(seatEntry.playerId);
                        }
                        if (seatEntry.control === 'local') {
                            // Re-adding under the SAVED playerId keeps seat handoff
                            // and manifest classification working; the pre-seeded
                            // `activePlayers` entry makes `handleHostedLocalSeatAdded`
                            // a no-op for this seat. Resolves without real I/O.
                            await lobbyManager.addLocalSeat(seatEntry.playerId);
                        }
                    }
                } finally {
                    // Always release the start-suppression gate — a mid-seating
                    // failure is unwound by the coordinator's closeLobby, but if
                    // that unwind itself failed the gate must not stay latched
                    // for the next session.
                    restoreSeatingActive = false;
                }
                tryStartGame();
            };

            const registeredPlayers = new Set<PlayerId>(initialPlayerIds);
            for (const slot of initialPlayerSlots) {
                registerSlotAgent(slot.playerId, slot.slotIndex);
            }
            tryStartGame();

            // Re-pack the host ledger's HUMANS into contiguous human-kind slots,
            // PINNING every AI entry at its slot, so the ledger mirrors
            // LobbyManager's compacted roster (#834). Shared by the human-leave
            // (`releaseLobbySeat`) and AI-removal (`removeAiSeat`, #838)
            // reconciles. AI seats can be in the ledger during the lobby (host-
            // time `agentSlots`, or a return-to-lobby #737 that retains the prior
            // match's AI), so a position-only re-pack would slide an AI into a
            // human slot and misclassify it as `remote`. Remaining humans keep
            // their join order (== LobbyManager's compacted `players` order),
            // re-taking the lowest human-kind slots.
            const repackLobbyLedger = (): void => {
                const entries = [...playerSlotIndexById.entries()].sort((a, b) => a[1] - b[1]);
                const humanPids: PlayerId[] = [];
                playerSlotIndexById.clear();
                assignedSlotIndexes.clear();
                for (const [entryPid, entrySlot] of entries) {
                    if (resolveLiveAgentSlot(entrySlot).kind === 'ai') {
                        playerSlotIndexById.set(entryPid, entrySlot); // AI keeps its slot
                        assignedSlotIndexes.add(entrySlot);
                    } else {
                        humanPids.push(entryPid);
                    }
                }
                let slot = 0;
                for (const hpid of humanPids) {
                    while (resolveLiveAgentSlot(slot).kind !== 'human') slot += 1;
                    playerSlotIndexById.set(hpid, slot);
                    assignedSlotIndexes.add(slot);
                    slot += 1;
                }
            };

            // Release a departing lobby seat (#834). Without this the ledger only
            // grows: `getSessionManifest` would emit the departed player's stale
            // seat and `nextHumanSlotIndex` could hand a later join an out-of-range
            // slot. Lobby-phase only — an in-match disconnect keeps its seat for
            // reconnect/restore (#821/#823).
            const releaseLobbySeat = (pid: PlayerId): void => {
                playerSlotIndexById.delete(pid);
                registeredPlayers.delete(pid); // a lobby rejoin is a fresh join, not a reconnect
                repackLobbyLedger();
            };

            // Reconcile the host ledger when an AI is removed from the lobby
            // roster — `removeAi()` or the join-overflow auto-remove (#838).
            // Lobby-phase only. Drops the removed AI's synthetic seat if it was
            // seated (host-time `agentSlots` / return-to-lobby #737) — else the
            // manifest keeps a phantom `remote` seat and `activePlayers` is off by
            // one — then re-packs humans into the freed slot (so a human stranded
            // ABOVE the removed AI does not collide with a later `addAi`).
            // `currentAgentSlots` is already updated (the removal ran
            // `syncLiveAgentSlots` synchronously), so the re-pack sees the freed
            // slot as human-kind.
            removeAiSeat = (slotIndex: number): void => {
                if (
                    sessionRuntime.getSnapshot().phase !== gamePhase('lobby') ||
                    restoreSeatingActive
                ) {
                    return;
                }
                const aiPid = createSyntheticAIPlayerId(slotIndex);
                const hadSeat = playerSlotIndexById.delete(aiPid);
                if (hadSeat) {
                    activePlayers.delete(aiPid);
                    registeredPlayers.delete(aiPid);
                }
                repackLobbyLedger();
                if (hadSeat) {
                    // AgentManager has no per-agent unregister; rebuild agents over
                    // the reconciled ledger to drop the removed AI's agent (the
                    // `resetActiveSessionToLobby` idiom).
                    agentManager.clear();
                    for (const [pid, slot] of [...playerSlotIndexById]) {
                        registerSlotAgent(pid, slot);
                    }
                }
            };

            const unsubJoined = transport.onPlayerJoined(({ playerId: pid }) => {
                activePlayers.add(pid);
                const isReconnect = registeredPlayers.has(pid);
                if (!isReconnect) {
                    registeredPlayers.add(pid);
                    registerSlotAgent(pid, nextHumanSlotIndex());
                }
                // Once every expected player has joined and had their agent
                // registered, notify agents that the game has started
                // (Invariant #17: projection via host; agents must be fully
                // wired before onGameStart fires).
                tryStartGame();
                // Re-sync only reconnecting peers; first-time joins receive
                // their first snapshot through normal broadcast flow.
                if (isReconnect) {
                    broadcastCurrentGameSnapshot(pid);
                }
                // Fill a missing restored seat (F68 #823) — a no-op outside an
                // in-flight restore.
                sessionRestoreCoordinator.notePlayerJoined(pid);
            });
            const unsubLeft = transport.onPlayerLeft((pid, reason) => {
                activePlayers.delete(pid);
                // A lobby-phase leave frees + re-packs the host slot ledger so it
                // stays in step with LobbyManager's compacted `players` roster
                // (#834). An in-match disconnect (below) RETAINS the seat for
                // reconnect/restore (#821/#823); a mid-restore leave is left to
                // the coordinator (the `!restoreSeatingActive` guard keeps
                // `seatRestoredRoster`'s rebuild intact).
                if (
                    sessionRuntime.getSnapshot().phase === gamePhase('lobby') &&
                    !restoreSeatingActive
                ) {
                    releaseLobbySeat(pid);
                    return; // a lobby leave is silent — the roster update is already visible
                }
                // In-battle only: notify the host when an opponent *deliberately*
                // leaves a live match → "{name} left game." toast (§4.30). A
                // transient drop ('timeout'/'error') keeps the #687 "Player
                // disconnected" presence toast; a lobby-phase leave stays silent
                // (the roster update is already visible). The display name is the
                // lobby-scoped cosmetic name from the host PlayerDirectory
                // (Invariant #59/#60 — not snapshot/save state, #74-safe).
                if (
                    reason === 'normal' &&
                    sessionRuntime.getSnapshot().phase !== gamePhase('lobby')
                ) {
                    const event: PlayerLeftMatchEvent = {
                        playerId: pid,
                        displayName: playerDirectory.snapshot()[pid]?.displayName ?? String(pid),
                    };
                    BrowserWindow.getAllWindows().forEach((win) => {
                        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                            win.webContents.send(LOBBY_PLAYER_LEFT_CHANNEL, event);
                        }
                    });
                }
            });

            // Drive the pipeline with every received `EngineAction`.  Each
            // action mutates the SessionRuntime's live snapshot via the
            // pipeline's `processAction`, and `engine:end_turn` triggers
            // autosave fire-and-forget (Issue #375).  Errors here are
            // swallowed so a single misbehaving client cannot crash the
            // host event loop; the pipeline already logs invalid actions.
            const unsubAction = transport.onActionReceived((_from, action) => {
                try {
                    // Same fan-out as the host's own actions (Invariant #17:
                    // routing through SimulationHost/AgentManager), so a remote
                    // human's action also drives any AI seat made active by it.
                    runHostAction(action);
                } catch (err) {
                    lobbyLogger.warn('hosted session: applyAction threw', {
                        actionType: action.type,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            });

            return () => {
                // Stop the heartbeat first so no tick fires during teardown.
                realtimeTicker?.stop();
                const finalSnapshot = sessionRuntime.getSnapshot();
                if (finalSnapshot.gameResult === null) {
                    simulationHost.onGameEnd(finalSnapshot, { winnerIds: [] });
                }
                if (pendingSeatHandoffTimer !== null) {
                    clearTimeout(pendingSeatHandoffTimer);
                    pendingSeatHandoffTimer = null;
                }
                unsubJoined();
                unsubLeft();
                unsubAction();
                clearUndoHistory([...activePlayers]);
                // Discard any retained replay recording on session close (F44 / T4).
                // Matches are no longer persisted at game-over, so this drops both an
                // abandoned mid-match recording AND a finished-but-unsaved one — the
                // replay player's save icon is the only path that writes a file.
                // `abort()` is idempotent (a no-op once the user has saved), so both
                // run unconditionally, and the next session starts clean.
                replayManager.abortRecording();
                hostPerspectiveActive = false;
                perspectiveReplayPort.abort();
                unsubscribeHostRenderer();
                broadcasterRef.current?.dispose();
                if (activeSession === sessionRuntime) {
                    activeSession = null;
                    currentMatchId = null;
                    activeE2eHooks = undefined;
                    dispatchRendererAction = null;
                    saveInitialTurnMemento = null;
                    handleHostedLocalSeatAdded = null;
                    seatLobbyAgentsForGameStart = null;
                    syncLiveAgentSlots = null;
                    removeAiSeat = null;
                    broadcastRestoredSnapshot = null;
                    resetActiveSessionToLobby = null;
                    seatRestoredRoster = null;
                    restoreSeatingActive = false;
                    // Aborts an in-flight restore / re-arms a completed one so
                    // a later menu-load can restore again (F68 #823).
                    sessionRestoreCoordinator.noteSessionClosed();
                }
            };
        },
        onLocalSeatAdded: (entry) => {
            handleHostedLocalSeatAdded?.(entry);
        },
        onSessionJoined: (transport) => {
            // Arm the joined-client perspective recording (F44b T5). Recording is
            // started lazily on the first received snapshot (in
            // `onClientSnapshotReceived`) since the client has no session-start
            // header; the cleanup fn below aborts anything still in progress.
            clientPerspective = { started: false };
            joinedSessionActive = true;
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
                // Teardown: discard any retained perspective recording so leaving
                // without saving leaves no file — whether the joined match was
                // abandoned mid-play or finished-but-unsaved (matches are no longer
                // persisted at game-over; the save icon is the sole gate). `abort()`
                // is idempotent, so it runs unconditionally even after game-over has
                // cleared `clientPerspective`.
                perspectiveReplayPort.abort();
                clientPerspective = null;
                // The joined session is over: a later perspective export has no
                // session to draw from (the deterministic export was already
                // host-only). Clearing this re-closes the export gate.
                joinedSessionActive = false;
                unsubSnapshotCommitments();
                unsubReveal();
            };
        },
        onGameStartRequested: (state) => {
            const sessionRuntime = activeSession;
            if (sessionRuntime === null) {
                throw new Error('LobbyManager: no hosted session runtime is available');
            }

            const selectedFirstPlayer = resolveFirstPlayerFromLobbyState(
                state,
                activeE2eHooks?.firstPlayerRole ?? 'host',
            );
            const firstPlayer = hostedGame.resolveFirstPlayer({
                hostPlayerId: state.info.hostId,
                firstPlayer: selectedFirstPlayer,
            });

            // Seat the lobby-added AI roster (#730 follow-up): register their agents
            // and fold their synthetic ids into the start roster so each AI gets a
            // unit, a players-map seat, and a place in the turn rotation. Appended
            // AFTER the human ids so the (always-human) first player keeps
            // unit-assignment index 0.
            const aiPlayerIds = seatLobbyAgentsForGameStart?.(state.agentSlots ?? []) ?? [];

            // Reorder playerIds so the first player is at index 0 for unit assignment
            const allPlayerIds = [
                ...state.players.map((player) => player.playerId),
                ...aiPlayerIds,
            ];
            const playerIds = [firstPlayer, ...allPlayerIds.filter((id) => id !== firstPlayer)];

            const initialEntities = resolveInitialEntitiesForGame(
                gameRegistry,
                HOSTED_GAME_ID,
                playerIds,
            );

            // Carry the host-authored lobby setup (chosen match settings +
            // per-player attributes) into the match (#706). Keyed by real
            // playerId via `state.players`, so the firstPlayer turn-order reorder
            // above does not affect it. Omitted (undefined) for games with no
            // lobby setup, keeping the payload backward-compatible.
            const setup = buildSetupFromLobbyState(state);

            // Mint the stable match identity here — host-side, once per match
            // start — and carry it in the action payload so deterministic
            // replay reproduces the same id (F68, #820). The reducer writes it
            // onto the snapshot; projection syncs it verbatim to every client.
            const matchId = crypto.randomUUID();
            currentMatchId = matchId;

            const action: ActionEnvelope = {
                type: 'engine:start_game',
                playerId: state.info.hostId,
                tick: sessionRuntime.getSnapshot().tick,
                payload: {
                    playerIds: allPlayerIds,
                    firstPlayerId: firstPlayer,
                    matchId,
                    ...(Object.keys(initialEntities).length > 0 ? { initialEntities } : {}),
                    ...(setup !== undefined ? { setup } : {}),
                },
            };
            sessionRuntime.applyAction(action);
            // Seed the turn-start memento only for the active (first-to-act) player.
            // Seeding every player would make non-active players eligible to undo the
            // host's actions, violating the per-turn ownership rule in
            // undo-redo-policy.md §60 and the per-viewer contract (BLOCK-2 fix).
            // Non-active players receive their memento when engine:end_turn fires and
            // their turn begins.
            saveInitialTurnMemento?.(firstPlayer);
        },
        onReturnToLobbyRequested: (state) => {
            // Reverse of `onGameStartRequested` (#737): abandon the live match
            // back to the lobby. Dispatch `engine:return_to_lobby` into the
            // active session — its pipeline broadcast carries the resulting
            // `phase:'lobby'` snapshot to every client and the host's own
            // renderer (Invariant #1/#3: clients follow via the projected
            // PlayerSnapshot, not a side channel) — then run the host-local
            // match-state resets that make the lobby restartable.
            const sessionRuntime = activeSession;
            if (sessionRuntime === null) {
                throw new Error('LobbyManager: no hosted session runtime is available');
            }
            // A rejected dispatch (the reducer's host-only guard) throws
            // `ActionUnauthorizedError` out of `applyAction`, so the host-local
            // reset below never runs and `returnToLobby()` rejects — fail-loud,
            // mirroring `onGameStartRequested`. In the normal flow the dispatcher
            // is always the host (`state.info.hostId` === `snapshot.hostPlayerId`),
            // so the action is accepted and the reset proceeds.
            sessionRuntime.applyAction({
                type: 'engine:return_to_lobby',
                playerId: state.info.hostId,
                tick: sessionRuntime.getSnapshot().tick,
                payload: {},
            });
            resetActiveSessionToLobby?.();
        },
        onAiSlotRemoved: (slotIndex) => {
            // Reconcile the host slot ledger when an AI leaves the roster (#838).
            removeAiSeat?.(slotIndex);
        },
        onLobbyStateChanged: (state) => {
            // Keep the hosted session's live AI roster in sync so a human joining
            // after `addAi()` skips the AI's slot index (#833).
            syncLiveAgentSlots?.(state.agentSlots ?? []);

            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(LOBBY_UPDATE_CHANNEL, state);
                }
            });

            // Direct-game E2E auto-start: when the host process has bootstrapped
            // both players (host + client) and all players are ready, start the
            // match automatically without any lobby UI interaction.
            if (
                process.env['CHIMERA_E2E'] === '1' &&
                process.env['CHIMERA_E2E_DIRECT_GAME_ROLE'] === 'host' &&
                state.players.length === 2 &&
                state.players.every((p) => p.ready)
            ) {
                void lobbyManager.startGame().catch((err) => {
                    logger.warn('direct-game E2E: auto startGame failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            }
        },
        onConnectionStatusChanged: (status) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(SYSTEM_CONNECTION_STATUS_CHANNEL, status);
                }
            });
        },
        // Opponent presence transitions (host-side): a transient drop or reconnect
        // → renderer "Player disconnected"/"Player reconnected" toast (§4.30 / #687).
        onPlayerConnectionChanged: (event) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(LOBBY_PLAYER_CONNECTION_CHANNEL, event);
                }
            });
        },
        // Profile-admission rejection (JOIN or mid-session PROFILE_UPDATE) →
        // renderer "Profile rejected: {reason}" toast (§4.30 / #688).
        onProfileRejected: (reason) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(LOBBY_PROFILE_REJECTED_CHANNEL, { reason });
                }
            });
        },
        profileGate,
        chatRelay,
        onLocalChatDelivered: (message) => {
            chatHub.deliverLocal(message);
        },
        onClientSnapshotReceived: (snapshot, checksum) => {
            lastSentPlayerSnapshot = snapshot;
            // Remember this seat for restored-session reclaim (F68 #822) —
            // fire-and-forget inside the recorder; never blocks live egress.
            recordSessionTicket(snapshot);
            resolvedE2eHooks?.onBroadcastChecksum(snapshot.tick, snapshot.viewerId, checksum);
            const win = mainWindow;
            if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(GAME_SNAPSHOT_CHANNEL, snapshot);
            }
            // Joined-client perspective recording (F44b T5). Lazily start on the
            // first snapshot (locking to its `viewerId`, always the local seat),
            // append every frame, then finalise once the match resolves. Failures
            // never break the live egress; finalise is fire-and-forget. The
            // transport snapshot is bridged to the simulation `PlayerSnapshot` the
            // recorder expects through `asProjectedSnapshot` (the one documented
            // home for that wire→sim boundary cast).
            if (clientPerspective !== null) {
                const projected = asProjectedSnapshot(snapshot);
                if (!clientPerspective.started) {
                    if (perspectiveReplayPort.isRecording()) {
                        // Host/joined-client exclusion violated (see the port's
                        // contract): another recording is already live. Surface it
                        // loudly and stand down rather than throwing inside start().
                        lobbyLogger.error(
                            'perspective replay overlap: a recording was already in progress at client start',
                            new Error(
                                'host/joined-client perspective recording mutual-exclusion violated',
                            ),
                            { gameId: HOSTED_GAME_ID },
                        );
                        clientPerspective = null;
                        return;
                    }
                    try {
                        const directory = playerDirectory.snapshot();
                        perspectiveReplayPort.start({
                            formatVersion: 1,
                            kind: 'perspective',
                            engineVersion: app.getVersion(),
                            gameId: HOSTED_GAME_ID,
                            gameVersion: HOSTED_GAME_VERSION,
                            viewerId: projected.viewerId,
                            recordedAt: new Date().toISOString(),
                            players: Object.keys(projected.players).map((id) => {
                                const pid = id as PlayerId;
                                return {
                                    playerId: pid,
                                    displayName: directory[pid]?.displayName ?? String(pid),
                                };
                            }),
                        });
                        clientPerspective.started = true;
                    } catch (err: unknown) {
                        lobbyLogger.error(
                            'perspective replay start failed',
                            err instanceof Error ? err : new Error(String(err)),
                            { gameId: HOSTED_GAME_ID },
                        );
                        clientPerspective = null;
                    }
                }
                if (clientPerspective?.started === true) {
                    perspectiveReplayPort.recordSnapshot({
                        tick: projected.tick,
                        snapshot: projected,
                    });
                    if (projected.gameResult !== null) {
                        // Stop appending at game-over, but do NOT persist: the
                        // recording is retained in memory and written only on an
                        // explicit save from the replay player; an unsaved match is
                        // discarded by `perspectiveReplayPort.abort()` at teardown
                        // (§4.28). Clearing the flag halts further frame capture.
                        clientPerspective = null;
                    }
                }
            }
        },
        onClientTickReceived: (tick) => {
            resolvedE2eHooks?.onClockTick(tick, 'client');
            const win = mainWindow;
            if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(GAME_TICK_CHANNEL, tick);
            }
        },
        // E2E hooks are resolved at the wiring point and injected so
        // LobbyManager never pulls from globalThis directly (WARN-3 / §2 DIP).
        ...(resolvedE2eHooks !== undefined ? { e2eHooks: resolvedE2eHooks } : {}),
    });

    // The ONE live-restore apply path (Invariant #24), shared by the in-session
    // load branch and the menu-restore coordinator below. Re-pointing
    // `currentMatchId` at the file keeps the in-session same-match guard and a
    // later re-save's manifest coherent with the restored checkpoint.
    const applyRestoredFileToActiveSession = (file: SaveFile): void => {
        if (activeSession === null) {
            throw new Error('saves:load: no active session to apply the restored save to.');
        }
        activeSession.applyRestoredFile(file);
        currentMatchId = file.session.matchId;
        broadcastRestoredSnapshot?.();
    };

    // Menu-load restore orchestrator (F68 #823): hosts a lobby pre-seeded with
    // the saved roster, applies the checkpoint through the Invariant #24 helper
    // above, seats the roster, and tracks missing remote seats until the
    // `tryStartGame` gate can open. `onStatusChanged` is the seam the
    // restore-status IPC push (#826) will attach to.
    const sessionRestoreCoordinator = new SessionRestoreCoordinator({
        logger,
        ports: {
            hostLobby: async ({ maxPlayers, restore }) => {
                // Suppress start attempts until the checkpoint is applied and
                // the roster is seated (see `restoreSeatingActive`). Cleared on
                // failure so an aborted hosting never wedges the next session.
                restoreSeatingActive = true;
                try {
                    const info = await lobbyManager.hostLobby({
                        gameId: HOSTED_GAME_ID,
                        maxPlayers,
                        restore,
                    });
                    // LobbyInfo.sessionId IS the join code (`<host>:<port>:<token>`)
                    // — the waiting overlay shows it via the #826 status push.
                    return { lobbyCode: info.sessionId };
                } catch (error) {
                    restoreSeatingActive = false;
                    throw error;
                }
            },
            applyRestoredFile: applyRestoredFileToActiveSession,
            seatRestoredRoster: async (seats) => {
                if (seatRestoredRoster === null) {
                    throw new Error(
                        'saves:load: hosted session wiring incomplete — cannot seat the roster.',
                    );
                }
                await seatRestoredRoster(seats);
            },
            closeLobby: () => lobbyManager.closeLobby(),
        },
    });

    // Push every renderer-relevant restore transition to all windows over
    // `chimera:saves:restore-status` (F68 #826). `toRestoreStatusEvent`
    // projects the coordinator status to a validated slim event (Invariant
    // #1) and returns null for internal transitions (idle/hosting) — those
    // are not pushed. A schema failure throws inside the listener and is
    // caught + logged by the coordinator's listener guard (fail closed).
    sessionRestoreCoordinator.onStatusChanged((status) => {
        const event = toRestoreStatusEvent(status, HOSTED_GAME_ID);
        if (event === null) {
            return;
        }
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(SAVES_RESTORE_STATUS_CHANNEL, event);
            }
        });
    });

    // Register the `chimera:game:*` channels.
    registerGameHandlers({
        ipcMain,
        actionDispatcher: (action) => {
            if (dispatchRendererAction !== null) {
                dispatchRendererAction(action);
                return;
            }

            lobbyManager.sendAction(action);
        },
        actionRegistry: gameRegistry,
        getCurrentSnapshot: () => lastSentPlayerSnapshot,
        logger: logger.child({ module: 'game' }),
    });

    // Register the `chimera:lobby:*` channels.
    registerLobbyHandlers({
        ipcMain,
        lobbyManager,
        profileManager,
        logger: logger.child({ module: 'lobby' }),
    });

    // Register the generic `chimera:content:*` channel, backed by the content
    // databases loaded at startup. Game-agnostic: ships plain collections only.
    registerContentHandlers({
        ipcMain,
        contentProvider: {
            getCollections: (gameId: string): GameContent | null => getGameContent(gameId) ?? null,
        },
        logger: logger.child({ module: 'content' }),
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
    // `restoreSession` routes a loaded `SaveFile` (F68 #823): with an active
    // session a SAME-match file is live-applied via the Invariant #24 helper
    // (a different match rejects renderer-friendly); with no active session
    // the SessionRestoreCoordinator hosts a restored session seeded from the
    // file's `session` manifest and applies the checkpoint through that same
    // helper.
    const savesLogger = logger.child({ module: 'saves' });
    registerSavesHandlers({
        ipcMain,
        logger: savesLogger,
        ...(resolvedE2eHooks !== undefined ? { e2eHooks: resolvedE2eHooks } : {}),
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
            restoreSession: async (file) => {
                if (file.header.gameId !== HOSTED_GAME_ID) {
                    throw new Error(
                        `saves:load: save is for game "${file.header.gameId}" — ` +
                            `this host runs "${HOSTED_GAME_ID}".`,
                    );
                }
                if (activeSession !== null) {
                    // In-session load: only the SAME match may be live-applied.
                    // A different match (or a hosted-but-unstarted lobby, where
                    // no match identity exists yet) must go through the menu
                    // flow so the roster is re-seated from the manifest.
                    if (currentMatchId !== null && file.session.matchId === currentMatchId) {
                        applyRestoredFileToActiveSession(file);
                        return;
                    }
                    throw new Error(
                        'saves:load: this save belongs to a different match than the ' +
                            'active session — return to the main menu to load it.',
                    );
                }
                // A joined client has no `activeSession` but does hold a live
                // provider session — routing into the menu-restore flow would
                // surface LobbyManager's hosting-conflict error. Only the host
                // may restore (Invariant #25); reject renderer-friendly.
                if (joinedSessionActive) {
                    throw new Error(
                        'saves:load: cannot load a save while joined to another session — ' +
                            'leave the session first.',
                    );
                }
                // Menu flow: host a session seeded from the saved roster and
                // apply the checkpoint (F68 #823).
                await sessionRestoreCoordinator.restoreSession(file);
            },
            logger: savesLogger,
        }),
        broadcastSlotsChanged: (_gameId, slots) => {
            BrowserWindow.getAllWindows().forEach((win) => {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(SAVES_SLOT_UPDATE_CHANNEL, slots);
                }
            });
        },
        // Abort a pending menu-load restore (F68 #826). A no-op outside an
        // in-flight restore — cancel never touches a completed live session.
        cancelRestore: () => sessionRestoreCoordinator.cancel(),
    });

    // Register the `chimera:replay:*` channels backed by the shared
    // ReplayManager (§4.28, F44 / T5). `exportCurrentMatch` is gated on an
    // active hosted session here because only this scope knows the live
    // session graph; the manager's `exportCurrentMatch` is idempotent — it
    // finalises the retained recording on the first save press, or returns the path
    // already written on a repeat press (the match is not persisted at game-over;
    // the player's save icon is the sole gate, F44 / T8). `navigateToPlayer` pushes
    // the validated path so the renderer can switch to the replay player route.
    // Playback session (§4.28, F44 / T6): loads a replay and serves projected
    // per-viewer PlayerSnapshots tick-by-tick to the renderer's replay player.
    // Reuses the shared `gameRegistry` (live ActionPipeline wiring, invariant
    // #70) and projects via each game's visibility rules; only a PlayerSnapshot
    // crosses IPC (invariant #3).
    const replayPlaybackManager = new ReplayPlaybackManager(
        gameRegistry,
        createVisibilityRulesResolver(visibilityRulesByGameId),
        replayManager,
        logger.child({ module: 'replay-playback' }),
    );

    // Shared replay-player navigation push: pushes the validated path so the
    // renderer can switch to the replay player route. Reused by BOTH the
    // deterministic and perspective `open-in-player` handlers — the renderer
    // subscribes once via `replay.onNavigate` (the perspective surface reuses
    // the same `chimera:replay:navigate` channel, F44b / T7).
    const navigateToReplayPlayer = (
        replayPath: string,
        kind: ReplayNavigateKind,
        saveable: boolean,
    ): void => {
        const payload: ReplayNavigatePayload = { path: replayPath, kind, saveable };
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(REPLAY_NAVIGATE_CHANNEL, payload);
            }
        });
    };

    // Replay-export-completed push: fired by the export handler after a
    // successful `export-current-match`, so a renderer listener can raise the
    // "Replay saved" toast (§4.30). Mirrors `navigateToReplayPlayer`.
    const notifyReplayExported = (replayPath: string): void => {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(REPLAY_EXPORTED_CHANNEL, replayPath);
            }
        });
    };

    registerReplayHandlers({
        ipcMain,
        logger: logger.child({ module: 'replay' }),
        replay: replayManager,
        playback: replayPlaybackManager,
        replayDir,
        exportCurrentMatch: () => {
            if (activeSession === null) {
                return Promise.reject(
                    new Error(
                        'replay:export-current-match invoked with no active hosted session — ' +
                            'start a game before exporting.',
                    ),
                );
            }
            return replayManager.exportCurrentMatch();
        },
        // The deterministic surface always opens the deterministic player; the
        // kind is bound here (the composition root knows which surface it is
        // registering) so the handler stays kind-agnostic.
        navigateToPlayer: (path, saveable) =>
            navigateToReplayPlayer(path, 'deterministic', saveable),
        notifyExported: notifyReplayExported,
    });

    // Register the `chimera:replay:perspective:*` channels backed by the shared
    // PerspectiveReplayManager (read/delete + gated export) and a verbatim
    // PerspectiveReplayPlaybackManager (§4.28, ADR F44b, F44b / T7). The manager
    // satisfies `PerspectiveReplayLoaderPort` via its `load` (engineVersion guard)
    // and `getCurrentFile` (in-memory preview of the just-finished match).
    // `exportCurrent` is gated on an active session and is idempotent — it flushes
    // the retained frames on the first save press, or returns the path already
    // written on a repeat press (the match is not persisted at game-over; mirrors
    // the deterministic `exportCurrentMatch`). Path arguments are confined to
    // `perspectiveReplayDir`; `open-in-player` reuses the shared navigate push.
    const perspectiveReplayPlaybackManager = new PerspectiveReplayPlaybackManager(
        perspectiveReplayManager,
        logger.child({ module: 'perspective-replay-playback' }),
    );

    registerPerspectiveReplayHandlers({
        ipcMain,
        logger: logger.child({ module: 'replay-perspective' }),
        replay: perspectiveReplayManager,
        playback: perspectiveReplayPlaybackManager,
        perspectiveReplayDir,
        exportCurrent: () => {
            // Perspective replays are privacy-safe (one locked viewer's already
            // fog-filtered frames, Invariant #98), so a joined client may export
            // its OWN perspective — unlike the deterministic replay, which stays
            // host-only (`activeSession`). Allow either an active hosted session
            // (host's perspective) or an active joined session (client's). The
            // client's recording is finalised to disk at game-over, so the
            // idempotent manager returns its saved path here.
            if (activeSession === null && !joinedSessionActive) {
                return Promise.reject(
                    new Error(
                        'replay:perspective:export-current invoked with no active session — ' +
                            'start or join a game before exporting.',
                    ),
                );
            }
            return perspectiveReplayManager.exportCurrent();
        },
        navigateToPlayer: (path, saveable) => navigateToReplayPlayer(path, 'perspective', saveable),
    });

    async function autosaveActiveSessionBeforeCrash(): Promise<void> {
        if (activeSession === null) {
            crashLogger.warn('autosave skipped: no active session at crash time');
            return;
        }
        const file = activeSession.captureSaveFile({ gameId: activeSession.gameId });
        await saveManager.autoSave(file);
        if (resolvedE2eHooks !== undefined) {
            // Slot id is derived from the naming convention used by SaveManager.autoSave()
            // (`<gameId>/autosave`). If that convention changes, this line must be updated too.
            resolvedE2eHooks.lastSavedSlotId = `${file.header.gameId}/autosave`;
            resolvedE2eHooks.lastSavedTick = file.checkpoint.tick;
        }
    }

    // Register the `chimera:settings:*` channels backed by SettingsManager.
    // FileSettingsRepository persists user overrides under `<userData>/settings/`.
    // Each registered game's settings schema is registered here so
    // getSettings(gameId) returns full game defaults rather than bare engine
    // defaults.
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
    for (const game of Object.values(mainGameRegistry)) {
        game.registerSettings(settingsManager);
    }
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
        sink: crashLogSink,
    });

    // Register the `chimera:profile:*` channels.  All profile state is
    // user-scoped and stateless — profile data never enters GameSnapshot,
    // PlayerSnapshot, or SaveFile (Invariant #59).
    registerProfileHandlers({
        ipcMain,
        logger: logger.child({ module: 'profile' }),
        profileManager,
        playerDirectory,
    });

    // Register the `chimera:chat:*` channels (§4.29). `send` routes through the
    // host ChatRelay via LobbyManager.sendLocalChat (the mandatory gate,
    // Invariant #73); `history` / `mute` / `unmute` read and mutate ChatHub
    // state. The `chimera:chat:message` push is driven by ChatHub's `onMessage`
    // (configured above) — there is no invoke handler for it.
    registerChatHandlers({
        ipcMain,
        logger: logger.child({ module: 'chat' }),
        sendChat: (body, scope) => lobbyManager.sendLocalChat(body, scope),
        history: (maxEntries) => chatHub.history(maxEntries),
        mute: (playerId) => {
            chatHub.mute(playerId);
        },
        unmute: (playerId) => {
            chatHub.unmute(playerId);
        },
    });

    const createWindow = (): void => {
        deviceProbeWatcher?.dispose();
        const createdWindow = createMainWindow({
            preloadPath,
            rendererEntry,
            initialUrl:
                process.env['CHIMERA_E2E'] === '1'
                    ? sanitiseE2eInitialUrl(process.env['CHIMERA_E2E_INITIAL_URL'])
                    : rendererLaunchUrl,
            env,
            // Packaged production launches in windowed fullscreen; dev keeps the
            // chrome+DevTools window and E2E keeps a deterministic window. Note
            // `env` is 'production' under E2E too (the fixture sets CHIMERA_E2E
            // but not CHIMERA_ENV), so E2E must be excluded explicitly.
            windowedFullscreen: env === 'production' && process.env['CHIMERA_E2E'] !== '1',
            logger,
            windowTitle: resolveWindowTitle(hostedGame.manifest),
            icon: resolveAppIcon(hostedGame.manifest, gameAssetsRoot, __dirname),
        });
        mainWindow = createdWindow;
        createdWindow.webContents.on(
            'render-process-gone',
            makeRendererGoneHandler({
                logger: crashLogger,
                crashesDir,
                getSnapshot: () => activeSession?.getSnapshot() ?? null,
                getRecentLogs: () => crashLogSink.drain(),
                getAppVersion: () => app.getVersion(),
                reloadRenderer: () => {
                    if (!createdWindow.isDestroyed()) {
                        createdWindow.reload();
                    }
                },
                shutdownAfterRepeatedCrash: () => {
                    app.quit();
                },
            }),
        );

        // Create the device-probe watcher now that we have a window.
        // The watcher subscribes to display-metrics-changed and pushes updates
        // to all open windows via the SYSTEM_DEVICE_INFO_CHANGE_CHANNEL.
        // screenPort is built here (inside createWindow / app.whenReady) so
        // it is never constructed before Electron's screen module is ready.
        const screenPort: ScreenPort = {
            getAllDisplays: () => electronScreen.getAllDisplays(),
            getPrimaryDisplayId: () => electronScreen.getPrimaryDisplay().id,
            on: (event, listener) => {
                electronScreen.on(event, listener);
            },
            off: (event, listener) => {
                electronScreen.off(event, listener);
            },
        };
        const win = mainWindow;
        deviceProbeWatcher = createDeviceProbeWatcher({
            platform: process.platform,
            arch: process.arch,
            osRelease: getOsRelease(),
            electronVer: process.versions.electron ?? '',
            chromiumVer: process.versions.chrome ?? '',
            locale: app.getLocale(),
            screen: screenPort,
            getWindowContentSize: () => {
                if (win === null || win.isDestroyed()) return [1920, 1080];
                const [w, h] = win.getContentSize();
                return [w ?? 1920, h ?? 1080];
            },
        });
        deviceProbeWatcher.onChange((info) => {
            BrowserWindow.getAllWindows().forEach((openWin) => {
                if (!openWin.isDestroyed() && !openWin.webContents.isDestroyed()) {
                    openWin.webContents.send(SYSTEM_DEVICE_INFO_CHANGE_CHANNEL, info);
                }
            });
        });
        const createdWatcher = deviceProbeWatcher;
        win.on('resize', () => {
            createdWatcher.recompute();
        });
    };

    const bootstrapDirectGameBeforeWindow = async (): Promise<void> => {
        const directGameRole =
            process.env['CHIMERA_E2E'] === '1'
                ? process.env['CHIMERA_E2E_DIRECT_GAME_ROLE']
                : undefined;

        if (directGameRole === 'host') {
            try {
                const passAndPlay = process.env['CHIMERA_E2E_PASS_AND_PLAY'] === '1';
                const info = await lobbyManager.hostLobby({
                    gameId: HOSTED_GAME_ID,
                    maxPlayers: 2,
                });
                if (resolvedE2eHooks !== undefined) {
                    resolvedE2eHooks.directGameLobbyCode = info.sessionId;
                }
                await lobbyManager.updatePlayerReadyState(true);
                if (passAndPlay) {
                    await lobbyManager.addLocalSeat(playerId(`${info.hostId}-local-2`), {
                        displayName: 'Player Two',
                        ready: true,
                    });
                }
            } catch (err) {
                logger.warn('direct-game E2E: host bootstrap failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
            return;
        }

        if (directGameRole === 'client') {
            const joinAddress = process.env['CHIMERA_E2E_DIRECT_GAME_JOIN_ADDRESS'];
            if (joinAddress === undefined) {
                return;
            }
            const reconnectPlayerId = process.env['CHIMERA_E2E_RECONNECT_PLAYER_ID'];
            try {
                await lobbyManager.joinLobby({
                    address: joinAddress,
                    profile: profileManager.currentAttestation(),
                    ...(reconnectPlayerId === undefined
                        ? {}
                        : { reconnectPlayerId: playerId(reconnectPlayerId) }),
                });
                await lobbyManager.updatePlayerReadyState(true);
            } catch (err) {
                logger.warn('direct-game E2E: client bootstrap failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }
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
        registerRendererProtocol({
            protocol: electronProtocol,
            rendererRoot: path.dirname(rendererEntry),
            gameAssetsRoot,
            logger: logger.child({ module: 'renderer-protocol' }),
        });

        const directGameRole =
            process.env['CHIMERA_E2E'] === '1'
                ? process.env['CHIMERA_E2E_DIRECT_GAME_ROLE']
                : undefined;
        if (directGameRole === 'host' || directGameRole === 'client') {
            void bootstrapDirectGameBeforeWindow().finally(createWindow);
            return;
        }

        createWindow();
    });

    registerAppLifecycle({
        app,
        platform: process.platform,
        getOpenWindowCount: () => BrowserWindow.getAllWindows().length,
        createWindow,
    });
}

// The Electron entry point is the consumer app composition root
// (apps/tactics/electron/main.ts): it constructs the game contribution(s) and
// calls `main(contributions)`. `index.ts`
// (this file, the `@chimera-engine/electron` package's `./main` surface) names no game
// and no longer self-bootstraps.
