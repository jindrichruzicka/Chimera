/**
 * renderer/animation/__tests__/marker-handler-no-dispatch.test.ts
 *
 * Invariant #132: no animation event may gate an `EngineAction`.
 *
 * The invariant says the rule is held by ABSENT PARAMETERS rather than by
 * review — so what has to be pinned is the parameter list, and pinning it needs
 * two different reads, because each is blind where the other sees.
 *
 * 1. **What a handler is HANDED at runtime.** Every marker event the scheduler
 *    emits, driven through a real timeline, with its key set asserted EXACTLY.
 *    A dispatcher smuggled onto an event would be a new key, and an exact set
 *    is the only assertion that notices one — `not.toHaveProperty('dispatch')`
 *    passes for `sendAction`, `emit`, `ctx` and every other name.
 * 2. **What a handler is DECLARED to take.** Types erase, so nothing at runtime
 *    can see a fourth parameter added to `ClipMarkerHandlers` or a second
 *    argument added beside the event. That half is a source read of the
 *    modules that own the surface — `OWNING_MODULES` below is the list, so
 *    it is one place rather than a count repeated in prose.
 *
 * Neither is a lint rule, deliberately: the invariant's own claim is that the
 * shape is the enforcement, and a lint rule is something someone can disable.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { compileClipTimeline } from '../ClipTimeline.js';
import { initSchedulerState, stepScheduler } from '../clipMarkerScheduler.js';
import type { MarkerEvent, SchedulerState } from '../clipMarkerScheduler.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The keys a marker event is allowed to carry, per event kind. */
const ALLOWED_KEYS: Readonly<Record<string, readonly string[]>> = {
    notify: ['kind', 'name'],
    'passage-start': ['kind', 'name', 'window'],
    'passage-tick': ['kind', 'name', 'progress', 'window'],
    'passage-end': ['kind', 'name', 'reason', 'window'],
    'clip-end': ['kind'],
};

/** A sheet whose marks cover every event kind across one pass of a 1 s clip. */
const SHEET = {
    clips: {
        wave: {
            durationSeconds: 1,
            loop: 'once' as const,
            notifies: { crest: { at: { seconds: 0.5 } } },
            passages: { swing: { from: 0.25, to: 0.75, window: 'showcase-swing' } },
        },
    },
};

/** Every event one full pass of the clip emits, in order. */
function eventsAcrossOnePass(): MarkerEvent[] {
    const timeline = compileClipTimeline(SHEET, 'wave', 1);
    expect(timeline, 'the fixture sheet must compile').not.toBeNull();

    const emitted: MarkerEvent[] = [];
    let scheduler: SchedulerState = initSchedulerState();
    // Ten steps of 0.1 phase, then the ending sample: a `'once'` clip's
    // `clip-end` arrives on the step that reports `ended`, and without it the
    // kind census below would be one kind short.
    for (let step = 1; step <= 10; step += 1) {
        const result = stepScheduler(scheduler, timeline!.marks, {
            phase: step / 10,
            cycle: 0,
            ended: step === 10,
        });
        scheduler = result.state;
        emitted.push(...result.events);
    }
    return emitted;
}

describe('Invariant #132 — a marker event carries no dispatcher', () => {
    const events = eventsAcrossOnePass();

    it('emits every event kind the surface declares, so the census below is not vacuous', () => {
        // The floor. An empty or one-kind list would satisfy every key
        // assertion here while proving nothing about the kinds it never saw.
        expect(new Set(events.map((event) => event.kind))).toEqual(
            new Set(['passage-start', 'passage-tick', 'notify', 'passage-end', 'clip-end']),
        );
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
        // A dispatcher smuggled in as a VALUE rather than as a new key — an
        // existing field retyped — would pass the exact-key census above.
        // `ClipMarkerHandlers`' every member is declared `(event) => void`, so
        // what a handler can receive is decided by the DECLARATION rather than
        // by the scheduler — which returns a batch and calls nothing. The
        // declaration is read below; what the scheduler can be checked for here
        // is that each event is a self-contained value carrying its own kind,
        // with nothing a caller would have to pass alongside it.
        for (const event of events) {
            expect(typeof event).toBe('object');
            expect(typeof event.kind).toBe('string');
            for (const value of Object.values(event)) {
                // A dispatcher smuggled onto an event would be a function.
                expect(typeof value).not.toBe('function');
            }
        }
        expect(events).not.toHaveLength(0);
    });
});

describe('Invariant #132 — the surface DECLARES no dispatcher', () => {
    // Types erase, so the runtime census above cannot see a parameter added to
    // the declaration. Between them these modules own the whole handler
    // surface: the scheduler declares the events, `ClipPlayer` declares the
    // handler set, and the React binding re-exports and re-wraps it.
    const OWNING_MODULES = [
        'clipMarkerScheduler.ts',
        'ClipPlayer.ts',
        // The React binding re-exports the handler type verbatim and re-wraps
        // all five members. It declares nothing new, which is the point — and
        // is unmeasured unless it is read.
        '../components/r3f/useClipPlayer.ts',
    ] as const;

    it.each(OWNING_MODULES)('names no dispatch API in %s', (moduleName) => {
        const source = codeOf(readFileSync(path.join(here, '..', moduleName), 'utf8'));

        // Two floors against a scan that could pass for the wrong reason: a
        // module must still carry a declaration after stripping, and the phrase
        // a module header uses to SAY it holds this rule must not survive into
        // what is scanned — or a header would satisfy its own scan.
        expect(source).toMatch(/export (interface|type|class|function)/u);
        expect(source).not.toContain('held by parameters');

        for (const forbidden of ['SendAction', 'EngineAction', 'dispatch', 'PlayerId']) {
            expect(source, forbidden).not.toContain(forbidden);
        }
    });
});

/**
 * `source` with block and line comments removed, so the scan reads CODE rather
 * than the prose explaining why there is none.
 *
 * Crude in a known direction: it has no notion of string or regex literals, so
 * a `//` inside one is eaten and a `/*` inside one eats forward to the next
 * close. Neither module holds either, and the floors above catch a strip that
 * removed real declarations.
 */
function codeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}
