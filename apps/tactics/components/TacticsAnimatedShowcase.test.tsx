// @vitest-environment jsdom

/**
 * apps/tactics/components/TacticsAnimatedShowcase.test.tsx
 *
 * The clip-player adoption, driven frame by frame against REAL `three` objects
 * through `@react-three/test-renderer` — the same harness the other in-canvas
 * tactics components use, and the only one that can advance a `useFrame` chain.
 *
 * What is asserted here, and what deliberately is not:
 *
 *   - the marker CALL LIST across a scripted frame sequence, with the
 *     `passage-end` reason recorded. A boolean "it fired" would pass for a
 *     passage that opened twice, or one that closed for the wrong reason;
 *   - that unmounting mid-passage closes the open passage exactly once, as
 *     `'released'` — the teardown path, on a SINGLE mount;
 *   - that NOTHING dispatches (Invariant #132), asserted the only way it is
 *     assertable here. MEASURED: a game screen receives `sendAction` as a PROP
 *     from `GameScreenRegistry` — there is no `useSendAction` a game may import
 *     — so a mocked dispatcher hook would be a spy nothing could ever call, and
 *     an empty call list on it would prove nothing at all. What is checked
 *     instead is the two things that are real: the marker events carry no
 *     dispatcher-shaped field, and neither this component nor the screen that
 *     mounts it NAMES a dispatch API. The prohibition is a missing parameter,
 *     so the test is about parameters.
 *
 * The clip itself is a real `AnimationClip` built here rather than the committed
 * `.glb`: this suite is about the wiring, and loading a container would make it
 * a test of the loader. The manifest sheet's agreement with the real container
 * is `apps/tactics/asset-manifest.test.ts`.
 *
 * ## What this suite cannot reach: a StrictMode double mount
 *
 * MEASURED against `@react-three/test-renderer@9.1.0` in this file's own
 * environment, with a control: an effect logs `['setup']` before unmount both
 * with and without `<React.StrictMode>` wrapping the element handed to
 * `create()`, while `@testing-library/react`'s `render` in the same file logs
 * `['setup', 'cleanup', 'setup']`. React 19 simulates the double mount only for
 * the element handed to `root.render`, and `create()` renders what it is given
 * INSIDE its own root — so StrictMode lands one level down, which
 * `renderer/components/r3f/useClipPlayer.test.tsx` records as the same trap.
 * The renderer exposes no strict-mode option to reach it either.
 *
 * So the double mount is proved where it can be: that suite drives
 * `useClipPlayer` through a real one. This suite mounts once, and says so.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import {
    AnimationClip,
    Object3D,
    QuaternionKeyframeTrack,
    type AnimationClip as AnimationClipType,
} from 'three';
import { describe, expect, it } from 'vitest';

import type { ModelInstance } from '@chimera-engine/renderer/assets';
import type { ModelAnimationMetadata } from '@chimera-engine/simulation/content/animationManifest.js';

import { TacticsAnimatedShowcase } from './TacticsAnimatedShowcase.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const CLIP_NAME = 'wave';
const DURATION_SECONDS = 1;

/**
 * A second clip on the same bone, so a case can change the DECLARED clip —
 * which is the only thing the real screen's toggle changes, and what restarts
 * the frame recording.
 */
const OTHER_CLIP_NAME = 'hold';

/**
 * The sheet under test, authored to the same shape the manifest ships: one
 * notify at the half-second, and one phase passage spanning the middle half.
 */
const SHEET: ModelAnimationMetadata = {
    clips: {
        [CLIP_NAME]: {
            durationSeconds: DURATION_SECONDS,
            loop: 'once',
            notifies: { crest: { at: { seconds: 0.5 } } },
            passages: {
                swing: { from: 0.25, to: 0.75, beatWindow: [5, 15], window: 'showcase-swing' },
            },
        },
        [OTHER_CLIP_NAME]: { durationSeconds: DURATION_SECONDS, loop: 'once' },
    },
};

/**
 * The same sheet with the played clip LOOPING, so the bone keeps moving for as
 * many frames as a case cares to advance. `SHEET`'s `once` holds the final pose
 * after a second, and a held pose is exactly what the recording collapses.
 */
const LOOPING_SHEET: ModelAnimationMetadata = {
    clips: {
        [CLIP_NAME]: { durationSeconds: DURATION_SECONDS, loop: 'loop' },
        [OTHER_CLIP_NAME]: { durationSeconds: DURATION_SECONDS, loop: 'once' },
    },
};

/** A rigged root carrying one real, one-second clip on a `top` bone. */
function makeInstance(): ModelInstance {
    const root = new Object3D();
    root.name = 'showcase-rig-animated';
    const bone = new Object3D();
    bone.name = 'top';
    root.add(bone);

    const track = new QuaternionKeyframeTrack(
        `${bone.name}.quaternion`,
        [0, DURATION_SECONDS],
        [0, 0, 0, 1, 0, 0, 0.17364817766693033, 0.984807753012208],
    );
    const clip: AnimationClipType = new AnimationClip(CLIP_NAME, DURATION_SECONDS, [track]);
    // A second clip holding the bone still, so declaring it is a real clip
    // change the player can act on rather than a name nothing resolves.
    const otherTrack = new QuaternionKeyframeTrack(
        `${bone.name}.quaternion`,
        [0, DURATION_SECONDS],
        [0, 0, 0.5, 0.8660254037844387, 0, 0, 0.5, 0.8660254037844387],
    );
    const otherClip: AnimationClipType = new AnimationClip(OTHER_CLIP_NAME, DURATION_SECONDS, [
        otherTrack,
    ]);

    return { root, clips: [clip, otherClip] };
}

interface RecordedMarker {
    readonly kind: string;
    readonly mark: string;
    readonly reason?: string;
}

/**
 * `source` with its block and line comments removed, so the dispatch scan reads
 * CODE rather than the prose explaining why there is none.
 *
 * Crude on purpose, and crude in a KNOWN direction: it has no notion of string
 * or regex literals, so a `//` inside one is eaten and a `/*` inside one eats
 * forward to the next close. Neither of the two files it is pointed at holds
 * either, and the caller's floors would catch a strip that removed the
 * component's own name. Widening it to a real tokenizer would be a parser this
 * suite has no other use for.
 */
function codeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

/**
 * Advance `frames` REAL frames on `renderer`, one at a time.
 *
 * MEASURED against `@react-three/test-renderer@9.1.0`: its `advanceFrames(n, δ)`
 * loops SUBSCRIBERS on the outside and frames on the inside, so it runs the clip
 * player n times, then the mixer n times, then this component's writer n times —
 * the last of those against a scene that is already n frames old. Every sample
 * such a call produces is the same one, which is invisible to a case reading
 * only the final value and fatal to one reading a series. Only
 * `advanceFrames(1, δ)` in a loop interleaves the three the way a frame loop
 * does.
 */
async function stepFrames(
    renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
    frames: number,
    delta: number,
): Promise<void> {
    for (let frame = 0; frame < frames; frame += 1) {
        await renderer.advanceFrames(1, delta);
    }
}

/** The samples carried by one recording attribute, in the order they were taken. */
function recorded(element: HTMLElement, key: string): string[] {
    const raw = element.dataset[key] ?? '';
    return raw === '' ? [] : raw.split(',');
}

/**
 * `values` with consecutive repeats collapsed — what a recording keeps.
 *
 * A repeat visits no rotation the entry before it did not, so dropping one
 * loses nothing a reader asking "was this value ever posed" can use, and it is
 * what keeps a held pose from filling the recording's cap.
 */
function withoutRepeats(values: readonly string[]): string[] {
    return values.filter((value, index) => value !== values[index - 1]);
}

function recorder(): { events: RecordedMarker[]; handlers: Record<string, unknown> } {
    const events: RecordedMarker[] = [];
    return {
        events,
        handlers: {
            onNotify: (event: { name: string }) =>
                events.push({ kind: 'notify', mark: event.name }),
            onPassageStart: (event: { name: string }) =>
                events.push({ kind: 'passage-start', mark: event.name }),
            onPassageEnd: (event: { name: string; reason: string }) =>
                events.push({ kind: 'passage-end', mark: event.name, reason: event.reason }),
        },
    };
}

describe('TacticsAnimatedShowcase', () => {
    it('fires the notify once and opens and closes the passage exactly once', async () => {
        const { events, handlers } = recorder();
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
                handlers={handlers}
            />,
        );

        try {
            // Ten frames of 0.12 s: past the passage's 0.25→0.75 span and past
            // the clip's end, so the whole mark set is crossed once.
            await renderer.advanceFrames(10, 0.12);

            expect(events).toEqual([
                { kind: 'passage-start', mark: 'swing' },
                { kind: 'notify', mark: 'crest' },
                { kind: 'passage-end', mark: 'swing', reason: 'reached-end' },
            ]);
        } finally {
            await renderer.unmount();
        }
    });

    it('hands its handlers events that carry no dispatcher (Invariant #132)', async () => {
        // The runtime half. A marker event is the ONLY thing this component
        // gives a game handler, so the prohibition holds exactly as long as
        // nothing dispatch-shaped rides on one — asserted as the exact key set,
        // not as an absence check that a renamed field would slip past.
        const received: Record<string, unknown>[] = [];
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
                handlers={{
                    onNotify: (event: object) => received.push({ ...event }),
                    onPassageStart: (event: object) => received.push({ ...event }),
                    onPassageTick: (event: object) => received.push({ ...event }),
                    onPassageEnd: (event: object) => received.push({ ...event }),
                    onClipEnd: (event: object) => received.push({ ...event }),
                }}
            />,
        );

        try {
            await renderer.advanceFrames(10, 0.12);
        } finally {
            await renderer.unmount();
        }

        // Floor: an empty list would satisfy every key assertion below.
        expect(received.length).toBeGreaterThan(3);
        const KNOWN_KEYS = new Set(['kind', 'name', 'reason', 'window', 'progress']);
        for (const event of received) {
            expect(Object.keys(event).filter((key) => !KNOWN_KEYS.has(key))).toEqual([]);
        }
    });

    it('names no dispatch API, here or on the screen that mounts it', () => {
        // The structural half, and the one that survives a refactor: Invariant
        // #131 is enforced by a MISSING PARAMETER, so what must stay true is
        // that neither module can reach one. Read as source, because a runtime
        // spy on a hook a game cannot import would be a spy nothing calls.
        const files = [
            path.join(here, 'TacticsAnimatedShowcase.tsx'),
            path.join(here, '..', 'screens', 'TacticsModelShowcaseScreen.tsx'),
        ];
        const sources = files.map((file) => codeOf(readFileSync(file, 'utf8')));

        // Two floors, because both halves can fail silently. A mistyped path
        // would read as an empty string; a comment stripper that ate the code
        // would leave one too. Both files must still carry their own name, and
        // the stripper must really have removed the prose — this module's
        // header says "Nothing here dispatches", which is exactly the sentence
        // a naive scan would trip over.
        for (const source of sources) expect(source).toContain('TacticsAnimatedShowcase');
        expect(sources[0]).not.toContain('Nothing here dispatches');

        for (const source of sources) {
            for (const forbidden of ['sendAction', 'useSendAction', 'dispatch', 'EngineAction']) {
                expect(source, forbidden).not.toContain(forbidden);
            }
        }
    });

    it('records nothing on a handler set that is absent entirely', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
            />,
        );

        try {
            // The optional-handlers path: every forwarder must tolerate the
            // absent set, or the first marker throws inside the frame loop.
            await expect(renderer.advanceFrames(10, 0.12)).resolves.not.toThrow();
        } finally {
            await renderer.unmount();
        }
    });

    it("closes an open passage exactly once, as 'released', when unmounted mid-passage", async () => {
        // A single mount, deliberately — see the header for why this suite
        // cannot reach a StrictMode double mount at all. What is asserted is
        // still the teardown a double mount exercises twice: exactly ONE
        // `'released'`, so a `ClipPlayer` whose dispose left a scheduler alive
        // behind it would report two.
        const { events, handlers } = recorder();
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
                handlers={handlers}
            />,
        );

        // Three frames of 0.12 s lands at 0.36 s — inside the 0.25→0.75 span,
        // so the passage is open when the teardown runs.
        await renderer.advanceFrames(3, 0.12);
        expect(events).toEqual([{ kind: 'passage-start', mark: 'swing' }]);

        await renderer.unmount();

        expect(events.filter((event) => event.kind === 'passage-end')).toEqual([
            { kind: 'passage-end', mark: 'swing', reason: 'released' },
        ]);
    });

    it('advances the played bone and leaves the control bone alone', async () => {
        // The property the e2e reads off the DOM, asserted here on the scene
        // graph: same model, same frames, one driver each — only the clip-player
        // instance moves.
        const played = makeInstance();
        const control = makeInstance();
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={played}
                controlInstance={control}
                sheet={SHEET}
                clip={CLIP_NAME}
            />,
        );

        try {
            await renderer.advanceFrames(5, 0.1);

            expect(played.root.getObjectByName('top')?.rotation.z).not.toBe(0);
            expect(control.root.getObjectByName('top')?.rotation.z).toBe(0);
        } finally {
            await renderer.unmount();
        }
    });

    it('places the animated pair in the RIGHT half of the frustum, clear of the seam pair', async () => {
        // The camera frustum was widened from ±2.4 to ±3.4 precisely to hold
        // this pair, and nothing else pins where it lands: the e2e reads DOM
        // attributes rather than pixels, so both quads could drift onto the seam
        // pair — or off-frustum entirely — with every other case green.
        //
        // The seam pair holds x -2.55 and -0.85 (`TacticsModelShowcase`), so
        // these two continue the same 1.7 spacing rightwards and stay inside
        // ±3.4 with their own half-width of 0.45.
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
            />,
        );

        try {
            const positions = renderer.scene.children.map(
                (child) => (child.instance as { position: { x: number } }).position.x,
            );

            expect(positions).toEqual([0.85, 2.55]);
            for (const x of positions) {
                expect(Math.abs(x) + 0.45).toBeLessThanOrEqual(3.4);
            }
        } finally {
            await renderer.unmount();
        }
    });

    it('mounts nothing while both instances are still loading', async () => {
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={null}
                controlInstance={null}
                sheet={null}
                clip={null}
            />,
        );

        try {
            // Both hooks still register their frame subscribers — rules of
            // hooks — so advancing must be inert rather than throwing.
            await expect(renderer.advanceFrames(3, 0.1)).resolves.not.toThrow();
            expect(renderer.scene.children).toHaveLength(0);
        } finally {
            await renderer.unmount();
        }
    });

    it('writes the frame-sampled facts onto the status node it is given', async () => {
        const element = document.createElement('div');
        const statusRef = { current: element };
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
                statusRef={statusRef}
            />,
        );

        try {
            await renderer.advanceFrames(10, 0.12);

            expect(element.dataset['clipNotifies']).toBe('1');
            expect(element.dataset['clipPassageStarts']).toBe('1');
            expect(element.dataset['clipPassageEnds']).toBe('1');
            expect(element.dataset['clipPassageEndReason']).toBe('reached-end');
            expect(element.dataset['clipControlBoneZ']).toBe('0.0000');
        } finally {
            await renderer.unmount();
        }
    });

    it('records the same rotation series a reader that missed no frame would see', async () => {
        // The reason the recording exists: a value the bone passes THROUGH
        // between two outside reads is a value an outside reader cannot see at
        // all. What is pinned is that the recording holds what a reader who
        // never missed a frame would have got, so nothing can fall between two
        // of its entries.
        const element = document.createElement('div');
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
                statusRef={{ current: element }}
            />,
        );

        try {
            // One frame at a time, reading the LIVE attribute after each: this
            // is the series an outside reader could only get by sampling on
            // exactly these instants and never missing one.
            const perFrame: string[] = [];
            for (let frame = 0; frame < 8; frame += 1) {
                await stepFrames(renderer, 1, 0.1);
                perFrame.push(element.dataset['clipPlayedBoneZ'] ?? '');
            }

            // Two floors. The bone really moved across these frames, so the
            // equality below is not one repeated value compared with itself —
            // and no two of them repeat, which is what makes that equality
            // EXACT rather than one the collapse could have paid for. The
            // collapse has its own case below.
            expect(new Set(perFrame).size).toBeGreaterThan(4);
            expect(withoutRepeats(perFrame)).toEqual(perFrame);
            expect(recorded(element, 'clipPlayedBoneZRecording')).toEqual(perFrame);
        } finally {
            await renderer.unmount();
        }
    });

    it('records the control bone as a single at-rest sample for the whole run', async () => {
        // Stronger than the two instants an e2e can read from outside, and in
        // the way that matters: a control that moved during a transition and
        // came back would land a second sample here, where two point reads on
        // either side of the transition see nothing.
        const element = document.createElement('div');
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={SHEET}
                clip={CLIP_NAME}
                statusRef={{ current: element }}
            />,
        );

        try {
            await stepFrames(renderer, 8, 0.1);

            expect(recorded(element, 'clipControlBoneZRecording')).toEqual(['0.0000']);
        } finally {
            await renderer.unmount();
        }
    });

    it('restarts the recording, and names the new clip, when the declared clip changes', async () => {
        // What scopes the recording to ONE ask. Without it the samples an e2e
        // reads after a toggle would still carry everything the previous clip
        // posed, and no reader could tell which transition produced what.
        const played = makeInstance();
        const control = makeInstance();
        const element = document.createElement('div');
        const statusRef = { current: element };
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={played}
                controlInstance={control}
                sheet={SHEET}
                clip={CLIP_NAME}
                statusRef={statusRef}
            />,
        );

        try {
            await stepFrames(renderer, 6, 0.1);

            // Floor: the window BEFORE the change is longer than the one after
            // it, so a recording that never restarted could not satisfy the
            // length assertion below.
            expect(recorded(element, 'clipPlayedBoneZRecording').length).toBeGreaterThan(2);
            expect(element.dataset['clipRecordingClip']).toBe(CLIP_NAME);

            await renderer.update(
                <TacticsAnimatedShowcase
                    playedInstance={played}
                    controlInstance={control}
                    sheet={SHEET}
                    clip={OTHER_CLIP_NAME}
                    statusRef={statusRef}
                />,
            );
            await stepFrames(renderer, 2, 0.1);

            expect(element.dataset['clipRecordingClip']).toBe(OTHER_CLIP_NAME);
            // ONE, not "at most two": `hold` authors no blend length, so the
            // change cuts and both frames after it pose the same rotation. A
            // bound with slack in it would be satisfied by a restart that left a
            // stale entry behind.
            expect(recorded(element, 'clipPlayedBoneZRecording')).toHaveLength(1);
        } finally {
            await renderer.unmount();
        }
    });

    it('leaves a frame with no bone to read out of the series entirely', async () => {
        // The route really produces those frames: the screen hands this
        // component its status node from the first render, while both instances
        // are still `null` — so `boneRotationZ` answers '' and the recorder is
        // asked to take it. An '' TAKEN is a sample a reader parses as 0, and 0
        // is a rotation the rig genuinely poses, so it cannot be told from a
        // bone at rest.
        const element = document.createElement('div');
        const statusRef = { current: element };
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={null}
                controlInstance={null}
                sheet={null}
                clip={CLIP_NAME}
                statusRef={statusRef}
            />,
        );

        try {
            await stepFrames(renderer, 3, 0.1);
            expect(recorded(element, 'clipPlayedBoneZRecording')).toEqual([]);

            await renderer.update(
                <TacticsAnimatedShowcase
                    playedInstance={makeInstance()}
                    controlInstance={makeInstance()}
                    sheet={SHEET}
                    clip={CLIP_NAME}
                    statusRef={statusRef}
                />,
            );
            await stepFrames(renderer, 3, 0.1);

            // The series OPENS on a real rotation. Read this way rather than as
            // an index, because the empty samples are at the head: a recorder
            // that took them would answer `['', '0.0035', …]` here.
            const series = recorded(element, 'clipPlayedBoneZRecording');
            expect(series.length).toBeGreaterThan(0);
            expect(series).toEqual(series.filter((sample) => sample !== ''));
        } finally {
            await renderer.unmount();
        }
    });

    it('caps the recording by dropping the frames AFTER the cap, never the ones before', async () => {
        // The route can be left open for as long as a spec runs, and a clip
        // that keeps moving writes a new sample every frame — so the recording
        // needs a bound. Which END it drops is the load-bearing half: a
        // transition happens at the START of a recording, so a bound that
        // dropped the oldest entries would throw away the only frames anything
        // reads it for.
        const element = document.createElement('div');
        const renderer = await ReactThreeTestRenderer.create(
            <TacticsAnimatedShowcase
                playedInstance={makeInstance()}
                controlInstance={makeInstance()}
                sheet={LOOPING_SHEET}
                clip={CLIP_NAME}
                statusRef={{ current: element }}
            />,
        );

        try {
            await stepFrames(renderer, 20, 0.01);
            const opening = recorded(element, 'clipPlayedBoneZRecording')[0];
            expect(opening).toBeDefined();

            // Well past the cap: the clip LOOPS, so every one of these frames
            // moves the bone and nothing here is collapsed away.
            await stepFrames(renderer, 1300, 0.01);

            const full = recorded(element, 'clipPlayedBoneZRecording');
            expect(full).toHaveLength(600);
            expect(full[0]).toBe(opening);
        } finally {
            await renderer.unmount();
        }
    });
});
