/**
 * tools/verify-packaged-bundle.test.ts
 *
 * Pins the PREDICATES of the `verify:packaged-bundle` gate against synthetic
 * bundle text, the same way every sibling gate (`verify-pack`, `verify-scaffold`,
 * `changeset-policy`, `version-alignment`) has its check logic under test.
 *
 * Division of labour with the gate itself: the gate's own run validates its
 * predicates end-to-end against a REAL dev bundle (the negative control — every
 * predicate must reject it), which covers the wiring. What the real fixtures
 * cannot reach is covered here instead: the size floor, the inline-sourcemap
 * detector (a dev bundle never carries one), the request-channel regex's
 * negative lookahead (the sanctioned `chimera:debug:toggle-*` sends must NOT
 * fire it), and each `devRejectionGaps` failure mode in isolation.
 */

import { describe, it, expect } from 'vitest';

import { checkBundleText, devRejectionGaps, foldedGateFailure } from './verify-packaged-bundle.js';
import {
    ALL_DEBUG_GRAPH_MARKERS,
    DEBUG_BRIDGE_GLOBAL,
    DEBUG_PUSH_CHANNEL_LITERAL,
    FOLDED_GATE_LITERAL,
} from '../apps/tactics/electron/debug-bundle-markers.js';

/** Clears the size floor without tripping any content predicate. */
const PAD = 'const x = 1;\n'.repeat(200);

/** A synthetic DEV-shaped main bundle: every content predicate must fire on it. */
const DEV_SHAPED_MAIN = [
    PAD,
    ...ALL_DEBUG_GRAPH_MARKERS,
    // A bare request-channel occurrence (word boundary after), plus the push channel.
    "'chimera:debug' ",
    DEBUG_PUSH_CHANNEL_LITERAL,
].join('\n');

const checkIds = (code: string): string[] => checkBundleText('main', code).map((f) => f.check);

describe('checkBundleText', () => {
    it('passes clean text that clears the size floor', () => {
        expect(checkBundleText('main', PAD)).toEqual([]);
    });

    it('fails a truncated bundle on the size floor alone', () => {
        // Every content predicate is an absence check, so an empty file would
        // satisfy all of them — the floor is what keeps them falsifiable.
        expect(checkIds('const x = 1;')).toEqual(['size-floor']);
    });

    it.each(ALL_DEBUG_GRAPH_MARKERS.map((marker) => [marker]))(
        'fires marker check for %s',
        (marker) => {
            expect(checkIds(PAD + marker)).toEqual([`marker:${marker}`]);
        },
    );

    it('fires the request-channel check on a bare chimera:debug occurrence', () => {
        expect(checkIds(`${PAD}'chimera:debug' `)).toEqual(['request-channel']);
    });

    it('does NOT fire the request-channel check on the sanctioned toggle sends', () => {
        // `chimera:debug:toggle-inspector` / `:toggle-i18n-token-mode` are the
        // data-free sends Invariant #28 permits in a packaged preload; the
        // negative lookahead exists exactly so they pass.
        expect(checkIds(`${PAD}'chimera:debug:toggle-inspector'`)).toEqual([]);
        expect(checkIds(`${PAD}'chimera:debug:toggle-i18n-token-mode'`)).toEqual([]);
    });

    it('fires only the push-channel check on the push channel literal', () => {
        // The literal starts with `chimera:debug` followed by `:`, which the
        // request-channel lookahead rejects — the two checks stay independent.
        expect(checkIds(PAD + DEBUG_PUSH_CHANNEL_LITERAL)).toEqual(['push-channel']);
    });

    it('fires the bridge-global check', () => {
        expect(checkIds(PAD + DEBUG_BRIDGE_GLOBAL)).toEqual(['bridge-global']);
    });

    it('fires the inline-sourcemap check', () => {
        // Base64 hides every marker string, so an inline map ships the debug
        // sources while all absence checks stay green — it needs its own check,
        // and no real fixture exercises it (dev bundles emit external maps).
        expect(checkIds(`${PAD}//# sourceMappingURL=data:application/json;base64,AAAA`)).toEqual([
            'inline-sourcemap',
        ]);
    });
});

describe('foldedGateFailure', () => {
    it('fails a main bundle without the folded gate literal', () => {
        expect(foldedGateFailure(PAD)?.check).toBe('folded-gate-missing');
    });

    it('passes a main bundle carrying it', () => {
        expect(foldedGateFailure(PAD + FOLDED_GATE_LITERAL)).toBeUndefined();
    });
});

describe('devRejectionGaps (the negative control run against every dev build)', () => {
    const LIVE_PRELOAD = PAD + DEBUG_BRIDGE_GLOBAL;

    it('reports no gaps for a fully dev-shaped build', () => {
        expect(
            devRejectionGaps({ mainCode: DEV_SHAPED_MAIN, debugPreloadCode: LIVE_PRELOAD }),
        ).toEqual([]);
    });

    it('reports each marker whose check no longer fires', () => {
        // A gutted or rotted marker predicate must fail the GATE, not silently
        // narrow it — this is the per-predicate teeth of the control.
        const [dropped, ...kept] = ALL_DEBUG_GRAPH_MARKERS;
        const main = [PAD, ...kept, "'chimera:debug' ", DEBUG_PUSH_CHANNEL_LITERAL].join('\n');

        const gaps = devRejectionGaps({ mainCode: main, debugPreloadCode: LIVE_PRELOAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(dropped);
    });

    it('reports a missing request-channel rejection', () => {
        const main = [PAD, ...ALL_DEBUG_GRAPH_MARKERS, DEBUG_PUSH_CHANNEL_LITERAL].join('\n');
        const gaps = devRejectionGaps({ mainCode: main, debugPreloadCode: LIVE_PRELOAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('request channel');
    });

    it('reports a missing push-channel rejection', () => {
        const main = [PAD, ...ALL_DEBUG_GRAPH_MARKERS, "'chimera:debug' "].join('\n');
        const gaps = devRejectionGaps({ mainCode: main, debugPreloadCode: LIVE_PRELOAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(DEBUG_PUSH_CHANNEL_LITERAL);
    });

    it('reports a dev main that already carries the folded gate (packaged-shaped dev build)', () => {
        // The strongest wrong-environment signal: if the restore build emits
        // `IS_DEBUG_MODE = false`, the packaged flag leaked into the dev
        // environment and F9 is silently dead.
        const gaps = devRejectionGaps({
            mainCode: DEV_SHAPED_MAIN + FOLDED_GATE_LITERAL,
            debugPreloadCode: LIVE_PRELOAD,
        });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(FOLDED_GATE_LITERAL);
    });

    it('reports a dev build that emitted no debug preload', () => {
        const gaps = devRejectionGaps({ mainCode: DEV_SHAPED_MAIN, debugPreloadCode: undefined });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain('debug preload');
    });

    it('reports a debug preload without the bridge global', () => {
        // Proves the string the packaged absence check looks for is still the
        // string a live bridge actually carries.
        const gaps = devRejectionGaps({ mainCode: DEV_SHAPED_MAIN, debugPreloadCode: PAD });
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toContain(DEBUG_BRIDGE_GLOBAL);
    });
});
