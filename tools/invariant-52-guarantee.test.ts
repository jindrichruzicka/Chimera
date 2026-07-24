// tools/invariant-52-guarantee.test.ts
//
// Anti-rot guard for Invariant #52's guarantee wording.
//
// Invariant #52 once claimed that assets "loaded on-demand inside the new scene
// ... are flagged by the `validate-assets` CI tool." That promise was false.
// `tools/validate-assets.ts` only harvests DECLARED refs (requiredAssets arrays,
// asset manifests, content JSON, font `src`) and checks they resolve on disk and
// are manifest-covered (Invariant #22). It never scans `useAsset(` /
// `AssetManager.load(` call sites, so it cannot detect an UNDECLARED on-demand
// load — and per-scene completeness is undeliverable statically anyway (scenes
// register imperatively into a Map with no file<->descriptor mapping). Two audit
// groups reported the gap, and the docs were corrected to the tool's real
// guarantee.
//
// These assertions keep the false promise from silently returning, in ANY of the
// three places it lived. `readFileSync` throws if a doc moves, so the guard fails
// loud rather than passing vacuously on a renamed path — the Check 9 dead-code
// lesson applied to a doc ratchet.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const INVARIANTS_DOC = 'docs/executive-architecture/architecture-invariants.md';
const SCENE_FADE_DOC = 'docs/core-components/scene-transitions-fade.md';
const OVERVIEW_DOC = 'docs/architecture-overview.md';

/**
 * The `**52.**` paragraph, isolated so the flag-word ban below is scoped to this
 * invariant rather than the whole (large) invariants file. Bounded by the next
 * invariant marker so it survives Prettier reflowing #52 across lines.
 */
function invariant52Paragraph(): string {
    const match = /\*\*52\.\*\*[\s\S]*?(?=\*\*53\.\*\*)/.exec(read(INVARIANTS_DOC));
    expect(
        match,
        'Invariant #52 paragraph not found between the #52 and #53 markers — did the numbering change?',
    ).not.toBeNull();
    return match?.[0] ?? '';
}

describe('Invariant #52 guarantee wording', () => {
    it('Invariant #52 no longer claims validate-assets FLAGS on-demand loads', () => {
        // Ban the exact affirmative false phrasing, not the word "flag": the tool
        // legitimately DOES flag things (unmanifested declared refs, missing
        // files), and a correct negated reword ("cannot flag undeclared on-demand
        // loads") must stay allowed. The positive anchor below is what proves the
        // correction is actually present, so this only needs to catch a verbatim
        // return of the old promise.
        expect(invariant52Paragraph()).not.toContain('flagged by the');
    });

    it('Invariant #52 still states the tool does not scan on-demand call sites', () => {
        // Deleting the false phrase is not enough — the invariant must still
        // explain the tool's REAL limit, so a future reword that drops the
        // correction re-fails here. Emphasis markers are stripped so `**not**`
        // reads as "not".
        const normalized = invariant52Paragraph().replace(/\*/g, '');
        expect(normalized).toContain('does not scan');
        expect(normalized).toContain('call sites');
    });

    it('the scene-transitions doc drops the duplicate on-demand-flag claim', () => {
        expect(read(SCENE_FADE_DOC)).not.toContain('flags on-demand assets');
    });

    it('the architecture overview stops claiming validate-assets flags a useAsset ref', () => {
        expect(read(OVERVIEW_DOC)).not.toContain('will flag it');
    });
});
