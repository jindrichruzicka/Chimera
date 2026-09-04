import { describe, expect, it } from 'vitest';

import {
    DEFAULT_CURSOR_HOTSPOT,
    DEFAULT_REALTIME_RETAIN_ACTIONS,
    DEFAULT_TICK_RATE_MS,
    DEFAULT_WINDOW_TITLE,
    firstLanguageCode,
    MAX_ACTION_HISTORY_ENTRIES,
    resolveGameCursor,
    resolveGameLanguages,
    resolveGameLogoScreen,
    resolveMatchHistorySupport,
    resolveSpectatorSupport,
    resolveTickerHz,
    resolveWindowTitle,
    type GameLanguage,
    type GameLogoScreen,
    type GameMatchHistorySupport,
    type GameSpectatorSupport,
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

describe('resolveGameLanguages', () => {
    it('returns undefined when there is no manifest', () => {
        expect(resolveGameLanguages(undefined)).toBeUndefined();
    });

    it('returns undefined when the manifest declares no languages — single-language, selector stays hidden', () => {
        expect(resolveGameLanguages(makeManifest())).toBeUndefined();
    });

    it('returns undefined for an empty array', () => {
        expect(resolveGameLanguages(makeManifest({ languages: [] }))).toBeUndefined();
    });

    it('returns undefined for a single valid entry — single-language is behaviour-neutral', () => {
        const manifest = makeManifest({ languages: [{ code: 'en-US', label: 'English' }] });
        expect(resolveGameLanguages(manifest)).toBeUndefined();
    });

    it('resolves a valid two-entry array, preserving code and label', () => {
        const manifest = makeManifest({
            languages: [
                { code: 'en-US', label: 'English' },
                { code: 'cs-CZ', label: 'Čeština' },
            ],
        });
        expect(resolveGameLanguages(manifest)).toEqual([
            { code: 'en-US', label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ]);
    });

    it('dedupes duplicate codes, first occurrence wins', () => {
        const manifest = makeManifest({
            languages: [
                { code: 'en-US', label: 'English (first)' },
                { code: 'cs-CZ', label: 'Čeština' },
                { code: 'en-US', label: 'English (second)' },
            ],
        });
        expect(resolveGameLanguages(manifest)).toEqual([
            { code: 'en-US', label: 'English (first)' },
            { code: 'cs-CZ', label: 'Čeština' },
        ]);
    });

    it('drops an entry with a non-string code without throwing', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = [
            { code: 42, label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ] as unknown as readonly GameLanguage[];
        expect(resolveGameLanguages(makeManifest({ languages: malformed }))).toBeUndefined();
    });

    it('drops an entry with an empty-string code without throwing', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = [
            { code: '', label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ] as unknown as readonly GameLanguage[];
        expect(resolveGameLanguages(makeManifest({ languages: malformed }))).toBeUndefined();
    });

    it('drops an entry with a non-string label without throwing', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = [
            { code: 'en-US', label: 7 },
            { code: 'cs-CZ', label: 'Čeština' },
        ] as unknown as readonly GameLanguage[];
        expect(resolveGameLanguages(makeManifest({ languages: malformed }))).toBeUndefined();
    });

    it('drops an entry with an empty-string label without throwing', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = [
            { code: 'en-US', label: '' },
            { code: 'cs-CZ', label: 'Čeština' },
        ] as unknown as readonly GameLanguage[];
        expect(resolveGameLanguages(makeManifest({ languages: malformed }))).toBeUndefined();
    });

    it('returns undefined when dropping malformed entries brings the valid count below 2', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = [
            { code: 'en-US', label: 'English' },
            { code: '', label: 'Bad' },
            { code: 42, label: 'Also bad' },
        ] as unknown as readonly GameLanguage[];
        expect(resolveGameLanguages(makeManifest({ languages: malformed }))).toBeUndefined();
    });

    it('does not mutate the manifest languages array or its entries', () => {
        const languages = [
            { code: 'en-US', label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ] as const;
        const manifest = makeManifest({ languages });
        const resolved = resolveGameLanguages(manifest);
        expect(manifest.languages).toEqual([
            { code: 'en-US', label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ]);
        expect(resolved).not.toBe(languages);
    });
});

describe('firstLanguageCode', () => {
    it('returns undefined when there is no manifest', () => {
        expect(firstLanguageCode(undefined)).toBeUndefined();
    });

    it('returns undefined when languages is absent', () => {
        expect(firstLanguageCode(makeManifest())).toBeUndefined();
    });

    it('returns undefined when only a single valid entry is declared', () => {
        const manifest = makeManifest({ languages: [{ code: 'en-US', label: 'English' }] });
        expect(firstLanguageCode(manifest)).toBeUndefined();
    });

    it("returns the first resolved entry's code for a valid two-entry declaration", () => {
        const manifest = makeManifest({
            languages: [
                { code: 'en-US', label: 'English' },
                { code: 'cs-CZ', label: 'Čeština' },
            ],
        });
        expect(firstLanguageCode(manifest)).toBe('en-US');
    });

    it('returns the code that dedup determines survives at index 0', () => {
        const manifest = makeManifest({
            languages: [
                { code: 'cs-CZ', label: 'Čeština (first)' },
                { code: 'en-US', label: 'English' },
                { code: 'cs-CZ', label: 'Čeština (second)' },
            ],
        });
        expect(firstLanguageCode(manifest)).toBe('cs-CZ');
    });
});

describe('resolveSpectatorSupport', () => {
    it('returns undefined when there is no manifest', () => {
        expect(resolveSpectatorSupport(undefined)).toBeUndefined();
    });

    it('returns undefined when the manifest declares no spectators — the game never admits spectators', () => {
        expect(resolveSpectatorSupport(makeManifest())).toBeUndefined();
    });

    it("resolves a valid { mode: 'perspective' } declaration", () => {
        const manifest = makeManifest({ spectators: { mode: 'perspective' } });
        expect(resolveSpectatorSupport(manifest)).toEqual({ mode: 'perspective' });
    });

    it('rejects a malformed mode without throwing — a bad manifest must never brick a boot', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = { mode: 'public' } as unknown as GameSpectatorSupport;
        expect(resolveSpectatorSupport(makeManifest({ spectators: malformed }))).toBeUndefined();
    });

    it('rejects a non-string mode without throwing', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = { mode: 42 } as unknown as GameSpectatorSupport;
        expect(resolveSpectatorSupport(makeManifest({ spectators: malformed }))).toBeUndefined();
    });

    it('does not mutate the manifest spectators declaration and returns a fresh object', () => {
        const spectators = { mode: 'perspective' } as const;
        const manifest = makeManifest({ spectators });
        const resolved = resolveSpectatorSupport(manifest);
        expect(manifest.spectators).toEqual({ mode: 'perspective' });
        expect(resolved).not.toBe(spectators);
    });
});

describe('resolveMatchHistorySupport', () => {
    it('defaults a turn-based game to undo + replay with the full action-history ceiling', () => {
        expect(resolveMatchHistorySupport(makeManifest({ realtime: false }))).toEqual({
            undo: true,
            replay: true,
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
        });
    });

    it("resolves today's exact constants for a turn-based game with no declaration", () => {
        // Pins the byte-for-byte no-op requirement: the retention bound a
        // declaration-free turn-based game gets is the pre-feature constant.
        expect(MAX_ACTION_HISTORY_ENTRIES).toBe(10_000);
        expect(resolveMatchHistorySupport(makeManifest()).retainActions).toBe(10_000);
        expect(resolveMatchHistorySupport(makeManifest()).undo).toBe(true);
    });

    it('defaults a realtime game to no undo, replay on, and the realtime retention bound', () => {
        expect(resolveMatchHistorySupport(makeManifest({ realtime: true }))).toEqual({
            undo: false,
            replay: true,
            retainActions: DEFAULT_REALTIME_RETAIN_ACTIONS,
        });
    });

    it('bounds the realtime default below the turn-based ceiling', () => {
        expect(DEFAULT_REALTIME_RETAIN_ACTIONS).toBeGreaterThan(0);
        expect(DEFAULT_REALTIME_RETAIN_ACTIONS).toBeLessThan(MAX_ACTION_HISTORY_ENTRIES);
        expect(Number.isInteger(DEFAULT_REALTIME_RETAIN_ACTIONS)).toBe(true);
    });

    it('falls back to the turn-based defaults when there is no manifest at all', () => {
        expect(resolveMatchHistorySupport(undefined)).toEqual({
            undo: true,
            replay: true,
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
        });
    });

    it('keys the default off the same realtime reading resolveTickerHz uses', () => {
        // A manifest whose `realtime` is truthy but not `true` still runs a
        // ticker, so it must also get the realtime match-history default —
        // otherwise a realtime host would arm turn-based retention.
        const forged = makeManifest({ realtime: 1 as unknown as boolean });
        expect(resolveTickerHz(forged)).not.toBeNull();
        expect(resolveMatchHistorySupport(forged).undo).toBe(false);
        expect(resolveMatchHistorySupport(forged).retainActions).toBe(
            DEFAULT_REALTIME_RETAIN_ACTIONS,
        );
    });

    it('lets a turn-based game declare itself out of undo and replay', () => {
        const manifest = makeManifest({
            realtime: false,
            matchHistory: { undo: false, replay: false },
        });
        expect(resolveMatchHistorySupport(manifest)).toEqual({
            undo: false,
            replay: false,
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
        });
    });

    it('lets a realtime game declare itself back INTO undo and out of replay', () => {
        const manifest = makeManifest({
            realtime: true,
            matchHistory: { undo: true, replay: false },
        });
        expect(resolveMatchHistorySupport(manifest)).toEqual({
            undo: true,
            replay: false,
            retainActions: DEFAULT_REALTIME_RETAIN_ACTIONS,
        });
    });

    it('honours a declared retainActions within the ceiling', () => {
        const manifest = makeManifest({
            realtime: true,
            matchHistory: { undo: false, replay: true, retainActions: 250 },
        });
        expect(resolveMatchHistorySupport(manifest).retainActions).toBe(250);
    });

    it('honours a declared retainActions exactly ON the ceiling', () => {
        const manifest = makeManifest({
            realtime: true,
            matchHistory: {
                undo: false,
                replay: true,
                retainActions: MAX_ACTION_HISTORY_ENTRIES,
            },
        });
        expect(resolveMatchHistorySupport(manifest).retainActions).toBe(MAX_ACTION_HISTORY_ENTRIES);
    });

    it('honours a declared retainActions of exactly 1 — the low boundary', () => {
        const manifest = makeManifest({
            realtime: true,
            matchHistory: { undo: false, replay: true, retainActions: 1 },
        });
        expect(resolveMatchHistorySupport(manifest).retainActions).toBe(1);
    });

    it.each([
        ['zero', 0],
        ['negative', -5],
        ['non-integer', 12.5],
        ['above the ceiling', MAX_ACTION_HISTORY_ENTRIES + 1],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])(
        'drops a %s retainActions and falls back to the realtime default without throwing',
        (_label, retainActions) => {
            const manifest = makeManifest({
                realtime: true,
                matchHistory: { undo: false, replay: true, retainActions },
            });
            expect(() => resolveMatchHistorySupport(manifest)).not.toThrow();
            expect(resolveMatchHistorySupport(manifest).retainActions).toBe(
                DEFAULT_REALTIME_RETAIN_ACTIONS,
            );
        },
    );

    it('drops a non-number retainActions and falls back to the turn-based default', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = {
            undo: true,
            replay: true,
            retainActions: '500',
        } as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: false, matchHistory: malformed });
        expect(() => resolveMatchHistorySupport(manifest)).not.toThrow();
        expect(resolveMatchHistorySupport(manifest).retainActions).toBe(MAX_ACTION_HISTORY_ENTRIES);
    });

    it('drops a non-boolean undo and falls back to the realtime default for that field only', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = {
            undo: 'yes',
            replay: false,
        } as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: true, matchHistory: malformed });
        expect(resolveMatchHistorySupport(manifest)).toEqual({
            undo: false,
            replay: false,
            retainActions: DEFAULT_REALTIME_RETAIN_ACTIONS,
        });
    });

    it('falls back a non-boolean replay to the REPLAY default, not the undo one', () => {
        // On this fork `fallback.undo` and `fallback.replay` differ, so a
        // fallback read off the wrong field flips the resolved value.
        const malformed = {
            undo: false,
            replay: 'on',
        } as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: true, matchHistory: malformed });
        expect(resolveMatchHistorySupport(manifest).replay).toBe(true);
    });

    it('falls back a non-boolean undo to the UNDO default, not the replay one', () => {
        // Mirror of the case above, on the same fork.
        const malformed = {
            undo: 'on',
            replay: true,
        } as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: true, matchHistory: malformed });
        expect(resolveMatchHistorySupport(manifest).undo).toBe(false);
    });

    it('drops a non-boolean replay and falls back to the turn-based default for that field only', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = {
            undo: false,
            replay: null,
        } as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: false, matchHistory: malformed });
        expect(resolveMatchHistorySupport(manifest)).toEqual({
            undo: false,
            replay: true,
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
        });
    });

    it('drops a null matchHistory without throwing and falls back to every default', () => {
        const malformed = null as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: false, matchHistory: malformed });
        expect(() => resolveMatchHistorySupport(manifest)).not.toThrow();
        expect(resolveMatchHistorySupport(manifest)).toEqual({
            undo: true,
            replay: true,
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
        });
    });

    it('drops a non-object matchHistory and falls back to every default', () => {
        // Deliberately forges a declaration the types forbid, to exercise the
        // resolver's never-throws guarantee against malformed runtime input.
        const malformed = 'undo' as unknown as GameMatchHistorySupport;
        const manifest = makeManifest({ realtime: true, matchHistory: malformed });
        expect(() => resolveMatchHistorySupport(manifest)).not.toThrow();
        expect(resolveMatchHistorySupport(manifest)).toEqual({
            undo: false,
            replay: true,
            retainActions: DEFAULT_REALTIME_RETAIN_ACTIONS,
        });
    });

    it('does not mutate the declaration and returns a fresh object', () => {
        const matchHistory = { undo: true, replay: false, retainActions: 42 } as const;
        const manifest = makeManifest({ realtime: true, matchHistory });
        const resolved = resolveMatchHistorySupport(manifest);
        expect(manifest.matchHistory).toEqual({ undo: true, replay: false, retainActions: 42 });
        expect(resolved).not.toBe(matchHistory);
    });
});
