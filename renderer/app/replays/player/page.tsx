'use client';

/**
 * Replay Player (§4.28).
 *
 * Plays back a recorded match. The player does NOT run a `ReplayPlayer` itself:
 * it requests {@link PlayerSnapshot}s from the main process over IPC (only
 * `PlayerSnapshot`s ever cross — Invariant #3) and feeds them to the
 * store-agnostic `GameShell`, exactly as the live game route does. Playback
 * state (current tick / playing / speed) lives here; `ReplayControls` is
 * display-only.
 *
 * To keep auto-advance cheap, snapshots are fetched in batches via
 * `snapshotRange` and held in an in-memory buffer: stepping/playing reads from
 * the buffer, and the buffer is refilled ahead of the playhead rather than once
 * per tick. Playback speed scales the auto-advance interval.
 *
 * Engine shell page: it loads the game renderer through the engine's
 * `loadRendererGame` registry and passes the registry to `GameShell` as data —
 * it never imports from `games/*` (Invariants #80/#94). The replay file path
 * arrives as a `?path=` query param, written by `ReplayNavigationBridge` in
 * response to a main-process `navigate` push.
 */

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
    EngineAction,
    PerspectiveReplayPlaybackInfo,
    PlayerSnapshot,
    ReplayPlaybackInfo,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { createAssetManager, type AssetManager } from '../../../assets/AssetManager';
import { createRendererGameAssetResolver } from '../../../assets/AssetResolver';
import { useLeaveGame } from '../../../bridge/useLeaveGame';
import { GameShell } from '../../../components/shell/GameShell';
import { ReplayControls } from '../../../components/replay/ReplayControls';
import { parseReplayKind } from '../../../components/replay/replayKind';
import { loadRendererGame, type LoadedRendererGame } from '../../../game/rendererGameRegistry';
import { useReplayApi } from '../../../hooks/useReplayApi';
import { resolveShellGameId, withShellGameId } from '../../../shell/resolveMainMenuGameId';
import { useGameContent } from '../../../state/useGameContent';
import { useUiStore } from '../../../state/uiStore';

/** Wall-clock spacing between auto-advanced ticks at 1× playback speed. */
const PLAYBACK_INTERVAL_MS = 1000;

/**
 * Number of ticks fetched per `snapshotRange` round-trip. Auto-advance reads
 * from this in-memory buffer rather than issuing one IPC call per tick.
 */
const PREFETCH_BATCH = 32;

/** Refill the buffer once fewer than this many ticks are buffered ahead. */
const PREFETCH_LOW_WATERMARK = 8;

const NOOP_SEND_ACTION = (_action: EngineAction): void => undefined;

const pageStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'var(--ch-font-ui)',
};

const boardStyle: React.CSSProperties = { flex: '1 1 auto', minHeight: 0, position: 'relative' };

const errorStyle: React.CSSProperties = {
    padding: 'calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
    margin: 'var(--ch-space-md)',
    background: 'var(--ch-color-error-surface-muted)',
    border: 'var(--ch-border-width-sm) solid var(--ch-color-error-border-muted)',
    borderRadius: 'var(--ch-radius-sm)',
    color: 'var(--ch-color-error-text-muted)',
};

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function useLoadedRendererGame(
    gameId: string | null,
    onError: (error: Error) => void,
): LoadedRendererGame | null {
    const [game, setGame] = React.useState<LoadedRendererGame | null>(null);

    React.useEffect(() => {
        if (gameId === null) {
            setGame(null);
            return;
        }
        let active = true;
        loadRendererGame(gameId)
            .then((loaded) => {
                if (active) {
                    setGame(loaded);
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    onError(error instanceof Error ? error : new Error(String(error)));
                }
            });
        return () => {
            active = false;
        };
    }, [gameId, onError]);

    return game;
}

function ReplayPlayerView(): React.ReactElement {
    const replayApi = useReplayApi();
    const router = useRouter();
    // The role-aware live-match leave (host → returnToLobby), used only for a
    // post-game replay where the session is still alive — see `handleLeaveReplay`.
    const liveLeave = useLeaveGame();
    // `useSearchParams` reflects the live router state, so the `?path=`/`?kind=`
    // query is read reactively: a client (soft) navigation can mount the player
    // before the URL is committed, and this re-renders once it settles rather
    // than capturing a stale snapshot of `window.location.search`.
    const params = useSearchParams();
    const path = params.get('path');
    const kind = React.useMemo(() => parseReplayKind(params.get('kind')), [params]);
    // `saveable=1` is set only when the player was opened for the just-finished
    // match (the post-game **Replay** action, via the navigate push). It gates the
    // compact save icon: a library-opened replay is already on disk, and the
    // current-match export is session-gated to the live match, so it never applies.
    const saveable = params.get('saveable') === '1';

    // The playback session methods (`openPlayback`/`snapshotAt`/`closePlayback`)
    // are shared by both surfaces; selecting here keeps the rest of the page
    // kind-agnostic. Deterministic playback re-projects every tick (dense,
    // range-buffered below); perspective playback serves verbatim sparse frames
    // via `snapshotAt`'s floor lookup (Invariant #98).
    const playback = React.useMemo(
        () => (kind === 'perspective' ? replayApi.perspective : replayApi),
        [kind, replayApi],
    );

    // A replay plays back recorded board frames and is never "in" the post-game
    // summary. The uiStore screen is a module-level singleton that persists across
    // route navigations, so opening a replay from the in-game post-game summary
    // would otherwise inherit its stale 'summary' screen — rendering the summary
    // (and its invalid Replay button) over the first recorded frame. Reset to the
    // board on entry, before the board mounts, so there is no flash.
    React.useEffect(() => {
        useUiStore.getState().resetScreenNavigation();
        // A new replay starts unsaved, so the save icon resets with it.
        setSaveState('idle');
    }, [path]);

    const [info, setInfo] = React.useState<
        ReplayPlaybackInfo | PerspectiveReplayPlaybackInfo | null
    >(null);
    const [snapshot, setSnapshot] = React.useState<PlayerSnapshot | null>(null);
    const [currentTick, setCurrentTick] = React.useState(0);
    const [isPlaying, setIsPlaying] = React.useState(false);
    const [playbackSpeed, setPlaybackSpeed] = React.useState(1);
    const [error, setError] = React.useState<string | null>(null);
    // Save-icon state, owned here so `ReplayControls` stays display-only. The icon
    // disables while `saving` and stays disabled once `saved`, so the same replay
    // cannot be saved repeatedly. A failed save returns to `idle` (retryable) and
    // never replaces the player view — that whole-view error is for playback only.
    const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle');

    // In-memory snapshot buffer (tick → projected snapshot) plus a version
    // counter so a resolved prefetch re-runs the display effect. `inFlightRef`
    // dedupes concurrent fetches of the same range anchor.
    const bufferRef = React.useRef<Map<number, PlayerSnapshot>>(new Map());
    const inFlightRef = React.useRef<Set<number>>(new Set());
    const [bufferVersion, setBufferVersion] = React.useState(0);

    const reportError = React.useCallback((err: Error) => {
        setError(err.message);
    }, []);

    const totalTicks = info?.totalTicks ?? 0;

    // Open the playback session for the requested path; close it on unmount.
    React.useEffect(() => {
        if (path === null) {
            setError('No replay path provided.');
            return;
        }
        let active = true;
        setError(null);
        playback
            .openPlayback(path)
            .then((opened) => {
                if (active) {
                    bufferRef.current = new Map();
                    inFlightRef.current = new Set();
                    setBufferVersion(0);
                    setSnapshot(null);
                    setInfo(opened);
                    setCurrentTick(0);
                }
            })
            .catch((err: unknown) => {
                if (active) {
                    setError(err instanceof Error ? err.message : 'Failed to open replay.');
                }
            });
        return () => {
            active = false;
            void playback.closePlayback();
        };
    }, [playback, path]);

    // Fetch (and buffer) a batch of snapshots anchored at `from`, deduping
    // concurrent requests for the same anchor.
    const fetchRange = React.useCallback(
        (from: number) => {
            if (info === null || inFlightRef.current.has(from)) {
                return;
            }
            const to = Math.min(from + PREFETCH_BATCH - 1, info.totalTicks);
            inFlightRef.current.add(from);
            replayApi
                .snapshotRange(from, to)
                .then((snaps) => {
                    snaps.forEach((snap, index) => bufferRef.current.set(from + index, snap));
                    setBufferVersion((version) => version + 1);
                })
                .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : 'Failed to load ticks.');
                })
                .finally(() => {
                    inFlightRef.current.delete(from);
                });
        },
        [replayApi, info],
    );

    // Deterministic: display the current tick from the buffer, fetching it (and
    // prefetching ahead of the playhead) as needed. `bufferVersion` re-runs this
    // once a pending range resolves. Perspective playback uses the dedicated
    // effect below instead (sparse frames, floor lookup on main).
    React.useEffect(() => {
        if (kind !== 'deterministic' || info === null) {
            return;
        }
        const buffer = bufferRef.current;
        const cached = buffer.get(currentTick);
        if (cached === undefined) {
            fetchRange(currentTick);
            return;
        }
        setSnapshot(cached);

        // Find the highest contiguously-buffered tick ahead of the playhead and
        // refill once the runway drops below the low-water mark.
        let ahead = currentTick;
        while (ahead < info.totalTicks && buffer.has(ahead + 1)) {
            ahead += 1;
        }
        if (ahead < info.totalTicks && ahead - currentTick < PREFETCH_LOW_WATERMARK) {
            fetchRange(ahead + 1);
        }
    }, [kind, info, currentTick, bufferVersion, fetchRange]);

    // Perspective: fetch the stored frame for the current tick directly. Frames
    // are sparse and already projected, so main does a floor lookup (greatest
    // recorded tick ≤ `currentTick`) and returns it verbatim — there is nothing
    // to re-project or prefetch (Invariant #98).
    React.useEffect(() => {
        if (kind !== 'perspective' || info === null) {
            return;
        }
        let active = true;
        playback
            .snapshotAt(currentTick)
            .then((snap) => {
                if (active) {
                    setSnapshot(snap);
                }
            })
            .catch((err: unknown) => {
                if (active) {
                    setError(err instanceof Error ? err.message : 'Failed to load frame.');
                }
            });
        return () => {
            active = false;
        };
    }, [kind, info, currentTick, playback]);

    // Auto-advance while playing; the interval scales inversely with speed.
    React.useEffect(() => {
        if (!isPlaying || info === null) {
            return;
        }
        const id = setInterval(() => {
            setCurrentTick((tick) => Math.min(tick + 1, info.totalTicks));
        }, PLAYBACK_INTERVAL_MS / playbackSpeed);
        return () => {
            clearInterval(id);
        };
    }, [isPlaying, info, playbackSpeed]);

    // Stop playback once the final tick is reached.
    React.useEffect(() => {
        if (isPlaying && info !== null && currentTick >= info.totalTicks) {
            setIsPlaying(false);
        }
    }, [isPlaying, info, currentTick]);

    const loadedGame = useLoadedRendererGame(info?.gameId ?? null, reportError);
    const assetManager = React.useMemo<AssetManager | null>(
        () => (loadedGame === null ? null : createAssetManager(createRendererGameAssetResolver())),
        [loadedGame],
    );
    // The game's content collections, keyed by the replay's gameId, exactly as the
    // live game route supplies them (`renderer/app/game/page.tsx`). A game's screen
    // interprets these (tactics derives its colour palette); without them every
    // unit falls back to the default colour, so the replay would render all-blue.
    const gameContent = useGameContent(info?.gameId ?? null);

    const handlePlay = React.useCallback(() => {
        setIsPlaying(true);
    }, []);
    const handlePause = React.useCallback(() => {
        setIsPlaying(false);
    }, []);
    const handleStep = React.useCallback(
        (delta: number) => {
            setIsPlaying(false);
            setCurrentTick((tick) => clamp(tick + delta, 0, totalTicks));
        },
        [totalTicks],
    );
    const handleSeek = React.useCallback(
        (tick: number) => {
            setIsPlaying(false);
            setCurrentTick(clamp(tick, 0, totalTicks));
        },
        [totalTicks],
    );
    const handleSpeedChange = React.useCallback((speed: number) => {
        setPlaybackSpeed(speed);
    }, []);

    // Context-aware leave for the in-game menu (the live-match IPC leave does not
    // apply to a replay). `saveable` is the entry-point signal: it is set only when
    // the player was opened for the just-finished match (the post-game Replay), so
    // a live lobby session is still alive — reuse the role-aware live leave (host →
    // returnToLobby), and the app-global `GameStoreBootstrap` returns to the lobby
    // once the broadcast phase:'lobby' snapshot lands. A library-opened replay has
    // no session to return to, so it goes back to the replay library it came from.
    const handleLeaveReplay = React.useCallback(async (): Promise<void> => {
        if (saveable) {
            await liveLeave();
            return;
        }
        // Carry the shell's `?gameId=` (the param the main-menu override resolves
        // from) back onto /replays. Prefer the live URL over the replay's own
        // recorded gameId so the hop survives even if `info` has not loaded, and
        // never strands the eventual menu on the engine default.
        const explicitGameId =
            resolveShellGameId(new URLSearchParams(window.location.search)) ?? info?.gameId ?? null;
        router.push(withShellGameId('/replays', explicitGameId));
    }, [saveable, liveLeave, router, info]);

    // Save the just-finished match's replay. This is the SOLE persistence gate: the
    // match is not written at game-over, so the export here performs the first (and,
    // being idempotent on the main side, only) disk write. The deterministic export
    // raises the "Replay saved" toast; the perspective export raises none — the
    // disabled "saved" icon is its only confirmation. Each surface uses its own
    // export so the deterministic replay stays host-only (Invariants #71 / #98).
    const handleSaveReplay = React.useCallback(async (): Promise<void> => {
        setSaveState('saving');
        try {
            if (kind === 'perspective') {
                await replayApi.perspective.exportCurrent();
            } else {
                await replayApi.exportCurrentMatch('save');
            }
            setSaveState('saved');
        } catch {
            setSaveState('idle');
        }
    }, [kind, replayApi]);

    if (error !== null) {
        return (
            <main style={pageStyle}>
                <div style={errorStyle} role="alert">
                    {error}
                </div>
            </main>
        );
    }

    const isReady =
        info !== null && snapshot !== null && loadedGame !== null && assetManager !== null;

    if (!isReady) {
        return (
            <main style={pageStyle}>
                <div
                    role="status"
                    aria-label="Loading replay"
                    style={{ padding: 'var(--ch-space-md)' }}
                >
                    Loading replay…
                </div>
            </main>
        );
    }

    return (
        <main style={pageStyle}>
            <ReplayControls
                kind={kind}
                currentTick={currentTick}
                totalTicks={totalTicks}
                isPlaying={isPlaying}
                playbackSpeed={playbackSpeed}
                onPlay={handlePlay}
                onPause={handlePause}
                onStep={handleStep}
                onSeek={handleSeek}
                onSpeedChange={handleSpeedChange}
                {...(saveable
                    ? {
                          save: {
                              onSave: () => void handleSaveReplay(),
                              saving: saveState === 'saving',
                              saved: saveState === 'saved',
                          },
                      }
                    : {})}
            />
            <div style={boardStyle}>
                <GameShell
                    registry={loadedGame.registry}
                    assetManager={assetManager}
                    {...(loadedGame.assetManifest === undefined
                        ? {}
                        : { assetManifest: loadedGame.assetManifest })}
                    {...(loadedGame.inputActions === undefined
                        ? {}
                        : { inputActions: loadedGame.inputActions })}
                    {...(gameContent === undefined ? {} : { content: gameContent })}
                    snapshot={snapshot}
                    currentTick={currentTick}
                    sendAction={NOOP_SEND_ACTION}
                    canEndTurn={false}
                    leaveGame={handleLeaveReplay}
                    localPlayerId={info.viewerId as PlayerSnapshot['viewerId']}
                />
            </div>
        </main>
    );
}

/**
 * `useSearchParams` requires a Suspense boundary under static export
 * (`output: 'export'`), so the reactive view is wrapped here. The fallback
 * mirrors the view's own "Loading replay…" status so the transition is seamless.
 */
export default function ReplayPlayerPage(): React.ReactElement {
    return (
        <React.Suspense
            fallback={
                <main style={pageStyle}>
                    <div
                        role="status"
                        aria-label="Loading replay"
                        style={{ padding: 'var(--ch-space-md)' }}
                    >
                        Loading replay…
                    </div>
                </main>
            }
        >
            <ReplayPlayerView />
        </React.Suspense>
    );
}
