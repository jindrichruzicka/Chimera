import { describe, expect, it } from 'vitest';
import { MatchScreenRegistry } from './index.js';

describe('MatchScreenRegistry', () => {
    it('registers a concrete summary screen for engine:post-match', () => {
        expect(MatchScreenRegistry.sceneDefaultScreens?.['engine:post-match']).toBe('summary');
        expect(MatchScreenRegistry.screens?.['summary']).toBeDefined();
    });
});
