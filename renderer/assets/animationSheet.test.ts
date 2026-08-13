/**
 * renderer/assets/animationSheet.test.ts
 *
 * Holds the fail-soft contract of the two sheet readers.
 *
 * Three properties are worth naming, because each is the one a plausible
 * rewrite would drop:
 *
 * - **Nothing is logged.** Every case below reads warnings off the RETURN
 *   value; no console spy appears anywhere in the file, so a reader that
 *   started logging would pass every assertion here and the count would stop
 *   being a property of the value.
 * - **The input is not touched.** Each mutation-shaped case clones its input
 *   before the call and compares afterwards, which is what makes "freshly
 *   built" mean something beyond `not.toBe`.
 * - **Positions are carried, never inspected.** The cases that hand a reader a
 *   nonsense `at` assert the mark SURVIVES with the value intact rather than
 *   that it is refused; `renderer/animation/ClipPosition.ts` resolves them.
 */

import { describe, expect, it } from 'vitest';

import { parseModelAnimationMetadata, parseSpriteAnimationMetadata } from './animationSheet.js';

describe('parseModelAnimationMetadata refuses anything that is not a clip map', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'clips'],
        ['a number', 4],
        ['an array', [{ clips: {} }]],
        ['an object with no clips', { clipTracks: 3 }],
        ['a clips value that is not an object', { clips: 3 }],
        ['a clips value that is an array', { clips: [] }],
    ])('returns null for %s', (_label, metadata) => {
        expect(parseModelAnimationMetadata(metadata)).toBeNull();
    });

    it('accepts an empty clip map — a manifest may declare a sheet it has not filled in', () => {
        expect(parseModelAnimationMetadata({ clips: {} })).toEqual({
            sheet: { clips: {} },
            warnings: [],
        });
    });
});

describe('parseModelAnimationMetadata rebuilds what it returns', () => {
    const input = {
        version: 7,
        clips: {
            swing: {
                durationSeconds: 1.2,
                frameCount: 8,
                loop: 'once',
                unknownClipKey: 'dropped',
                notifies: { woosh: { at: 0.25, unknownNotifyKey: 1 } },
                passages: {
                    strike: {
                        from: 0.1,
                        to: 0.5,
                        beatWindow: [2, 11],
                        window: 'melee-hit',
                        unknownPassageKey: 1,
                    },
                },
            },
        },
    };

    it('drops unknown keys at the sheet, clip, notify and passage levels', () => {
        const result = parseModelAnimationMetadata(input);

        expect(result?.sheet).toEqual({
            clips: {
                swing: {
                    durationSeconds: 1.2,
                    frameCount: 8,
                    loop: 'once',
                    notifies: { woosh: { at: 0.25 } },
                    passages: {
                        strike: { from: 0.1, to: 0.5, beatWindow: [2, 11], window: 'melee-hit' },
                    },
                },
            },
        });
        expect(result?.warnings).toEqual([]);
    });

    it('shares no object with the input except the authored positions', () => {
        const result = parseModelAnimationMetadata(input);
        const clip = result?.sheet.clips?.['swing'];

        expect(result?.sheet).not.toBe(input);
        expect(result?.sheet.clips).not.toBe(input.clips);
        expect(clip).not.toBe(input.clips.swing);
        expect(clip?.notifies).not.toBe(input.clips.swing.notifies);
        expect(clip?.notifies?.['woosh']).not.toBe(input.clips.swing.notifies.woosh);
        expect(clip?.passages).not.toBe(input.clips.swing.passages);
        expect(clip?.passages?.['strike']).not.toBe(input.clips.swing.passages.strike);
        // The one aliasing the reader is allowed: `beatWindow` is rebuilt
        // because both members are checked here, so nothing is carried blind.
        expect(clip?.passages?.['strike']?.beatWindow).not.toBe(
            input.clips.swing.passages.strike.beatWindow,
        );
    });

    it('leaves the input deep-equal to a clone taken before the call', () => {
        const before = structuredClone(input);

        parseModelAnimationMetadata(input);

        expect(input).toEqual(before);
    });
});

describe('parseModelAnimationMetadata returns one warning per unusable mark', () => {
    it('yields exactly two warning strings for two unusable marks, and logs nothing', () => {
        const result = parseModelAnimationMetadata({
            clips: {
                swing: {
                    notifies: { woosh: { when: 0.25 } },
                    passages: { strike: { from: 0.1 } },
                },
            },
        });

        // Asserted on the RETURN value: nothing in this file spies a logger.
        expect(result?.warnings).toHaveLength(2);
        expect(result?.warnings.every((warning) => warning.length > 0)).toBe(true);
        expect(result?.warnings[0]).toContain('woosh');
        expect(result?.warnings[1]).toContain('strike');
    });

    it('keeps the usable siblings of an unusable mark', () => {
        const result = parseModelAnimationMetadata({
            clips: {
                swing: {
                    notifies: { woosh: { at: 0.25 }, broken: null },
                    passages: { strike: { from: 0.1, to: 0.5 }, alsoBroken: 4 },
                },
            },
        });

        expect(result?.sheet.clips?.['swing']?.notifies).toEqual({ woosh: { at: 0.25 } });
        expect(result?.sheet.clips?.['swing']?.passages).toEqual({
            strike: { from: 0.1, to: 0.5 },
        });
        expect(result?.warnings).toHaveLength(2);
    });

    it('drops a clip that is not an object, keeping its siblings, with one warning', () => {
        const result = parseModelAnimationMetadata({
            clips: { swing: { notifies: { woosh: { at: 0.25 } } }, broken: 'nope' },
        });

        expect(Object.keys(result?.sheet.clips ?? {})).toEqual(['swing']);
        expect(result?.warnings).toHaveLength(1);
        expect(result?.warnings[0]).toContain('broken');
    });
});

describe('parseModelAnimationMetadata range-checks only what it can decide alone', () => {
    it.each([
        ['durationSeconds', { durationSeconds: 0 }],
        ['durationSeconds', { durationSeconds: -1 }],
        ['durationSeconds', { durationSeconds: 'long' }],
        ['durationSeconds', { durationSeconds: Number.POSITIVE_INFINITY }],
        ['frameCount', { frameCount: 0 }],
        ['frameCount', { frameCount: 2.5 }],
        ['frameCount', { frameCount: -3 }],
        ['loop', { loop: 'ping-pong' }],
        ['loop', { loop: 1 }],
        ['blendInSeconds', { blendInSeconds: -1 }],
        ['blendInSeconds', { blendInSeconds: 'fast' }],
        ['blendInSeconds', { blendInSeconds: Number.NaN }],
        ['blendInSeconds', { blendInSeconds: Number.POSITIVE_INFINITY }],
    ])('drops a malformed %s with one warning and keeps the clip', (field, clip) => {
        const result = parseModelAnimationMetadata({ clips: { swing: clip } });

        expect(result?.sheet.clips?.['swing']).toEqual({});
        expect(result?.warnings).toHaveLength(1);
        expect(result?.warnings[0]).toContain(field);
    });

    it.each([
        ['not an array', { from: 0, to: 1, beatWindow: 2 }],
        ['a lone bound', { from: 0, to: 1, beatWindow: [2] }],
        ['three bounds', { from: 0, to: 1, beatWindow: [2, 11, 99] }],
        ['non-integer', { from: 0, to: 1, beatWindow: [2, 11.5] }],
        ['negative', { from: 0, to: 1, beatWindow: [-1, 11] }],
        ['empty', { from: 0, to: 1, beatWindow: [4, 4] }],
        ['reversed', { from: 0, to: 1, beatWindow: [11, 2] }],
    ])(
        'drops a beatWindow that is %s, keeping the passage, with one warning',
        (_label, passage) => {
            const result = parseModelAnimationMetadata({
                clips: { swing: { passages: { strike: passage } } },
            });

            expect(result?.sheet.clips?.['swing']?.passages?.['strike']).toEqual({
                from: 0,
                to: 1,
            });
            expect(result?.warnings).toHaveLength(1);
            expect(result?.warnings[0]).toContain('beatWindow');
        },
    );

    it('keeps a beatWindow that opens on beat 0 — a passage may start on the first beat', () => {
        const result = parseModelAnimationMetadata({
            clips: { swing: { passages: { strike: { from: 0, to: 1, beatWindow: [0, 1] } } } },
        });

        expect(result?.sheet.clips?.['swing']?.passages?.['strike']?.beatWindow).toEqual([0, 1]);
        expect(result?.warnings).toEqual([]);
    });

    it.each([
        ['not a string', 4],
        ['empty', ''],
    ])('drops a window id that is %s, keeping the passage, with one warning', (_label, window) => {
        const result = parseModelAnimationMetadata({
            clips: { swing: { passages: { strike: { from: 0, to: 1, window } } } },
        });

        expect(result?.sheet.clips?.['swing']?.passages?.['strike']).toEqual({ from: 0, to: 1 });
        expect(result?.warnings).toHaveLength(1);
        expect(result?.warnings[0]).toContain('window');
    });

    it.each([
        ['a number', 3],
        ['an array', []],
        // `null` on purpose: a reader that leaned on `== null` to spot an
        // absent map would drop this one without saying anything.
        ['null', null],
    ])('drops a notifies map that is %s, with one warning', (_label, notifies) => {
        const result = parseModelAnimationMetadata({ clips: { swing: { notifies } } });

        expect(result?.sheet.clips?.['swing']).toEqual({});
        expect(result?.warnings).toHaveLength(1);
        expect(result?.warnings[0]).toContain('notifies');
    });

    it('warns once per malformed mark map', () => {
        const result = parseModelAnimationMetadata({
            clips: { swing: { notifies: 3, passages: null } },
        });

        expect(result?.sheet.clips?.['swing']).toEqual({});
        expect(result?.warnings).toHaveLength(2);
    });

    it('carries an authored position through unexamined, however nonsensical', () => {
        const at = { seconds: 'soon' };
        const result = parseModelAnimationMetadata({
            clips: { swing: { notifies: { woosh: { at } } } },
        });

        // Carried by reference, and not even shape-checked. See
        // `renderer/animation/ClipPosition.ts`.
        expect(result?.sheet.clips?.['swing']?.notifies?.['woosh']?.at).toBe(at);
        expect(result?.warnings).toEqual([]);
    });
});

describe('parseModelAnimationMetadata carries an authored blend-in length', () => {
    it('keeps a positive blend length on the parsed clip', () => {
        const result = parseModelAnimationMetadata({
            clips: { swing: { durationSeconds: 1.2, blendInSeconds: 0.2 } },
        });

        expect(result?.sheet.clips?.['swing']).toEqual({
            durationSeconds: 1.2,
            blendInSeconds: 0.2,
        });
        expect(result?.warnings).toEqual([]);
    });

    it('keeps a blend length of exactly zero, which authors a cut', () => {
        // The boundary is an explicit fixture rather than something the refusal
        // cases imply: 0 is what an animator writes to say "this clip cuts in",
        // and the positive-number predicate the sibling fields use would drop it
        // with a warning.
        const result = parseModelAnimationMetadata({ clips: { swing: { blendInSeconds: 0 } } });

        expect(result?.sheet.clips?.['swing']).toEqual({ blendInSeconds: 0 });
        expect(result?.warnings).toEqual([]);
    });

    it('keeps the rest of a clip whose blend length it drops', () => {
        const result = parseModelAnimationMetadata({
            clips: { swing: { durationSeconds: 1.2, loop: 'loop', blendInSeconds: -1 } },
        });

        expect(result?.sheet.clips?.['swing']).toEqual({ durationSeconds: 1.2, loop: 'loop' });
        expect(result?.warnings).toHaveLength(1);
        // The CLIP name, not just the field name: an animator reads this message
        // to find which of forty clips they typed the value into.
        expect(result?.warnings[0]).toContain("'swing'");
        expect(result?.warnings[0]).toContain('blendInSeconds');
    });

    it('keeps one authored on a SPRITE clip, which has nothing to honour it', () => {
        const result = parseSpriteAnimationMetadata({
            clips: { run: { frames: [0, 1], durationSeconds: 0.5, blendInSeconds: 0.2 } },
        });

        // The shared sheet is shared: the parser is one reader for both backends
        // and does not learn which one is under it. Nothing warns, because there
        // is nothing wrong with the value — a sprite playback simply has no
        // weights to interpolate, so `supportsBlending` is what declines it.
        expect(result?.sheet.clips?.['run']).toEqual({
            frames: [0, 1],
            durationSeconds: 0.5,
            blendInSeconds: 0.2,
        });
        expect(result?.warnings).toEqual([]);
    });
});

describe('parseModelAnimationMetadata treats every authored name as data', () => {
    it("keeps a clip literally named '__proto__' as an own key and pollutes no prototype", () => {
        const result = parseModelAnimationMetadata(
            JSON.parse('{"clips":{"__proto__":{"durationSeconds":1}}}'),
        );
        const clips = result?.sheet.clips ?? {};

        expect(Object.prototype.hasOwnProperty.call(clips, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(clips)).toBe(Object.prototype);
        expect(({} as { durationSeconds?: number }).durationSeconds).toBeUndefined();
    });
});

describe('parseSpriteAnimationMetadata adds the frame run and nothing else', () => {
    it('keeps a well-formed frame run and drops unknown keys around it', () => {
        const result = parseSpriteAnimationMetadata({
            clips: {
                run: {
                    frames: [0, 1, 2, 1],
                    frameCount: 4,
                    loop: 'loop',
                    unknownClipKey: 1,
                    notifies: { step: { at: { frame: 2 } } },
                },
            },
        });

        expect(result?.sheet.clips?.['run']).toEqual({
            frames: [0, 1, 2, 1],
            frameCount: 4,
            loop: 'loop',
            notifies: { step: { at: { frame: 2 } } },
        });
        expect(result?.warnings).toEqual([]);
    });

    it('rebuilds the frame array rather than aliasing it', () => {
        const frames = [0, 1, 2];
        const result = parseSpriteAnimationMetadata({ clips: { run: { frames } } });

        expect(result?.sheet.clips?.['run']?.frames).toEqual([0, 1, 2]);
        expect(result?.sheet.clips?.['run']?.frames).not.toBe(frames);
    });

    it.each([
        ['absent', {}],
        ['not an array', { frames: { 0: 1 } }],
        ['empty', { frames: [] }],
        ['holding a non-integer', { frames: [0, 1.5] }],
        ['holding a negative index', { frames: [0, -1] }],
        ['holding a non-number', { frames: [0, '1'] }],
    ])('drops a sprite clip whose frame run is %s, with one warning', (_label, clip) => {
        const result = parseSpriteAnimationMetadata({
            clips: { run: clip, walk: { frames: [0] } },
        });

        expect(Object.keys(result?.sheet.clips ?? {})).toEqual(['walk']);
        expect(result?.warnings).toHaveLength(1);
        expect(result?.warnings[0]).toContain('frames');
    });

    it('refuses the same non-sheet inputs the model reader refuses', () => {
        expect(parseSpriteAnimationMetadata(undefined)).toBeNull();
        expect(parseSpriteAnimationMetadata({ clipTracks: 3 })).toBeNull();
        expect(parseSpriteAnimationMetadata({ clips: 'run' })).toBeNull();
    });

    it('leaves the input deep-equal to a clone taken before the call', () => {
        const input = {
            clips: { run: { frames: [0, 1], passages: { dash: { from: 0, to: 1 } } } },
        };
        const before = structuredClone(input);

        parseSpriteAnimationMetadata(input);

        expect(input).toEqual(before);
    });
});
