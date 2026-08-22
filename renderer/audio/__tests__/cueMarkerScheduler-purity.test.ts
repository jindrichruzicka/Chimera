/**
 * renderer/audio/__tests__/cueMarkerScheduler-purity.test.ts
 *
 * One claim about `renderer/audio/cueMarkerScheduler.ts`: its whole in-repo graph is
 * itself, and it depends on no package at all — no `AudioContext` wrapper, no clock,
 * no `react`, no `three`, and nothing from `renderer/animation/` either. The module
 * that turns playhead samples into cue emissions supplies no time of its own; the
 * caller hands it every sample, and a module that reaches no timer and no context
 * cannot do otherwise.
 *
 * Stated as CLOSED sets rather than as a denylist of the names the design happened to
 * call out. A denylist rejects only what whoever wrote it thought of; this module
 * reaches nothing outside itself and depends on no package, and the empty set says so
 * about every name at once — including `AudioManager.ts`, the sibling whose dependency
 * runs the OTHER way and which would drag the whole audio graph back in.
 *
 * Both claims are about what a BUNDLE pulls in, which is what the analyzer measures:
 * an explicit `import type` is erased before either channel sees it. This module holds
 * two such edges deliberately — the cue-sheet vocabulary from `simulation/foundation`
 * and `LoopWindowSeconds` from `voicePlayhead.ts` — and neither is visible here. That
 * is the right scope, because an erased import carries no clock and no framework into
 * anything; the type-level reach it does not measure is what
 * `cue-handler-no-dispatch.test.ts` reads the SOURCE for.
 *
 * The analyzer and its two channels live in `audioGraph.ts`. The channel-separation
 * control — an imported binding nothing uses, which reaches a module without resolving
 * into one — is a property of the analyzer rather than of any one module, and is
 * pinned in `voicePlayhead-purity.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import { analyze, AUDIO_DIR, AUDIO_SUBTREE, pathsOutside } from './audioGraph.js';

const MODULE = 'cueMarkerScheduler.ts';

describe('renderer/audio/cueMarkerScheduler pure-module graph', () => {
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
        // The opposite-polarity control for the closed `reached` set: the sibling
        // this module must never reach is visible to the same analyzer.
        const { reached } = await analyze({
            source: [
                `import { MUSIC_PRIORITY } from './AudioManager.js';`,
                `export const priority = MUSIC_PRIORITY;`,
            ].join('\n'),
        });

        expect(reached).toContain(`${AUDIO_SUBTREE}AudioManager.ts`);
    });

    it('would report a framework import, and a reach into renderer/animation, if one were there', async () => {
        // The opposite-polarity controls for the empty `externals` set and for
        // `pathsOutside` — the animation scheduler being the sibling this module is
        // a deliberate copy of rather than a consumer of.
        const { externals, reached } = await analyze({
            source: [
                `import { useMemo } from 'react';`,
                `import { initSchedulerState } from '../animation/clipMarkerScheduler.js';`,
                `export const seat = () => useMemo(initSchedulerState, []);`,
            ].join('\n'),
        });

        expect(externals).toEqual(['react']);
        expect(pathsOutside(reached, AUDIO_SUBTREE)).toContain(
            'renderer/animation/clipMarkerScheduler.ts',
        );
    });
});
