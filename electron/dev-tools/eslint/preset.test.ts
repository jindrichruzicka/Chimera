/**
 * electron/dev-tools/eslint/preset.test.ts
 *
 * Contract for the games-facing flat-config preset (§4.32).
 *
 * `standaloneLintConfig()` is an OVERLAY, not a base. It carries the curated
 * `chimera/*` rule blocks and nothing else, so a game spreads it onto its own
 * config and keeps ownership of parser options, ignores and every non-Chimera
 * rule. The two failure modes it has are opposite and both silent:
 *
 *   - emitting too MUCH — a `js.configs.recommended`, a base `no-restricted-*`
 *     block, a global `ignores` — quietly overrides decisions the game made,
 *     and the game author has no idea the preset is responsible;
 *   - emitting too LITTLE, or on the wrong glob — the rule is configured,
 *     reachable and reported by `--print-config`, and guards zero files.
 *
 * So the assertions are exact in both directions: every curated rule appears on
 * its curated zones at its curated severity, and nothing else appears at all.
 *
 * The one ordering fact that cannot be seen from a rule id: a flat config
 * resolves a rule from the LAST matching block, so the fromFloat test-file
 * exemption is only an exemption if it is emitted after the block it relaxes.
 */

import css from '@eslint/css';
import js from '@eslint/js';
import { Linter } from 'eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import type { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STANDALONE_LINT_RULES } from './curated-rules.js';
import { standaloneLintConfig } from './preset.js';

/** Blocks that configure `ruleId`, in emission order, with their severity. */
function blocksFor(
    config: readonly Linter.Config[],
    ruleId: string,
): { files: readonly string[]; severity: unknown; isCss: boolean }[] {
    return config
        .filter((block) => block.rules !== undefined && ruleId in block.rules)
        .map((block) => ({
            files: (block.files ?? []) as readonly string[],
            severity: (block.rules as Record<string, unknown>)[ruleId],
            isCss: (block as { language?: string }).language === 'css/css',
        }));
}

describe('standaloneLintConfig', () => {
    const config = standaloneLintConfig();

    it('emits a block for every curated rule and for nothing else', () => {
        const configured = new Set(
            config
                .flatMap((block) => Object.keys(block.rules ?? {}))
                .filter((id) => id.includes('/')),
        );
        const chimeraRules = [...configured].filter((id) => id.startsWith('chimera/')).sort();

        expect(chimeraRules).toEqual(
            [...new Set(STANDALONE_LINT_RULES.map((rule) => rule.ruleId))].sort(),
        );
    });

    it('registers the plugin in every block that switches a chimera rule on', () => {
        for (const block of config) {
            const enabled = Object.entries(block.rules ?? {}).filter(
                ([id, severity]) => id.startsWith('chimera/') && severity !== 'off',
            );
            if (enabled.length === 0) continue;

            expect(
                (block.plugins as Record<string, unknown> | undefined)?.['chimera'],
                JSON.stringify(block.files),
            ).toBeDefined();
        }
    });

    it('maps fromFloat onto the gameplay zones, with the OFF arm emitted after', () => {
        const blocks = blocksFor(config, 'chimera/no-fromfloat-in-simulation');

        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
            files: ['simulation/**/*.{ts,tsx}', 'ai/**/*.{ts,tsx}'],
            severity: 'error',
        });
        expect(blocks[1]).toMatchObject({
            files: ['simulation/**/*.{test,spec}.{ts,tsx}', 'ai/**/*.{test,spec}.{ts,tsx}'],
            severity: 'off',
        });
    });

    it('maps the animation-window derivation ban onto the gameplay zones, OFF arm after', () => {
        // The same two-block shape as its fromFloat sibling, and the ordering
        // matters for the same reason: a flat config resolves from the LAST
        // matching block, so the test-file arm relaxes nothing if it is emitted
        // first.
        const blocks = blocksFor(config, 'chimera/no-animation-derivation-in-reduce');

        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
            files: ['simulation/**/*.{ts,tsx}', 'ai/**/*.{ts,tsx}'],
            severity: 'error',
        });
        expect(blocks[1]).toMatchObject({
            files: ['simulation/**/*.{test,spec}.{ts,tsx}', 'ai/**/*.{test,spec}.{ts,tsx}'],
            severity: 'off',
        });
    });

    it('maps design values onto game screens, TS and CSS module arms alike', () => {
        const blocks = blocksFor(config, 'chimera/no-hardcoded-design-values');

        expect(blocks).toHaveLength(2);
        expect(blocks[0]).toMatchObject({
            files: ['screens/**/*.{ts,tsx,js,jsx,mjs}'],
            severity: 'error',
            isCss: false,
        });
        expect(blocks[1]).toMatchObject({
            files: ['screens/**/*.module.css'],
            severity: 'error',
            isCss: true,
        });
    });

    it('maps unknown token overrides onto the override file, through the CSS language', () => {
        const blocks = blocksFor(config, 'chimera/no-unknown-token-overrides');

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            files: ['styles/tokens-override.css'],
            severity: 'error',
            isCss: true,
        });
    });

    it('maps the renderer-barrel boundary onto the whole app', () => {
        const blocks = blocksFor(config, 'chimera/no-game-renderer-internals');

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            files: ['**/*.{ts,tsx,js,jsx,mjs}'],
            severity: 'error',
            isCss: false,
        });
    });

    it('maps the raw-canvas ban onto the whole app', () => {
        const blocks = blocksFor(config, 'chimera/no-raw-r3f-canvas');

        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({
            files: ['**/*.{ts,tsx,js,jsx,mjs}'],
            severity: 'error',
            isCss: false,
        });
    });

    it('registers the CSS language plugin on exactly the CSS blocks', () => {
        // The namespace is spelled out rather than imported from the source: a
        // test that restates the implementation cannot notice it changing.
        for (const block of config) {
            const isCss = (block as { language?: string }).language === 'css/css';
            const plugins = block.plugins as Record<string, unknown> | undefined;

            expect(plugins?.['css'] !== undefined, JSON.stringify(block.files)).toBe(isCss);
        }
    });
});

describe('overlay discipline', () => {
    const config = standaloneLintConfig();

    it('names no rule beyond the curated set, the js baseline, and what the caller silenced', () => {
        // Exact rather than "any id, as long as it is `off` on CSS" — that
        // looser form is equally satisfied by a hand-written base leaking in
        // through the CSS blocks.
        //
        // Three sources are legitimate and no fourth is: the curated rules, the
        // `js.configs.recommended` baseline the preset silences on its own, and
        // whatever the caller named.
        const silenced = { rules: { 'some-plugin/rule': 'error' } };
        const withSilencing = standaloneLintConfig({ silenceOnCss: [silenced] });
        const permitted = new Set([
            ...STANDALONE_LINT_RULES.map((rule) => rule.ruleId),
            ...Object.keys(js.configs.recommended.rules ?? {}),
            ...Object.keys(silenced.rules),
        ]);

        const offenders = withSilencing.flatMap((block) =>
            Object.keys(block.rules ?? {})
                .filter((id) => !permitted.has(id))
                .map((id) => `${JSON.stringify(block.files)}: ${id}`),
        );

        expect(offenders).toEqual([]);
        // The caller's id really is present, so the permit above is not just
        // absorbing everything.
        expect(withSilencing.flatMap((block) => Object.keys(block.rules ?? {}))).toContain(
            'some-plugin/rule',
        );
        // And the JS-zone blocks stay pure: only curated rules there.
        expect(
            config
                .filter((block) => (block as { language?: string }).language === undefined)
                .flatMap((block) =>
                    Object.keys(block.rules ?? {}).filter((id) => !id.startsWith('chimera/')),
                ),
        ).toEqual([]);
    });

    it('claims no files beyond the curated zones', () => {
        const curated = new Set(
            STANDALONE_LINT_RULES.flatMap((rule) => [
                ...(rule.zones ?? []),
                ...(rule.cssZones ?? []),
                ...(rule.exemptZones ?? []),
            ]),
        );

        for (const block of config) {
            for (const glob of block.files ?? []) {
                expect(curated, `unexpected zone ${String(glob)}`).toContain(glob);
            }
        }
    });

    it('emits no block that only ignores, and sets no global ignores', () => {
        for (const block of config) {
            // A block with `ignores` and no `files` is a GLOBAL ignore in flat
            // config — it removes files from the game's entire lint run, not
            // just from this overlay.
            const rules = Object.keys(block.rules ?? {}).join(',');
            expect((block.files ?? []).length > 0, `block configuring ${rules}`).toBe(true);
        }
    });

    it('sets no language options, parser, settings or linter options', () => {
        for (const block of config) {
            const wide = block as Record<string, unknown>;
            for (const key of ['languageOptions', 'linterOptions', 'settings', 'processor']) {
                expect(wide[key], `${key} on ${JSON.stringify(block.files)}`).toBeUndefined();
            }
        }
    });
});

/**
 * The overlay driven end to end against a synthetic game, because everything
 * above reads the config OBJECT and a rule can be configured, reachable and
 * still guard nothing.
 *
 * The two halves of the layout are deliberately different, and both are real:
 *
 *   - `files` globs resolve against the linter's CWD, which for a game is its
 *     own app root — so the zone globs are app-root-relative, as the manifest
 *     says;
 *   - a rule's own predicate reads the filename, and four of the six want an
 *     `apps/<name>/` segment in it — in a relative filename as readily as an
 *     absolute one.
 *
 * Get either half wrong and the rules go quiet, which is why the game path
 * (`<project>/apps/<kebab>`) is modelled rather than a bare directory.
 */
describe('composed onto a game base', () => {
    const APP_ROOT = '/p/apps/g';

    /** The idiomatic game base: recommended JS rules, unscoped. */
    const base: Linter.Config[] = [{ ...js.configs.recommended }];

    /**
     * The token rule's base set is pinned to a checked-in fixture rather than
     * the renderer's built `dist`, so this suite neither needs a package build
     * nor reds when the engine's token set changes under it. The block is appended
     * AFTER the overlay, so the CSS language and plugin registration under test
     * still come from the preset — only the rule's option is overridden.
     */
    const pinTokenFixture: Linter.Config[] = [
        {
            files: ['styles/tokens-override.css'],
            rules: {
                'chimera/no-unknown-token-overrides': [
                    'error',
                    {
                        tokensCssPath: resolve(
                            dirname(fileURLToPath(import.meta.url)),
                            '__test-support__/tokens.css',
                        ),
                    },
                ],
            },
        },
    ];

    function lint(
        relativePath: string,
        source: string,
        extra: Linter.Config[] = [],
    ): Linter.LintMessage[] {
        // `silenceOnCss: base` is the documented usage, not a workaround: the
        // base is unscoped, so without it the first stylesheet aborts the run.
        return new Linter({ cwd: APP_ROOT }).verify(
            source,
            [
                ...base,
                ...standaloneLintConfig({ silenceOnCss: base }),
                ...pinTokenFixture,
                ...extra,
            ],
            `${APP_ROOT}/${relativePath}`,
        );
    }

    it('lets a CSS file through a JS base that would otherwise crash on it', () => {
        // Without the off-switches the base's `no-irregular-whitespace` runs
        // against the CSS AST and throws `sourceCode.getAllComments is not a
        // function`, aborting the run. `js.configs.recommended` is the one set
        // the preset silences on its own, so this passes with no option — every
        // other unscoped set has to be named.
        const messages = lint(
            'styles/tokens-override.css',
            ':root {\n    --ch-color-surface: #101010;\n}\n',
        );

        expect(messages.filter((message) => message.fatal)).toEqual([]);
    });

    it('reports a planted unknown token, and stays silent on a declared one', () => {
        // Both tokens separate the FIXTURE's set from the engine's, so the pin
        // above is observable: `--ch-fixture-only-token` exists only in the
        // fixture and `--ch-color-surface-raised` only in the engine's real
        // stylesheet. A case built from tokens both sets share would pass
        // identically whether the pin applied or not.
        const declared = lint(
            'styles/tokens-override.css',
            ':root {\n    --ch-fixture-only-token: 1px;\n}\n',
        );
        const unknown = lint(
            'styles/tokens-override.css',
            ':root {\n    --ch-color-surface-raised: #101010;\n}\n',
        );

        expect(declared.map((message) => message.ruleId)).toEqual([]);
        expect(unknown.map((message) => message.ruleId)).toEqual([
            'chimera/no-unknown-token-overrides',
        ]);
    });

    it('reports a planted fromFloat in simulation, and exempts the same call in a test', () => {
        const source = `import { fromFloat } from '@chimera-engine/simulation/engine/FixedPoint.js';\nexport const x = fromFloat(1.5);\n`;

        expect(lint('simulation/rules.ts', source).map((m) => m.ruleId)).toEqual([
            'chimera/no-fromfloat-in-simulation',
        ]);
        // The OFF arm, on identical source. Without it a game's first
        // simulation test reds on its own fixture builder.
        expect(lint('simulation/rules.test.ts', source).map((m) => m.ruleId)).toEqual([]);
    });

    it('reports a planted hardcoded design value in a screen', () => {
        const messages = lint(
            'screens/Board.jsx',
            `export function Board() {\n    return <div style={{ padding: '12px' }} />;\n}\n`,
            [
                {
                    files: ['**/*.jsx'],
                    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
                },
            ],
        );

        expect(messages.map((message) => message.ruleId)).toEqual([
            'chimera/no-hardcoded-design-values',
        ]);
    });

    it('reports a planted deep renderer import anywhere in the game', () => {
        // The fourth curated rule, proved here because the end-to-end scaffold
        // gate plants only the other three.
        const messages = lint(
            'screens/Deep.jsx',
            `import { Button } from '@chimera-engine/renderer/components/ui/Button';\nexport const B = Button;\n`,
        );

        expect(messages.map((message) => message.ruleId)).toEqual([
            'chimera/no-game-renderer-internals',
        ]);
    });

    it('leaves an untouched game file alone', () => {
        // The floor. Every assertion above is equally satisfied by an overlay
        // that reports on everything.
        expect(lint('simulation/clean.ts', 'export const x = 1;\n')).toEqual([]);
        expect(lint('screens/Clean.jsx', 'export const x = 1;\n')).toEqual([]);
        expect(
            lint('styles/tokens-override.css', ':root {\n    --ch-radius-md: 4px;\n}\n'),
        ).toEqual([]);
    });
});

describe('CSS language plugin resolution', () => {
    it('registers the INJECTED plugin, not one it resolved itself', () => {
        // A sentinel, not the real `@eslint/css`. Under this repo's layout the
        // lazily-required plugin is the SAME object the test would import, so
        // asserting against the real one passes just as well when the injected
        // value is thrown away — and injection is the route documented as
        // reliable where the lazy resolve is not.
        const sentinel = { languages: {}, rules: {} } as unknown as ESLint.Plugin;
        const injected = standaloneLintConfig({ css: sentinel });
        const cssBlocks = injected.filter(
            (block) => (block as { language?: string }).language === 'css/css',
        );

        expect(cssBlocks.length).toBeGreaterThan(0);
        for (const block of cssBlocks) {
            expect((block.plugins as Record<string, unknown>)['css']).toBe(sentinel);
        }
    });

    it('resolves @eslint/css itself when none is injected', () => {
        const resolved = standaloneLintConfig();
        const cssBlock = resolved.find(
            (block) => (block as { language?: string }).language === 'css/css',
        );

        expect((cssBlock?.plugins as Record<string, unknown>)['css']).toBe(css);
    });
});

describe('the lint-only peer declarations', () => {
    it.each(['@eslint/css', '@eslint/js'])(
        'declares %s OPTIONAL, never as a dependency',
        (peer) => {
            // `verify:publish`'s depcheck cannot see this edge: the specifier is an
            // argument to an indirect `createRequire` call, not a static import, so
            // its AST scan extracts nothing. Deleting the declaration would leave
            // that gate green while a consumer's install stopped providing the
            // package — so the declaration is ratcheted here instead.
            //
            // Optional is the load-bearing half: package managers auto-install a
            // non-optional peer, which would put a lint-only package into the tree
            // of every game that never lints.
            const manifest = JSON.parse(
                readFileSync(
                    resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json'),
                    'utf8',
                ),
            ) as {
                dependencies?: Record<string, string>;
                peerDependencies?: Record<string, string>;
                peerDependenciesMeta?: Record<string, { optional?: boolean }>;
            };

            expect(manifest.peerDependencies?.[peer], peer).toBeDefined();
            expect(manifest.peerDependenciesMeta?.[peer]?.optional, peer).toBe(true);
            expect(manifest.dependencies?.[peer], peer).toBeUndefined();
        },
    );
});

describe('silenceOnCss', () => {
    /**
     * The option is the ONLY thing standing between a game and a whole-run
     * abort, so it is exercised against the config sets that actually abort —
     * not just asserted to appear in the output.
     */
    const APP_ROOT = '/p/apps/g';
    const CSS_FILE = `${APP_ROOT}/styles/tokens-override.css`;
    const CSS_SOURCE = ':root {\n    --ch-color-surface: #101010;\n}\n';

    function lintCssUnder(base: Linter.Config[], silenceOnCss?: Linter.Config[]): string {
        try {
            const overlay = silenceOnCss
                ? standaloneLintConfig({ silenceOnCss })
                : standaloneLintConfig();
            new Linter({ cwd: APP_ROOT }).verify(CSS_SOURCE, [...base, ...overlay], CSS_FILE);
            return 'ok';
        } catch (error) {
            return `threw: ${String((error as Error).message).slice(0, 60)}`;
        }
    }

    it.each([
        [
            'tseslint recommendedTypeChecked',
            tseslint.configs.recommendedTypeChecked,
            /await-thenable/u,
        ],
        ['tseslint strictTypeChecked', tseslint.configs.strictTypeChecked, /await-thenable/u],
        ['tseslint stylisticTypeChecked', tseslint.configs.stylisticTypeChecked, /dot-notation/u],
    ])('rescues a CSS file from an unscoped %s base', (_label, base, crash) => {
        const configs = base as Linter.Config[];

        // Both directions, and the failing half names the RULE it expects. A
        // bare "it threw" is satisfied by a throw from anywhere, including a
        // malformed block the preset itself emitted — which would make the
        // hazard look real while proving nothing about it.
        expect(lintCssUnder(configs)).toMatch(crash);
        expect(lintCssUnder(configs, configs)).toBe('ok');
    });

    it('leaves the game its OWN css rules', () => {
        // The caller is told to hand over its base wholesale, and a base very
        // often carries the game's own `css/css` block. Silencing that would
        // switch the game's `css/*` rules off on exactly the two stylesheets
        // this preset governs — and the run would still exit 0, which is the
        // one failure shape that survives a green gate.
        const gameCssBlock: Linter.Config = {
            files: ['**/*.css'],
            language: 'css/css',
            plugins: { css: css as unknown as ESLint.Plugin },
            rules: { 'css/no-invalid-properties': 'error' },
        };
        const base = [{ ...js.configs.recommended }, gameCssBlock] as Linter.Config[];

        const messages = new Linter({ cwd: APP_ROOT }).verify(
            ':root {\n    --ch-radius-md: 4px;\n    colr: red;\n}\n',
            [...base, ...standaloneLintConfig({ silenceOnCss: base })],
            CSS_FILE,
        );

        expect(messages.map((message) => message.ruleId)).toContain('css/no-invalid-properties');
    });

    it("leaves the game its own css rules in @eslint/css's DOCUMENTED shape too", () => {
        // `extends: ['css/recommended']` is what the plugin's README shows, and
        // flattening it puts the eleven `css/*` rules on a block carrying
        // `plugins: { css }` but NO `language` of its own. A predicate reading
        // only `language` classifies that as a JS-language hazard and switches
        // every one of them off — exit 0, guardrail gone.
        const gameCssConfig = defineConfig([
            {
                files: ['**/*.css'],
                plugins: { css: css as unknown as ESLint.Plugin },
                language: 'css/css',
                extends: ['css/recommended'],
            },
        ]) as Linter.Config[];
        const base = [{ ...js.configs.recommended }, ...gameCssConfig] as Linter.Config[];

        const messages = new Linter({ cwd: APP_ROOT }).verify(
            ':root {\n    --ch-radius-md: 4px;\n    colr: red;\n}\n',
            [...base, ...standaloneLintConfig({ silenceOnCss: base })],
            CSS_FILE,
        );

        expect(messages.map((message) => message.ruleId)).toContain('css/no-invalid-properties');
    });

    it('leaves the game its own css rules when the plugin is registered elsewhere', () => {
        // The third authoring style, and the one the plugin-map signal alone
        // cannot classify: the rules sit on a block that declares the LANGUAGE
        // but registers no plugin locally, because registration happens in a
        // separate block. Flat config merges plugins across matching blocks, so
        // this is legal and resolves fine — but read one object at a time, the
        // rules look like a JS-language hazard.
        const base = [
            { ...js.configs.recommended },
            { files: ['**/*.css'], plugins: { css: css as unknown as ESLint.Plugin } },
            {
                files: ['**/*.css'],
                language: 'css/css',
                rules: { 'css/no-invalid-properties': 'error' },
            },
        ] as Linter.Config[];

        const messages = new Linter({ cwd: APP_ROOT }).verify(
            ':root {\n    --ch-radius-md: 4px;\n    colr: red;\n}\n',
            [...base, ...standaloneLintConfig({ silenceOnCss: base })],
            CSS_FILE,
        );

        expect(messages.map((message) => message.ruleId)).toContain('css/no-invalid-properties');
    });

    it.each([
        [
            'a setup block plus a separate rules block',
            [
                {
                    files: ['**/*.css'],
                    plugins: { css: css as unknown as ESLint.Plugin },
                    language: 'css/css',
                },
                { files: ['**/*.css'], rules: { 'css/no-invalid-properties': 'error' } },
            ],
        ],
        [
            'a narrower per-directory override',
            [
                {
                    files: ['**/*.css'],
                    plugins: { css: css as unknown as ESLint.Plugin },
                    language: 'css/css',
                    rules: { ...css.configs.recommended.rules },
                },
                { files: ['styles/**/*.css'], rules: { 'css/no-invalid-properties': 'error' } },
            ],
        ],
        [
            'a scoped plugin alias',
            [
                {
                    files: ['**/*.css'],
                    plugins: { '@eslint/css': css as unknown as ESLint.Plugin },
                    language: 'css/css',
                },
                { files: ['**/*.css'], rules: { '@eslint/css/no-invalid-properties': 'error' } },
            ],
        ],
    ])('leaves the game its own css rules with %s', (_label, cssConfig) => {
        // Each of these puts the RULES on a block carrying neither a `language`
        // nor a `plugins` map, so classifying one block at a time silences
        // them. The registration is always somewhere in the array the caller
        // handed over, which is why the plugin map is accumulated first.
        //
        // The scoped case additionally pins the namespace parse: split at the
        // first slash and `@eslint/css/no-invalid-properties` reads as
        // `@eslint`, matches nothing, and is silenced.
        const base = [{ ...js.configs.recommended }, ...cssConfig] as Linter.Config[];

        const messages = new Linter({ cwd: APP_ROOT }).verify(
            ':root {\n    --ch-radius-md: 4px;\n    colr: red;\n}\n',
            [...base, ...standaloneLintConfig({ silenceOnCss: base })],
            CSS_FILE,
        );

        expect(messages.map((message) => message.ruleId).filter(Boolean)).toContain(
            cssConfig.some((block) =>
                Object.keys(block.rules ?? {}).some((id) => id.startsWith('@')),
            )
                ? '@eslint/css/no-invalid-properties'
                : 'css/no-invalid-properties',
        );
    });

    it("leaves the game its own css rules when it relies on the PRESET's registration", () => {
        // The game registers no CSS plugin at all — the preset already brings
        // one for the zones it governs, so naming the rules is enough and
        // ESLint resolves them. Reading only the caller's array classifies them
        // as JS-language rules and switches them off; there is no block the
        // caller could have "also passed" to fix it, because the registration
        // lives in this factory's own return value.
        const base = [
            { ...js.configs.recommended },
            {
                files: ['screens/**/*.module.css', 'styles/tokens-override.css'],
                rules: { 'css/no-invalid-properties': 'error' },
            },
        ] as Linter.Config[];

        const messages = new Linter({ cwd: APP_ROOT }).verify(
            ':root {\n    --ch-radius-md: 4px;\n    colr: red;\n}\n',
            [...base, ...standaloneLintConfig({ silenceOnCss: base })],
            CSS_FILE,
        );

        expect(messages.map((message) => message.ruleId)).toContain('css/no-invalid-properties');
    });

    it('silences a base scoped by DIRECTORY, not just an unscoped one', () => {
        // `files: ['screens/**']` is how a game says "stricter rules in my
        // screens" — and it matches `screens/**/*.module.css`, a zone this
        // preset itself declares. Treating "has files" as "cannot reach CSS"
        // would skip this block and let the run abort. The discriminator has to
        // be the LANGUAGE.
        const scopedTyped = (tseslint.configs.recommendedTypeChecked as Linter.Config[]).map(
            (block) => ({ ...block, files: ['screens/**'] }),
        );
        const base = [{ ...js.configs.recommended }, ...scopedTyped] as Linter.Config[];

        const messages = new Linter({ cwd: APP_ROOT }).verify(
            '.a {\n    color: red;\n}\n',
            [...base, ...standaloneLintConfig({ silenceOnCss: base })],
            `${APP_ROOT}/screens/A.module.css`,
        );

        expect(messages.filter((message) => message.fatal)).toEqual([]);
    });

    it('silences the base without being asked, for the one set every config has', () => {
        // `js.configs.recommended` is unscoped and effectively universal, so a
        // bare call has to handle it or the commonest base on earth aborts.
        expect(lintCssUnder([{ ...js.configs.recommended }] as Linter.Config[])).toBe('ok');
    });

    it('degrades to no baseline when @eslint/js cannot be resolved, without throwing', () => {
        // The fail-soft is a real branch and it is documented as safe in one
        // direction — the degrade is a loud abort, never a silent pass — so the
        // branch has to be reachable in a test rather than argued for. The
        // resolution is blocked at the same layer `createRequire` uses.
        const moduleInternals = Module as unknown as {
            _resolveFilename: (request: string, ...rest: unknown[]) => string;
        };
        const original = moduleInternals._resolveFilename;
        moduleInternals._resolveFilename = function blocked(request, ...rest) {
            if (request === '@eslint/js') throw new Error('blocked for test');
            return original.call(this, request, ...rest);
        };

        try {
            const config = standaloneLintConfig();
            const cssBlock = config.find(
                (block) => (block as { language?: string }).language === 'css/css',
            );

            // No throw, and no baseline: only the curated rule remains.
            expect(Object.keys(cssBlock?.rules ?? {})).toEqual([
                'chimera/no-hardcoded-design-values',
            ]);
        } finally {
            moduleInternals._resolveFilename = original;
        }
    });

    it('cannot be used to switch a curated rule off', () => {
        // `silenceOnCss` takes the game's own base, so a game that happens to
        // configure a `chimera/*` rule there would otherwise disable the
        // guardrail on CSS — the one place it is hardest to notice.
        const hostile = standaloneLintConfig({
            silenceOnCss: [{ rules: { 'chimera/no-unknown-token-overrides': 'error' } }],
        });
        const cssBlock = hostile.find((block) =>
            Object.keys(block.rules ?? {}).includes('chimera/no-unknown-token-overrides'),
        );

        expect(
            (cssBlock?.rules as Record<string, unknown>)['chimera/no-unknown-token-overrides'],
        ).toBe('error');
    });
});
