/**
 * renderer/animation/__tests__/scheduler-purity.test.ts
 *
 * Two claims about the compile half plus the scheduler and the player:
 *
 * 1. **Graph purity.** Their whole in-repo graph is exactly the modules listed
 *    below, and they depend on no package at all — no `three`, no `react`,
 *    no `@react-three/fiber`, and nothing else either.
 * 2. **No marker event carries a dispatcher.** Each event's key set is closed at
 *    the type level, so a later `sendAction`, `dispatch`, `playerId` or `tick`
 *    field cannot be added to one without failing `pnpm typecheck`. It says
 *    nothing about the handler SIGNATURES, which take one event and are pinned
 *    only by the compiler at their call sites.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * The list here is FIXED, unlike the census's `readdirSync` enumeration, and the
 * two mean opposite things: the census is a floor meant to grow with the
 * directory, this is a ceiling meant not to. A later F82 task ships a React hook
 * in this directory, which is expected to import `react` — folding that into an
 * enumerated claim would make this guard a tripwire for its own successors.
 *
 * The analyzer and its two channels live in `animationGraph.js`.
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import type {
    ClipEndEvent,
    NotifyEvent,
    PassageEndEvent,
    PassageEvent,
    PassageTickEvent,
} from '../clipMarkerScheduler.js';

import { analyze, ANIMATION_DIR, ANIMATION_SUBTREE, pathsOutside } from './animationGraph.js';

/**
 * The framework-free half of `renderer/animation/`: the compile modules, the
 * scheduler and the player.
 */
const PURE_MODULES = [
    'ClipBackend.ts',
    'ClipPlayer.ts',
    'ClipPosition.ts',
    'ClipTimeline.ts',
    'clipMarkerScheduler.ts',
    // The authored-sheet-to-run-spec bridge. Pure despite serving a backend that
    // is not: its `SpriteClipSpec` import is TYPE-ONLY, so it reaches neither
    // `SpriteClipBackend.ts` nor the `three` under it.
    'spriteClipSpecs.ts',
] as const;

describe('pathsOutside', () => {
    it('keeps a prefix match at the path start only, with the separator required', () => {
        expect(
            pathsOutside(
                [
                    'renderer/animation/ClipTimeline.ts',
                    'renderer/animations/x.ts',
                    'apps/x/renderer/animation/y.ts',
                    'renderer/state/store.ts',
                ],
                ANIMATION_SUBTREE,
            ),
        ).toEqual([
            'renderer/animations/x.ts',
            'apps/x/renderer/animation/y.ts',
            'renderer/state/store.ts',
        ]);
    });
});

describe('renderer/animation compile-half purity', () => {
    it('reaches nothing outside this directory and depends on no package at all', async () => {
        for (const modulePath of PURE_MODULES) {
            const { externals, reached } = await analyze({
                entryPoint: resolve(ANIMATION_DIR, modulePath),
            });

            // Positive control first: the analysis really saw this file.
            expect(reached, modulePath).toContain(`${ANIMATION_SUBTREE}${modulePath}`);

            // Both channels, each as a CLOSED set rather than a denylist of the
            // names the issue happened to call out (`three`, `react`,
            // `@react-three/fiber`, `renderer/logging|state|assets`). A denylist
            // rejects only what whoever wrote it thought of; these modules reach
            // nothing outside their own directory and depend on no package, and
            // the empty set says so about every name at once. Their only
            // cross-package imports are `import type`, which erase — which is
            // exactly why the opposite-polarity control below is needed.
            expect(pathsOutside(reached, ANIMATION_SUBTREE), modulePath).toEqual([]);
            expect(externals, modulePath).toEqual([]);
        }
    });

    it('reaches exactly the listed modules between them, and nothing else in the repo', async () => {
        const reached = new Set<string>();
        for (const modulePath of PURE_MODULES) {
            const analysis = await analyze({ entryPoint: resolve(ANIMATION_DIR, modulePath) });
            for (const path of analysis.reached) {
                reached.add(path);
            }
        }

        // A closed set over the UNION, which the per-module loop above cannot
        // state: that loop would stay green if an unlisted in-directory module
        // were pulled in. It says nothing in the other direction — every listed
        // module is its own analysis's entry point, so the union holds all of
        // them however little they reference each other.
        expect([...reached].sort()).toEqual(
            [...PURE_MODULES].map((name) => `${ANIMATION_SUBTREE}${name}`).sort(),
        );
    });

    it('would report a framework import if one were there', async () => {
        // The opposite-polarity control for the empty-set assertions above. It
        // names `three` because that is the one the issue asks be shown unreached.
        const { externals } = await analyze({
            source: [`import { Vector3 } from 'three';`, `export const up = Vector3;`].join('\n'),
        });

        expect(externals).toEqual(['three']);
    });

    it('would report a sibling module the union does not list', async () => {
        // The opposite-polarity control for the closed union: a module in this
        // directory that the list does NOT name is visible to the same analyzer.
        const { reached } = await analyze({
            entryPoint: resolve(ANIMATION_DIR, '__test-support__/fakeClipBackend.ts'),
        });

        expect(reached).toContain(`${ANIMATION_SUBTREE}__test-support__/fakeClipBackend.ts`);
    });
});

describe('the marker event surface carries no dispatcher', () => {
    // Each literal is checked BOTH ways by `satisfies`: a key added to the
    // interface is missing from the literal, and a key removed from the interface
    // is an excess property on it. So the red for a `sendAction`, `dispatch`,
    // `playerId` or `tick` field appearing on any of these is `pnpm typecheck`,
    // not an assertion below — the assertions pin that these literals say what
    // they appear to say.
    const NOTIFY_KEYS = { kind: true, name: true } as const satisfies Record<
        keyof NotifyEvent,
        true
    >;
    const PASSAGE_KEYS = { kind: true, name: true, window: true } as const satisfies Record<
        keyof PassageEvent,
        true
    >;
    const PASSAGE_TICK_KEYS = {
        kind: true,
        name: true,
        progress: true,
        window: true,
    } as const satisfies Record<keyof PassageTickEvent, true>;
    const PASSAGE_END_KEYS = {
        kind: true,
        name: true,
        reason: true,
        window: true,
    } as const satisfies Record<keyof PassageEndEvent, true>;
    const CLIP_END_KEYS = { kind: true } as const satisfies Record<keyof ClipEndEvent, true>;

    it.each([
        ['NotifyEvent', NOTIFY_KEYS, ['kind', 'name']],
        ['PassageEvent', PASSAGE_KEYS, ['kind', 'name', 'window']],
        ['PassageTickEvent', PASSAGE_TICK_KEYS, ['kind', 'name', 'progress', 'window']],
        ['PassageEndEvent', PASSAGE_END_KEYS, ['kind', 'name', 'reason', 'window']],
        ['ClipEndEvent', CLIP_END_KEYS, ['kind']],
    ])('%s carries exactly these keys', (_name, pinned, expected) => {
        expect(Object.keys(pinned).sort()).toEqual([...expected].sort());
    });
});
