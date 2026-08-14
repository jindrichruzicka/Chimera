// tools/invariant-52-guarantee.test.ts
//
// Anti-rot guard for Invariant #52's guarantee wording.
//
// History: #52 once claimed on-demand loads "are flagged by the `validate-assets`
// CI tool" — an OVERCLAIM (the tool had no call-site scan at all). That was first
// corrected to the opposite understatement ("does not scan ... call sites ...
// review/lint concern"). `validate-assets` now genuinely DOES statically scan
// scene/screen on-demand load call sites and flags an undeclared, statically-
// resolvable load (string literal, `buildAssetRef(...)`, or a manifest-const
// member) as a CI-blocking error — while WARNING (never failing) on dynamic refs
// and checking workspace-union membership rather than per-scene completeness (the
// imperative SceneRegistry Map exposes no file<->descriptor mapping).
//
// These assertions ratchet that PRECISE promise in all three places it lives:
// the doc must affirmatively state the detection is real, AND must keep the honest
// limits so a future reword can neither drop the capability (understatement) nor
// re-inflate it into the old unqualified overclaim. `readFileSync` throws if a doc
// moves, so the guard fails loud rather than passing vacuously on a renamed path.

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
 * The `**52.**` paragraph, isolated so the substring checks below are scoped to this
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

// Strip markdown emphasis and collapse whitespace so substring checks are
// reflow-proof and read the prose, not its formatting (`**not**` becomes "not").
function normalizedParagraph(): string {
    return invariant52Paragraph().replace(/\*/g, '').replace(/\s+/g, ' ');
}

describe('Invariant #52 guarantee wording', () => {
    it('affirmatively states validate-assets scans on-demand loads and flags undeclared ones', () => {
        // #52 must promise the mechanical detection that now exists — otherwise the
        // doc under-claims what CI actually enforces and reviewers stop trusting it.
        const text = normalizedParagraph();
        expect(text).toContain('scans');
        expect(text).toContain('undeclared on-demand load');
    });

    it('keeps the honest limits: dynamic refs warned, membership not per-scene', () => {
        // Guard against re-inflating the detection into the original unqualified
        // overclaim. The tool warns (never fails) on refs it cannot statically
        // resolve, and checks a workspace-wide union rather than per-scene
        // completeness — both facts must stay in the invariant.
        const text = normalizedParagraph();
        expect(text).toContain('warned');
        expect(text).toContain('not per-scene');
        // The two stale phrasings must never literally return: the old overclaim...
        expect(text).not.toContain('flagged by the');
        // ...and the interim "it's only a review/lint concern" understatement.
        expect(text).not.toContain('lint concern');
    });

    it('the scene-transitions doc reflects mechanical on-demand detection', () => {
        const doc = read(SCENE_FADE_DOC);
        expect(doc).toContain('on-demand load call sites');
        expect(doc).not.toContain('does not detect undeclared on-demand loads');
        expect(doc).not.toContain('review/lint concern');
    });

    it('the architecture overview states validate-assets catches resolvable on-demand loads', () => {
        const doc = read(OVERVIEW_DOC);
        expect(doc).toContain('statically catches this');
        expect(doc).not.toContain("won't catch it"); // the interim understatement
        expect(doc).not.toContain('will flag it'); // the original unqualified overclaim
    });

    it('names the runtime consumers the declaration gained, on both carriers', () => {
        // The third phase of the same wording, and the one this ratchet exists
        // to hold from here: `requiredAssets` was a declaration nothing read at
        // runtime, then a declaration two arms read. #52 has to name BOTH
        // carriers, because a reader who finds only one concludes that the other
        // entry path — a restore or a replay landing mid-scene — is ungated.
        const text = normalizedParagraph();
        expect(text).toContain('SceneTransitionState.requiredAssets');
        expect(text).toContain('BaseGameSnapshot.sceneRequiredAssets');
        // Bounded and fail-open, so the promise is not read as a blocking one.
        expect(text).toContain('fail-open');
        // And the limit that survives the wiring: a runtime fetch failure is
        // still invisible to the static tool.
        expect(text).toContain('cannot see');
    });

    it('does not let the scene-transitions doc go back to calling the arm unwired', () => {
        // `scene-transitions-fade.md` carried a "Not yet wired" block and a
        // "renders no progress bar" claim while the arm was a declaration only.
        // Both are now false, and neither may return by reword or by revert.
        const doc = read(SCENE_FADE_DOC);
        expect(doc).not.toContain('Not yet wired');
        expect(doc).not.toContain('renders no progress bar');
        // The over-claim on the other side is banned too: the ack is never
        // withheld on the outcome, so "preloads required assets before play
        // resumes" promises a guarantee the fail-open barrier does not make.
        expect(doc).not.toContain('preloads required assets before play resumes');
        // What must be there instead — the bounded, fail-open property a
        // reader can falsify against `useFadeTransition`.
        expect(doc).toContain('SCENE_PRELOAD_BUDGET_MS');
        expect(doc).toContain('fail-open');
    });
});
