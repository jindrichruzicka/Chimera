import { describe, expect, it } from 'vitest';
import { MatchScreenRegistry } from './index.js';

describe('MatchScreenRegistry', () => {
    it('registers a concrete summary screen for engine:post-match', () => {
        expect(MatchScreenRegistry.sceneDefaultScreens?.['engine:post-match']).toBe('summary');
        expect(MatchScreenRegistry.screens?.['summary']).toBeDefined();
    });

    it('code-splits the summary screen behind React.lazy (Invariant #87)', () => {
        const summary = MatchScreenRegistry.screens?.['summary'];
        // React.lazy components are exotic objects, not plain functions.
        // Invariant #87: every screen exported from screens/index.ts must be
        // wrapped in React.lazy so it does not bloat the initial registry bundle.
        expect(typeof summary).toBe('object');
        expect(summary).not.toBeNull();
    });
});
