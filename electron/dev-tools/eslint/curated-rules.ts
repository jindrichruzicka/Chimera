/**
 * electron/dev-tools/eslint/curated-rules.ts
 *
 * The curated standalone lint rule set — which Chimera lint rules a game gets
 * once it leaves the monorepo, at what severity, on which of its own zones. The
 * reasoning behind each verdict lives in §4.32; this file is the
 * machine-readable form of it.
 *
 * This module is PURE DATA. It imports neither the rule modules nor the
 * `eslint` types, so both the plugin assembly and the games-facing preset
 * factory can read it without a build, and a curation change is a one-file edit
 * rather than a scattered set of flat-config blocks.
 *
 * Two facts the rule ids do not carry:
 *
 * - Zone globs are stated relative to a game's app root, because a game runs
 *   `eslint .` from there. The monorepo's apps-prefixed form would match
 *   nothing.
 * - A rule fires only where the glob AND the rule's own internal path predicate
 *   agree. What those predicates want is the `apps/<name>/` SEGMENT, not a
 *   leading slash: they accept a relative filename as readily as an absolute
 *   one. Four rules want it — `no-fromfloat-in-simulation` on its `ai/**` arm
 *   (its other arm wants a `/simulation/` segment and is live anywhere);
 *   `no-unknown-token-overrides`, at `apps/<name>/styles/tokens-override.css`;
 *   `no-game-renderer-internals`; and `no-raw-r3f-canvas`. A scaffolded game
 *   satisfies all four because it lives at `apps/<kebab>` — which makes that
 *   layout part of this contract, and is why `preset.ts` spells out what a game
 *   at a bare project root loses. See `no-raw-r3f-canvas.test.ts` for its
 *   predicate under the filename shapes it is measured on.
 *   `no-animation-derivation-in-reduce` declares no path predicate, so its zones
 *   below are its WHOLE scope and both of them stay live wherever the game sits.
 */

/**
 * Severity a curated rule is configured at. Every entry is currently `error`;
 * the union widens the day a rule ships as advisory.
 */
export type CuratedLintSeverity = 'error';

/** One curated rule: what it is, how loud it is, and where it looks. */
export interface CuratedLintRule {
    /** Plugin-qualified rule id, as it appears in a flat-config `rules` block. */
    readonly ruleId: string;
    /** Severity for the rule's own zone blocks. */
    readonly severity: CuratedLintSeverity;
    /**
     * Globs linted through the default (JS/TS) language. Absent — never `[]` —
     * for a rule with no JS/TS zone: ESLint rejects a block whose `files` is an
     * empty array, so an empty array here would reach a consumer as a config
     * that fails to load rather than as a block it declines to emit.
     */
    readonly zones?: readonly string[];
    /**
     * Globs linted through the `@eslint/css` `css/css` language. Emitted as
     * separate flat-config blocks — a CSS file cannot be parsed by the TS
     * parser, so these can never be merged into `zones`.
     */
    readonly cssZones?: readonly string[];
    /**
     * Globs where the rule is switched back OFF by a block emitted AFTER its
     * zone blocks. Order is the whole mechanism: a flat config resolves a rule
     * from the last matching block, so an exemption emitted first does nothing.
     */
    readonly exemptZones?: readonly string[];
}

/** One rule deliberately withheld from games, with the reason it is withheld. */
export interface CuratedLintExclusion {
    readonly ruleId: string;
    readonly reason: string;
}

/**
 * The curated set, in the order the preset emits it.
 *
 * Severities and zones mirror the monorepo's own games-side blocks rather than
 * reinterpreting them: relocating the machinery must not retune what the rules
 * enforce.
 */
export const STANDALONE_LINT_RULES: readonly CuratedLintRule[] = [
    {
        // Invariant #76 — fromFloat() is permitted only at content-load time.
        // The engine's `simulation/content/loaders/` exemption needs no arm
        // here: the rule self-exempts that path from inside.
        ruleId: 'chimera/no-fromfloat-in-simulation',
        severity: 'error',
        zones: ['simulation/**/*.{ts,tsx}', 'ai/**/*.{ts,tsx}'],
        // Author fixtures build fixed-point values with fromFloat(); Invariant
        // #76 binds validate()/reduce() hot paths, not test code. Without this
        // arm a game's first simulation test reds on its own fixture builder.
        exemptZones: ['simulation/**/*.{test,spec}.{ts,tsx}', 'ai/**/*.{test,spec}.{ts,tsx}'],
    },
    {
        // Beat-owned animation windows compile at content-load, never from the
        // host's `tickRateMs` at reduce time. Same gameplay zones as the rule
        // above and for the same reason — a game's reducers are the hot path —
        // but with no internal predicate, so these two globs are the whole
        // scope. The exempt arm mirrors its sibling's: a window verifier is
        // exactly what a simulation test calls to assert its own sheet, and
        // without the arm a game's first animation test reds on that call.
        ruleId: 'chimera/no-animation-derivation-in-reduce',
        severity: 'error',
        zones: ['simulation/**/*.{ts,tsx}', 'ai/**/*.{ts,tsx}'],
        exemptZones: ['simulation/**/*.{test,spec}.{ts,tsx}', 'ai/**/*.{test,spec}.{ts,tsx}'],
    },
    {
        // Invariants #86 and #91 — design values flow through `var(--ch-*)`.
        // Screens only, mirroring the monorepo's games-side glob: that is where
        // a game's design-value-bearing UI is. A game's `renderer/` holds
        // loaders, `register.ts` and Next route re-exports — nothing to guard
        // rather than something noisy to avoid.
        //
        // Known gap, inherited from the monorepo and not widened here: a game's
        // `shell/` contributions are renderer surfaces under Invariant #96 but
        // get no design-value enforcement on either side of the boundary.
        ruleId: 'chimera/no-hardcoded-design-values',
        severity: 'error',
        zones: ['screens/**/*.{ts,tsx,js,jsx,mjs}'],
        // `styles/tokens-override.css` is absent by agreement AND by mechanism:
        // the monorepo gives that file the token rule below and only that rule,
        // and this rule gates its CSS visitors on a `.module.css` suffix, so it
        // is inert on any other stylesheet whatever the file contains.
        cssZones: ['screens/**/*.module.css'],
    },
    {
        // Invariant #85 — a game override may only redefine a declared token.
        // CSS-only: the rule's own guard matches the override file by name, so
        // it has no JS/TS zone at all.
        ruleId: 'chimera/no-unknown-token-overrides',
        severity: 'error',
        cssZones: ['styles/tokens-override.css'],
    },
    {
        // Invariant #96 — games consume the renderer only through its public
        // barrels. Whole-app zone: the rule's own guard decides which files
        // inside a game are renderer surfaces, and a forbidden deep import is
        // worth catching wherever it is written.
        ruleId: 'chimera/no-game-renderer-internals',
        severity: 'error',
        zones: ['**/*.{ts,tsx,js,jsx,mjs}'],
    },
    {
        // Invariant #127 — GameCanvas is the only canvas root a game mounts.
        // Whole-app zone for the same reason as its sibling above; the rule
        // header records the name-based rationale.
        ruleId: 'chimera/no-raw-r3f-canvas',
        severity: 'error',
        zones: ['**/*.{ts,tsx,js,jsx,mjs}'],
    },
];

/**
 * The four rules withheld, each with the reason. Recorded as data, not merely
 * omitted, so a rule dropped by accident is distinguishable from one withheld
 * on purpose.
 */
export const STANDALONE_LINT_EXCLUSIONS: readonly CuratedLintExclusion[] = [
    {
        // Invariants #80, #93 and #94.
        ruleId: 'chimera/no-shell-games-import',
        reason: "Keeps the ENGINE shell pages under renderer/app/ game-agnostic. Its predicate is directory-shaped — an /app/<shell-dir>/ segment — so it would be LIVE on a game's own Next host route tree, which ships all six of those directories. It is withheld because there the imports it forbids are legitimate: a game route naming its own game package is the app composing itself, not the engine acquiring a game dependency.",
    },
    {
        ruleId: 'chimera/no-main-games-import',
        reason: "Keeps engine main-process orchestration from importing a games package. Withheld for two independent reasons: its predicate requires an electron/main/ DIRECTORY segment, which a game's flat electron/main.ts never has, so the rule would guard nothing; and were the zone widened to reach it, that file is the sanctioned composition root that names exactly one game — precisely what the rule forbids elsewhere.",
    },
    {
        // Invariant #47.
        ruleId: 'chimera/no-main-provider-internals',
        reason: "Keeps engine main-process orchestration behind the public networking barrel. Withheld for the same two reasons as its sibling: the predicate requires an electron/main/ DIRECTORY segment a game's flat electron/main.ts never has, and that file is the composition root where wiring a concrete provider is the point.",
    },
    {
        // Invariant #1 (enforcement coverage).
        ruleId: 'chimera/no-dynamic-games-import',
        reason: 'Holds the dynamic import() position of the game ban in every zone whose no-restricted-imports group names a game. Withheld because it has no path predicate of its own — the declaring zone IS its scope — and it classifies a game by NAME: any non-engine @chimera-engine/* package. A scaffolded game IS one (@chimera-engine/<game-kebab>) and self-imports through that specifier, so a game that code-splits one of those self-imports would be reported for lazily loading itself, the exact inverse of the boundary the rule holds in the engine.',
    },
];
