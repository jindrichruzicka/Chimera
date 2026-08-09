/**
 * renderer/animation/ClipTimeline.test.ts
 *
 * Unit tests for `compileClipTimeline` — the pure compile half of the animation
 * layer. It turns one authored clip sheet into a sorted, phase-denominated mark
 * list the marker scheduler can walk, and reports every authoring problem it
 * found as a returned warning rather than a logged one.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned here:
 *   - `null` is reserved for "there is nothing to play": an absent sheet, an
 *     absent clip, or a clip whose runtime duration is unusable. A sheet whose
 *     every mark is bad compiles to an EMPTY mark list — a different outcome,
 *     because the clip still plays, just unmarked.
 *   - marks are ordered by phase with a lexicographic tie-break, so the JSON key
 *     order of the authored records cannot change what the scheduler sees.
 *   - every range check reads the RUNTIME duration, never the authored one.
 *   - the input is never mutated, and nothing is logged.
 *
 * Not pinned here: the phase VALUES for each authored unit. Those are
 * `resolveClipPosition`'s contract and are pinned in `ClipPosition.test.ts`;
 * this file pins that the timeline consults it with the right context.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
    AnimationTrackSheet,
    ModelAnimationMetadata,
} from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { compileClipTimeline } from './ClipTimeline.js';
import type { CompiledMark } from './ClipTimeline.js';

const CLIP = 'swing';

/** A one-clip mesh sheet, so each case states only the clip body that matters. */
function sheetOf(clip: AnimationTrackSheet): ModelAnimationMetadata {
    return { clips: { [CLIP]: clip } };
}

/** The compiled marks of `clip` at `runtimeDurationSeconds`, or `[]` if it did not compile. */
function marksOf(clip: AnimationTrackSheet, runtimeDurationSeconds = 2): readonly CompiledMark[] {
    return compileClipTimeline(sheetOf(clip), CLIP, runtimeDurationSeconds)?.marks ?? [];
}

describe('compileClipTimeline', () => {
    describe('returns null only when there is nothing to play', () => {
        it.each([
            ['an absent sheet', null],
            ['an undefined sheet', undefined],
        ])('returns null for %s', (_label, sheet) => {
            expect(compileClipTimeline(sheet, CLIP, 2)).toBeNull();
        });

        it('returns null for a sheet that declares no clips at all', () => {
            expect(compileClipTimeline({}, CLIP, 2)).toBeNull();
        });

        it('returns null when the named clip is absent from the sheet', () => {
            expect(compileClipTimeline(sheetOf({}), 'no-such-clip', 2)).toBeNull();
        });

        it.each([
            ['zero', 0],
            ['negative', -1],
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
        ])('returns null for a %s runtime duration', (_label, duration) => {
            // Every phase in the result is a ratio against this number. Letting a
            // zero through would make each ratio Infinity and each clamped phase
            // 1 — a full mark list, all of it at the clip end.
            expect(compileClipTimeline(sheetOf({}), CLIP, duration)).toBeNull();
        });

        it('compiles an EMPTY mark list — not null — when every authored mark is rejected', () => {
            // The distinction the null contract turns on: the clip is present and
            // playable, it just carries no usable mark. A null here would make a
            // caller fall back to "no such clip".
            const timeline = compileClipTimeline(
                sheetOf({ notifies: { hit: { at: { frame: 3 } } } }),
                CLIP,
                2,
            );

            expect(timeline).not.toBeNull();
            expect(timeline?.marks).toEqual([]);
            expect(timeline?.warnings).toHaveLength(1);
        });
    });

    describe('resolves each authored unit against the right context', () => {
        it('compiles a phase, a second and a frame in one clip', () => {
            expect(
                marksOf({
                    durationSeconds: 2,
                    frameCount: 4,
                    notifies: {
                        byPhase: { at: 0.5 },
                        bySecond: { at: { seconds: 1.5 } },
                        byFrame: { at: { frame: 1 } },
                    },
                }),
            ).toEqual([
                { kind: 'notify', name: 'byFrame', phase: 0.25 },
                { kind: 'notify', name: 'byPhase', phase: 0.5 },
                { kind: 'notify', name: 'bySecond', phase: 0.75 },
            ]);
        });

        it('resolves seconds against the RUNTIME duration, not the authored one', () => {
            // The mutation control for the third argument. The authored sheet says
            // the clip is 4s; the loaded clip really is 2s. Substituting the
            // authored value in the source turns 0.5 into 0.25 and reds this.
            const marks = marksOf(
                { durationSeconds: 4, notifies: { hit: { at: { seconds: 1 } } } },
                2,
            );

            expect(marks).toEqual([{ kind: 'notify', name: 'hit', phase: 0.5 }]);
            expect(marks[0]).not.toEqual({ kind: 'notify', name: 'hit', phase: 0.25 });
        });

        it('reports the runtime duration it compiled against', () => {
            expect(
                compileClipTimeline(sheetOf({ durationSeconds: 4 }), CLIP, 2)?.durationSeconds,
            ).toBe(2);
        });

        it('takes frameCount from the SHEET — the runtime duration cannot supply one', () => {
            expect(marksOf({ frameCount: 4, notifies: { hit: { at: { frame: 1 } } } })).toEqual([
                { kind: 'notify', name: 'hit', phase: 0.25 },
            ]);
        });

        it('drops a frame mark on a sheet declaring no frameCount, with exactly one warning, and keeps its siblings', () => {
            const timeline = compileClipTimeline(
                sheetOf({
                    notifies: { ok: { at: 0.5 }, broken: { at: { frame: 3 } } },
                }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([{ kind: 'notify', name: 'ok', phase: 0.5 }]);
            expect(timeline?.warnings).toHaveLength(1);
            expect(timeline?.warnings[0]).toContain('broken');
        });

        it('drops a non-finite second with exactly one warning, and keeps its siblings', () => {
            const timeline = compileClipTimeline(
                sheetOf({
                    notifies: { ok: { at: 0.5 }, broken: { at: { seconds: Number.NaN } } },
                }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([{ kind: 'notify', name: 'ok', phase: 0.5 }]);
            expect(timeline?.warnings).toHaveLength(1);
        });

        it('clamps a phase authored outside [0, 1] instead of dropping it', () => {
            expect(marksOf({ notifies: { early: { at: -1 }, late: { at: 4 } } })).toEqual([
                { kind: 'notify', name: 'early', phase: 0 },
                { kind: 'notify', name: 'late', phase: 1 },
            ]);
        });
    });

    describe('passages', () => {
        it('compiles a passage with its span and its gameplay window', () => {
            expect(
                marksOf({ passages: { swing: { from: 0.2, to: 0.6, window: 'sword-hit' } } }),
            ).toEqual([
                {
                    kind: 'passage',
                    name: 'swing',
                    fromPhase: 0.2,
                    toPhase: 0.6,
                    window: 'sword-hit',
                },
            ]);
        });

        it('omits the window key entirely on a presentation-only passage', () => {
            const [mark] = marksOf({ passages: { flourish: { from: 0.2, to: 0.6 } } });

            expect(mark).toEqual({
                kind: 'passage',
                name: 'flourish',
                fromPhase: 0.2,
                toPhase: 0.6,
            });
            expect(mark).not.toHaveProperty('window');
        });

        it('drops a passage whose end is not after its start, with a warning', () => {
            const timeline = compileClipTimeline(
                sheetOf({ passages: { flat: { from: 0.5, to: 0.5 } } }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([]);
            expect(timeline?.warnings).toHaveLength(1);
            expect(timeline?.warnings[0]).toContain('flat');
        });

        it('drops a loop-wrapping passage rather than splitting it in two', () => {
            // `from` after `to` reads as "wrap past the loop point". Splitting it
            // would emit two passage-start events for one authored passage, and
            // the beat window it may claim has no matching split at all.
            const timeline = compileClipTimeline(
                sheetOf({ passages: { wrap: { from: 0.9, to: 0.1 } } }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([]);
            expect(timeline?.warnings).toHaveLength(1);
            expect(timeline?.warnings[0]).toContain('wrap');
        });

        it('emits at most ONE warning for a passage whose BOTH ends are unresolvable', () => {
            // The short-circuit: `from` is resolved first and a rejection stops
            // the mark there. Two warnings for one authored mark would make the
            // warning count a function of how broken a mark is.
            const timeline = compileClipTimeline(
                sheetOf({ passages: { broken: { from: { frame: 1 }, to: { frame: 2 } } } }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([]);
            expect(timeline?.warnings).toHaveLength(1);
        });

        it('drops a passage whose END alone is unresolvable', () => {
            const timeline = compileClipTimeline(
                sheetOf({ passages: { broken: { from: 0.1, to: { frame: 2 } } } }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([]);
            expect(timeline?.warnings).toHaveLength(1);
        });
    });

    describe('one name, one mark', () => {
        it('lets the passage win a name a notify also claims, and warns', () => {
            // A mark name is the key a handler record is written against, so the
            // same name meaning both `notify` and `passage-start` would make a
            // handler's own type ambiguous. Passages compile after notifies, so
            // which one survives does not depend on JSON key order.
            const timeline = compileClipTimeline(
                sheetOf({
                    notifies: { hit: { at: 0.1 } },
                    passages: { hit: { from: 0.4, to: 0.8 } },
                }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toEqual([
                { kind: 'passage', name: 'hit', fromPhase: 0.4, toPhase: 0.8 },
            ]);
            expect(timeline?.warnings).toHaveLength(1);
            expect(timeline?.warnings[0]).toContain('hit');
        });

        it('keeps a notify whose name no passage claims', () => {
            // The negative control for the collision branch: without it, a
            // resolver that dropped every notify would pass the case above.
            const timeline = compileClipTimeline(
                sheetOf({
                    notifies: { hit: { at: 0.1 } },
                    passages: { swing: { from: 0.4, to: 0.8 } },
                }),
                CLIP,
                2,
            );

            expect(timeline?.marks).toHaveLength(2);
            expect(timeline?.warnings).toEqual([]);
        });
    });

    describe('order is decided once, at compile time', () => {
        it('sorts marks by ascending phase across notifies and passages alike', () => {
            const marks = marksOf({
                notifies: { late: { at: 0.9 }, early: { at: 0.1 } },
                passages: { middle: { from: 0.5, to: 0.7 } },
            });

            expect(marks.map((mark) => mark.name)).toEqual(['early', 'middle', 'late']);
        });

        it('breaks a tie lexicographically by name', () => {
            const marks = marksOf({ notifies: { delta: { at: 0.5 }, alpha: { at: 0.5 } } });

            expect(marks.map((mark) => mark.name)).toEqual(['alpha', 'delta']);
        });

        it('orders a passage by where it STARTS', () => {
            const marks = marksOf({
                notifies: { tip: { at: 0.5 } },
                passages: { swing: { from: 0.2, to: 0.9 } },
            });

            expect(marks.map((mark) => mark.name)).toEqual(['swing', 'tip']);
        });

        it('yields an identical timeline when the authored keys are written in a different order', () => {
            // Records preserve insertion order, so without the sort the mark list
            // would be whatever order the JSON happened to be typed in.
            const forwards = compileClipTimeline(
                sheetOf({
                    notifies: { a: { at: 0.1 }, b: { at: 0.4 }, c: { at: 0.9 } },
                    passages: { p: { from: 0.2, to: 0.3 }, q: { from: 0.6, to: 0.7 } },
                }),
                CLIP,
                2,
            );
            const backwards = compileClipTimeline(
                sheetOf({
                    notifies: { c: { at: 0.9 }, b: { at: 0.4 }, a: { at: 0.1 } },
                    passages: { q: { from: 0.6, to: 0.7 }, p: { from: 0.2, to: 0.3 } },
                }),
                CLIP,
                2,
            );

            expect(forwards).toEqual(backwards);
            // a@0.1, p@0.2, b@0.4, q@0.6, c@0.9 — notifies and passages
            // interleaved, so a sort that ordered the two records separately and
            // concatenated them would not produce this.
            expect(forwards?.marks.map((mark) => mark.name)).toEqual(['a', 'p', 'b', 'q', 'c']);
        });
    });

    describe('the compiled header', () => {
        it('carries the clip name it was asked for', () => {
            expect(compileClipTimeline(sheetOf({}), CLIP, 2)?.clipName).toBe(CLIP);
        });

        it('passes the authored loop mode through', () => {
            expect(compileClipTimeline(sheetOf({ loop: 'loop' }), CLIP, 2)?.loop).toBe('loop');
        });

        it('omits the loop key entirely when the sheet declares none, leaving the choice to the player', () => {
            const timeline = compileClipTimeline(sheetOf({}), CLIP, 2);

            expect(timeline).not.toHaveProperty('loop');
        });
    });

    describe('purity', () => {
        it('does not mutate a deep-frozen sheet, and leaves it equal to a pre-call clone', () => {
            const sheet: ModelAnimationMetadata = {
                clips: {
                    [CLIP]: {
                        durationSeconds: 4,
                        frameCount: 4,
                        loop: 'once',
                        notifies: { hit: { at: 0.5 }, bad: { at: { frame: 1.5 } } },
                        passages: { swing: { from: 0.2, to: 0.8, window: 'sword-hit' } },
                    },
                },
            };
            const before = structuredClone(sheet);
            deepFreeze(sheet);

            // A frozen object throws on write only in strict mode, which every
            // module here is; the clone comparison catches a write that landed on
            // a nested object the freeze walker missed.
            expect(() => compileClipTimeline(sheet, CLIP, 2)).not.toThrow();
            expect(sheet).toEqual(before);
        });

        it('warns rather than throwing when a mark BODY is not an object', () => {
            // `resolveClipPosition` is hardened because a position arrives through
            // the `unknown` metadata slot — but so does the record around it, and
            // reading `.at` off a null body would throw a TypeError straight into
            // the caller, past everything the fail-soft posture promises.
            const sheet = {
                clips: { [CLIP]: { notifies: { hit: null }, passages: { swing: null } } },
            } as unknown as ModelAnimationMetadata;

            const timeline = compileClipTimeline(sheet, CLIP, 2);

            expect(timeline?.marks).toEqual([]);
            expect(timeline?.warnings).toHaveLength(2);
        });

        it('returns its warnings instead of logging them', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

            const timeline = compileClipTimeline(
                sheetOf({ notifies: { bad: { at: { frame: 1 } } } }),
                CLIP,
                2,
            );

            expect(timeline?.warnings).toHaveLength(1);
            expect(warn).not.toHaveBeenCalled();
            expect(error).not.toHaveBeenCalled();

            warn.mockRestore();
            error.mockRestore();
        });
    });
});

/** Freezes `value` and everything reachable from it, so a nested write throws. */
function deepFreeze(value: unknown): void {
    if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
        return;
    }
    Object.freeze(value);
    for (const nested of Object.values(value)) {
        deepFreeze(nested);
    }
}
