/**
 * electron/dev-tools/eslint/index.test.ts
 *
 * Contract for the relocated `chimera` ESLint plugin (§4.32).
 *
 * The rules moved out of the never-published repo-root `tools/` and into the
 * published `@chimera-engine/electron`, following the dev-harness /
 * fetch-google-fonts / validate-assets / generate-icons precedent. What that
 * move can break is not the rule logic — it is everything the rules resolve
 * BY PATH, and the export shape their consumers compose against. Both are
 * locked here:
 *
 *   - the plugin is reachable at its new home as a NAMED `chimeraPlugin`, and
 *     carries all seven rules. The root config and the games-facing preset both
 *     compose against `{ chimeraPlugin }`, so a default export would leave two
 *     consumers importing `undefined` and registering an empty plugin — which
 *     ESLint accepts, and which silently disables every `chimera/*` rule;
 *   - the plugin's rule set and the curated manifest cover EXACTLY each other.
 *     The manifest's own test can only assert a hardcoded count; here the
 *     plugin is a sibling module, so an eighth rule added to one and not the
 *     other reds instead of being silently ungoverned;
 *   - no rule module derives a path from its own location any more. That is
 *     what a move re-aims: a walk-up anchored at the old home pointed at the
 *     repo root and would now point inside `electron/`, and from a published
 *     `dist/` at nothing a consumer has — a wrong file rather than an obvious
 *     absence.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ScriptKind,
    ScriptTarget,
    SyntaxKind,
    createSourceFile,
    forEachChild,
    isCallExpression,
    isIdentifier,
    isMetaProperty,
    isPropertyAccessExpression,
} from 'typescript';
import type { Node } from 'typescript';
import { chimeraPlugin } from './index.js';
import { STANDALONE_LINT_EXCLUSIONS, STANDALONE_LINT_RULES } from './curated-rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** eslint → dev-tools → electron → repo root. */
const repoRoot = resolve(__dirname, '..', '..', '..');

const EXPECTED_RULE_NAMES = [
    'no-fromfloat-in-simulation',
    'no-game-renderer-internals',
    'no-hardcoded-design-values',
    'no-unknown-token-overrides',
    'no-shell-games-import',
    'no-main-games-import',
    'no-main-provider-internals',
] as const;

describe('chimeraPlugin', () => {
    it('is a named export carrying all seven rules', () => {
        expect(Object.keys(chimeraPlugin.rules).sort()).toEqual([...EXPECTED_RULE_NAMES].sort());
    });

    it('exposes every rule as a create-able rule module', () => {
        for (const [name, rule] of Object.entries(chimeraPlugin.rules)) {
            expect(typeof rule.create, name).toBe('function');
            expect(rule.meta?.messages, name).toBeDefined();
        }
    });

    it('is covered exactly by the curated manifest and its exclusions', () => {
        const governed = new Set([
            ...STANDALONE_LINT_RULES.map((rule) => rule.ruleId),
            ...STANDALONE_LINT_EXCLUSIONS.map((exclusion) => exclusion.ruleId),
        ]);
        const shipped = new Set(Object.keys(chimeraPlugin.rules).map((name) => `chimera/${name}`));

        expect(governed).toEqual(shipped);
    });
});

/**
 * The retired home, assembled rather than written. The sweep below reads EVERY
 * source in this directory including this file, so spelling the path literally
 * here would make the test fail on itself — and the usual fix, excluding the
 * scanner from its own scan, reintroduces exactly the allowlist the sweep was
 * widened to remove.
 */
const RETIRED_PLUGIN_HOME = ['tools', 'eslint-plugin-chimera'].join('/');

/** Every TypeScript source under this directory, at any depth. */
function sourcesUnderEslintDir(): readonly { name: string; text: string }[] {
    return readdirSync(__dirname, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.ts'))
        .map((name) => ({ name, text: readFileSync(resolve(__dirname, name), 'utf8') }));
}

/** The rule modules, excluding their suites. */
function ruleSourceNames(): readonly string[] {
    return readdirSync(resolve(__dirname, 'rules')).filter(
        (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
}

/**
 * Every `import.meta` access in `file` that is NOT the sanctioned
 * `createRequire(import.meta.url)` seed, rendered as source text.
 */
function moduleLocationReadsIn(file: string): readonly string[] {
    const parsed = createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ScriptTarget.ESNext,
        /* setParentNodes */ true,
        ScriptKind.TS,
    );

    const offenders: string[] = [];

    const visit = (node: Node): void => {
        if (isMetaProperty(node) && node.keywordToken === SyntaxKind.ImportKeyword) {
            if (!isSanctionedResolverSeed(node)) {
                offenders.push((node.parent ?? node).getText(parsed));
            }
        }
        forEachChild(node, visit);
    };
    forEachChild(parsed, visit);

    return offenders;
}

/** True when `node` is the `import.meta` of a `createRequire(import.meta.url)` call. */
function isSanctionedResolverSeed(node: Node): boolean {
    const access = node.parent;
    if (access === undefined || !isPropertyAccessExpression(access)) return false;
    if (access.name.text !== 'url') return false;

    const call = access.parent;
    if (call === undefined || !isCallExpression(call)) return false;
    if (!isIdentifier(call.expression) || call.expression.text !== 'createRequire') return false;

    return call.arguments[0] === access;
}

describe('relocated rule modules', () => {
    const rulesDir = resolve(__dirname, 'rules');

    it('live beside the plugin index at its new home', () => {
        const modules = readdirSync(rulesDir)
            .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
            .map((name) => name.replace(/\.ts$/u, ''))
            .sort();

        expect(modules).toEqual([...EXPECTED_RULE_NAMES].sort());
    });

    it('name their own new home, and no retired path, anywhere in the moved tree', () => {
        // Nothing in this directory may still name the retired home — a header comment that does
        // is the cheapest kind of lie and the one a reader trusts most.
        //
        // Scanned over the WHOLE directory, not just `rules/` plus the index:
        // a hand-listed set of files is an allowlist, and its omissions are
        // silent. `curated-rules.ts` is the proof — it sits here, describes
        // these rules, and a rules-only sweep never looked at it.
        // Floor is EXACT: the seven rules, their seven suites, the plugin
        // index, this file, the curated manifest and its suite. Slack would let
        // a file drop out of the scan unnoticed, which is the one failure a
        // sweep cannot report on itself.
        expect(
            sourcesUnderEslintDir()
                .map((source) => source.name)
                .sort(),
        ).toHaveLength(EXPECTED_RULE_NAMES.length * 2 + 4);

        for (const { name, text } of sourcesUnderEslintDir()) {
            expect(text, name).not.toContain(RETIRED_PLUGIN_HOME);
        }

        const index = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(index).toContain('electron/dev-tools/eslint/index.ts');
    });

    it('derives no path from its own module location except to seed a resolver', () => {
        // The one rule that reads a file used to walk up from its own module
        // URL. At the old home that landed on the repo root; from here the same
        // expression lands inside `electron/`, and from the published `dist/`
        // at nothing a consumer has — a wrong file, not an obvious absence.
        //
        // So the ban is on the CAPABILITY rather than on one string form of one
        // depth. In ESM every route to a module's own location goes through
        // `import.meta`, so the property is: every `import.meta` access in a
        // rule is the `import.meta.url` passed directly to `createRequire`.
        // `new URL('../x', import.meta.url)`, `fileURLToPath(import.meta.url)`
        // and `import.meta.dirname` all violate it; a substring scan for
        // `../../../` catches none of them.
        //
        // Read from the AST, not the text. A text scan cannot tell an
        // expression from a sentence, and this very rule's doc-comment names
        // `import.meta.resolve` to explain why it is NOT used — under a text
        // scan the fix for that false positive is to reword the prose, which
        // is precisely the wrong incentive.
        const offenders = ruleSourceNames().flatMap((name) =>
            moduleLocationReadsIn(resolve(rulesDir, name)).map((expr) => `${name}: ${expr}`),
        );

        expect(offenders).toEqual([]);
    });

    it('names the renderer token subpath as the specifier it resolves', () => {
        // The declared CONSTANT, not the file's text: the same string appears
        // in the rule's doc-comment and in its report message, so a whole-file
        // scan stays green while the specifier actually resolved is changed.
        const source = readFileSync(resolve(rulesDir, 'no-unknown-token-overrides.ts'), 'utf8');
        expect(source).toContain(
            "const TOKENS_CSS_SPECIFIER = '@chimera-engine/renderer/styles/tokens.css'",
        );
    });

    it('leaves no rule source behind at the retired repo-root location', () => {
        // Scoped to the rule sources, which is what this move relocates. The
        // retired directory itself still holds the CJS shim the root config
        // loads until that config is repointed at the compiled subpath.
        expect(() => readdirSync(resolve(repoRoot, RETIRED_PLUGIN_HOME, 'rules'))).toThrow();
    });
});

/**
 * These two grade the BUILT artifact, not the source beside it, following the
 * sibling bins' precedent (`../generate-icons/bin.test.ts`). Two consequences,
 * neither visible from the assertions:
 *
 *   - a MISSING build fails them rather than skipping. The whole point of the
 *     relocation is that the plugin ships as compiled JS, and a smoke test that
 *     opts out when there is nothing to smoke proves less than none. `pnpm test`
 *     runs `build:packages` first, so the gate always has a build;
 *   - a STALE build is not detected — electron's own `test` script has no build
 *     step, so rebuild before trusting a green run of these.
 *
 * They run in a CHILD `node`, deliberately. The point is that the compiled
 * plugin loads with no TypeScript transform registered anywhere, and asserting
 * that from inside a Vitest worker — which has a transform pipeline attached to
 * everything it imports — would prove nothing about the consumer's Node.
 */
describe('compiled plugin', () => {
    const builtIndex = resolve(__dirname, '../../dist/dev-tools/eslint/index.js');

    /**
     * Two deliberate hostilities, both needed before this child can tell a
     * module-anchored resolve from any other kind:
     *
     *   - `cwd` OUTSIDE the workspace. Run from the repo root, a resolver
     *     anchored on `process.cwd()` reaches the renderer through the
     *     workspace symlink and succeeds, so the child would pass while proving
     *     nothing;
     *   - `NODE_PATH` STRIPPED. VITEST exports it inside its workers — its own
     *     resolution chain, ending in pnpm's hoisted `.pnpm/node_modules` layer
     *     — and every child inherits it. (Neither pnpm nor plain node sets
     *     it.) With it set, resolution succeeds from ANY anchor,
     *     including a deliberately wrong one, because Node consults `NODE_PATH`
     *     before giving up. That is a property of this repo's test runner, not
     *     of a consumer's install, and leaving it in place is what let a
     *     cwd-anchored mutant survive a probe written to catch it.
     *
     * With both applied, the only route to the renderer is the walk-up from the
     * module's own directory — which is the consumer's condition.
     */
    function runInFreshNode(script: string): string {
        const { NODE_PATH: _runnerResolutionChain, ...env } = process.env;

        return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
            encoding: 'utf8',
            cwd: tmpdir(),
            env,
        }).trim();
    }

    it('loads from dist with no TypeScript transform registered', () => {
        const output = runInFreshNode(`
            import { chimeraPlugin } from ${JSON.stringify(builtIndex)};
            console.log(Object.keys(chimeraPlugin.rules).sort().join(','));
        `);

        expect(output).toBe([...EXPECTED_RULE_NAMES].sort().join(','));
    });

    it('resolves its base token set through the renderer package, with no option passed', () => {
        // The production path, end to end: no injected fixture, so the rule has
        // to resolve `@chimera-engine/renderer/styles/tokens.css` from inside
        // `dist/` and read the real engine token set. A declared token must
        // stay silent and an undeclared one must report — the pair, because a
        // rule whose token set came back EMPTY would report both, and a rule
        // that failed open would report neither.
        const output = runInFreshNode(`
            import { chimeraPlugin } from ${JSON.stringify(builtIndex)};
            const rule = chimeraPlugin.rules['no-unknown-token-overrides'];
            const reported = [];
            const visitors = rule.create({
                filename: '/anywhere/apps/some-game/styles/tokens-override.css',
                options: [],
                sourceCode: { text: ':root { --ch-color-surface: #000; --ch-not-a-real-token: 1px; }' },
                report: (descriptor) => reported.push(descriptor.data.token),
            });
            visitors.StyleSheet({});
            console.log(JSON.stringify(reported));
        `);

        expect(JSON.parse(output)).toEqual(['--ch-not-a-real-token']);
    });
});
