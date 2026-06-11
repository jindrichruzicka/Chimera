import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { release as getOsRelease } from 'node:os';
import {
    app,
    BrowserWindow,
    ipcMain,
    protocol as electronProtocol,
    screen as electronScreen,
    session,
} from 'electron';
import { CLEAN_EXIT_IPC_CHANNEL } from '@chimera/shared/constants.js';
import { MalformedAssetRefError, parseAssetRef } from '@chimera/shared/asset-ref-parse.js';
import {
    registerGameHandlers,
    registerLobbyHandlers,
    registerSavesHandlers,
    registerSettingsHandlers,
    registerSystemHandlers,
    registerLogsHandlers,
    registerProfileHandlers,
    registerReplayHandlers,
    registerPerspectiveReplayHandlers,
    registerChatHandlers,
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
import { toSlotId } from '../preload/api-types.js';
import { SettingsManager } from './settings/SettingsManager.js';
import { FileSettingsRepository } from './settings/FileSettingsRepository.js';
import {
    JsonSaveSerializer,
    createDefaultMigrator,
} from '@chimera/simulation/persistence/index.js';
import { tacticsSettingsSchema } from '@chimera/games/tactics/settings-schema.js';
import {
    registerTacticsActions,
    resolveTacticsFirstPlayer,
} from '@chimera/games/tactics/actions.js';
import { SETTINGS_CHANGE_CHANNEL } from '../preload/apis/settings-api.js';
import { SAVES_SLOT_UPDATE_CHANNEL } from '../preload/apis/saves-api.js';
import { REPLAY_NAVIGATE_CHANNEL, REPLAY_EXPORTED_CHANNEL } from '../preload/apis/replay-api.js';
import { LobbyManager } from './lobby/LobbyManager.js';
import { StateBroadcaster } from './runtime/StateBroadcaster.js';
import { buildHostSessionPipeline, type ReplayPort } from './runtime/HostSessionPipeline.js';
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
import { JsonReplaySerializer, ReplayMigrator } from '@chimera/simulation/replay/index.js';
import type { PerspectiveReplayFrame } from '@chimera/simulation/replay/index.js';
import {
    buildDefaultAIPlayerAgent,
    buildInitialHostedSessionSnapshot,
    buildReplayPlayers,
    collectInitialPlayerSlots,
    resolveAgentSlot,
} from './runtime/HostedSessionAgents.js';
import {
    SessionCommitmentRuntime,
    SessionRuntime,
    type E2eSessionRuntime,
} from './runtime/SessionRuntime.js';
import { wireDefaultSceneActions } from './runtime/SceneActionWiring.js';
import { PlayerDirectory } from './profile/PlayerDirectory.js';
import { createProfileGate } from './profile/ProfileGate.js';
import { ChatRelay } from './ChatRelay.js';
import { ChatHub } from './ChatHub.js';
import { LocalWebSocketProvider } from '../../networking/provider/local/LocalWebSocketProvider.js';
import type {
    ClientTransport,
    LobbyPlayerEntry,
    LobbyState,
    Unsubscribe,
    PlayerSnapshot as WirePlayerSnapshot,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import {
    GAME_REVEAL_CHANNEL,
    GAME_SNAPSHOT_CHANNEL,
    GAME_TICK_CHANNEL,
} from '../preload/apis/game-api.js';
import {
    LOBBY_UPDATE_CHANNEL,
    LOBBY_PLAYER_CONNECTION_CHANNEL,
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
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { gamePhase, playerId } from '@chimera/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    DefaultStateProjector,
    toCommitmentId,
    type CommitmentReveal,
    type PlayerSnapshot,
} from '@chimera/simulation/projection/index.js';
import { AgentManager } from '@chimera/ai/engine/AgentManager.js';
import { HumanPlayerAgent } from '@chimera/ai/engine/PlayerAgent.js';
import { tacticsVisibilityRules } from '@chimera/games/tactics/visibility-rules.js';
import { SimulationHost } from './runtime/SimulationHost.js';
import {
    registerE2eHooks,
    getE2eHooks,
    type E2eFirstPlayerRole,
    type E2eHooks,
} from './runtime/e2e-hooks.js';
import { assertProductionDebugGuard, assertProductionDevHarnessGuard } from './startup-guard.js';
import { buildAssetRef, type TextureAsset } from '@chimera/simulation/content/AssetRef.js';
import {
    localProfileId,
    type PlayerProfile,
    type ProfileRepository,
} from '@chimera/simulation/profile/ProfileSchema.js';
import {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_LAUNCH_URL,
    CHIMERA_RENDERER_PROTOCOL,
    CHIMERA_RENDERER_URL,
    type ChimeraRendererUrl,
} from './renderer-url.js';
import { TACTICS_GAME_ID } from '@chimera/shared/tactics.js';

export { CLEAN_EXIT_IPC_CHANNEL };
export {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_LAUNCH_URL,
    CHIMERA_RENDERER_PROTOCOL,
    CHIMERA_RENDERER_URL,
};
export type { ChimeraRendererUrl };

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

registerRendererProtocolScheme(electronProtocol);

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
    const gameAssetsRoot = path.join(options.moduleDirname, '..', '..', 'games');

    if (options.env['CHIMERA_E2E'] !== '1') {
        return { preloadPath, rendererEntry, gameAssetsRoot };
    }

    return {
        preloadPath: options.env['CHIMERA_E2E_PRELOAD_PATH'] ?? preloadPath,
        rendererEntry: options.env['CHIMERA_E2E_RENDERER_ENTRY'] ?? rendererEntry,
        gameAssetsRoot: options.env['CHIMERA_E2E_GAME_ASSETS_ROOT'] ?? gameAssetsRoot,
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
 * Validate a CHIMERA_E2E_INITIAL_URL value from the environment.
 *
 * Security invariant (BLOCK-1): the env var is untrusted input — accept only
 * URLs whose protocol is `chimera:` and whose host is `renderer`.  Any other
 * value (remote https, wrong host, malformed string, undefined) falls back to
 * `CHIMERA_RENDERER_URL` (the renderer root, distinct from the production
 * launch URL `CHIMERA_RENDERER_LAUNCH_URL`) so a BrowserWindow can never load
 * a remote URL via the E2E path.
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
    const window = new BrowserWindow({
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        backgroundColor: BOOTSTRAP_BACKGROUND_COLOR,
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

    const urlToLoad = options.initialUrl ?? CHIMERA_RENDERER_LAUNCH_URL;
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
    assertProductionDevHarnessGuard(process.env);

    const { preloadPath, rendererEntry, gameAssetsRoot } = resolveRuntimePaths({
        moduleDirname: __dirname,
        env: process.env,
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

    // The single live `SessionRuntime` for the currently-hosted session, or
    // `null` when no session is running. Declared before crash-reporter wiring
    // so crash dumps can include the current authoritative snapshot.
    let activeSession: SessionRuntime | null = null;

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
        userData,
        logger.child({ module: 'saves' }),
    );

    // Wire the SaveManager lifecycle: checks crash recovery, clears the flag,
    // and registers the before-quit handler. Returns wasCleanExit for the IPC
    // channel so the renderer can prompt crash-recovery on startup, and
    // autosaveMeta for the chimera:saves:check-crash-recovery handler.
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
            gameVersions: new Map([[TACTICS_GAME_ID, '0.1.0']]),
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
    let deviceProbeWatcher: DeviceProbeWatcher | null = null;
    app.on('before-quit', () => {
        pinoSink.flushSync();
        deviceProbeWatcher?.dispose();
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
        isE2e: process.env['CHIMERA_E2E'] === '1',
        getDeviceInfo: () => deviceProbeWatcher?.getCurrentInfo(),
    });

    // Build the LobbyManager once so both lobby IPC and game seat-switch IPC
    // use the same authoritative local-seat context.
    const lobbyLogger = logger.child({ module: 'lobby-manager' });

    // Shared ActionRegistry for all hosted sessions.  Engine actions are
    // always registered; game-specific actions (tactics, etc.) will be added
    // here when F18+ lands.  The registry is immutable after this point.
    const gameRegistry = new ActionRegistry();
    registerEngineActions(gameRegistry);
    wireDefaultSceneActions(gameRegistry);
    registerTacticsActions(gameRegistry);

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

    // Joined-client perspective recording state (F44b T5). Non-null only inside a
    // joined session: `onSessionJoined` arms it, the cleanup fn disarms it, and
    // `onClientSnapshotReceived` lazily starts recording on the first snapshot
    // (the client has no session-start header — `viewerId` is read off the first
    // projected snapshot, which is always the local seat). Set back to null once
    // the match finalises so trailing snapshots neither re-start nor record after
    // finalise. Host recording is independent (scoped inside `onSessionHosted`).
    let clientPerspective: { started: boolean } | null = null;

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

    // M1: only `'tactics'` is registered.  Stamped on captured save files
    // and used as the qualified slot prefix.
    const HOSTED_GAME_ID = TACTICS_GAME_ID;
    const HOSTED_GAME_VERSION = '0.1.0';

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
            // Delegates to the shared `ReplayManager`; `recordAction` /
            // `finaliseRecording` are driven by the pipeline, `startRecording`
            // by the composition root just below.
            const replayPort: ReplayPort = {
                startRecording: (header) => replayManager.startRecording(header),
                recordAction: (entry) => replayManager.recordAction(entry),
                finaliseRecording: async () => {
                    await replayManager.finaliseRecording();
                },
            };

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
                },
            );

            // Begin recording now that `seed` and `gameConfig` are resolved. The
            // gameConfig mirrors the inputs to `buildInitialHostedSessionSnapshot`
            // so a replay can reconstruct the same initial snapshot from seed +
            // config (see `createBaseReplayInitialSnapshot`). Recording finalises
            // on match end (in the pipeline) or is discarded on session close
            // (in the teardown below). A startup failure must not break hosting.
            //
            // Intentional trade-off: a single `replayManager` is shared across all
            // hosted sessions, and `finaliseRecording` is fire-and-forget (it clears
            // `recording` only after the async `repository.save` resolves). If a new
            // session's `startRecording` were to fire before a slow finalise resolved,
            // `startRecording` would throw "a recording is already in progress"; the
            // catch below keeps hosting alive and that session's replay is dropped
            // rather than corrupting the in-flight one. The teardown's
            // `abortRecording()` clears state between sessions, so this only bites on
            // a back-to-back host with a still-saving prior replay. We accept that
            // narrow, gracefully-degrading loss over blocking session startup on a
            // disk write; the live transport path must never wait on replay I/O.
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

            // Begin the host's *perspective* recording (F44b T5), locked to the
            // seat the renderer is bound to at start (`metadata.hostId`, see
            // `bindHostRendererRecipient` below). Frames are appended in
            // `sendHostedRendererSnapshot`; after a pass-and-play handoff that
            // egress sees snapshots for other seats, which the manager skips by
            // the lock (invariant #98). Recorded in its own try/catch so neither
            // recorder's startup failure suppresses the other or breaks hosting.
            let hostPerspectiveActive = false;
            if (perspectiveReplayPort.isRecording()) {
                // Host/joined-client exclusion violated: another recording is
                // already live. Skip rather than start over it (which would throw
                // inside the manager) so the assumption fails loudly, not silently.
                lobbyLogger.error(
                    'perspective replay overlap: a recording was already in progress at host start',
                    new Error('host/joined-client perspective recording mutual-exclusion violated'),
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

            const sessionRuntime = new SessionRuntime({
                gameId: HOSTED_GAME_ID,
                gameVersion: HOSTED_GAME_VERSION,
                initialSnapshot,
                applyAction: processAction,
                commitmentRuntime: sessionCommitmentRuntime,
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
                metadata.e2eHooks.triggerCrashSave = () => {
                    void autosaveActiveSessionBeforeCrash();
                };
            }

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
                // Perspective recording (F44b T5): append this projected frame,
                // then finalise once the match resolves. The manager skips frames
                // for any seat other than the locked one (post-handoff), so no
                // call-site filtering is needed; finalise is fire-and-forget.
                if (hostPerspectiveActive) {
                    perspectiveReplayPort.recordSnapshot({ tick: snapshot.tick, snapshot });
                    if (snapshot.gameResult !== null) {
                        hostPerspectiveActive = false;
                        void perspectiveReplayPort.finalise().catch((err: unknown) => {
                            lobbyLogger.error(
                                'perspective replay finalise failed at match end',
                                err instanceof Error ? err : new Error(String(err)),
                                { gameId: HOSTED_GAME_ID },
                            );
                        });
                    }
                }
            };
            const sendHostedRendererTick = (tick: number): void => {
                const win = mainWindow;
                if (win !== null && !win.isDestroyed() && !win.webContents.isDestroyed()) {
                    win.webContents.send(GAME_TICK_CHANNEL, tick);
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
            dispatchRendererAction = (action) => {
                sessionRuntime.applyAction(action);
                simulationHost.afterTick(sessionRuntime.getSnapshot());
                scheduleAutoLocalSeatHandoff(action);
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

            const broadcastCurrentGameSnapshot = (viewerId: PlayerId): void => {
                const snapshot = sessionRuntime.getSnapshot();
                if (snapshot.phase === gamePhase('lobby')) {
                    return;
                }
                broadcasterRef.current?.broadcast(snapshot, viewerId);
            };

            handleHostedLocalSeatAdded = (entry): void => {
                activePlayers.add(entry.playerId);
                registerSlotAgent(entry.playerId, nextHumanSlotIndex());
                tryStartGame();
            };

            const registeredPlayers = new Set<PlayerId>(initialPlayerIds);
            for (const slot of initialPlayerSlots) {
                registerSlotAgent(slot.playerId, slot.slotIndex);
            }
            tryStartGame();

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
                    scheduleAutoLocalSeatHandoff(action);
                } catch (err) {
                    lobbyLogger.warn('hosted session: applyAction threw', {
                        actionType: action.type,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            });

            return () => {
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
                // Discard any still-in-progress replay recording (F44 / T4): a
                // match that ended already finalised+cleared the recording, so
                // this is a no-op then; an abandoned mid-match session produces
                // no replay file. Also guarantees the next session starts clean.
                replayManager.abortRecording();
                // Same for the perspective recording (F44b T5): a finalised
                // match has cleared `hostPerspectiveActive`, so only an abandoned
                // mid-match session aborts here — no partial perspective file.
                if (hostPerspectiveActive) {
                    hostPerspectiveActive = false;
                    perspectiveReplayPort.abort();
                }
                unsubscribeHostRenderer();
                broadcasterRef.current?.dispose();
                if (activeSession === sessionRuntime) {
                    activeSession = null;
                    if (metadata.e2eHooks !== undefined) {
                        metadata.e2eHooks.triggerCrashSave = () => undefined;
                    }
                    activeE2eHooks = undefined;
                    dispatchRendererAction = null;
                    saveInitialTurnMemento = null;
                    handleHostedLocalSeatAdded = null;
                    broadcastRestoredSnapshot = null;
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
                // Abnormal teardown: discard any unfinalised perspective
                // recording so an abandoned joined match leaves no partial file.
                if (clientPerspective !== null) {
                    perspectiveReplayPort.abort();
                    clientPerspective = null;
                }
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
            const firstPlayer = resolveTacticsFirstPlayer({
                hostPlayerId: state.info.hostId,
                firstPlayer: selectedFirstPlayer,
            });

            // Reorder playerIds so the first player is at index 0 for unit assignment
            const allPlayerIds = state.players.map((player) => player.playerId);
            const playerIds = [firstPlayer, ...allPlayerIds.filter((id) => id !== firstPlayer)];

            const initialEntities = resolveInitialEntitiesForGame(
                gameRegistry,
                HOSTED_GAME_ID,
                playerIds,
            );

            const action: ActionEnvelope = {
                type: 'engine:start_game',
                playerId: state.info.hostId,
                tick: sessionRuntime.getSnapshot().tick,
                payload: {
                    playerIds: allPlayerIds,
                    firstPlayerId: firstPlayer,
                    ...(Object.keys(initialEntities).length > 0 ? { initialEntities } : {}),
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
        onLobbyStateChanged: (state) => {
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
                        clientPerspective = null;
                        void perspectiveReplayPort.finalise().catch((err: unknown) => {
                            lobbyLogger.error(
                                'perspective replay finalise failed at match end',
                                err instanceof Error ? err : new Error(String(err)),
                                { gameId: HOSTED_GAME_ID },
                            );
                        });
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
                broadcastRestoredSnapshot?.();
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

    // Register the `chimera:replay:*` channels backed by the shared
    // ReplayManager (§4.28, F44 / T5). `exportCurrentMatch` is gated on an
    // active hosted session here because only this scope knows the live
    // session graph; the manager's `exportCurrentMatch` is idempotent — it
    // finalises an in-progress recording, or returns the path already written
    // when the host pipeline auto-finalised at game-over (the post-game summary
    // buttons run only after that point, F44 / T8). `navigateToPlayer` pushes
    // the validated path so the renderer can switch to the replay player route.
    // Playback session (§4.28, F44 / T6): loads a replay and serves projected
    // per-viewer PlayerSnapshots tick-by-tick to the renderer's replay player.
    // Reuses the shared `gameRegistry` (live ActionPipeline wiring, invariant
    // #70) and projects via each game's visibility rules; only a PlayerSnapshot
    // crosses IPC (invariant #3).
    const replayPlaybackManager = new ReplayPlaybackManager(
        gameRegistry,
        createVisibilityRulesResolver({ [TACTICS_GAME_ID]: tacticsVisibilityRules }),
        replayManager,
        logger.child({ module: 'replay-playback' }),
    );

    // Shared replay-player navigation push: pushes the validated path so the
    // renderer can switch to the replay player route. Reused by BOTH the
    // deterministic and perspective `open-in-player` handlers — the renderer
    // subscribes once via `replay.onNavigate` (the perspective surface reuses
    // the same `chimera:replay:navigate` channel, F44b / T7).
    const navigateToReplayPlayer = (replayPath: string): void => {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                win.webContents.send(REPLAY_NAVIGATE_CHANNEL, replayPath);
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
        navigateToPlayer: navigateToReplayPlayer,
        notifyExported: notifyReplayExported,
    });

    // Register the `chimera:replay:perspective:*` channels backed by the shared
    // PerspectiveReplayManager (read/delete + gated export) and a verbatim
    // PerspectiveReplayPlaybackManager (§4.28, ADR F44b, F44b / T7). The manager
    // satisfies `PerspectiveReplayLoaderPort` via its `load` (engineVersion
    // guard). `exportCurrent` is gated on an active hosted session and is
    // idempotent — it flushes in-progress frames, or returns the path already
    // written when the egress path auto-finalised at game-over (mirrors the
    // deterministic `exportCurrentMatch`). Path arguments are confined to
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
            if (activeSession === null) {
                return Promise.reject(
                    new Error(
                        'replay:perspective:export-current invoked with no active hosted session — ' +
                            'start a game before exporting.',
                    ),
                );
            }
            return perspectiveReplayManager.exportCurrent();
        },
        navigateToPlayer: navigateToReplayPlayer,
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
                    : CHIMERA_RENDERER_LAUNCH_URL,
            env,
            logger,
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

// Auto-bootstrap only when executed by Electron, not when imported by Vitest.
if (process.env['VITEST'] === undefined) {
    void main();
}
