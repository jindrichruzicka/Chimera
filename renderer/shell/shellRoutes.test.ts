// renderer/shell/shellRoutes.test.ts
//
// Pins the pure route helpers every shell-route consumer shares: the
// normalizer that makes a static-export `/credits/` compare equal to a declared
// `/credits`, the engine's own route tree, and the declared-route matcher.

import { describe, expect, it } from 'vitest';
import {
    ENGINE_OWNED_ROUTES,
    isEngineOwnedRoute,
    matchesDeclaredShellRoute,
    normalizeRoutePath,
} from './shellRoutes';

describe('normalizeRoutePath', () => {
    it('returns the root path for a null pathname', () => {
        expect(normalizeRoutePath(null)).toBe('/');
    });

    it('returns the root path for an empty pathname', () => {
        expect(normalizeRoutePath('')).toBe('/');
    });

    it('leaves the root path alone rather than stripping it to the empty string', () => {
        expect(normalizeRoutePath('/')).toBe('/');
    });

    it('strips the trailing slash the static export serves', () => {
        expect(normalizeRoutePath('/credits/')).toBe('/credits');
    });

    it('strips a trailing /index.html', () => {
        expect(normalizeRoutePath('/credits/index.html')).toBe('/credits');
    });

    it('leaves an already-normalized path unchanged', () => {
        expect(normalizeRoutePath('/credits')).toBe('/credits');
    });

    it('normalizes a nested route on both spellings', () => {
        expect(normalizeRoutePath('/extras/credits/')).toBe('/extras/credits');
        expect(normalizeRoutePath('/extras/credits/index.html')).toBe('/extras/credits');
    });

    it('does not mistake a path segment ending in index.html for the export suffix', () => {
        // Only the `/index.html` SUFFIX is the export spelling; a segment that
        // merely ends with those characters is a different route.
        expect(normalizeRoutePath('/my-index.html')).toBe('/my-index.html');
    });
});

describe('ENGINE_OWNED_ROUTES / isEngineOwnedRoute', () => {
    it('contains every route the engine app tree ships', () => {
        expect([...ENGINE_OWNED_ROUTES].sort()).toEqual([
            '/',
            '/component-gallery',
            '/debug',
            '/game',
            '/lobby',
            '/logo-screen',
            '/main-menu',
            '/replays',
            '/replays/player',
            '/saves',
            '/settings',
        ]);
    });

    it('reports an engine route on either static-export spelling', () => {
        expect(isEngineOwnedRoute('/game')).toBe(true);
        expect(isEngineOwnedRoute('/game/')).toBe(true);
        expect(isEngineOwnedRoute('/replays/player/index.html')).toBe(true);
    });

    it('reports a route the engine does not ship as not engine-owned', () => {
        expect(isEngineOwnedRoute('/credits')).toBe(false);
        expect(isEngineOwnedRoute('/replays/archive')).toBe(false);
    });
});

describe('matchesDeclaredShellRoute', () => {
    it('is false when the game declares nothing', () => {
        expect(matchesDeclaredShellRoute('/credits', undefined)).toBe(false);
        expect(matchesDeclaredShellRoute('/credits', [])).toBe(false);
    });

    it('matches a declared route reached on the exported trailing-slash spelling', () => {
        expect(matchesDeclaredShellRoute('/credits/', ['/credits'])).toBe(true);
    });

    it('matches a declared route reached on the /index.html spelling', () => {
        expect(matchesDeclaredShellRoute('/credits/index.html', ['/credits'])).toBe(true);
    });

    it('matches when the DECLARATION carries the trailing slash', () => {
        expect(matchesDeclaredShellRoute('/credits', ['/credits/'])).toBe(true);
    });

    it('does not match a different route with a shared prefix', () => {
        expect(matchesDeclaredShellRoute('/credits-extra', ['/credits'])).toBe(false);
        expect(matchesDeclaredShellRoute('/credits/deep', ['/credits'])).toBe(false);
    });

    it('matches the second declared route, not only the first', () => {
        expect(matchesDeclaredShellRoute('/atlas', ['/credits', '/atlas'])).toBe(true);
    });

    it('is false for a null pathname even when a route is declared', () => {
        expect(matchesDeclaredShellRoute(null, ['/credits'])).toBe(false);
    });
});

describe('normalizeRoutePath — export spellings of the root', () => {
    it('normalizes the bare exported index file to the root path', () => {
        expect(normalizeRoutePath('/index.html')).toBe('/');
    });

    it('returns the root path for an undefined pathname', () => {
        expect(normalizeRoutePath(undefined)).toBe('/');
    });
});

describe('matchesDeclaredShellRoute — absent pathname', () => {
    it('is false for an undefined pathname even when a route is declared', () => {
        // Guarded explicitly rather than through the normalizer: `undefined`
        // normalizes to '/', which a declaration could otherwise match.
        expect(matchesDeclaredShellRoute(undefined, ['/'])).toBe(false);
        expect(matchesDeclaredShellRoute(null, ['/'])).toBe(false);
    });
});
