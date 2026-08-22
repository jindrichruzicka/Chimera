/**
 * renderer/audio/__tests__/cue-handler-no-dispatch.test.ts
 *
 * The cue-observation rule: a cue is renderer-only feedback, so nothing on the
 * observation surface can reach the simulation with it. That direction has no
 * invariant number yet — Invariant #63 runs the other way, barring the simulation
 * from reaching audio — and the row for it is authored with the audio-system docs
 * rather than here, so this guard names no number and holds whatever one it is given.
 *
 * The rule's own claim is that it is held by ABSENT PARAMETERS rather than by
 * review — so what has to be pinned is the parameter list, and pinning it needs two
 * different reads, because each is blind where the other sees.
 *
 * 1. **What a handler is HANDED at runtime.** Every event the scheduler emits,
 *    driven through a real timeline, with its key set asserted EXACTLY. A dispatcher
 *    smuggled onto an event would be a new key, and an exact set is the only
 *    assertion that notices one — `not.toHaveProperty('dispatch')` passes for
 *    `sendAction`, `emit`, `ctx` and every other name.
 * 2. **What a handler is DECLARED to take.** Types erase, so nothing at runtime can
 *    see a parameter added to `CueHandlers` or a second argument added beside the
 *    event. That half is a source read, and `OWNING_MODULES` is the list of what
 *    owns the surface, so it is one place rather than a count repeated in prose.
 *    The pure scheduler declares both the events and the handler record; the frame
 *    sampler calls the handlers and the manager verb takes them from a game. A
 *    module joining that surface joins this list.
 *
 * Neither is a lint rule, deliberately: the rule's own claim is that the shape is
 * the enforcement, and a lint rule is something someone can disable.
 *
 * Mechanism mirrors `renderer/animation/__tests__/marker-handler-no-dispatch.test.ts`,
 * which holds the animation half (Invariant #132).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    compileCueSheet,
    stepCueScheduler,
    type CueEvent,
    type CuePlayheadSample,
} from '../cueMarkerScheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The keys a cue event is allowed to carry, per event kind. */
const ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
    cue: ['kind', 'name'],
    loop: ['kind'],
    end: ['kind'],
};

const sample = (unwrappedSeconds: number, ended = false): CuePlayheadSample => ({
    unwrappedSeconds,
    ended,
});

/**
 * Every event kind the surface can emit. A looping voice carried across its wrap
 * produces `cue` and `loop`; a non-looping one carried off its end produces `end`.
 */
function everyEventKind(): readonly CueEvent[] {
    const cues = compileCueSheet({ cues: { early: 1.25, late: 2.75 }, durationSeconds: 10 });

    const wrapped = stepCueScheduler(sample(1.5), sample(3.5), cues, {
        startSeconds: 1,
        endSeconds: 3,
    });
    const finished = stepCueScheduler(sample(1), sample(3, true), cues, null);

    return [...wrapped.events, ...finished.events];
}

describe('a cue event carries no dispatcher', () => {
    const events = everyEventKind();

    it('emits every event kind the surface declares, so the census below is not vacuous', () => {
        // The floor. An empty or one-kind list would satisfy every key assertion
        // here while proving nothing about the kinds it never saw.
        expect(new Set(events.map((event) => event.kind))).toEqual(new Set(['cue', 'loop', 'end']));
    });

    it('carries NO key beside the declared ones, on any event', () => {
        for (const event of events) {
            const allowed = ALLOWED_KEYS[event.kind];
            expect(allowed, `unknown event kind ${event.kind}`).toBeDefined();
            expect(
                Object.keys(event).filter((key) => !allowed!.includes(key)),
                JSON.stringify(event),
            ).toEqual([]);
        }
    });

    it('emits self-contained values, with no function riding on any of them', () => {
        // A dispatcher smuggled in as a VALUE rather than as a new key — an existing
        // field retyped — would pass the exact-key census above. `CueHandlers`' every
        // member is declared `(event) => void`, so what a handler can receive is
        // decided by the DECLARATION rather than by the scheduler, which returns a
        // batch and calls nothing. The declaration is read below; what the scheduler
        // can be checked for here is that each event is a self-contained value
        // carrying its own kind, with nothing a caller would have to pass alongside.
        for (const event of events) {
            expect(typeof event).toBe('object');
            expect(typeof event.kind).toBe('string');
            for (const value of Object.values(event)) {
                expect(typeof value).not.toBe('function');
            }
        }
        expect(events).not.toHaveLength(0);
    });
});

describe('the cue surface DECLARES no dispatcher', () => {
    /** Every module that owns part of the cue observation surface. */
    const OWNING_MODULES = ['cueMarkerScheduler.ts', 'cueSampler.ts', 'AudioManager.ts'] as const;

    /** The one that DECLARES the handler record; the others take it as a parameter. */
    const DECLARING_MODULE = 'cueMarkerScheduler.ts';

    it.each(OWNING_MODULES)('names no dispatch API anywhere in %s', (moduleName) => {
        const source = codeOf(readFileSync(path.join(here, '..', moduleName), 'utf8'));

        // Three floors against a scan that could pass for the wrong reason: the
        // module must still carry declarations after stripping; it must still NAME
        // the handler record, or the scan would stay green the day its part of the
        // surface moved somewhere unlisted; and the phrase a module header uses to
        // SAY it holds this rule must not survive into what is scanned, or a header
        // would satisfy its own scan.
        expect(source).toMatch(/export (interface|type|class|function)/u);
        expect(source).toContain('CueHandlers');
        expect(source).not.toContain('held by parameters');

        for (const forbidden of ['SendAction', 'EngineAction', 'dispatch', 'PlayerId', 'tick']) {
            expect(source.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
        }
    });

    it('reads the module the handler record is declared in', () => {
        // The scan above accepts a module that merely NAMES `CueHandlers`, which every
        // consumer does. Without this, the list could lose its declaration site and go
        // on passing on three consumers of a record nothing here reads.
        const source = codeOf(readFileSync(path.join(here, '..', DECLARING_MODULE), 'utf8'));

        expect(OWNING_MODULES).toContain(DECLARING_MODULE);
        expect(source).toMatch(/export interface CueHandlers/u);
    });
});

/**
 * `source` with block and line comments removed, so the scan reads CODE rather than
 * the prose explaining why there is none.
 *
 * Crude in a known direction: it has no notion of string or regex literals, so a
 * `//` inside one is eaten and a `/*` inside one eats forward to the next close.
 * The floors above are what catch a strip that removed real declarations, in
 * whichever module of the list it happened.
 */
function codeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}
