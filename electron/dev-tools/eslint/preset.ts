/**
 * electron/dev-tools/eslint/preset.ts
 *
 * The games-facing flat-config preset (§4.32): the curated `chimera/*` rules,
 * mapped onto a game's own zones, ready to spread into its `eslint.config.mjs`.
 *
 * ## An overlay, not a base
 *
 * What comes back is the Chimera rule blocks and nothing else — no recommended
 * sets, no parser options, no global `ignores`. Those are the game's.
 *
 * ## Using it
 *
 *   const base = [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked];
 *
 *   export default [
 *       { ignores: ['dist/**', '.next/**'] },
 *       ...base,
 *       ...standaloneLintConfig({ css, silenceOnCss: base }),
 *       prettier,
 *   ];
 *
 * `silenceOnCss` is not decoration, and passing the base twice is not
 * redundancy. Two of the curated rules fire on CSS, which needs the
 * `@eslint/css` language — and a flat config resolves rules from EVERY matching
 * block, so a base with no `files` restriction has its JS rules applied to the
 * CSS source as well. That is not a false positive:
 *
 *   - `js.configs.recommended` → `no-irregular-whitespace` dies with
 *     `sourceCode.getAllComments is not a function`;
 *   - any TYPE-CHECKED `typescript-eslint` set (`recommendedTypeChecked`,
 *     `strictTypeChecked`, `stylisticTypeChecked`) → `await-thenable` or
 *     `dot-notation` dies demanding type information for a `.css` file.
 *
 * And it does not degrade — ESLint aborts the whole run, so a game linting one
 * unhandled stylesheet lints nothing at all.
 *
 * `js.configs.recommended` is silenced for free, because it is in effectively
 * every flat config. Everything else has to be named, because only the game
 * knows what it applies — a list enumerated here would cover the sets that
 * existed when it was written and no others. The cost of missing one is an
 * abort naming the rule and the `.css` file, which is loud; the reason to
 * prefer the game's own base is completeness, not the failure being quieter.
 *
 * A game whose base is already scoped to JS/TS files needs none of it.
 *
 * ## Two layout facts a rule id does not carry
 *
 *   - Zone globs are relative to the game's app root, because `files` globs
 *     resolve against the directory ESLint runs in.
 *   - Four of the six rules additionally require an `apps/<name>/` segment in the
 *     path — their own predicates read the segment, in a relative filename as
 *     readily as an absolute one. A game at
 *     `<project>/apps/<kebab>` satisfies that; the same game at a bare project
 *     root loses `no-game-renderer-internals`, `no-raw-r3f-canvas`, and
 *     `no-unknown-token-overrides`
 *     silently, and `no-fromfloat-in-simulation` keeps only its simulation arm.
 *     `no-animation-derivation-in-reduce` declares no predicate at all, so both
 *     of its zones survive that layout intact.
 *
 * ## What the CSS arm changes about `eslint .`
 *
 * It brings `.css` files into the run that were not linted before — that is how
 * the token rules reach them, and it is the one way this overlay widens rather
 * than narrows what the game's command touches.
 *
 * ## Why `@eslint/css` is resolved lazily
 *
 * It is an OPTIONAL peer dependency — lint-only, and it must not enter this
 * package's runtime closure. A module-top `import` would therefore break
 * `chimeraPlugin` too, for every consumer who never asked for the preset: ESM
 * evaluates imports before anything can decide they were not needed. It is
 * required on demand instead, inside the factory.
 *
 * Passing it in is the reliable route, not merely a convenience: under an
 * isolated package linker an optional peer is not installed beside this
 * package, so resolution from HERE can fail where the consumer's own succeeds.
 */

import { createRequire } from 'node:module';
import type { ESLint, Linter } from 'eslint';
import { chimeraPlugin } from './index.js';
import { STANDALONE_LINT_RULES, type CuratedLintRule } from './curated-rules.js';

const requireFromHere = createRequire(import.meta.url);

/**
 * The namespace this preset registers `@eslint/css` under, in the CSS blocks it
 * emits. Shared by the registration and the off-map's seed so those two cannot
 * drift: a game may name `css/*` rules without registering the plugin itself,
 * precisely because these blocks already did.
 *
 * The `css/css` language id beside it is a third coupled site and stays a
 * literal — changing this constant breaks it loudly at config load, so there is
 * nothing silent to guard against there.
 */
const CSS_NAMESPACE = 'css';

/** A flat-config object read for the rule ids it names, and for whose rules they are. */
export interface RuleBearingConfig {
    readonly rules?: Readonly<Record<string, unknown>> | undefined;
    /** Used to tell a language plugin's rules from a JS plugin's. */
    readonly plugins?: Readonly<Record<string, { readonly languages?: unknown }>> | undefined;
}

export interface StandaloneLintConfigOptions {
    /**
     * The `@eslint/css` plugin. Pass the consumer's own import; omitted, it is
     * resolved from this package, which works in a hoisted layout and can fail
     * in an isolated one.
     */
    readonly css?: ESLint.Plugin;
    /**
     * The game's own base config objects, whose rules are switched OFF on CSS
     * files. Needed for any unscoped rule set beyond `js.configs.recommended`,
     * which is silenced for free — most of all a type-checked
     * `typescript-eslint` set, which otherwise aborts the entire run on the
     * first stylesheet. See this module's header.
     *
     * Pass the whole base. Plugin registrations are read across everything
     * handed in, and across this preset's own blocks, which is what lets a
     * game's `css/*` rules survive however it chose to wire them.
     */
    readonly silenceOnCss?: readonly RuleBearingConfig[];
}

/** Loads the optional CSS peer, or explains both ways to supply it. */
function requireCssPlugin(): ESLint.Plugin {
    try {
        // `@eslint/css` ships CJS with an interop `default`; take that when it
        // is there so the plugin object is the one ESLint expects either way.
        const loaded = requireFromHere('@eslint/css') as { default?: ESLint.Plugin };
        return loaded.default ?? (loaded as ESLint.Plugin);
    } catch {
        throw new Error(
            'standaloneLintConfig() needs "@eslint/css", an optional peer dependency of @chimera-engine/electron that is not resolvable from it. ' +
                'Install it (npm i -D @eslint/css), or import it in your own config and pass it as the `css` option, which resolves it in your project.',
        );
    }
}

/**
 * `{ ruleId: 'off' }` for the rules that would otherwise run against a CSS file
 * under the JS language and crash.
 *
 * The hard part is telling those from the game's OWN CSS rules, which must
 * survive: silencing them would switch `css/*` off on precisely the stylesheets
 * this preset governs, with the run still exiting 0.
 *
 * A rule is left alone when its namespace names a plugin that brings its own
 * language. Registrations are collected across EVERY config handed in before
 * any rule is classified, because flat config resolves a file's language by
 * merging matching blocks — so a game may register `@eslint/css` in one block
 * and configure `css/*` rules in another, and both halves are in the array the
 * caller passed.
 *
 * Measured against the shapes a game actually writes: the plugin's documented
 * `extends: ['css/recommended']`, a self-contained `language` block, a setup
 * block plus a separate rules block, a narrower per-directory override, a
 * scoped or simple plugin alias, and rules named against this preset's own
 * registration. Each has a case in the suite.
 *
 * `chimera/*` ids are skipped too. The spread order in `cssZoneBlock` already
 * keeps the curated rule winning, so this is a second line rather than the only
 * one.
 */
function offMapFor(configs: readonly RuleBearingConfig[]): Record<string, Linter.RuleSeverity> {
    const languageNamespaces = languagePluginNamespacesIn(configs);
    const off: Record<string, Linter.RuleSeverity> = {};

    for (const config of configs) {
        for (const ruleId of Object.keys(config.rules ?? {})) {
            if (ruleId.startsWith('chimera/')) continue;
            if (ownedByALanguagePlugin(languageNamespaces, ruleId)) continue;
            off[ruleId] = 'off';
        }
    }

    return off;
}

/**
 * Every namespace a language-bringing plugin is registered under — by these
 * configs, or by the preset itself.
 *
 * The seed is the part that is easy to miss. This preset's own CSS blocks
 * register `@eslint/css`, and they are part of the merged config for the files
 * it governs, so a game can name `css/*` rules with no registration of its own
 * and ESLint resolves them. Reading only the caller's array would classify
 * those as JS-language rules and switch them off.
 */
function languagePluginNamespacesIn(configs: readonly RuleBearingConfig[]): ReadonlySet<string> {
    const namespaces = new Set<string>([CSS_NAMESPACE]);
    for (const config of configs) {
        for (const [namespace, plugin] of Object.entries(config.plugins ?? {})) {
            if (plugin?.languages !== undefined) namespaces.add(namespace);
        }
    }
    return namespaces;
}

/**
 * True when `ruleId` belongs to one of `namespaces`.
 *
 * A scoped plugin is registered under two segments (`@eslint/css`) while a
 * scoped RULE from an unscoped-name plugin has only one (`@typescript-eslint/x`),
 * so the longer candidate is tried first rather than splitting at the first
 * slash — which would read `@eslint/css/no-invalid-properties` as `@eslint`
 * and miss.
 */
function ownedByALanguagePlugin(namespaces: ReadonlySet<string>, ruleId: string): boolean {
    const parts = ruleId.split('/');
    if (parts.length < 2) return false; // a core rule; always the JS language

    if (parts.length >= 3 && namespaces.has(`${parts[0]}/${parts[1]}`)) return true;
    return namespaces.has(parts[0] ?? '');
}

/**
 * `@eslint/js`'s recommended rules, or none if it cannot be resolved from here.
 *
 * A free baseline under `silenceOnCss`, because `js.configs.recommended` is in
 * effectively every flat config and is unscoped, so without it the single most
 * common base aborts on the first stylesheet. Swallowing the resolution failure
 * is safe in the one direction that matters: the degrade is a LOUD abort naming
 * the offending rule, never a silent pass. A caller whose layout cannot resolve
 * it hands the same set over through `silenceOnCss` and loses nothing.
 */
function baselineJsRules(): RuleBearingConfig {
    try {
        const loaded = requireFromHere('@eslint/js') as {
            default?: { configs?: { recommended?: RuleBearingConfig } };
            configs?: { recommended?: RuleBearingConfig };
        };
        return (loaded.default ?? loaded).configs?.recommended ?? {};
    } catch {
        return {};
    }
}

/**
 * The curated Chimera rule blocks, in the order a flat config must see them.
 *
 * Exemptions come LAST, after every block they relax — the manifest's
 * `exemptZones` doc-comment explains why that ordering is the mechanism.
 */
export function standaloneLintConfig(options?: StandaloneLintConfigOptions): Linter.Config[] {
    const css = options?.css ?? requireCssPlugin();
    const cssRulesOff = offMapFor([baselineJsRules(), ...(options?.silenceOnCss ?? [])]);

    return [
        ...STANDALONE_LINT_RULES.flatMap((rule) => jsZoneBlock(rule) ?? []),
        ...STANDALONE_LINT_RULES.flatMap((rule) => cssZoneBlock(rule, css, cssRulesOff) ?? []),
        ...STANDALONE_LINT_RULES.flatMap((rule) => exemptBlock(rule) ?? []),
    ];
}

function jsZoneBlock(rule: CuratedLintRule): Linter.Config | undefined {
    const files = rule.zones ?? [];
    if (files.length === 0) return undefined;

    return {
        files: [...files],
        plugins: { chimera: chimeraPlugin },
        rules: { [rule.ruleId]: rule.severity },
    };
}

function cssZoneBlock(
    rule: CuratedLintRule,
    css: ESLint.Plugin,
    cssRulesOff: Record<string, Linter.RuleSeverity>,
): Linter.Config | undefined {
    const files = rule.cssZones ?? [];
    if (files.length === 0) return undefined;

    // The curated rule is spread LAST so it wins over anything
    // `cssRulesOff` carries.
    return {
        files: [...files],
        language: 'css/css',
        plugins: { [CSS_NAMESPACE]: css, chimera: chimeraPlugin },
        rules: { ...cssRulesOff, [rule.ruleId]: rule.severity },
    };
}

function exemptBlock(rule: CuratedLintRule): Linter.Config | undefined {
    const files = rule.exemptZones ?? [];
    if (files.length === 0) return undefined;

    return {
        files: [...files],
        rules: { [rule.ruleId]: 'off' },
    };
}
