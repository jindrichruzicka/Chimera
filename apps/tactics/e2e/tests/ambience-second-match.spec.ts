/**
 * ambience-second-match.spec.ts
 * §4.25 Audio System — the music bed across a match boundary.
 *
 * Regression: the ambience bed played in the FIRST match of a session and was
 * silent in every match opened after it. Leaving to the lobby and starting again
 * left `<TacticsAmbience>` mounted and its `data-track` marker correct while no
 * voice was ever started — so nothing user-visible, and nothing in the log
 * either: the play was abandoned by a rejected asset load, which `play()`
 * swallows.
 *
 * That silence is why this spec instruments Web Audio rather than reading the
 * DOM or the log. `data-track` is rendered from a prop and flips whether or not a
 * voice exists (`audio-smoke.spec.ts` says so in as many words), and the failure
 * emitted no warning for the log assertion there to catch. The one thing that
 * separates a playing bed from a silent one is whether an `AudioBufferSourceNode`
 * for it was ever STARTED, so the probe below patches
 * `AudioBufferSourceNode.prototype.start` and records the looping voices that
 * reach it.
 *
 * The first match is measured too, and that is what makes the second-match
 * assertion mean something: a window whose AudioContext never came up (the noop
 * manager fallback in `Providers`) records nothing at all, and without the
 * first-match count the regression assertion could not be told apart from that.
 */

import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/lobby.fixture';
import { GamePage } from '../pages/GamePage';
import { InGameMenuPage } from '../pages/InGameMenuPage';
import { LobbyPage } from '../pages/LobbyPage';
import { readyAndStart } from '../helpers/lobby-match';

const NAV_TIMEOUT_MS = 20_000;
const CANVAS_TIMEOUT_MS = 15_000;
/** Authored in `apps/tactics/asset-manifest.ts`; both beds share the sheet. */
const AMBIENCE_DURATION_SECONDS = 1.5;
/**
 * Slack on the decoded duration. The bed is matched by buffer length rather than
 * by the bare loop flag so a future looping SFX cannot satisfy this spec on the
 * bed's behalf; the tolerance covers the app AudioContext resampling the clip to
 * the device rate, which `audio-smoke.spec.ts`'s 44.1 kHz offline decode does not.
 */
const DURATION_TOLERANCE_SECONDS = 0.05;

interface LoopingVoiceStart {
    readonly durationSeconds: number;
}

interface LoopingVoiceProbe {
    readonly starts: LoopingVoiceStart[];
}

type ProbeHolder = typeof globalThis & { __ambienceVoiceProbe?: LoopingVoiceProbe };

/**
 * Record every LOOPING buffer source that starts in this window, from now on.
 *
 * Installed while the window sits in the lobby, before the first match, so both
 * matches are measured through one counter — the whole comparison rests on the
 * renderer keeping ONE JS context across `/lobby` → `/game` → `/lobby` → `/game`,
 * which client-side routing gives it. {@link readLoopingVoiceStarts} throws
 * rather than reporting zero if that ever stops holding.
 *
 * `AudioBufferSourceNode` is reached through `globalThis` with a local shape
 * rather than the ambient DOM type: this body is typechecked by the root
 * `tsc --noEmit` program, whose `lib` is ES2022 only.
 */
async function installLoopingVoiceProbe(window: Page): Promise<void> {
    await window.evaluate(() => {
        interface PatchableSource {
            loop: boolean;
            buffer: { duration: number } | null;
        }
        const holder = globalThis as ProbeHolder;
        if (holder.__ambienceVoiceProbe !== undefined) {
            return;
        }

        const prototype = (
            globalThis as unknown as {
                AudioBufferSourceNode: {
                    prototype: { start: (this: PatchableSource, ...args: number[]) => void };
                };
            }
        ).AudioBufferSourceNode.prototype;
        const nativeStart = prototype.start;
        const probe: LoopingVoiceProbe = { starts: [] };
        holder.__ambienceVoiceProbe = probe;

        prototype.start = function patchedStart(this: PatchableSource, ...args: number[]): void {
            // Delegate FIRST and record only on the way back: a `start()` the platform
            // refuses throws, and a voice that never played must not be counted as a
            // bed that did. `loop` and `buffer` are both already set by then —
            // `startVoice` assigns them before it starts the source.
            nativeStart.apply(this, args);
            if (this.loop) {
                probe.starts.push({ durationSeconds: this.buffer?.duration ?? -1 });
            }
        };
    });
}

/** Every looping voice started so far whose buffer is an ambience bed's length. */
async function readAmbienceStarts(window: Page): Promise<LoopingVoiceStart[]> {
    const starts = await window.evaluate(() => {
        const probe = (globalThis as ProbeHolder).__ambienceVoiceProbe;
        if (probe === undefined) {
            throw new Error(
                'the looping-voice probe is gone: this window loaded a new document, so ' +
                    'starts recorded before it are unreachable and no count here is comparable',
            );
        }
        return probe.starts;
    });

    return starts.filter(
        (start) =>
            Math.abs(start.durationSeconds - AMBIENCE_DURATION_SECONDS) <
            DURATION_TOLERANCE_SECONDS,
    );
}

test.describe('Ambience across a match boundary', () => {
    test('the bed starts again in a second match opened in the same session', async ({
        hostWindow,
        clientWindow,
    }) => {
        test.slow();

        const hostLobby = new LobbyPage(hostWindow);
        const clientLobby = new LobbyPage(clientWindow);
        const hostGame = new GamePage(hostWindow);

        await hostLobby.hostLobby();
        await clientLobby.joinLobby(await hostLobby.lobbyCode());
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        // Before the first match, so the opening bed of BOTH matches is measured the
        // same way. Nothing about the beds is asserted per-track: which of calm/tense
        // opens follows the first player, and the bug is about neither playing at all.
        await installLoopingVoiceProbe(hostWindow);

        // ── First match ──────────────────────────────────────────────────────
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
        await expect(hostGame.ambience).toBeAttached({ timeout: CANVAS_TIMEOUT_MS });

        await expect
            .poll(async () => (await readAmbienceStarts(hostWindow)).length, {
                timeout: NAV_TIMEOUT_MS,
            })
            .toBeGreaterThan(0);

        // ── Leave: the host returns everyone to the lobby ────────────────────
        const hostMenu = new InGameMenuPage(hostWindow);
        await hostMenu.openViaEscape();
        await hostMenu.confirmLeave();

        await expect(hostLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await expect(clientLobby.lobbyScreen).toBeVisible({ timeout: NAV_TIMEOUT_MS });
        await hostLobby.waitForPlayerCount(2);
        await clientLobby.waitForPlayerCount(2);

        const startsBeforeSecondMatch = (await readAmbienceStarts(hostWindow)).length;

        // ── Second match from the same lobby ─────────────────────────────────
        await readyAndStart(hostLobby, clientLobby, hostWindow, clientWindow);
        await expect(hostGame.canvas).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
        // The marker the regression left correct — asserted so the count below is
        // read against a mounted <TacticsAmbience>, not a screen that never rendered.
        await expect(hostGame.ambience).toBeAttached({ timeout: CANVAS_TIMEOUT_MS });

        await expect
            .poll(async () => (await readAmbienceStarts(hostWindow)).length, {
                timeout: NAV_TIMEOUT_MS,
            })
            .toBeGreaterThan(startsBeforeSecondMatch);
    });
});
