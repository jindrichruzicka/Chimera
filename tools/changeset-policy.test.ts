// tools/changeset-policy.test.ts
//
// Unit tests for the `verify:changeset-policy` bump-policy gate (issue #805, F66).
//
// Exercises the pure surface only — changeset frontmatter parsing, internal
// `@chimera-engine/*` dependency-graph construction, release merging (the strongest bump
// wins), and the centerpiece cascade rule (a `major` on a PUBLISHABLE package
// requires a `major` on every publishable package that depends on it, directly or
// transitively) — all with in-memory inputs, so no real `.changeset/` files, disk,
// or process is touched.
//
// The cascade encodes Appendix C.4 / Invariant #1: `@chimera-engine/simulation` is the
// zero-dependency leaf, so its breaking change is genuinely major and must propagate
// a major to every inward consumer.

import { describe, it, expect } from 'vitest';
import {
    BUMP_RANK,
    parseChangeset,
    buildDepGraph,
    transitiveDependents,
    mergeReleases,
    cascadeViolations,
    verifyChangesetPolicySelfTest,
    type ChangesetManifest,
    type ParsedChangeset,
} from './changeset-policy.js';

// ── Fixtures ────────────────────────────────────────────────────────────────────

/** A minimal model of the real graph: simulation leaf → ai/networking/renderer; electron → all; tactics private. */
const MANIFESTS: ChangesetManifest[] = [
    { name: '@chimera-engine/simulation', dependencies: { zod: '^4.0.0' } },
    { name: '@chimera-engine/ai', dependencies: { '@chimera-engine/simulation': 'workspace:*' } },
    {
        name: '@chimera-engine/networking',
        dependencies: { '@chimera-engine/simulation': 'workspace:*' },
    },
    {
        name: '@chimera-engine/renderer',
        dependencies: { '@chimera-engine/simulation': 'workspace:*' },
        peerDependencies: { react: '^19.0.0' },
    },
    {
        name: '@chimera-engine/electron',
        dependencies: {
            '@chimera-engine/simulation': 'workspace:*',
            '@chimera-engine/ai': 'workspace:*',
            '@chimera-engine/networking': 'workspace:*',
            '@chimera-engine/renderer': 'workspace:*',
        },
    },
    {
        name: '@chimera-engine/tactics',
        private: true,
        dependencies: {
            '@chimera-engine/simulation': 'workspace:*',
            '@chimera-engine/ai': 'workspace:*',
            '@chimera-engine/renderer': 'workspace:*',
            '@chimera-engine/electron': 'workspace:*',
        },
    },
];

// ── parseChangeset ───────────────────────────────────────────────────────────────

describe('parseChangeset', () => {
    it('parses single-quoted package keys and bump levels with the summary', () => {
        const content = [
            '---',
            "'@chimera-engine/simulation': major",
            "'@chimera-engine/ai': minor",
            '---',
            '',
            'Rework the action pipeline contract.',
            '',
        ].join('\n');

        const parsed = parseChangeset(content);

        expect(parsed.releases).toEqual({
            '@chimera-engine/simulation': 'major',
            '@chimera-engine/ai': 'minor',
        });
        expect(parsed.summary).toBe('Rework the action pipeline contract.');
    });

    it('accepts double-quoted and unquoted keys and ignores blank frontmatter lines', () => {
        const content = [
            '---',
            '"@chimera-engine/renderer": patch',
            '',
            '@chimera-engine/electron: major',
            '---',
            'Bump renderer and electron.',
        ].join('\n');

        expect(parseChangeset(content).releases).toEqual({
            '@chimera-engine/renderer': 'patch',
            '@chimera-engine/electron': 'major',
        });
    });

    it('returns no releases for an empty frontmatter but preserves the summary', () => {
        const content = ['---', '---', '', 'Docs-only note.'].join('\n');
        const parsed = parseChangeset(content);
        expect(parsed.releases).toEqual({});
        expect(parsed.summary).toBe('Docs-only note.');
    });
});

// ── buildDepGraph ────────────────────────────────────────────────────────────────

describe('buildDepGraph', () => {
    it('keeps only internal @chimera-engine/* edges and drops external deps', () => {
        const graph = buildDepGraph(MANIFESTS);

        expect(graph.dependsOn.get('@chimera-engine/simulation')).toEqual(new Set());
        expect(graph.dependsOn.get('@chimera-engine/ai')).toEqual(
            new Set(['@chimera-engine/simulation']),
        );
        expect(graph.dependsOn.get('@chimera-engine/electron')).toEqual(
            new Set([
                '@chimera-engine/simulation',
                '@chimera-engine/ai',
                '@chimera-engine/networking',
                '@chimera-engine/renderer',
            ]),
        );
    });

    it('records which packages are private', () => {
        const graph = buildDepGraph(MANIFESTS);
        expect(graph.privatePackages.has('@chimera-engine/tactics')).toBe(true);
        expect(graph.privatePackages.has('@chimera-engine/simulation')).toBe(false);
    });

    it('counts a peerDependency on an internal package as an edge', () => {
        const graph = buildDepGraph([
            { name: '@chimera-engine/simulation' },
            {
                name: '@chimera-engine/cards',
                peerDependencies: { '@chimera-engine/simulation': '^1.0.0' },
            },
        ]);
        expect(graph.dependsOn.get('@chimera-engine/cards')).toEqual(
            new Set(['@chimera-engine/simulation']),
        );
    });
});

// ── transitiveDependents ─────────────────────────────────────────────────────────

describe('transitiveDependents', () => {
    it('walks the reverse edges transitively (C depends on B depends on A ⇒ A has dependents B and C)', () => {
        const graph = buildDepGraph([
            { name: '@chimera-engine/a' },
            { name: '@chimera-engine/b', dependencies: { '@chimera-engine/a': 'workspace:*' } },
            { name: '@chimera-engine/c', dependencies: { '@chimera-engine/b': 'workspace:*' } },
        ]);
        expect(transitiveDependents(graph, '@chimera-engine/a')).toEqual(
            new Set(['@chimera-engine/b', '@chimera-engine/c']),
        );
    });

    it('returns every inward consumer of simulation', () => {
        const graph = buildDepGraph(MANIFESTS);
        expect(transitiveDependents(graph, '@chimera-engine/simulation')).toEqual(
            new Set([
                '@chimera-engine/ai',
                '@chimera-engine/networking',
                '@chimera-engine/renderer',
                '@chimera-engine/electron',
                '@chimera-engine/tactics',
            ]),
        );
    });
});

// ── mergeReleases ────────────────────────────────────────────────────────────────

describe('mergeReleases', () => {
    it('keeps the strongest bump per package across changesets (major > minor > patch)', () => {
        const sets: ParsedChangeset[] = [
            { releases: { '@chimera-engine/simulation': 'patch' }, summary: 'a' },
            {
                releases: { '@chimera-engine/simulation': 'major', '@chimera-engine/ai': 'minor' },
                summary: 'b',
            },
        ];
        expect(mergeReleases(sets)).toEqual({
            '@chimera-engine/simulation': 'major',
            '@chimera-engine/ai': 'minor',
        });
        expect(BUMP_RANK.major).toBeGreaterThan(BUMP_RANK.minor);
        expect(BUMP_RANK.minor).toBeGreaterThan(BUMP_RANK.patch);
    });
});

// ── cascadeViolations ────────────────────────────────────────────────────────────

describe('cascadeViolations', () => {
    const graph = buildDepGraph(MANIFESTS);

    it('flags every publishable dependent when simulation is majored alone', () => {
        const violations = cascadeViolations({ '@chimera-engine/simulation': 'major' }, graph);
        const flagged = violations.map((v) => v.pkg).sort();
        expect(flagged).toEqual([
            '@chimera-engine/ai',
            '@chimera-engine/electron',
            '@chimera-engine/networking',
            '@chimera-engine/renderer',
        ]);
        expect(violations.every((v) => v.requiredBy === '@chimera-engine/simulation')).toBe(true);
        expect(violations.every((v) => v.actual === 'none')).toBe(true);
    });

    it('passes when the major cascade is fully declared', () => {
        const violations = cascadeViolations(
            {
                '@chimera-engine/simulation': 'major',
                '@chimera-engine/ai': 'major',
                '@chimera-engine/networking': 'major',
                '@chimera-engine/renderer': 'major',
                '@chimera-engine/electron': 'major',
            },
            graph,
        );
        expect(violations).toEqual([]);
    });

    it('does not require a cascade for a minor or patch bump', () => {
        expect(cascadeViolations({ '@chimera-engine/simulation': 'minor' }, graph)).toEqual([]);
        expect(cascadeViolations({ '@chimera-engine/simulation': 'patch' }, graph)).toEqual([]);
    });

    it('exempts private packages from the major-cascade requirement', () => {
        // electron major requires its publishable dependents to major — but tactics is private.
        const violations = cascadeViolations({ '@chimera-engine/electron': 'major' }, graph);
        expect(violations).toEqual([]);
    });

    it('flags a dependent whose declared bump is too weak', () => {
        const violations = cascadeViolations(
            { '@chimera-engine/simulation': 'major', '@chimera-engine/ai': 'minor' },
            graph,
        );
        const ai = violations.find((v) => v.pkg === '@chimera-engine/ai');
        expect(ai?.actual).toBe('minor');
    });
});

// ── verifyChangesetPolicySelfTest ────────────────────────────────────────────────

describe('verifyChangesetPolicySelfTest', () => {
    it('PASSES only when the synthetic cascade violation is detected', async () => {
        const logs: string[] = [];
        const result = await verifyChangesetPolicySelfTest({ log: (m) => logs.push(m) });
        expect(result.ok).toBe(true);
        expect(logs.join('\n')).toMatch(/PASS/);
    });
});
