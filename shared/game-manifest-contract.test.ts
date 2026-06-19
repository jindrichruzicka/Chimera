import { describe, expect, it } from 'vitest';

import {
    DEFAULT_TICK_RATE_MS,
    DEFAULT_WINDOW_TITLE,
    resolveTickerHz,
    resolveWindowTitle,
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
