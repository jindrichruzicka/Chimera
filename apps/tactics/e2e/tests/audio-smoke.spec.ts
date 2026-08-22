/**
 * audio-smoke.spec.ts
 * §4.25 Audio System → Cue, Fade & Crossfade Extensions
 *
 * The feature-review gate's end-to-end proof that Tactics' adoption of cue
 * sheets and the bed swap works in the real runtime, not just against doubles.
 *
 * No spec can hear sound, so this one asserts the three things that are actually
 * observable and that together make silence the only remaining failure:
 *
 *   1. **The clips are reachable and decodable.** Both ambience beds are fetched
 *      through the real `chimera://` game-asset protocol and decoded by the real
 *      browser decoder, and the DECODED duration is compared against the
 *      `durationSeconds` their cue sheets author. Nothing else measures those two
 *      against each other: `validate-assets` range-checks each cue against the
 *      sheet's own `durationSeconds` (Invariant #125) and so cannot notice a sheet
 *      that is self-consistent but wrong about the file, while the renderer clamps
 *      against the decoded buffer — a disagreement mis-times every cue silently.
 *      `music/` is also a directory no Tactics asset used before, so this doubles
 *      as the protocol-serves-it check.
 *   2. **The turn signal reaches both beds.** The bed follows the turn, so ending a
 *      turn puts the two windows through the swap in opposite directions.
 *      `data-track` is the marker `<TacticsAmbience>` renders for exactly this — the
 *      bed the turn calls for. That the swap is then DEFERRED to the bed's own cue
 *      rather than cutting across the phrase is a different claim, on a different
 *      marker, and it belongs to `ambience-cue-aligned.spec.ts`.
 *   3. **Nothing degraded on the way.** Cue resolution is fail-soft by design
 *      (Invariant #118): an unresolvable `{ name }`, or a `from` past the buffer,
 *      abandons the play with ONE warning and playback simply continues silent.
 *      That is invisible to (2) — the marker is rendered from the prop, so it flips
 *      whether or not a voice ever started. The warning is the only trace, so the
 *      spec reads the main-process log through the renderer bridge and requires it
 *      to be clean.
 *
 * Assertion (3) alone would pass vacuously against a component that never mounted;
 * (1) and (2) are what make it non-vacuous.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

/** Authored in `apps/tactics/asset-manifest.ts`; both beds share the sheet. */
const AMBIENCE_DURATION_SECONDS = 1.5;

const AMBIENCE_REFS = [
    'tactics/audio/music/ambience-calm.wav',
    'tactics/audio/music/ambience-tense.wav',
] as const;

interface DecodeProbe {
    readonly ok: boolean;
    readonly status: number;
    readonly byteLength: number;
    readonly duration: number;
    readonly sampleRate: number;
    readonly error: string | null;
}

interface LoggedEntry {
    readonly level: string;
    readonly message: string;
}

/** Fetch a game asset over `chimera://` and decode it, all inside the renderer. */
async function probeDecodedClip(window: Page, ref: string): Promise<DecodeProbe> {
    return window.evaluate<DecodeProbe, string>(async (assetRef: string) => {
        try {
            const response = await fetch(`chimera://renderer/game-assets/${assetRef}`);
            const bytes = await response.arrayBuffer();
            // OfflineAudioContext rather than AudioContext: decoding needs no output
            // device and no autoplay gesture, so this measures the file and nothing
            // about the window's audio permissions.
            //
            // Reached through `globalThis` with a local shape rather than the ambient
            // DOM type: this body is typechecked by the root `tsc --noEmit` program,
            // whose `lib` is ES2022 only — the same reason the logging spec casts its
            // way to `window.__chimera`.
            const OfflineAudioCtor = (
                globalThis as unknown as {
                    OfflineAudioContext: new (
                        channels: number,
                        length: number,
                        sampleRate: number,
                    ) => {
                        decodeAudioData(data: ArrayBuffer): Promise<{
                            duration: number;
                            sampleRate: number;
                        }>;
                    };
                }
            ).OfflineAudioContext;
            const decoded = await new OfflineAudioCtor(1, 1, 44100).decodeAudioData(bytes.slice(0));
            return {
                ok: response.ok,
                status: response.status,
                byteLength: bytes.byteLength,
                duration: decoded.duration,
                sampleRate: decoded.sampleRate,
                error: null,
            };
        } catch (error) {
            return {
                ok: false,
                status: -1,
                byteLength: -1,
                duration: -1,
                sampleRate: -1,
                error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            };
        }
    }, ref);
}

/**
 * One window's log. Host and client are separate Electron applications, so each has
 * its own main process and its own memory sink — a window can only be asked about
 * itself, and checking one says nothing about the other.
 */
const LOG_READ_LIMIT = 500;

async function readWindowLog(window: Page): Promise<LoggedEntry[]> {
    return window.evaluate<LoggedEntry[], number>(async (limit: number) => {
        const api = (
            globalThis as unknown as {
                __chimera: { logs: { readRecent(n: number): Promise<LoggedEntry[]> } };
            }
        ).__chimera.logs;
        return api.readRecent(limit);
    }, LOG_READ_LIMIT);
}

/**
 * Emit a marker through the renderer console bridge and hand back its text.
 *
 * The probe proves the **bridge is live**: a renderer whose console patch never
 * installed forwards nothing, and `readRecent` then returns a log with no audio
 * warning in it for the least interesting reason — which the emptiness assertion
 * below cannot tell apart from a clean run.
 *
 * It is NOT a non-truncation proof, and deliberately does not claim to be. The bed
 * starts with the game screen, which the fixture waits for before any test body
 * runs, so the `play()` that emits #118's fail-soft warnings has already happened by
 * the time the marker is dropped. What holds the truncation risk down is the read
 * size against the session length, not the marker's position.
 *
 * The text deliberately does not start with `audio`, so the probe cannot satisfy the
 * very filter it exists to make meaningful.
 */
async function dropLogProbe(window: Page, role: string): Promise<string> {
    const marker = `[smoke-probe] ${role} bridge live`;
    await window.evaluate((text: string) => {
        console.warn(text);
    }, marker);
    return marker;
}

/**
 * Warnings and errors from the audio layer.
 *
 * Matched on a **prefix**, because that is what the layer actually shares: every
 * warning `renderer/audio` emits begins with the literal `Audio ` — the rejected
 * play window, the unresolvable loop region, the dropped play bound, the
 * `fadeOut`/voice stop that could not be scheduled, the skipped linked fade-out a
 * failed crossfade leaves behind. `audioCueSheet.ts` calls no logger at all; it
 * returns its warning text for `AudioManager` to print, under that same prefix. The
 * one audio warning raised elsewhere is `Providers`' noop-manager fallback, which
 * names `AudioManager` rather than leading with it, so it gets its own clause —
 * without it the whole spec could pass against a window with no real audio at all.
 *
 * Matching a bare `cue` or an `[AudioManager]`-style tag instead would be narrower
 * than the layer it is meant to cover, and a filter narrower than its subject turns
 * this assertion back into a vacuous one.
 */
function audioComplaints(entries: readonly LoggedEntry[]): LoggedEntry[] {
    return entries.filter((entry) => {
        if (entry.level !== 'warn' && entry.level !== 'error' && entry.level !== 'fatal') {
            return false;
        }
        const message = entry.message.toLowerCase();
        return message.startsWith('audio') || message.includes('audiomanager');
    });
}

test.describe('Audio smoke — cue sheet + bed swap', () => {
    test('both ambience beds decode to the duration their cue sheets author', async ({
        hostWindow,
    }) => {
        for (const ref of AMBIENCE_REFS) {
            const probe = await probeDecodedClip(hostWindow, ref);

            expect(probe.error, `${ref} failed to fetch or decode`).toBeNull();
            expect(probe.ok, `${ref} was not served over chimera://`).toBe(true);
            expect(probe.byteLength).toBeGreaterThan(0);
            // The claim the build gate structurally cannot check.
            expect(
                probe.duration,
                `${ref} decoded duration disagrees with its cue sheet`,
            ).toBeCloseTo(AMBIENCE_DURATION_SECONDS, 5);
        }
    });

    test('the turn signal reaches the bed in both windows when the turn passes', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);

        // The host moves first, so it opens calm and the client opens tense. Asserting
        // BOTH sides makes this a statement about the turn signal rather than about
        // one window's mount order.
        await expect(hostGame.ambience).toHaveAttribute('data-track', 'calm');
        await expect(clientGame.ambience).toHaveAttribute('data-track', 'tense');

        await hostGame.endTurnButton.click();

        // Each window's bed is called in the opposite direction — driven by the projected
        // snapshot, not by who clicked. WHEN the handover then happens is
        // `ambience-cue-aligned.spec.ts`'s claim, not this one's.
        await expect(hostGame.ambience).toHaveAttribute('data-track', 'tense');
        await expect(clientGame.ambience).toHaveAttribute('data-track', 'calm');
    });

    test('no cue resolved fail-soft while the beds started and the turn passed', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);
        const windows = [
            { role: 'host', window: hostWindow },
            { role: 'client', window: clientWindow },
        ] as const;

        // One marker per window: the two are separate Electron applications with
        // separate sinks, so a live bridge in one says nothing about the other.
        const probes = new Map<string, string>();
        for (const { role, window } of windows) {
            probes.set(role, await dropLogProbe(window, role));
        }

        await expect(hostGame.ambience).toHaveAttribute('data-track', 'calm');
        await hostGame.endTurnButton.click();
        await expect(hostGame.ambience).toHaveAttribute('data-track', 'tense');
        await expect(clientGame.ambience).toHaveAttribute('data-track', 'calm');

        // Both windows, separately: each Electron application has its own main process
        // and its own sink, and the client is the one that opens on the TENSE bed, so
        // reading only the host would leave half the scenario unchecked.
        for (const { role, window } of windows) {
            const entries = await readWindowLog(window);

            expect(
                entries.map((entry) => entry.message),
                `${role}: the probe never came back, so this window's renderer log bridge is not forwarding — the emptiness assertion below would pass on an empty log for that reason alone`,
            ).toContain(probes.get(role));

            expect(
                audioComplaints(entries).map((entry) => `${entry.level}: ${entry.message}`),
                `${role} logged an audio warning — a cue degraded rather than resolving`,
            ).toEqual([]);
        }
    });
});
