/**
 * electron/dev-tools/eslint/curated-rules.test.ts
 *
 * Contract for the curated standalone lint rule set (§4.32).
 *
 * The manifest is the only place the curation decision lives, and both the
 * plugin assembly and the games-facing preset factory read it — so a silent
 * edit here changes what every scaffolded game enforces without touching
 * either consumer. What is locked is therefore the curation itself, value by
 * value, not that the constant parses:
 *
 *   - membership is EXACT in both directions, and each withheld rule carries a
 *     reason that names what it guards;
 *   - the zone globs, which mirror the monorepo's games-side blocks translated
 *     to app-root-relative form (§4.32 argues each one);
 *   - the fromFloat OFF arm on the simulation/ai test globs;
 *   - the encoding rule that "no zone of this language" is `undefined` and
 *     never `[]` — ESLint rejects a flat-config block whose `files` is empty,
 *     so an empty array would reach a consumer as a config that fails to load.
 */

import { describe, expect, it } from 'vitest';
import {
    STANDALONE_LINT_EXCLUSIONS,
    STANDALONE_LINT_RULES,
    type CuratedLintRule,
} from './curated-rules.js';

function ruleById(ruleId: string): CuratedLintRule {
    const entry = STANDALONE_LINT_RULES.find((rule) => rule.ruleId === ruleId);
    if (!entry) throw new Error(`curated rule "${ruleId}" is absent from STANDALONE_LINT_RULES`);
    return entry;
}

function allZones(rule: CuratedLintRule): readonly string[] {
    return [...(rule.zones ?? []), ...(rule.cssZones ?? []), ...(rule.exemptZones ?? [])];
}

/**
 * Each withheld rule, with what its recorded reason must name as the thing it
 * guards, plus a token unique to that rule. "Withheld" is the only property the
 * four share: three name a directory, and one names a property of the flat
 * config, because its scope is not a directory at all. The zone alone cannot
 * tell the two `no-main-*` reasons apart — they share `electron/main/` — and
 * those two are the pair most likely to be copy-pasted onto each other.
 */
const WITHHELD_RULES = [
    {
        ruleId: 'chimera/no-shell-games-import',
        guardedZone: 'renderer/app/',
        distinguishingToken: 'shell pages',
    },
    {
        ruleId: 'chimera/no-main-games-import',
        guardedZone: 'electron/main/',
        distinguishingToken: 'games package',
    },
    {
        ruleId: 'chimera/no-main-provider-internals',
        guardedZone: 'electron/main/',
        distinguishingToken: 'networking barrel',
    },
    {
        // The only withheld rule with no path predicate: its zone is not a
        // directory but a property of the config, so that property is what its
        // reason has to name. Stated without a count or a list, because the
        // set of such zones lives in eslint.config.mjs and is pinned there by
        // tools/eslint-dynamic-games-import-zone.test.ts.
        ruleId: 'chimera/no-dynamic-games-import',
        guardedZone: 'every zone whose no-restricted-imports group names a game',
        distinguishingToken: 'import() position',
    },
] as const;

describe('STANDALONE_LINT_RULES', () => {
    it('curates exactly the five games-side rules', () => {
        expect(STANDALONE_LINT_RULES.map((rule) => rule.ruleId)).toEqual([
            'chimera/no-fromfloat-in-simulation',
            'chimera/no-hardcoded-design-values',
            'chimera/no-unknown-token-overrides',
            'chimera/no-game-renderer-internals',
            'chimera/no-raw-r3f-canvas',
        ]);
    });

    it('omits every withheld boundary rule', () => {
        const curated = STANDALONE_LINT_RULES.map((rule) => rule.ruleId);
        for (const { ruleId } of WITHHELD_RULES) {
            expect(curated).not.toContain(ruleId);
        }
    });

    it('enables every curated rule at error severity', () => {
        for (const rule of STANDALONE_LINT_RULES) {
            expect(rule.severity).toBe('error');
        }
    });

    it('maps fromFloat onto the game gameplay zones with the test-file OFF arm', () => {
        const rule = ruleById('chimera/no-fromfloat-in-simulation');

        expect(rule.zones).toEqual(['simulation/**/*.{ts,tsx}', 'ai/**/*.{ts,tsx}']);
        expect(rule.exemptZones).toEqual([
            'simulation/**/*.{test,spec}.{ts,tsx}',
            'ai/**/*.{test,spec}.{ts,tsx}',
        ]);
        expect(rule.cssZones).toBeUndefined();
    });

    it('maps design values onto screens only — never a game renderer/ path', () => {
        const rule = ruleById('chimera/no-hardcoded-design-values');

        expect(rule.zones).toEqual(['screens/**/*.{ts,tsx,js,jsx,mjs}']);
        expect(rule.cssZones).toEqual(['screens/**/*.module.css']);
        expect(rule.exemptZones).toBeUndefined();

        for (const zone of allZones(rule)) {
            expect(zone.startsWith('renderer/')).toBe(false);
        }
    });

    it('maps unknown token overrides onto the CSS override file alone', () => {
        const rule = ruleById('chimera/no-unknown-token-overrides');

        expect(rule.zones).toBeUndefined();
        expect(rule.cssZones).toEqual(['styles/tokens-override.css']);
        expect(rule.exemptZones).toBeUndefined();
    });

    it('maps the renderer-barrel boundary onto the whole app', () => {
        const rule = ruleById('chimera/no-game-renderer-internals');

        expect(rule.zones).toEqual(['**/*.{ts,tsx,js,jsx,mjs}']);
        expect(rule.cssZones).toBeUndefined();
        expect(rule.exemptZones).toBeUndefined();
    });

    it('maps the raw-canvas ban onto the whole app', () => {
        const rule = ruleById('chimera/no-raw-r3f-canvas');

        expect(rule.severity).toBe('error');
        expect(rule.zones).toEqual(['**/*.{ts,tsx,js,jsx,mjs}']);
        expect(rule.cssZones).toBeUndefined();
        expect(rule.exemptZones).toBeUndefined();
    });

    it('states every zone glob relative to the game app root', () => {
        for (const rule of STANDALONE_LINT_RULES) {
            for (const zone of allZones(rule)) {
                expect(zone.startsWith('/')).toBe(false);
                expect(zone.includes('apps/')).toBe(false);
            }
        }
    });

    it('encodes an absent zone list as undefined, never as an empty array', () => {
        for (const rule of STANDALONE_LINT_RULES) {
            for (const list of [rule.zones, rule.cssZones, rule.exemptZones]) {
                if (list !== undefined) expect(list.length).toBeGreaterThan(0);
            }
        }
    });

    it('gives each rule at least one zone to guard', () => {
        for (const rule of STANDALONE_LINT_RULES) {
            expect(allZones(rule).length).toBeGreaterThan(0);
        }
    });
});

describe('STANDALONE_LINT_EXCLUSIONS', () => {
    it('records each withheld boundary rule left out', () => {
        expect(STANDALONE_LINT_EXCLUSIONS.map((exclusion) => exclusion.ruleId)).toEqual(
            WITHHELD_RULES.map((rule) => rule.ruleId),
        );
    });

    it('names what each withheld rule actually guards', () => {
        for (const { ruleId, guardedZone } of WITHHELD_RULES) {
            const exclusion = STANDALONE_LINT_EXCLUSIONS.find((entry) => entry.ruleId === ruleId);
            expect(exclusion?.reason, ruleId).toContain(guardedZone);
        }
    });

    it('gives each withheld rule a reason only that rule could carry', () => {
        for (const { ruleId, distinguishingToken } of WITHHELD_RULES) {
            const owner = STANDALONE_LINT_EXCLUSIONS.find((entry) => entry.ruleId === ruleId);
            expect(owner?.reason, ruleId).toContain(distinguishingToken);

            // The token has to be unique, or two reasons could each contain
            // both and still be swapped.
            const carriers = STANDALONE_LINT_EXCLUSIONS.filter((entry) =>
                entry.reason.includes(distinguishingToken),
            );
            expect(
                carriers.map((entry) => entry.ruleId),
                distinguishingToken,
            ).toEqual([ruleId]);
        }
    });

    it('partitions all nine plugin rules between curated and excluded', () => {
        const curated = STANDALONE_LINT_RULES.map((rule) => rule.ruleId);
        const excluded = STANDALONE_LINT_EXCLUSIONS.map((exclusion) => exclusion.ruleId);

        expect(new Set([...curated, ...excluded]).size).toBe(9);
        for (const ruleId of excluded) {
            expect(curated).not.toContain(ruleId);
        }
    });
});
