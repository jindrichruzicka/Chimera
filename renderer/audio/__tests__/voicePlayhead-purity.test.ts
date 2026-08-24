/**
 * renderer/audio/__tests__/voicePlayhead-purity.test.ts
 *
 * One claim about `renderer/audio/voicePlayhead.ts`: its whole in-repo graph is
 * itself, and it depends on no package at all — no `AudioContext` wrapper, no
 * clock, no `react`, no `three`, and nothing else either.
 *
 * Invariants upheld:
 *   #122 — a voice's cue timing is derived from its recorded schedule facts — the ones
 *          `voicePlayhead.ts` itself enumerates — against a clock the CALLER supplies,
 *          never a wall-clock timer. A module that reaches no timer and no context
 *          cannot read one, which is what turns that rule into something measured
 *          rather than reviewed.
 *
 * Stated as CLOSED sets rather than as a denylist of the names the design happened
 * to call out. A denylist rejects only what whoever wrote it thought of; this module
 * reaches nothing outside itself and depends on no package, and the empty set says so
 * about every name at once — including the ones a cue sampler will be tempted to add.
 *
 * Both claims are about what a BUNDLE pulls in, which is what the analyzer measures:
 * an explicit `import type` is erased before either channel sees it, so a later
 * type-only edge would pass here. That is the right scope — an erased import carries
 * no clock — and it is why the second control below is written with a value import.
 *
 * Mechanism mirrors `renderer/animation/__tests__/scheduler-purity.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { analyze, AUDIO_DIR, AUDIO_SUBTREE, pathsOutside } from './audioGraph.js';

const MODULE = 'voicePlayhead.ts';

describe('renderer/audio/voicePlayhead pure-module graph', () => {
    it('reaches nothing but itself and depends on no package at all', async () => {
        const { externals, reached } = await analyze({
            entryPoint: resolve(AUDIO_DIR, MODULE),
        });

        // Positive control first: the analysis really saw this file.
        expect(reached).toContain(`${AUDIO_SUBTREE}${MODULE}`);

        // Closed on BOTH sides of the directory boundary. `pathsOutside` alone would
        // stay green if the module pulled in `AudioManager.ts` — a sibling, and the
        // one edge that would drag the whole audio graph back in.
        expect(pathsOutside(reached, AUDIO_SUBTREE)).toEqual([]);
        expect([...reached].sort()).toEqual([`${AUDIO_SUBTREE}${MODULE}`]);
        expect(externals).toEqual([]);
    });

    it('would report a sibling module if one were imported', async () => {
        // The opposite-polarity control for the closed `reached` set: the sibling this
        // module was carved out of is visible to the same analyzer.
        const { reached } = await analyze({
            source: [
                `import { MUSIC_PRIORITY } from './AudioManager.js';`,
                `export const priority = MUSIC_PRIORITY;`,
            ].join('\n'),
        });

        expect(reached).toContain(`${AUDIO_SUBTREE}AudioManager.ts`);
    });

    it('would report a sibling whose binding nothing uses, which is not an input', async () => {
        // The control for `reached`'s SECOND channel, and the only thing that separates
        // it from `inputs`. An unused binding is elided before its target is resolved, so
        // it enters no bundle — but the import record survives, and resolving it against
        // its importer is what keeps an edge written and never called from reading as no
        // edge at all. Without this the union could be dropped and every claim here
        // would stay green.
        const { inputs, reached } = await analyze({
            source: [
                `import { MUSIC_PRIORITY } from './AudioManager.js';`,
                `export const priority = 100;`,
            ].join('\n'),
        });

        // `.js`, not `.ts`: this channel carries the SPECIFIER as written, which is what
        // makes a verdict over it a subtree question rather than a file-identity one.
        // Both spellings are asserted, so a resolver that started reporting the resolved
        // file instead would be reported rather than quietly changing what is measured.
        expect(inputs).toEqual([`${AUDIO_SUBTREE}graph-control.ts`]);
        expect(reached).toContain(`${AUDIO_SUBTREE}AudioManager.js`);
        expect(reached).not.toContain(`${AUDIO_SUBTREE}AudioManager.ts`);
    });

    it('would report a framework import if one were there', async () => {
        // The opposite-polarity control for the empty `externals` set.
        const { externals } = await analyze({
            source: [`import { Vector3 } from 'three';`, `export const up = Vector3;`].join('\n'),
        });

        expect(externals).toEqual(['three']);
    });
});
