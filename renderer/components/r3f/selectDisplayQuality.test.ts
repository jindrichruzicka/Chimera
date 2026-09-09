import { describe, expect, it } from 'vitest';
import { selectRenderScaleFraction, selectShadowQualityTier } from './selectDisplayQuality';
import type { SettingsStoreState } from '../../state/settingsStore';

/** A settings store holding one namespace's `display` values. */
function storeWith(
    gameId: string | null,
    settings: Readonly<Record<string, unknown>>,
): SettingsStoreState {
    return { activeGameId: gameId, settings } as unknown as SettingsStoreState;
}

describe('selectShadowQualityTier', () => {
    it("reads the active game's stored tier", () => {
        const state = storeWith('tactics', { tactics: { display: { shadowQuality: 'high' } } });

        expect(selectShadowQualityTier(state)).toBe('high');
    });

    // The same fallback AudioBus uses: with no game active the engine namespace
    // is what a settings page writes to, so an engine-wide choice has to reach
    // a canvas mounted before any game loads.
    it('falls back to the engine namespace when no game is active', () => {
        const state = storeWith(null, { __engine__: { display: { shadowQuality: 'medium' } } });

        expect(selectShadowQualityTier(state)).toBe('medium');
    });

    it('returns the engine default when the store carries no value', () => {
        expect(selectShadowQualityTier(storeWith(null, {}))).toBe('off');
        expect(selectShadowQualityTier(storeWith('tactics', { tactics: {} }))).toBe('off');
    });
});

describe('selectRenderScaleFraction', () => {
    it("reads the active game's stored fraction", () => {
        const state = storeWith('tactics', { tactics: { display: { renderScale: 0.75 } } });

        expect(selectRenderScaleFraction(state)).toBe(0.75);
    });

    it('falls back to the engine namespace when no game is active', () => {
        const state = storeWith(null, { __engine__: { display: { renderScale: 0.5 } } });

        expect(selectRenderScaleFraction(state)).toBe(0.5);
    });

    it('returns the engine default when the store carries no value', () => {
        expect(selectRenderScaleFraction(storeWith(null, {}))).toBe(1);
    });

    // The guard is on the TYPE, not on falsiness: a stored 0 would be a value
    // the schema rejects, and treating it as "unset" would hide it behind the
    // default rather than letting the coarse ratio show.
    it('ignores a stored value that is not a number', () => {
        const state = storeWith('tactics', { tactics: { display: { renderScale: '0.5' } } });

        expect(selectRenderScaleFraction(state)).toBe(1);
    });
});
