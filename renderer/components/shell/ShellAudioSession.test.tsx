// @vitest-environment jsdom

/**
 * renderer/components/shell/ShellAudioSession.test.tsx
 *
 * The shell-scoped audio session (§4.25): the delegate that makes `useSound` and
 * `useMusicTrack` resolve a clip OUTSIDE a match, the menu bed it plays across the
 * shell screens, and the menu→match handoff that hands the binding over.
 *
 * The delegating manager under test is the REAL one — the whole point of the
 * session is which manager an app-level `AudioManager.play()` reaches, and a
 * spy on the setter cannot tell a registered delegate from a discarded one.
 */

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import type { AssetManager } from '../../assets/AssetManager';
import * as assetManagerModule from '../../assets/AssetManager';
import {
    createDelegatingAssetManager,
    NoActiveGameSessionError,
    type DelegatingAssetManager,
} from '../../assets/DelegatingAssetManager';
import {
    SetGameAssetManagerContext,
    type GameAssetManagerBinding,
} from '../../assets/SetGameAssetManagerContext';
import { MUSIC_PRIORITY, type AudioHandle, type AudioManager } from '../../audio/AudioManager';
import { AudioManagerContext } from '../../audio/AudioManagerContext.js';
import { createAudioManagerSpy } from '../../audio/__test-support__/AudioManagerStubs';
import { createRecordingLogsApi } from '../../logging/__test-support__/RecordingLogsApi';
import { useSound } from '../../audio/useSound';
import type { LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import {
    _resetShellStateForTest,
    armShellTransition,
    clearShellTransition,
    setShellRoute,
    type ShellSurface,
} from '../../shell/shellStateStore';
import { ShellAudioSession } from './ShellAudioSession';

const { mockLoadRendererGameShell } = vi.hoisted(() => ({
    mockLoadRendererGameShell: vi.fn(),
}));

vi.mock('../../game/rendererGameRegistry', () => ({
    loadRendererGameShell: mockLoadRendererGameShell,
}));

const BED_REF = 'tactics/audio/music/menu-bed.ogg' as AssetRef<AudioClipAsset>;
const BLIP_REF = 'tactics/audio/sfx/select.ogg' as AssetRef<AudioClipAsset>;

/**
 * The shell audio inventory, as an inline literal. `metadata` carries a clip's cue
 * sheet, which is what decides between the two handoff shapes below.
 *
 * The bed is never `entries[0]`, and the sibling ahead of it always carries the
 * OPPOSITE sheet: a real `shell-asset-manifest.ts` lists many clips, and a lookup
 * that read a fixed slot rather than the bed's own ref would flip the handoff
 * branch while every DOM and call assertion stayed green.
 */
function shellAudioManifest(options: { readonly withCueSheet: boolean }): AssetManifest {
    const sheet = { durationSeconds: 96, cues: { intro: 4, outro: 88 } };
    return {
        gameId: 'tactics',
        entries: [
            {
                ref: BLIP_REF,
                kind: 'audio-clip',
                priority: 'deferred',
                ...(options.withCueSheet ? {} : { metadata: sheet }),
            },
            {
                ref: BED_REF,
                kind: 'audio-clip',
                priority: 'deferred',
                ...(options.withCueSheet ? { metadata: sheet } : {}),
            },
        ],
    };
}

/** Publishes a recording logs bridge, which `emitRendererError` reads off `window`. */
function installLogsApi(logsApi: ReturnType<typeof createRecordingLogsApi>): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { logs: logsApi },
    });
}

let delegating: DelegatingAssetManager;
let audioManager: AudioManager;
let binding: GameAssetManagerBinding;
/** Managers `createAssetManager` handed out, newest last. */
let builtManagers: AssetManager[];

function setSurface(surface: ShellSurface, pathname: string, gameId: string | null): void {
    act(() => {
        setShellRoute({ surface, pathname, gameId });
    });
}

function renderSession(children?: React.ReactNode): ReturnType<typeof render> {
    return render(
        <SetGameAssetManagerContext.Provider value={binding}>
            <AudioManagerContext.Provider value={audioManager}>
                <ShellAudioSession />
                {children}
            </AudioManagerContext.Provider>
        </SetGameAssetManagerContext.Provider>,
    );
}

/** The handle the session's `index`-th `play()` returned (0-based). */
function playedBedHandle(index: number): AudioHandle {
    return vi.mocked(audioManager.play).mock.results[index]?.value as AudioHandle;
}

/**
 * The bed voices the session has started and not ended, oldest first.
 *
 * `stop` is the only verb here that ends a voice outright. A cue-aligned
 * `fadeOutAtCue` books its ramp at the cue and leaves the voice at full volume
 * until then, and a plain `fadeOut` still runs for its whole window — so neither
 * makes a voice finished at the instant it is armed, and counting either as one
 * would hide a second bed playing over the first.
 *
 * Matched by OBJECT IDENTITY, never by `handle.id`: the shared spy mints the same
 * id for every voice, so an id-keyed set would read one `stop` as having ended
 * all of them.
 */
function soundingBeds(): AudioHandle[] {
    const stopped = new Set(vi.mocked(audioManager.stop).mock.calls.map(([handle]) => handle));
    return vi
        .mocked(audioManager.play)
        .mock.results.map((result) => result.value as AudioHandle)
        .filter((handle) => !stopped.has(handle));
}

/**
 * Assert the handed-off bed was ENDED BEFORE the replacement started.
 *
 * A set difference over calls is order-blind, and the order is load-bearing:
 * `AudioManager.play` reserves a voice slot and refuses the play outright when the
 * pool is still full afterwards, so starting the new bed while the handed-off one
 * still holds its slot costs a third voice or the bed itself.
 *
 * Scoped to the exact pair — the `stop` that took THIS handle and the `play` at
 * THIS index — rather than to the first call of either verb, which would only say
 * that some `stop` preceded some `play`.
 */
function expectEndedBeforePlay(handle: AudioHandle, playIndex: number): void {
    const stopIndex = vi.mocked(audioManager.stop).mock.calls.findIndex(([arg]) => arg === handle);
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    const stopOrder = vi.mocked(audioManager.stop).mock.invocationCallOrder[stopIndex];
    const playOrder = vi.mocked(audioManager.play).mock.invocationCallOrder[playIndex];
    expect(stopOrder).toBeDefined();
    expect(playOrder).toBeDefined();
    expect(stopOrder!).toBeLessThan(playOrder!);
}

/** Whether the app-level delegating manager can currently reach a shell clip. */
async function shellClipResolves(): Promise<boolean> {
    try {
        await delegating.load(BLIP_REF);
        return true;
    } catch (error) {
        if (error instanceof NoActiveGameSessionError) {
            return false;
        }
        // Any other rejection means the delegate WAS reached — the stub resolver
        // has no protocol behind it, which is a different failure entirely.
        return true;
    }
}

beforeEach(() => {
    _resetShellStateForTest();
    delegating = createDelegatingAssetManager();
    audioManager = createAudioManagerSpy();
    binding = {
        set: (manager) => {
            delegating.setDelegate(manager);
        },
        release: (manager) => {
            delegating.releaseDelegate(manager);
        },
    };
    builtManagers = [];
    vi.spyOn(assetManagerModule, 'createAssetManager').mockImplementation((_resolver, manifest) => {
        const manager: AssetManager = {
            registerManifest: vi.fn(),
            preloadCritical: vi.fn(async () => undefined),
            get: vi.fn(() => null),
            getManifestMetadata: vi.fn(
                (ref) => manifest?.entries.find((entry) => entry.ref === ref)?.metadata,
            ),
            load: vi.fn(async (ref) => {
                const entry = manifest?.entries.find((candidate) => candidate.ref === ref);
                if (entry === undefined) {
                    throw new Error(`not in the shell manifest: ${String(ref)}`);
                }
                return {} as never;
            }),
            dispose: vi.fn(),
        };
        builtManagers.push(manager);
        return manager;
    });
    mockLoadRendererGameShell.mockReset();
    mockLoadRendererGameShell.mockResolvedValue({} satisfies LoadedRendererGameShell);
});

afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    vi.restoreAllMocks();
});

describe('ShellAudioSession — the delegate', () => {
    it('leaves the app-level manager delegate-less before it opens a session', async () => {
        // The red half of the feature: this is the swallowed NoActiveGameSessionError
        // every menu blip died in.
        expect(await shellClipResolves()).toBe(false);
    });

    it('registers a shell-scoped delegate on a shell surface with a game that declares shell audio', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await waitFor(async () => {
            expect(await shellClipResolves()).toBe(true);
        });
    });

    it('lets a useSound() call on a shell route reach the clip through the app-level manager', async () => {
        // AC1's second half, through the REAL hook: `useSound` resolves its clip
        // via `useAudioManager()`, which is app-level and therefore behind the
        // delegating manager — nothing the shell renders can substitute one.
        const realAudioManager = audioManager;
        const played: AssetRef<AudioClipAsset>[] = [];
        vi.mocked(realAudioManager.play).mockImplementation((ref) => {
            played.push(ref);
            void delegating.load(ref);
            return { id: 'h', ref, bus: 'sfx', priority: 0, valid: true };
        });
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        function BlipProbe(): React.ReactElement {
            const play = useSound(BLIP_REF);
            return (
                <button type="button" data-testid="blip" onClick={() => void play()}>
                    blip
                </button>
            );
        }

        const { getByTestId } = renderSession(<BlipProbe />);
        await waitFor(async () => {
            expect(await shellClipResolves()).toBe(true);
        });
        act(() => {
            getByTestId('blip').click();
        });

        expect(played).toEqual([BLIP_REF]);
        const shellManager = builtManagers.at(-1);
        expect(shellManager?.load).toHaveBeenCalledWith(BLIP_REF);
    });

    it('opens no session for a game that declares no shell audio', async () => {
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await waitFor(() => {
            expect(mockLoadRendererGameShell).toHaveBeenCalledWith('tactics');
        });
        expect(builtManagers).toHaveLength(0);
        expect(await shellClipResolves()).toBe(false);
    });

    it('opens no session on a shell surface with no game in context', async () => {
        setSurface('main-menu', '/main-menu', null);

        renderSession();

        await Promise.resolve();
        expect(mockLoadRendererGameShell).not.toHaveBeenCalled();
        expect(await shellClipResolves()).toBe(false);
    });

    it('releases and disposes its manager when the shell surface is left', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');
        renderSession();
        await waitFor(async () => {
            expect(await shellClipResolves()).toBe(true);
        });
        const shellManager = builtManagers.at(-1);

        setSurface('match', '/game', 'tactics');

        await waitFor(() => {
            expect(shellManager?.dispose).toHaveBeenCalledTimes(1);
        });
        expect(await shellClipResolves()).toBe(false);
    });

    it('keeps ONE session across the shell screens rather than rebuilding per route', async () => {
        // The bed and the delegate both have to survive `/main-menu → /settings`:
        // a session rebuilt per screen would restart the music on every hop.
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');
        renderSession();
        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(1);
        });

        setSurface('settings', '/settings', 'tactics');
        setSurface('saves', '/saves', 'tactics');

        await waitFor(async () => {
            expect(await shellClipResolves()).toBe(true);
        });
        expect(audioManager.play).toHaveBeenCalledTimes(1);
        expect(audioManager.stop).not.toHaveBeenCalled();
        expect(builtManagers).toHaveLength(1);
    });
});

describe('ShellAudioSession — the critical warm-up', () => {
    const CRITICAL_REF = 'tactics/audio/sfx/confirm.ogg' as AssetRef<AudioClipAsset>;
    const criticalManifest: AssetManifest = {
        gameId: 'tactics',
        entries: [{ ref: CRITICAL_REF, kind: 'audio-clip', priority: 'critical' }],
    };

    /** The per-entry failure reporter the warm-up handed the shell manager. */
    function entryFailureReporter(): (ref: AssetRef, error: unknown) => void {
        const manager = builtManagers.at(-1);
        if (manager === undefined) {
            throw new Error('the shell session built no manager');
        }
        const reporter = vi.mocked(manager.preloadCritical).mock.calls[0]?.[2];
        if (reporter === undefined) {
            throw new Error('the shell session started no critical warm-up');
        }
        return reporter;
    }

    async function mountWithCriticalEntry(): Promise<void> {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: criticalManifest,
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');
        renderSession();
        await waitFor(() => {
            expect(builtManagers).toHaveLength(1);
        });
    }

    it('warms the entries the game marked critical, so the priority means something here too', async () => {
        // §4.10: nothing else runs the warm-up for a session with no GameShell
        // above it, so a `critical` shell clip would otherwise decode on the first
        // click that needs it.
        await mountWithCriticalEntry();

        expect(builtManagers.at(-1)?.preloadCritical).toHaveBeenCalledWith(
            criticalManifest,
            undefined,
            expect.any(Function),
        );
    });

    it('reports a critical warm-up failure while the session is mounted', async () => {
        // The control for the case below: without it, "no error after teardown"
        // could equally mean the report never works at all.
        const logsApi = createRecordingLogsApi();
        installLogsApi(logsApi);
        await mountWithCriticalEntry();
        const report = entryFailureReporter();

        act(() => {
            report(CRITICAL_REF, new Error('decode failed'));
        });

        expect(
            logsApi.emitCalls.some((entry) => entry.message.includes('critical asset preload')),
        ).toBe(true);
    });

    it('abandons the warm-up report on teardown, so a disposed session logs nothing', async () => {
        // Nothing aborts an in-flight load: the manager this session disposes
        // rejects everything still running, and a teardown is not a failure to
        // report.
        const logsApi = createRecordingLogsApi();
        installLogsApi(logsApi);
        await mountWithCriticalEntry();
        const report = entryFailureReporter();

        setSurface('match', '/game', 'tactics');
        act(() => {
            report(CRITICAL_REF, new Error('superseded by dispose'));
        });

        expect(
            logsApi.emitCalls.some((entry) => entry.message.includes('critical asset preload')),
        ).toBe(false);
    });
});

describe('ShellAudioSession — surfaces', () => {
    const declaringShell = {
        shellAudioAssets: { gameId: 'tactics', entries: [] },
    } satisfies LoadedRendererGameShell;

    beforeEach(() => {
        mockLoadRendererGameShell.mockResolvedValue(declaringShell);
    });

    it.each([
        ['main-menu', '/main-menu'],
        ['settings', '/settings'],
        ['lobby', '/lobby'],
        ['saves', '/saves'],
        ['replays', '/replays'],
        ['page', '/credits'],
    ] as const)('opens the session on the %s surface', async (surface, pathname) => {
        setSurface(surface, pathname, 'tactics');

        renderSession();

        await waitFor(() => {
            expect(builtManagers).toHaveLength(1);
        });
    });

    it.each([
        ['match', '/game'],
        ['replay-player', '/replays/player'],
        ['boot', '/logo-screen'],
    ] as const)('opens no session on the %s surface', async (surface, pathname) => {
        setSurface(surface, pathname, 'tactics');

        renderSession();

        await Promise.resolve();
        expect(builtManagers).toHaveLength(0);
    });
});

describe('ShellAudioSession — the menu bed', () => {
    it('plays the declared bed as a looping music voice at the music priority', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
            shellMusicBed: { ref: BED_REF, volume: 0.5, fadeInMs: 750 },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledWith(BED_REF, {
                bus: 'music',
                loop: true,
                priority: MUSIC_PRIORITY,
                volume: 0.5,
                fadeIn: { durationMs: 750 },
            });
        });
    });

    it('plays a bed that declares only a ref, with no fade and no volume override', async () => {
        // Each knob is separately optional, so a bare declaration must not carry a
        // `fadeIn: { durationMs: undefined }` the manager would read as a fade.
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(1);
        });
        expect(vi.mocked(audioManager.play).mock.calls[0]?.[1]).toEqual({
            bus: 'music',
            loop: true,
            priority: MUSIC_PRIORITY,
        });
    });

    it('plays nothing for a game that declares shell audio but no bed', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await waitFor(() => {
            expect(builtManagers).toHaveLength(1);
        });
        expect(audioManager.play).not.toHaveBeenCalled();
    });

    it('plays nothing for a bed declared without a shell audio manifest', async () => {
        // Inert by declaration: the ref would resolve against nothing.
        mockLoadRendererGameShell.mockResolvedValue({
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await Promise.resolve();
        expect(audioManager.play).not.toHaveBeenCalled();
        expect(builtManagers).toHaveLength(0);
    });

    it('stops the bed outright when the shell is left with nothing armed', async () => {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');
        renderSession();
        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(1);
        });
        const handle = vi.mocked(audioManager.play).mock.results[0]?.value as unknown;

        setSurface('boot', '/logo-screen', 'tactics');

        await waitFor(() => {
            expect(audioManager.stop).toHaveBeenCalledWith(handle);
        });
        expect(audioManager.fadeOut).not.toHaveBeenCalled();
        expect(audioManager.fadeOutAtCue).not.toHaveBeenCalled();
    });

    it('reaches the bed through the app-level AudioManager, so the audio settings buses apply', async () => {
        // AC3. Volumes and mute live on the app-level manager's buses
        // (`AudioBus` subscribes to the settings store), so what has to hold here
        // is that shell playback goes through THAT manager on the `music` bus —
        // the session never constructs an AudioManager of its own.
        const contextManager = audioManager;
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest({ withCueSheet: false }),
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');

        renderSession();

        await waitFor(() => {
            expect(contextManager.play).toHaveBeenCalledTimes(1);
        });
        expect(vi.mocked(contextManager.play).mock.calls[0]?.[1]?.bus).toBe('music');
    });
});

describe('ShellAudioSession — the menu→match handoff', () => {
    async function mountWith(options: { readonly withCueSheet: boolean }): Promise<unknown> {
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: shellAudioManifest(options),
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');
        renderSession();
        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(1);
        });
        return vi.mocked(audioManager.play).mock.results[0]?.value as unknown;
    }

    it('fades the bed out FROM the outro cue when the clip declares a sheet', async () => {
        const handle = await mountWith({ withCueSheet: true });

        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });

        expect(audioManager.fadeOutAtCue).toHaveBeenCalledWith(handle, {
            atCue: { name: 'outro' },
            fade: { overMs: 400 },
        });
        expect(audioManager.fadeOut).not.toHaveBeenCalled();
        // The scheduled fade IS the stop; cutting the voice would defeat it.
        expect(audioManager.stop).not.toHaveBeenCalled();
    });

    it('fades the bed out over the screen fade when the clip declares no sheet', async () => {
        const handle = await mountWith({ withCueSheet: false });

        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });

        expect(audioManager.fadeOut).toHaveBeenCalledWith(handle, { overMs: 400 });
        expect(audioManager.fadeOutAtCue).not.toHaveBeenCalled();
        expect(audioManager.stop).not.toHaveBeenCalled();
    });

    it('falls back to the screen-fade boundary when the sheet declares no outro cue', async () => {
        // A sheet is not automatically a handoff point: `fadeOutAtCue` resolves an
        // unknown `{ name }` to the DECODED END rather than abandoning, so a
        // sheet-exists check would arm the transition against an instant the game
        // never authored.
        mockLoadRendererGameShell.mockResolvedValue({
            shellAudioAssets: {
                gameId: 'tactics',
                entries: [
                    {
                        ref: BLIP_REF,
                        kind: 'audio-clip',
                        priority: 'deferred',
                        metadata: { durationSeconds: 2, cues: { outro: 1 } },
                    },
                    {
                        ref: BED_REF,
                        kind: 'audio-clip',
                        priority: 'deferred',
                        metadata: { durationSeconds: 96, cues: { intro: 4 } },
                    },
                ],
            },
            shellMusicBed: { ref: BED_REF },
        } satisfies LoadedRendererGameShell);
        setSurface('main-menu', '/main-menu', 'tactics');
        renderSession();
        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(1);
        });

        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });

        expect(audioManager.fadeOut).toHaveBeenCalledWith(expect.anything(), { overMs: 400 });
        expect(audioManager.fadeOutAtCue).not.toHaveBeenCalled();
    });

    it('hands the delegate back the moment the entry is armed, before /game renders', async () => {
        // The ordering pin. A session driven by the shell-state store tears down
        // on a store update that lands after the router's own commit, so one that
        // waited for its own unmount would still be bound when `GameShell`
        // registers the match manager during render. The arm happens before the
        // navigation, so the binding is free by then.
        await mountWith({ withCueSheet: false });
        expect(await shellClipResolves()).toBe(true);

        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });

        expect(await shellClipResolves()).toBe(false);
        expect(builtManagers.at(-1)?.dispose).toHaveBeenCalledTimes(1);
    });

    it('leaves a match delegate registered ahead of it alone when it lets go', async () => {
        // The backstop for every entry the arm does not cover: releasing by
        // IDENTITY means a late teardown cannot clear a binding a match has
        // already taken over.
        await mountWith({ withCueSheet: false });
        const matchManager = { load: vi.fn(async () => ({}) as never) } as unknown as AssetManager;
        delegating.setDelegate(matchManager);

        setSurface('match', '/game', 'tactics');

        await waitFor(() => {
            expect(builtManagers.at(-1)?.dispose).toHaveBeenCalledTimes(1);
        });
        await delegating.load(BLIP_REF);
        expect(matchManager.load).toHaveBeenCalledWith(BLIP_REF);
    });

    it('takes the binding back and restarts the bed when an armed entry is cancelled', async () => {
        // A refused quick start clears the transition and leaves the player on the
        // menu — with the bed and the delegate both gone unless this re-arms.
        await mountWith({ withCueSheet: false });
        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });
        expect(await shellClipResolves()).toBe(false);

        act(() => {
            clearShellTransition();
        });

        await waitFor(async () => {
            expect(await shellClipResolves()).toBe(true);
        });
        expect(audioManager.play).toHaveBeenCalledTimes(2);
    });

    it('leaves ONE bed sounding when a cue-aligned handoff is cancelled', async () => {
        // A cue-aligned handoff does not end the voice: `fadeOutAtCue` books the
        // ramp at the CUE, and the bed plays on at full volume until the playhead
        // gets there — a whole loop period away for a menu loop. So the session
        // cannot treat a handed-off bed as finished: starting the next one over
        // the top of it gives the player two out-of-phase copies of the same loop.
        await mountWith({ withCueSheet: true });
        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });
        expect(audioManager.fadeOutAtCue).toHaveBeenCalledTimes(1);

        act(() => {
            clearShellTransition();
        });

        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(2);
        });
        const sounding = soundingBeds();
        expect(sounding).toHaveLength(1);
        expect(sounding[0]).toBe(playedBedHandle(1));
        expectEndedBeforePlay(playedBedHandle(0), 1);
    });

    it('leaves ONE bed sounding across a match round trip after a cue-aligned handoff', async () => {
        // The ordinary quit-to-menu. The handed-off bed can still be sounding when
        // the player comes back, and it is this session that started it.
        await mountWith({ withCueSheet: true });
        act(() => {
            armShellTransition({ kind: 'to-match', durationMs: 400 });
        });
        setSurface('match', '/game', 'tactics');

        setSurface('main-menu', '/main-menu', 'tactics');

        await waitFor(() => {
            expect(audioManager.play).toHaveBeenCalledTimes(2);
        });
        const sounding = soundingBeds();
        expect(sounding).toHaveLength(1);
        expect(sounding[0]).toBe(playedBedHandle(1));
        expectEndedBeforePlay(playedBedHandle(0), 1);
    });

    it('ignores a to-shell transition, which is a match LEAVING rather than starting', async () => {
        await mountWith({ withCueSheet: false });

        act(() => {
            armShellTransition({ kind: 'to-shell', durationMs: 400 });
        });

        expect(audioManager.fadeOut).not.toHaveBeenCalled();
        expect(audioManager.fadeOutAtCue).not.toHaveBeenCalled();
        expect(await shellClipResolves()).toBe(true);
    });
});
