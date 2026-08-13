/**
 * simulation/foundation/animation-clip-sheet.test.ts
 *
 * Type-level and runtime unit tests for the sim-side animation clip-sheet
 * vocabulary: `AnimationClipName`, `AnimationMarkName`, `AnimationWindowName`,
 * `AnimationLoopMode`, `ClipPosition`, `AnimationNotify`, `AnimationPassage`,
 * `AnimationTrackSheet`, `ModelAnimationMetadata`, `SpriteClipDeclaration` and
 * `SpriteAnimationMetadata`. These names are the authoring vocabulary games use
 * to mark notify points and sub-passages inside an animation clip.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   The sheet rides `AssetManifestEntry.metadata`, which stays typed `unknown`.
 *   `beatWindow` is a pair of integers, so the tuple is pinned as a
 *     two-element `[number, number]` and a three-element literal is rejected.
 *   #1 — `simulation/foundation/` is the zero-dependency engine leaf and this
 *     module is PURE TYPE DECLARATIONS. The esbuild pin at the bottom asserts
 *     the module bundles to the empty string, so no runtime value can enter it.
 *
 * Written test-first: for a type-only module the meaningful red is at the type
 * layer, not the runtime one. The `expectTypeOf`/`@ts-expect-error` assertions
 * below fail `tsc -p simulation/tsconfig.json` when the source types are missing
 * or wrong; vitest alone cannot see it, because `import type` is erased and
 * `expectTypeOf(...)` is a runtime no-op.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import { build } from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    AnimationClipName,
    AnimationLoopMode,
    AnimationMarkName,
    AnimationNotify,
    AnimationPassage,
    AnimationTrackSheet,
    AnimationWindowName,
    ClipPosition,
    ModelAnimationMetadata,
    SpriteAnimationMetadata,
    SpriteClipDeclaration,
} from './animation-clip-sheet.js';
import type { AssetManifestEntry } from '../content/AssetManifest.js';

/** `simulation/`, resolved from this file rather than from the runner's cwd. */
const simulationRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every shipped `.ts` under `simulation/`, excluding tests and doubles. */
function simulationSourceFiles(): readonly string[] {
    const skipped = new Set(['node_modules', 'dist', 'out', '__tests__', '__test-support__']);
    const found: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                if (!skipped.has(entry.name)) {
                    walk(path);
                }
                continue;
            }
            if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
                found.push(path);
            }
        }
    };
    walk(simulationRoot);
    return found.sort((left, right) => left.localeCompare(right));
}

// ─── The three open name aliases ──────────────────────────────────────────────

describe('clip / mark / window name aliases', () => {
    it('are the open string aliases games author names with', () => {
        expectTypeOf<AnimationClipName>().toEqualTypeOf<string>();
        expectTypeOf<AnimationMarkName>().toEqualTypeOf<string>();
        expectTypeOf<AnimationWindowName>().toEqualTypeOf<string>();

        const clip: AnimationClipName = 'swing';
        const mark: AnimationMarkName = 'impact';
        const window: AnimationWindowName = 'sword-hit';
        expect([clip, mark, window]).toEqual(['swing', 'impact', 'sword-hit']);
    });
});

// ─── AnimationLoopMode ────────────────────────────────────────────────────────

describe('AnimationLoopMode', () => {
    it('pins exactly the two supported loop modes', () => {
        expectTypeOf<AnimationLoopMode>().toEqualTypeOf<'once' | 'loop'>();

        const mode: AnimationLoopMode = 'loop';
        expect(mode).toBe('loop');
    });

    it('rejects ping-pong — a reversing playhead is refused, never clamped', () => {
        // @ts-expect-error: 'ping-pong' is not a supported loop mode — nothing
        // downstream models a reversing playhead.
        const mode: AnimationLoopMode = 'ping-pong';
        expect(mode).toBe('ping-pong');
    });
});

// ─── ClipPosition ─────────────────────────────────────────────────────────────

describe('ClipPosition', () => {
    it('is a normalized phase, an absolute second, or a frame index', () => {
        expectTypeOf<ClipPosition>().toEqualTypeOf<
            number | { readonly seconds: number } | { readonly frame: number }
        >();

        const phase: ClipPosition = 0.5;
        const seconds: ClipPosition = { seconds: 1.25 };
        const frame: ClipPosition = { frame: 3 };
        expect([phase, seconds, frame]).toEqual([0.5, { seconds: 1.25 }, { frame: 3 }]);
    });

    it('requires the seconds/frame members to be numbers', () => {
        // @ts-expect-error: a position in seconds must be a number
        const bad: ClipPosition = { seconds: 'two' };
        expect(bad).toEqual({ seconds: 'two' });
    });
});

// ─── AnimationNotify ──────────────────────────────────────────────────────────

describe('AnimationNotify', () => {
    it('carries exactly the position it fires at — a notify is a name plus a phase', () => {
        expectTypeOf<AnimationNotify>().toEqualTypeOf<{ readonly at: ClipPosition }>();

        const notify: AnimationNotify = { at: 0.35 };
        expect(notify.at).toBe(0.35);
    });

    it('exposes `at` as readonly', () => {
        const notify: AnimationNotify = { at: { seconds: 0.2 } };
        // @ts-expect-error: AnimationNotify.at is readonly
        notify.at = 0;
        expect(notify).toBeDefined();
    });
});

// ─── AnimationPassage ─────────────────────────────────────────────────────────

describe('AnimationPassage', () => {
    it('carries the visual span plus the optional gameplay window it declares', () => {
        const passage: AnimationPassage = {
            from: { seconds: 0.1 },
            to: { seconds: 0.2 },
            beatWindow: [2, 4],
            window: 'sword-hit',
        };

        expect(passage.beatWindow).toEqual([2, 4]);
        expect(passage.window).toBe('sword-hit');
    });

    it('type-checks a presentation-only passage — beatWindow and window are optional', () => {
        const presentation: AnimationPassage = { from: 0, to: 0.25 };
        expect(presentation).toEqual({ from: 0, to: 0.25 });
    });

    it('pins beatWindow as a two-element tuple', () => {
        const bad: AnimationPassage = {
            from: 0,
            to: 1,
            // @ts-expect-error: beatWindow is a [startBeat, endBeat] two-tuple
            beatWindow: [0, 1, 2],
        };
        expect(bad).toBeDefined();
    });
});

// ─── AnimationTrackSheet ──────────────────────────────────────────────────────

describe('AnimationTrackSheet', () => {
    it('accepts a well-formed per-clip sheet', () => {
        const track: AnimationTrackSheet = {
            durationSeconds: 1.2,
            frameCount: 24,
            loop: 'once',
            notifies: { impact: { at: { seconds: 0.15 } } },
            passages: { hit: { from: 0.1, to: 0.2, beatWindow: [2, 4], window: 'sword-hit' } },
        };

        expect(track.notifies?.['impact']).toEqual({ at: { seconds: 0.15 } });
        expect(track.passages?.['hit']?.beatWindow).toEqual([2, 4]);
    });

    it('type-checks an empty sheet — every field is optional', () => {
        const empty: AnimationTrackSheet = {};
        expect(empty).toEqual({});
    });

    it('is named by no shipped simulation source but its own declaration', () => {
        // The field is authored vocabulary carried opaquely in `metadata`, and a
        // reducer, a pipeline or a `validate()` that read it would be a renderer
        // concern leaking sim-side. Asserted as the exact matched SET rather than
        // a count; what keeps THIS file out of that set is the `.test.ts` filter
        // in the walk, which is why the walk excludes tests rather than trusting
        // how the token is spelled here.
        const token = 'blendInSeconds';
        const found = simulationSourceFiles().filter((file) =>
            readFileSync(file, 'utf8').includes(token),
        );

        expect(found.map((file) => relative(simulationRoot, file))).toEqual([
            'foundation/animation-clip-sheet.ts',
        ]);
    });

    it('carries an authored blend-in length, in seconds', () => {
        const track: AnimationTrackSheet = { durationSeconds: 1.2, blendInSeconds: 0.2 };

        expect(track.blendInSeconds).toBe(0.2);
    });

    it('types the blend-in length as optional seconds, and refuses a word', () => {
        // The direct pin first: an excess-property error also discharges a
        // `@ts-expect-error`, so the directive below cannot tell "wrong type"
        // from "field absent" on its own.
        expectTypeOf<AnimationTrackSheet['blendInSeconds']>().toEqualTypeOf<number | undefined>();

        const bad: AnimationTrackSheet = {
            // @ts-expect-error: a blend length is seconds, not an authored word
            blendInSeconds: 'fast',
        };
        expect(bad).toBeDefined();
    });

    it('carries NO frame list — sprite frames belong to SpriteClipDeclaration', () => {
        const bad: AnimationTrackSheet = {
            durationSeconds: 0.4,
            // @ts-expect-error: `frames` is a sprite-only field, not part of the shared track sheet
            frames: [0, 1, 2],
        };
        expect(bad).toBeDefined();
    });
});

// ─── ModelAnimationMetadata / SpriteAnimationMetadata ─────────────────────────

describe('ModelAnimationMetadata', () => {
    it('maps clip names to their track sheets', () => {
        const metadata: ModelAnimationMetadata = {
            clips: { swing: { durationSeconds: 0.4, passages: { hit: { from: 0.25, to: 0.5 } } } },
        };

        expect(metadata.clips?.['swing']?.durationSeconds).toBe(0.4);
    });

    it('type-checks an empty metadata value', () => {
        const empty: ModelAnimationMetadata = {};
        expect(empty).toEqual({});
    });
});

describe('SpriteClipDeclaration / SpriteAnimationMetadata', () => {
    it('adds the atlas frame list on top of the shared track sheet', () => {
        const declaration: SpriteClipDeclaration = {
            durationSeconds: 0.4,
            frameCount: 4,
            frames: [0, 1, 2, 3],
            notifies: { impact: { at: { frame: 2 } } },
        };

        expect(declaration.frames).toEqual([0, 1, 2, 3]);
        expectTypeOf<SpriteClipDeclaration>().toMatchTypeOf<AnimationTrackSheet>();
    });

    it('requires the frame list — a sprite clip with no frames cannot play', () => {
        // @ts-expect-error: SpriteClipDeclaration.frames is required
        const bad: SpriteClipDeclaration = { durationSeconds: 0.4 };
        expect(bad).toBeDefined();
    });

    it('maps clip names to sprite clip declarations', () => {
        const metadata: SpriteAnimationMetadata = {
            clips: { swing: { frames: [0, 1], durationSeconds: 0.1 } },
        };

        expect(metadata.clips?.['swing']?.frames).toEqual([0, 1]);
    });
});

// ─── AssetManifestEntry.metadata stays `unknown` (anti-rot) ───────────────────

describe('AssetManifestEntry.metadata (opaque slot the clip sheet rides on)', () => {
    it('is still typed `unknown` — the sheet must ride the opaque slot unchanged', () => {
        expectTypeOf<AssetManifestEntry['metadata']>().toEqualTypeOf<unknown>();

        const metadata: ModelAnimationMetadata = { clips: {} };
        const slot: AssetManifestEntry['metadata'] = metadata;
        expect(slot).toBe(metadata);
    });
});

// ─── The module carries zero runtime (Invariant #1) ───────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bundle a module with esbuild (bundle + tree-shake) and return its emitted
 * JavaScript with comments and whitespace removed. A side-effect-free, type-only
 * module erases to the empty string.
 *
 * Declared locally rather than shared: this pin is about THIS module, and the
 * contract-barrel helper it mirrors covers only the two public barrels, neither
 * of which re-exports this file.
 */
async function bundleAndStrip(absoluteEntry: string): Promise<string> {
    const result = await build({
        entryPoints: [absoluteEntry],
        bundle: true,
        treeShaking: true,
        write: false,
        format: 'esm',
        platform: 'neutral',
        logLevel: 'silent',
    });
    const code = result.outputFiles[0]?.text ?? '';
    return code
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, '');
}

describe('animation-clip-sheet.ts is PURE TYPE DECLARATIONS (Invariant #1)', () => {
    it('bundles to the empty string — it evaluates no runtime module', async () => {
        // Mutation control: adding `export const ANY = 1;` to the source module
        // reds this assertion.
        expect(await bundleAndStrip(resolve(__dirname, 'animation-clip-sheet.ts'))).toBe('');
    });
});
