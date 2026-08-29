// renderer/shell/shellRoutes.test.ts
//
// Pins the pure route helpers every shell-route consumer shares: the
// normalizer that makes a static-export `/credits/` compare equal to a declared
// `/credits`, the engine's own route tree, and the declared-route matcher.

import { describe, expect, it } from 'vitest';
import {
    classifyShellSurface,
    ENGINE_OWNED_ROUTES,
    isEngineOwnedRoute,
    matchesDeclaredShellRoute,
    normalizeRoutePath,
    SHELL_AUDIO_SURFACES,
    SHELL_BACKGROUND_SURFACES,
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

describe('classifyShellSurface — the engine surfaces', () => {
    it.each([
        ['/main-menu', 'main-menu'],
        ['/settings', 'settings'],
        ['/lobby', 'lobby'],
        ['/saves', 'saves'],
        ['/replays', 'replays'],
        ['/replays/player', 'replay-player'],
        ['/game', 'match'],
    ] as const)('classifies %s as %s', (pathname, surface) => {
        expect(classifyShellSurface(pathname, [])).toBe(surface);
    });

    it('classifies the replay BROWSER apart from the replay PLAYER', () => {
        // The reverse navigation gate acts on the player and not on the
        // browser, so one member for both would silently widen it.
        expect(classifyShellSurface('/replays', [])).not.toBe(
            classifyShellSurface('/replays/player', []),
        );
    });

    it.each(['/', '/logo-screen', '/debug', '/component-gallery'])(
        'classifies the engine route %s as boot — it carries no shell surface',
        (pathname) => {
            expect(classifyShellSurface(pathname, [])).toBe('boot');
        },
    );

    it('classifies every engine-owned route without consulting the declaration', () => {
        for (const route of ENGINE_OWNED_ROUTES) {
            expect(classifyShellSurface(route, [route])).toBe(classifyShellSurface(route, []));
        }
    });
});

describe('classifyShellSurface — declared game pages', () => {
    it('classifies a declared route as a page', () => {
        expect(classifyShellSurface('/credits', ['/credits'])).toBe('page');
    });

    it('classifies an UNdeclared non-engine route as boot rather than a page', () => {
        expect(classifyShellSurface('/credits', ['/atlas'])).toBe('boot');
    });

    it('classifies a declared route as a page before the declaration resolves only when it is in it', () => {
        expect(classifyShellSurface('/credits', [])).toBe('boot');
    });

    it('normalizes both sides, so every static-export spelling agrees', () => {
        expect(classifyShellSurface('/credits/', ['/credits'])).toBe('page');
        expect(classifyShellSurface('/credits/index.html', ['/credits'])).toBe('page');
        expect(classifyShellSurface('/credits', ['/credits/'])).toBe('page');
    });

    it('normalizes the engine spellings too', () => {
        expect(classifyShellSurface('/main-menu/', [])).toBe('main-menu');
        expect(classifyShellSurface('/replays/player/index.html', [])).toBe('replay-player');
    });

    it('never lets a declaration turn an engine route into a page', () => {
        expect(classifyShellSurface('/game', ['/game'])).toBe('match');
        expect(classifyShellSurface('/debug', ['/debug'])).toBe('boot');
    });

    it('classifies an absent pathname as boot', () => {
        expect(classifyShellSurface(null, ['/credits'])).toBe('boot');
        expect(classifyShellSurface(undefined, ['/credits'])).toBe('boot');
    });
});

describe('SHELL_BACKGROUND_SURFACES', () => {
    it('holds the three engine screens the background mounts on plus every game page', () => {
        expect([...SHELL_BACKGROUND_SURFACES].sort()).toEqual([
            'lobby',
            'main-menu',
            'page',
            'settings',
        ]);
    });

    it('excludes the match surface, so the background never paints over a match', () => {
        expect(SHELL_BACKGROUND_SURFACES.has('match')).toBe(false);
    });

    it('excludes boot, so an unclassified route paints nothing', () => {
        expect(SHELL_BACKGROUND_SURFACES.has('boot')).toBe(false);
    });
});

describe('SHELL_AUDIO_SURFACES', () => {
    it('holds every shell screen a menu bed plays across, including the two the background skips', () => {
        expect([...SHELL_AUDIO_SURFACES].sort()).toEqual([
            'lobby',
            'main-menu',
            'page',
            'replays',
            'saves',
            'settings',
        ]);
    });

    it('is a separate set from the background one, not an alias of it', () => {
        // The two answer different questions and the audio set is the wider of
        // them: `/saves` and `/replays` carry no background but do carry the bed,
        // so a shared constant would either silence those two or paint a
        // background on them.
        expect(SHELL_AUDIO_SURFACES).not.toBe(SHELL_BACKGROUND_SURFACES);
        expect(SHELL_AUDIO_SURFACES.has('saves')).toBe(true);
        expect(SHELL_BACKGROUND_SURFACES.has('saves')).toBe(false);
        expect(SHELL_AUDIO_SURFACES.has('replays')).toBe(true);
        expect(SHELL_BACKGROUND_SURFACES.has('replays')).toBe(false);
    });

    it('excludes the match surface, so the shell session never runs alongside a match', () => {
        expect(SHELL_AUDIO_SURFACES.has('match')).toBe(false);
    });

    it('excludes the replay player, which plays a match back rather than framing one', () => {
        expect(SHELL_AUDIO_SURFACES.has('replay-player')).toBe(false);
    });

    it('excludes boot, so the logo screen and the developer routes stay silent', () => {
        expect(SHELL_AUDIO_SURFACES.has('boot')).toBe(false);
    });
});
