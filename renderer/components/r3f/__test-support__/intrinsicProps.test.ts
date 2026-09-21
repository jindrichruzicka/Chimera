// @vitest-environment jsdom

/**
 * renderer/components/r3f/__test-support__/intrinsicProps.test.ts
 *
 * The guard on the guard. The failure mode that would matter is `intrinsicProps`
 * answering an EMPTY object when react-dom's internal key is gone: every
 * `expect(props['transparent']).toBe(true)` built on it would still red loudly,
 * but every `toBeUndefined()` and every absent-prop check would pass vacuously,
 * and a reader would have no way to tell a ported helper from a dead one.
 *
 * So the throw is the behaviour, and it is pinned here rather than assumed —
 * alongside the happy path, so the helper's return value is not hostage to one
 * component test in another file.
 */

import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { intrinsicProps } from './intrinsicProps';

afterEach(() => {
    cleanup();
});

describe('intrinsicProps', () => {
    it('answers the committed props by value, for props the DOM drops or converts', () => {
        // Values chosen to differ from the default material's, so this cannot
        // pass by coincidence with the pin in `AnimatedSprite.test.tsx`, and a
        // helper returning a fixed object cannot satisfy both.
        const { container } = render(
            createElement(
                'mesh',
                null,
                createElement('meshbasicmaterial', {
                    transparent: false,
                    toneMapped: true,
                    alphaTest: 0.42,
                }),
            ),
        );

        const element = container.querySelector('meshbasicmaterial')!;

        // The premise this helper exists for, pinned where it is claimed rather
        // than assumed: react-dom drops BOTH booleans from the DOM — whatever
        // their value — and keeps only the number, stringified.
        // Without this, react-dom starting to serialise booleans would falsify
        // the helper's header and this test's name while the suite stayed green.
        expect(element.hasAttribute('transparent')).toBe(false);
        expect(element.hasAttribute('tonemapped')).toBe(false);
        expect(element.getAttribute('alphatest')).toBe('0.42');

        const props = intrinsicProps(element);

        expect(props['transparent']).toBe(false);
        expect(props['toneMapped']).toBe(true);
        expect(props['alphaTest']).toBe(0.42);
    });

    it('throws on a node React never committed, rather than answering an empty object', () => {
        // A hand-built element carries no `__reactProps$*` key — the same state
        // the node would be in if react-dom renamed it.
        const orphan = document.createElement('meshbasicmaterial');

        expect(() => intrinsicProps(orphan)).toThrow(/__reactProps\$\*/);
    });

    it('names the tag it failed on, so a suite-wide port says which read broke', () => {
        expect(() => intrinsicProps(document.createElement('meshstandardmaterial'))).toThrow(
            /<meshstandardmaterial>/,
        );
    });

    it('throws when the key holds null', () => {
        const node = document.createElement('meshbasicmaterial');
        Object.assign(node, { [`__reactProps$abc123`]: null });

        expect(() => intrinsicProps(node)).toThrow(/is null/);
    });

    it('throws when the key holds a non-null value that is not an object', () => {
        // The case the null fixture above does NOT reach: react-dom keeps the
        // key and changes what it stores. A cast would hand the caller a
        // string's own properties, which reads as a material with no prop set.
        const node = document.createElement('meshbasicmaterial');
        Object.assign(node, { [`__reactProps$abc123`]: 'not-props' });

        expect(() => intrinsicProps(node)).toThrow(/is string/);
    });
});
