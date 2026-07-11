import { describe, expect, it } from 'vitest';

import {
    DEFAULT_CURSOR_HOTSPOT,
    DEFAULT_TICK_RATE_MS,
    DEFAULT_WINDOW_TITLE,
    resolveGameCursor,
    resolveGameLogoScreen,
    resolveTickerHz,
    resolveWindowTitle,
    type GameLogoScreen,
    type GameManifest,
} from './game-manifest-contract.js';

function makeManifest(overrides: Partial<GameManifest> = {}): GameManifest {
    return {
        gameId: 'sample',
        displayName: 'Sample',
        realtime: false,
        ...overrides,
    };
}

describe('resolveWindowTitle', () => {
    it('prefers an explicit windowTitle override', () => {
        const manifest = makeManifest({ displayName: 'Sample', windowTitle: 'Sample Game' });
        expect(resolveWindowTitle(manifest)).toBe('Sample Game');
    });

    it('falls back to displayName when no windowTitle is set', () => {
        const manifest = makeManifest({ displayName: 'Tactics' });
        expect(resolveWindowTitle(manifest)).toBe('Tactics');
    });

    it('falls back to the default title when there is no manifest', () => {
        expect(resolveWindowTitle(undefined)).toBe(DEFAULT_WINDOW_TITLE);
        expect(DEFAULT_WINDOW_TITLE).toBe('Chimera');
    });
});

describe('resolveTickerHz', () => {
    it('returns null for a turn-based (non-realtime) manifest — no ticker should run', () => {
        expect(resolveTickerHz(makeManifest({ realtime: false }))).toBeNull();
    });

    it('returns null when there is no manifest', () => {
        expect(resolveTickerHz(undefined)).toBeNull();
    });

    it('converts the default tick rate to Hz when realtime and tickRateMs is unset', () => {
        expect(DEFAULT_TICK_RATE_MS).toBe(50);
        // 1000 / 50ms = 20 Hz (the perf-budget baseline).
        expect(resolveTickerHz(makeManifest({ realtime: true }))).toBe(20);
    });

    it('converts an explicit tickRateMs interval to Hz', () => {
        expect(resolveTickerHz(makeManifest({ realtime: true, tickRateMs: 100 }))).toBe(10);
        expect(resolveTickerHz(makeManifest({ realtime: true, tickRateMs: 10 }))).toBe(100);
    });

    it('throws on a non-positive or non-finite tickRateMs', () => {
        expect(() => resolveTickerHz(makeManifest({ realtime: true, tickRateMs: 0 }))).toThrow(
            RangeError,
        );
        expect(() => resolveTickerHz(makeManifest({ realtime: true, tickRateMs: -5 }))).toThrow(
            RangeError,
        );
        expect(() =>
            resolveTickerHz(makeManifest({ realtime: true, tickRateMs: Number.NaN })),
        ).toThrow(RangeError);
    });
});

describe('resolveGameCursor', () => {
    it('returns undefined when there is no manifest', () => {
        expect(resolveGameCursor(undefined)).toBeUndefined();
    });

    it('returns undefined when the manifest declares no cursor — system cursor stays', () => {
        expect(resolveGameCursor(makeManifest())).toBeUndefined();
    });

    it('returns undefined for an empty cursor declaration — behaviour-neutral', () => {
        expect(resolveGameCursor(makeManifest({ cursor: {} }))).toBeUndefined();
    });

    it('resolves a full three-role declaration, preserving images and explicit hotspots', () => {
        const manifest = makeManifest({
            cursor: {
                default: { image: 'cursors/default.png', hotspot: { x: 2, y: 3 } },
                pointer: { image: 'cursors/pointer.png', hotspot: { x: 8, y: 1 } },
                disabled: { image: 'cursors/disabled.png', hotspot: { x: 16, y: 16 } },
            },
        });
        expect(resolveGameCursor(manifest)).toEqual({
            default: { image: 'cursors/default.png', hotspot: { x: 2, y: 3 } },
            pointer: { image: 'cursors/pointer.png', hotspot: { x: 8, y: 1 } },
            disabled: { image: 'cursors/disabled.png', hotspot: { x: 16, y: 16 } },
        });
    });

    it('resolves a partial declaration to only the declared roles', () => {
        const manifest = makeManifest({
            cursor: { pointer: { image: 'cursors/pointer.png' } },
        });
        const resolved = resolveGameCursor(manifest);
        expect(resolved).toBeDefined();
        expect(Object.keys(resolved ?? {})).toEqual(['pointer']);
    });

    it('defaults a missing hotspot to (0, 0)', () => {
        expect(DEFAULT_CURSOR_HOTSPOT).toEqual({ x: 0, y: 0 });
        const manifest = makeManifest({
            cursor: { default: { image: 'cursors/default.png' } },
        });
        expect(resolveGameCursor(manifest)).toEqual({
            default: { image: 'cursors/default.png', hotspot: { x: 0, y: 0 } },
        });
    });

    it('does not mutate the manifest cursor declaration when defaulting hotspots', () => {
        const cursor = { default: { image: 'cursors/default.png' } } as const;
        const manifest = makeManifest({ cursor });
        resolveGameCursor(manifest);
        expect(manifest.cursor).toEqual({ default: { image: 'cursors/default.png' } });
        expect(manifest.cursor?.default).not.toHaveProperty('hotspot');
    });
});

describe('resolveGameLogoScreen', () => {
    it('returns undefined when there is no manifest', () => {
        expect(resolveGameLogoScreen(undefined)).toBeUndefined();
    });

    it('returns undefined when the manifest declares no logoScreen — boot goes straight to the main menu, exactly as today', () => {
        expect(resolveGameLogoScreen(makeManifest())).toBeUndefined();
    });

    it('resolves a valid declaration, preserving the route', () => {
        const manifest = makeManifest({ logoScreen: { route: '/logo-screen' } });
        expect(resolveGameLogoScreen(manifest)).toEqual({ route: '/logo-screen' });
    });

    it('rejects a malformed route missing the leading slash without throwing — a bad manifest must never brick a packaged boot', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = { route: 'logo-screen' } as unknown as GameLogoScreen;
        expect(resolveGameLogoScreen(makeManifest({ logoScreen: malformed }))).toBeUndefined();
    });

    it('rejects a non-string route without throwing', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = { route: 42 } as unknown as GameLogoScreen;
        expect(resolveGameLogoScreen(makeManifest({ logoScreen: malformed }))).toBeUndefined();
    });

    it('rejects a route containing a query string — the host trailing-slash normalisation would land the slash inside the query and 404 the static export', () => {
        const manifest = makeManifest({ logoScreen: { route: '/logo-screen?autoplay=1' } });
        expect(resolveGameLogoScreen(manifest)).toBeUndefined();
    });

    it('rejects a route containing a fragment — same static-export 404 hazard as a query string', () => {
        const manifest = makeManifest({ logoScreen: { route: '/logo-screen#intro' } });
        expect(resolveGameLogoScreen(manifest)).toBeUndefined();
    });

    it('does not mutate the manifest logoScreen declaration', () => {
        const logoScreen = { route: '/logo-screen' } as const;
        const manifest = makeManifest({ logoScreen });
        const resolved = resolveGameLogoScreen(manifest);
        expect(manifest.logoScreen).toEqual({ route: '/logo-screen' });
        expect(resolved).not.toBe(logoScreen);
    });
});
