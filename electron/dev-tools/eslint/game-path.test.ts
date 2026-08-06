/**
 * electron/dev-tools/eslint/game-path.test.ts
 *
 * Contract for the shared "is this specifier a game" classifier.
 *
 * Three rules read it (`no-shell-games-import`, `no-main-games-import`,
 * `no-dynamic-games-import`) and so does the derivation in
 * `tools/eslint-dynamic-games-import-zone.test.ts`, which asks it whether a
 * `no-restricted-imports` group glob names a game. Each of those has its own
 * suite; none of them covers the two conjuncts below, which is what a shared
 * module with four callers has to own itself:
 *
 *   - `isTokensOverrideImport` requires `isGamesImport` as well as the filename.
 *     Without it, a shell page importing the ENGINE's own tokens-override path
 *     would be reported under Invariant #93;
 *   - both functions normalise backslashes, and BOTH copies are pinned. An
 *     import specifier is `/`-separated by spec, so the normalisation is cheap
 *     insurance — and untested, insurance is indistinguishable from dead code.
 *     One case per function, because the two are separate statements: dropping
 *     either one alone leaves the other's case green.
 */

import { describe, expect, it } from 'vitest';
import { isGamesImport, isTokensOverrideImport } from './game-path.js';

describe('isGamesImport', () => {
    it.each([
        ['apps/tactics/simulation/rules.js', true],
        ['../../apps/tactics/simulation/rules.js', true],
        ['games/tactics/rules.js', true],
        ['@chimera-engine/tactics', true],
        ['@chimera-engine/tactics/actions.js', true],
        // Engine packages share the scope; the allowlist separates them.
        ['@chimera-engine/simulation/foundation/logging.js', false],
        ['@chimera-engine/ai', false],
        ['@chimera-engine/networking/provider/MultiplayerProvider.js', false],
        ['@chimera-engine/renderer/components/ui', false],
        ['@chimera-engine/electron/main', false],
        // Both segment anchors: a prefix lookalike and a suffix one.
        ['../../webapps/thing.js', false],
        ['./gamestate.js', false],
        ['./local.js', false],
        // The scoped arm is anchored at the START of the specifier. A vendored
        // reach — `…/node_modules/@chimera-engine/<game>` — is deliberately NOT
        // a game here, and `check-invariants.sh` states its own regexes match
        // this classifier "including the scoped arm's anchor at the opening
        // quote". Nothing else in the repo holds that anchor.
        ['../../node_modules/@chimera-engine/tactics', false],
        ['./node_modules/@chimera-engine/tactics/actions.js', false],
    ])('classifies %s as a game: %s', (specifier, expected) => {
        expect(isGamesImport(specifier)).toBe(expected);
    });

    it('reads a backslash-separated path as segments, not as one opaque name', () => {
        // Dropping the normalisation leaves this false: the segment regex needs
        // a `/` before `apps`, and nothing else in the repo's suites supplies a
        // backslash specifier.
        expect(isGamesImport('..\\..\\apps\\tactics\\rules.js')).toBe(true);
    });
});

describe('isTokensOverrideImport', () => {
    it('accepts a GAME token override', () => {
        expect(isTokensOverrideImport('../../apps/tactics/styles/tokens-override.css')).toBe(true);
        expect(isTokensOverrideImport('@chimera-engine/tactics/styles/tokens-override.css')).toBe(
            true,
        );
    });

    it('rejects a tokens-override path that names no game', () => {
        // The load-bearing conjunct. Without `&& isGamesImport(n)` a shell page
        // importing a non-game `styles/tokens-override.css` would be reported
        // under Invariant #93, which binds GAME overrides only.
        expect(isTokensOverrideImport('./styles/tokens-override.css')).toBe(false);
        expect(isTokensOverrideImport('@chimera-engine/renderer/styles/tokens-override.css')).toBe(
            false,
        );
    });

    it('reads a backslash-separated path as segments, not as one opaque name', () => {
        // Its OWN normalisation, not `isGamesImport`'s: the tokens-override
        // regex needs a `/` before `styles`, so dropping this function's copy
        // leaves this false while every other case here stays green.
        expect(isTokensOverrideImport('..\\..\\apps\\tactics\\styles\\tokens-override.css')).toBe(
            true,
        );
    });

    it('rejects a game stylesheet that is not the token override', () => {
        expect(isTokensOverrideImport('../../apps/tactics/styles/theme.css')).toBe(false);
        // Its `styles/` is a SEGMENT, anchored at both ends like the game arm:
        // a directory whose name merely ends in `styles` is a different place.
        expect(isTokensOverrideImport('../../apps/tactics/mystyles/tokens-override.css')).toBe(
            false,
        );
        expect(isTokensOverrideImport('../../apps/tactics/styles/tokens-override.css.map')).toBe(
            false,
        );
    });
});
