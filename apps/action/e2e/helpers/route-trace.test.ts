import { describe, it, expect } from 'vitest';
import { visitedRoutePaths } from './route-trace';

/**
 * The reader half of the recorder — the part a spec compares against a literal
 * list, and the only part that runs in the RUNNER rather than being shipped into
 * the page as source text.
 *
 * Each collapse gets its own case. The route-trace assertion in `menu-flow` is
 * an exact `toEqual`, so a normalisation that stopped collapsing would not fail
 * quietly: it would fail on whatever the live app happened to push that run,
 * which is a fact about the app rather than about this function.
 */
describe('visitedRoutePaths', () => {
    it('drops the query, so two entries differing only by ?gameId= are one route', () => {
        expect(
            visitedRoutePaths(['/main-menu?gameId=action', '/main-menu?gameId=action&x=1']),
        ).toEqual(['/main-menu']);
    });

    it('drops the static export’s trailing slash', () => {
        expect(visitedRoutePaths(['/select/'])).toEqual(['/select']);
    });

    it('keeps the root, whose only character is that slash', () => {
        expect(visitedRoutePaths(['/'])).toEqual(['/']);
    });

    it('collapses consecutive duplicates but keeps a genuine revisit', () => {
        // The second `/main-menu` is a route the window came BACK to, with a
        // different one in between — the shape a leave-and-return produces, and
        // the one a blanket de-duplication would lose.
        expect(visitedRoutePaths(['/main-menu', '/main-menu', '/game', '/main-menu'])).toEqual([
            '/main-menu',
            '/game',
            '/main-menu',
        ]);
    });

    it('answers an empty trace with an empty list', () => {
        expect(visitedRoutePaths([])).toEqual([]);
    });
});
