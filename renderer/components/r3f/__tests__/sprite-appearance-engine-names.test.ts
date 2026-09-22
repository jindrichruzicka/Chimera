/**
 * renderer/components/r3f/__tests__/sprite-appearance-engine-names.test.ts
 *
 * A game authors a sprite's whole appearance without importing `three`
 * (Invariant #1).
 *
 * The appearance props are engine-owned NAMES — `'additive'`, `'mask'` — rather
 * than `three`'s blending and alpha constants, and the point of that choice is
 * that the `three` import never appears in game code. So the claim this file
 * carries is about its own source: it declares every appearance prop the
 * component takes, and it imports nothing from `three` while doing it.
 *
 * Both halves have to be measured together. The prop values alone would pass in
 * a file that also imported `three` for something else, and the import check
 * alone would pass in a file that used no props at all — so the literal below is
 * what makes the absent import mean something, and the absent import is what
 * makes the literal a claim about `three` rather than a type test.
 *
 * Values rather than a type declaration, because only an object LITERAL trips
 * excess-property checking: a declared field of a narrowed type is legal, and a
 * spread would satisfy the same assignment silently.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type {
    AnimatedSpriteProps,
    SpriteAlphaMode,
    SpriteBlending,
} from '@chimera-engine/renderer/components/r3f';

/** Every blending name the engine publishes, spelled as a game spells them. */
const EVERY_BLENDING: readonly SpriteBlending[] = [
    'normal',
    'additive',
    'subtractive',
    'multiply',
    'none',
];

/** Every alpha mode the engine publishes. */
const EVERY_ALPHA_MODE: readonly SpriteAlphaMode[] = ['opaque', 'mask', 'blend'];

/**
 * One sprite declaring every appearance prop at once.
 *
 * `satisfies` rather than an annotation so excess-property checking stays live:
 * a prop that leaves the type reds `pnpm typecheck` here, and so does a value
 * that stops being assignable.
 */
const everyAppearanceProp = {
    sheet: null,
    clip: 'run',
    // The packed-number branch of `color`, not the CSS-string one. A sprite tint
    // is content rather than UI chrome, so it has no `var(--ch-*)` token to come
    // from — and `no-hardcoded-design-values` (Invariants #86/#91) reads a
    // hex-coloured `color:` property in `renderer/` as chrome either way. The
    // number carries the same claim about `three` and covers the other half of
    // `string | number`; the CSS-string form is exercised in
    // `AnimatedSprite.test.tsx`.
    color: 0xff8800,
    opacity: 0.5,
    blending: 'additive',
    alphaMode: 'mask',
    alphaThreshold: 0.5,
    depthWrite: false,
    depthTest: true,
} satisfies AnimatedSpriteProps;

describe('the sprite appearance surface is authorable without three', () => {
    it('declares every appearance prop in a file that imports nothing from three', () => {
        const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');

        // The subpaths too, so `three/examples/...` cannot slip past a check
        // written only for the bare specifier.
        expect(source).not.toMatch(/['"]three(\/[^'"]*)?['"]/);

        // The control: the source really was read, and really is this file.
        expect(source).toContain('everyAppearanceProp');
    });

    it('publishes the five blending names and the three alpha modes as plain strings', () => {
        // Engine names, so a game's own constant or settings record can hold one
        // without reaching for a `three` type. Read back as values so the
        // enumeration is not only a type-level claim.
        expect(EVERY_BLENDING).toEqual(['normal', 'additive', 'subtractive', 'multiply', 'none']);
        expect(EVERY_ALPHA_MODE).toEqual(['opaque', 'mask', 'blend']);
        for (const name of [...EVERY_BLENDING, ...EVERY_ALPHA_MODE]) {
            expect(typeof name).toBe('string');
        }
    });

    it('takes every one of those names on the element’s props', () => {
        // The enumerations above are only meaningful if the component accepts
        // each member. Assignability is checked at every value, not just at the
        // one the literal above happens to use.
        const perBlending = EVERY_BLENDING.map(
            (blending) => ({ sheet: null, clip: 'run', blending }) satisfies AnimatedSpriteProps,
        );
        const perAlphaMode = EVERY_ALPHA_MODE.map(
            (alphaMode) => ({ sheet: null, clip: 'run', alphaMode }) satisfies AnimatedSpriteProps,
        );

        expect(perBlending).toHaveLength(5);
        expect(perAlphaMode).toHaveLength(3);
        expect(everyAppearanceProp.blending).toBe('additive');
    });
});
