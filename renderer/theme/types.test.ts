/**
 * renderer/theme/types.test.ts
 *
 * Unit tests for the ThemeId branded type and its constructor helper.
 * Written first (red) per TDD mandate — themeId factory does not exist yet.
 *
 * Reference: TypeScript §1.3 (branded types), WARN-1.
 */

import { describe, expect, it } from 'vitest';
import { themeId } from './types';
import type { ThemeId } from './types';

describe('themeId', () => {
    it('wraps a raw string as a ThemeId', () => {
        const id = themeId('engine-default');
        expect(id).toBe('engine-default');
    });

    it('result is assignable to string', () => {
        const id: ThemeId = themeId('my-theme');
        const s: string = id;
        expect(s).toBe('my-theme');
    });

    it('preserves non-trivial theme identifier strings', () => {
        expect(themeId('tactics-dark')).toBe('tactics-dark');
        expect(themeId('game/my-theme_v2')).toBe('game/my-theme_v2');
    });

    it('preserves empty string', () => {
        expect(themeId('')).toBe('');
    });
});
