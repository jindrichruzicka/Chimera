/**
 * renderer/__tests__/logs-bridge-read-shape.test.ts
 *
 * Source census for the read of the preload log bridge (§4.27, Invariant #67):
 * under the roots `listCensusRoots` names, no production module narrows the
 * bridge to its log namespace inline, by casting the global and reading that
 * property off it. Inside the engine renderer package the way to the namespace
 * is `readRendererLogsApi()`.
 *
 * Consolidating the inline reads left that property as a measurement of one
 * tree — nothing re-runs a commit body. This census is the ratchet.
 *
 * Those roots are of three kinds: the engine renderer package, every game app
 * under `apps/`, and every scaffold template under
 * `tools/create-chimera-game/templates/`. The allowance list names sites in the
 * first only, and that asymmetry is the point rather than an omission —
 * `readRendererLogsApi` sits behind no public barrel, so Invariant #96 puts it
 * out of a game surface's reach, and what carries a game's report to the log
 * file instead is the `console.warn` / `console.error` the installed bridge
 * patches. A template is walked because it is copied into a repository where
 * this census does not run, so its own tree is read here instead.
 *
 * The properties below are independent — each is defeatable without the others:
 *
 * 1. **Root list** — `listCensusRoots` decides which trees exist for the walk.
 *    Pinned against a synthetic tree carrying two apps and two templates, so a
 *    root list narrowed back to one hard-coded app fails, and against the real
 *    repository as an exact set.
 * 2. **File filter** — `isProductionCensusSource` decides what the census reads
 *    at all. Which paths it accepts and refuses, per root and at both ends of
 *    each anchor, is the case list below — including the near-misses (`ad.ts`
 *    is not a declaration file, `latest.ts` is not a test, `e2e-helpers/` is
 *    not `e2e/`) that a sloppier test would silently exempt.
 * 3. **Match pattern** — `scanLogsBridgeReads` parses; it does not grep. What
 *    it reaches is the case list below: `globalThis` and `window`, dotted and
 *    bracketed, three quote styles, the split cast-then-narrow form through the
 *    wrappers and the binding constructs enumerated there, and the
 *    destructuring forms — plus the negatives (prose, type positions, a
 *    different namespace, a local merely compared against the bridge) that say
 *    the pattern discriminates rather than matching the token.
 * 4. **Attribution** — a read buried in a callback, a constructor, or a class
 *    body inside an allowed function does not inherit that function's name.
 * 5. **Allowance classifier** — `isAllowedSite` keys on file AND enclosing
 *    function. `LoggingBootstrap.resolveLogsApi` is a permanent exception, not
 *    a migration item: it reads `window` behind a `typeof window` guard,
 *    validates both `emit` and `readRecent`, and returns `LogsAPI | null` — a
 *    contract `readRendererLogsApi` does not offer. Pinned to prove the
 *    allowance covers that function rather than its file, its directory, or its
 *    basename under another root.
 * 6. **Composition and the tree** — `censusLogsBridgeReads` applies the filter
 *    before it parses, and over every root walked it matches EXACTLY the two
 *    allowed sites. Asserted as a set rather than as "no violations", so the
 *    case cannot pass by finding nothing at all.
 *
 * The probed tokens are assembled at runtime here and in the census module, per
 * the source-scan guard convention in the TDD skill's green-confirmation
 * checklist.
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    censusLogsBridgeReads,
    isAllowedSite,
    isProductionCensusSource,
    listCensusRoots,
    listCensusSourceFiles,
    scanLogsBridgeReads,
    type LogsBridgeRead,
} from './logsBridgeReadCensus';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../');

const TEMPLATES_ROOT_PARENT = 'tools/create-chimera-game/templates';

// Never spelled literally — see the file header.
const BRIDGE = `__${'chimera'}`;
const LOGS = `lo${'gs'}`;

describe('isProductionCensusSource — what the census reads', () => {
    it.each([
        ['renderer/logging/rendererLogger.ts', true],
        ['renderer/app/LoggingBootstrap.tsx', true],
        // A near-miss on the declaration-file suffix: `.d.ts` must be anchored
        // at the dot, or every module whose name ends in `d` is exempted.
        ['renderer/state/ad.ts', true],
        // Likewise the test suffix: `latest.ts` ends with `test.ts`.
        ['renderer/state/latest.ts', true],
        // Segment-wise, not substring: a `dist-helpers/` directory is source.
        ['renderer/dist-helpers/paths.ts', true],

        // Start anchor, both ends: a leading segment that merely CONTAINS the
        // package name is not it, and one the package name is merely a PREFIX
        // of is not it either. Both rows carry a source extension, so the end
        // anchor below cannot stand in for this one.
        ['xrenderer/logging/rendererLogger.ts', false],
        ['renderer-utils/logging/rendererLogger.ts', false],
        ['renderer', false],
        // End anchor, both ends: the path must END with a source extension.
        ['renderer/logging/rendererLogger.ts.bak', false],
        ['renderer/logging/rendererLogger.mts', false],
        ['renderer/app/page.test.ts.snap', false],
        // Declarations carry the bridge's own type augmentation.
        ['renderer/types/chimera.d.ts', false],
        // Tests install and read the bridge on purpose.
        ['renderer/logging/rendererLogger.test.ts', false],
        ['renderer/app/page.test.tsx', false],
        ['renderer/__tests__/logsBridgeReadCensus.ts', false],
        ['renderer/animation/__test-support__/clips.ts', false],
        ['renderer/out/_next/chunk.ts', false],
    ])('classifies the engine renderer path %s as production=%s', (relPath, expected) => {
        expect(isProductionCensusSource(relPath)).toBe(expected);
    });

    // A game app is a root in its own right, and the whole app tree is walked
    // rather than the four surfaces Invariant #96 legalises: the allowance is
    // empty everywhere under it, so no subdirectory carries a different policy,
    // and a list of renderer directories would have to be kept in step with a
    // consumer's own layout to stay true. `apps/<game>/renderer/register.ts`
    // is the composition root of a game's renderer bundle, so it reads true.
    it.each([
        ['apps/tactics/renderer/register.ts', true],
        ['apps/tactics/screens/BattleScreen.tsx', true],
        ['apps/tactics/styles/register-token-overrides.tsx', true],
        ['apps/tactics/simulation/reducers/move.ts', true],
        // Segment-wise, not substring, at this anchor too: an `e2e-helpers/`
        // directory is ordinary source.
        ['apps/tactics/renderer/e2e-helpers/wait.ts', true],

        // Start anchor, both ends: a leading segment that merely CONTAINS the
        // parent is not it, a segment it is merely a PREFIX of is not it
        // either, and a path under the parent that never names a game is not
        // inside one.
        ['xapps/tactics/renderer/register.ts', false],
        ['appsx/tactics/renderer/register.ts', false],
        ['apps/tactics.ts', false],
        ['apps', false],
        // Playwright drives a built app through the browser; its specs and the
        // page objects beside them read the bridge on purpose, exactly as a
        // renderer unit test does.
        ['apps/tactics/e2e/tests/renderer-logging.spec.ts', false],
        ['apps/tactics/e2e/pages/GamePage.ts', false],
        ['apps/tactics/manifest.test.ts', false],
        ['apps/tactics/css-modules.d.ts', false],
        ['apps/tactics/__tests__/wiring.ts', false],
        ['apps/tactics/dist/manifest.ts', false],
        ['apps/tactics/renderer/out/_next/chunk.ts', false],
    ])('classifies the game-app path %s as production=%s', (relPath, expected) => {
        expect(isProductionCensusSource(relPath)).toBe(expected);
    });

    // The scaffold templates, whose tokens (`__GamePascal__`) are identifiers
    // and whose specifiers are strings, so the parse reaches them in place even
    // though ESLint and `tsc` are pointed at the generated app instead.
    it.each([
        [`${TEMPLATES_ROOT_PARENT}/blank/renderer/register.ts`, true],
        [`${TEMPLATES_ROOT_PARENT}/blank/screens/PlayScreen.tsx`, true],

        // Start anchor, both ends, as above — and the initializer's own source
        // is not a template: it runs on the adopter's machine, never in a
        // renderer bundle.
        [`x${TEMPLATES_ROOT_PARENT}/blank/renderer/register.ts`, false],
        [`${TEMPLATES_ROOT_PARENT}-extra/blank/renderer/register.ts`, false],
        [`${TEMPLATES_ROOT_PARENT}/index.ts`, false],
        ['tools/create-chimera-game/index.ts', false],
        [`${TEMPLATES_ROOT_PARENT}/blank/manifest.test.ts`, false],
        [`${TEMPLATES_ROOT_PARENT}/blank/e2e/tests/boot-smoke.spec.ts`, false],
    ])('classifies the scaffold-template path %s as production=%s', (relPath, expected) => {
        expect(isProductionCensusSource(relPath)).toBe(expected);
    });
});

describe('scanLogsBridgeReads — the shape it matches', () => {
    const scanTs = (source: string): LogsBridgeRead[] =>
        scanLogsBridgeReads('renderer/probe/module.ts', source);

    it('matches a dotted read off a cast globalThis', () => {
        const reads = scanTs(
            `export const api = (globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS};\n`,
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 1, enclosingFunction: null },
        ]);
    });

    it('matches the window spelling too', () => {
        const reads = scanTs(
            [
                'export function read(): unknown {',
                `    return (window as { ${BRIDGE}: { ${LOGS}: unknown } }).${BRIDGE}.${LOGS};`,
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 2, enclosingFunction: 'read' },
        ]);
    });

    it.each([
        ['single', "'"],
        ['double', '"'],
        ['backtick', '`'],
    ])('matches a bracketed read written with %s quotes', (_style, quote) => {
        const reads = scanTs(
            [
                'declare const bridge: Record<string, Record<string, unknown>>;',
                `export const api = bridge[${quote}${BRIDGE}${quote}][${quote}${LOGS}${quote}];`,
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 2, enclosingFunction: null },
        ]);
    });

    // The split cast-then-narrow form: the bridge lands in a local and the
    // narrowing happens a statement later, wrapped in whatever the author
    // needed to satisfy the type checker. Each wrapper below is a no-op at
    // runtime and has to be stripped — the as-cast row is the shape the one
    // sanctioned exception is written in, and dropping any other row leaves an
    // equally inline read invisible.
    it.each([
        ['a parenthesised alias', `(chimera)?.${LOGS}`],
        ['an as-cast alias', `(chimera as { ${LOGS}?: unknown } | undefined)?.${LOGS}`],
        ['a non-null asserted alias', `chimera!.${LOGS}`],
        ['a satisfies-checked alias', `(chimera satisfies unknown)?.${LOGS}`],
        ['an angle-bracket asserted alias', `(<{ ${LOGS}?: unknown }>chimera)?.${LOGS}`],
        ['a comma sequence', `(0, chimera)?.${LOGS}`],
    ])('follows the local alias through %s', (_form, narrowing) => {
        const reads = scanTs(
            [
                'export function resolve(): unknown {',
                `    const chimera = (window as unknown as { ${BRIDGE}?: unknown }).${BRIDGE};`,
                `    return ${narrowing};`,
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 3, enclosingFunction: 'resolve' },
        ]);
    });

    // The list above holds the binding construct fixed and varies the wrapper;
    // this one holds the wrapper fixed and varies what binds the local. Each
    // row is the same split read respelled: the parameter-default one lints
    // clean in the renderer zone and typechecks under `--strict`, so a
    // construct the scan skips is a read that lands with nothing to report it.
    const CAST_TO_LOCAL = `(globalThis as { ${BRIDGE}?: unknown }).${BRIDGE}`;
    const NARROW_LOCAL = `(chimera as { ${LOGS}?: unknown } | undefined)?.${LOGS}`;

    it.each([
        [
            'a const initialiser',
            [
                'export function resolve(): unknown {',
                `    const chimera = ${CAST_TO_LOCAL};`,
                `    return ${NARROW_LOCAL};`,
                '}',
            ],
            3,
        ],
        [
            'a parameter default',
            [
                'export function resolve(',
                `    chimera: unknown = ${CAST_TO_LOCAL},`,
                '): unknown {',
                `    return ${NARROW_LOCAL};`,
                '}',
            ],
            4,
        ],
        [
            'a parameter default on an arrow',
            [
                `export const resolve = (chimera: unknown = ${CAST_TO_LOCAL}): unknown =>`,
                `    ${NARROW_LOCAL};`,
            ],
            2,
        ],
        // `prefer-const` closes the straight `let x; x = …` spelling, but not
        // this one: the assignment sits in a branch, so the declaration cannot
        // become a `const` and the module lints clean.
        [
            'an assignment made after the declaration',
            [
                'export function resolve(): unknown {',
                '    let chimera: unknown;',
                "    if (typeof window !== 'undefined') {",
                `        chimera = ${CAST_TO_LOCAL};`,
                '    }',
                `    return ${NARROW_LOCAL};`,
                '}',
            ],
            6,
        ],
    ] as const)('follows the bridge into a local bound by %s', (_form, lines, line) => {
        expect(scanTs([...lines, ''].join('\n'))).toEqual([
            { file: 'renderer/probe/module.ts', line, enclosingFunction: 'resolve' },
        ]);
    });

    // Two bindings of one name inside one scope, which a default plus a later
    // assignment makes an ordinary spelling. A binding adds to what the name
    // can hold rather than replacing it, so both orders have to be followed:
    // keeping only the first loses the second row, only the last the first.
    it.each([
        [
            'the first',
            [
                `export function resolve(chimera: unknown = ${CAST_TO_LOCAL}): unknown {`,
                '    chimera = chimera ?? {};',
                `    return ${NARROW_LOCAL};`,
                '}',
            ],
            3,
        ],
        [
            'the second',
            [
                'export function resolve(): unknown {',
                '    let chimera: unknown = null;',
                "    if (typeof window !== 'undefined') {",
                `        chimera = ${CAST_TO_LOCAL};`,
                '    }',
                `    return ${NARROW_LOCAL};`,
                '}',
            ],
            6,
        ],
    ] as const)(
        'follows a local bound twice where %s binding reaches the bridge',
        (_which, lines, line) => {
            expect(scanTs([...lines, ''].join('\n'))).toEqual([
                { file: 'renderer/probe/module.ts', line, enclosingFunction: 'resolve' },
            ]);
        },
    );

    it('ignores a local whose parameter default is not the bridge', () => {
        const reads = scanTs(
            [
                'export function resolve(chimera: unknown = globalThis): unknown {',
                `    return ${NARROW_LOCAL};`,
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([]);
    });

    // A comparison is not a binding — it can just as well be false — so the
    // hop is followed out of an assignment, not out of any binary operator
    // with the local on its left.
    it('ignores a local merely compared against the bridge', () => {
        const reads = scanTs(
            [
                'export function resolve(chimera: unknown): unknown {',
                `    const isBridge = chimera === ${CAST_TO_LOCAL};`,
                `    return isBridge ? null : ${NARROW_LOCAL};`,
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([]);
    });

    it.each([
        ['shorthand', `export const { ${LOGS} } = BRIDGE_EXPR;`],
        ['renamed', `export const { ${LOGS}: api } = BRIDGE_EXPR;`],
        ['string-keyed', `export const { '${LOGS}': api } = BRIDGE_EXPR;`],
    ])('matches a %s destructuring of the bridge', (_form, statement) => {
        const reads = scanTs(
            `${statement.replace(
                'BRIDGE_EXPR',
                `(globalThis as { ${BRIDGE}: { ${LOGS}: unknown } }).${BRIDGE}`,
            )}\n`,
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 1, enclosingFunction: null },
        ]);
    });

    // What the pattern hangs off has to be the bridge, in either spelling of
    // the owner — otherwise every `const { logs } = …` in the package is a
    // reported violation.
    it.each([
        [
            'a declaration',
            [`declare const props: { ${LOGS}: unknown };`, `export const { ${LOGS} } = props;`],
        ],
        [
            'a parameter default',
            [
                `declare const fallback: { ${LOGS}: unknown };`,
                `export function render({ ${LOGS} }: { ${LOGS}: unknown } = fallback): unknown {`,
                `    return ${LOGS};`,
                '}',
            ],
        ],
    ])('ignores a namespace destructured out of %s that is not the bridge', (_form, lines) => {
        expect(scanTs([...lines, ''].join('\n'))).toEqual([]);
    });

    // The same destructuring one construct over: what the pattern hangs off is
    // a parameter's default rather than a declaration's initialiser.
    it('matches a destructuring of the bridge in a parameter default', () => {
        const reads = scanTs(
            [
                `export function read({ ${LOGS} }: { ${LOGS}: unknown } = (globalThis as { ${BRIDGE}: { ${LOGS}: unknown } }).${BRIDGE}): unknown {`,
                `    return ${LOGS};`,
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 1, enclosingFunction: 'read' },
        ]);
    });

    // A destructured bridge has no initialiser naming it, and under the renamed
    // spelling the local's own name says nothing either — so nothing but the
    // binding itself records that the local holds a bridge.
    it.each([
        ['under its own name', `const { ${BRIDGE} } = SOURCE;`, `${BRIDGE}?.${LOGS}`],
        ['under a renamed local', `const { ${BRIDGE}: bridge } = SOURCE;`, `bridge?.${LOGS}`],
    ])('follows a bridge destructured %s', (_form, declaration, narrowing) => {
        const reads = scanTs(
            [
                declaration.replace(
                    'SOURCE',
                    `globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }`,
                ),
                `export const api = ${narrowing};`,
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 2, enclosingFunction: null },
        ]);
    });

    it('matches a read off the bridge global named directly', () => {
        const reads = scanTs(
            [
                `declare const ${BRIDGE}: { ${LOGS}?: unknown };`,
                `export const api = ${BRIDGE}.${LOGS};`,
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 2, enclosingFunction: null },
        ]);
    });

    it('matches a nested destructuring that never names the namespace on a member access', () => {
        const reads = scanTs(
            `export const { ${BRIDGE}: { ${LOGS} } } = globalThis as { ${BRIDGE}: { ${LOGS}: unknown } };\n`,
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 1, enclosingFunction: null },
        ]);
    });

    it('reports a second read in the same module, not just the first', () => {
        const reads = scanTs(
            [
                `export const first = (globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS};`,
                'export function second(): unknown {',
                `    return (window as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS};`,
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([
            { file: 'renderer/probe/module.ts', line: 1, enclosingFunction: null },
            { file: 'renderer/probe/module.ts', line: 3, enclosingFunction: 'second' },
        ]);
    });

    it('ignores the shape written in prose', () => {
        const reads = scanTs(
            [
                `// Reads (globalThis as X).${BRIDGE}?.${LOGS} — but only in a comment.`,
                `/** Forwards over window.${BRIDGE}.${LOGS}. */`,
                'export const nothing = 1;',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([]);
    });

    it('ignores the namespace named in a type position', () => {
        const reads = scanTs(
            [
                'export interface Bridge {',
                `    readonly ${BRIDGE}?: { readonly ${LOGS}?: unknown };`,
                '}',
                `export type Logs = Bridge['${BRIDGE}'];`,
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([]);
    });

    it('ignores a read of a different namespace on the same bridge', () => {
        const reads = scanTs(
            `export const saves = (globalThis as { ${BRIDGE}?: { saves?: unknown } }).${BRIDGE}?.saves;\n`,
        );

        expect(reads).toEqual([]);
    });

    it('ignores a namespace-named property on an unrelated object', () => {
        const reads = scanTs(
            [
                `declare const response: { readonly ${LOGS}: readonly string[] };`,
                `export const entries = response.${LOGS};`,
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([]);
    });

    it('ignores the sanctioned accessor call', () => {
        const reads = scanTs(
            [
                "import { readRendererLogsApi } from '../logging/rendererLogger';",
                'export function report(): unknown {',
                '    return readRendererLogsApi();',
                '}',
                '',
            ].join('\n'),
        );

        expect(reads).toEqual([]);
    });

    // Both directions of the extension→ScriptKind choice, because TypeScript's
    // parse recovery is good enough that ordinary JSX still yields the read
    // under either kind — pinning the choice needs text whose MEANING differs
    // between the two grammars, not merely text one of them rejects.
    it('parses .tsx as TSX: JSX text is text, not the start of a block comment', () => {
        const source = [
            'export function Panel(): unknown {',
            '    const label = <span>ratio a /* b</span>;',
            `    const api = (window as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS};`,
            '    return [label, api];',
            '}',
            '',
        ].join('\n');

        expect(scanLogsBridgeReads('renderer/probe/Panel.tsx', source)).toEqual([
            { file: 'renderer/probe/Panel.tsx', line: 3, enclosingFunction: 'Panel' },
        ]);
        // Under TypeScript's grammar the same `/*` opens a comment that runs to
        // the end of the file and eats the read.
        expect(scanLogsBridgeReads('renderer/probe/Panel.ts', source)).toEqual([]);
    });

    it('parses .ts as TypeScript: a generic arrow is a generic, not an unclosed tag', () => {
        const source = [
            'const identity = <T>(value: T): T => value;',
            `export const api = identity((globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS});`,
            '',
        ].join('\n');

        expect(scanLogsBridgeReads('renderer/probe/module.ts', source)).toEqual([
            { file: 'renderer/probe/module.ts', line: 2, enclosingFunction: null },
        ]);
        // Under the TSX grammar `<T>` opens a JSX element that is never closed,
        // and the read goes with it.
        expect(scanLogsBridgeReads('renderer/probe/module.tsx', source)).toEqual([]);
    });
});

describe('scanLogsBridgeReads — the enclosing function it reports', () => {
    const READ = `(globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS}`;

    const enclosingFunctionOf = (statement: string): string | null | undefined =>
        scanLogsBridgeReads('renderer/probe/module.ts', `${statement.replace('READ', READ)}\n`)[0]
            ?.enclosingFunction;

    // The allowance is a (file, function) pair, so every function form that can
    // hold a read has to yield the name a reviewer would write in that pair —
    // and an anonymous one has to yield null rather than the name of something
    // further out that IS on the list.
    it.each([
        ['module scope', 'export const api = READ;', null],
        ['a function declaration', 'export function report(): unknown { return READ; }', 'report'],
        [
            'an arrow bound to a const',
            'export const resolveLogs = (): unknown => READ;',
            'resolveLogs',
        ],
        [
            'an arrow bound to a property',
            'export const handlers = { onReady: (): unknown => READ };',
            'onReady',
        ],
        [
            'an immediately-invoked named function expression',
            'export const api = (function reportLogs(): unknown { return READ; })();',
            'reportLogs',
        ],
        ['a method', 'export class Reporter { read(): unknown { return READ; } }', 'read'],
        ['a getter', 'export class Reporter { get api(): unknown { return READ; } }', 'api'],
        [
            'a setter',
            'export class Reporter { set target(value: unknown) { void [value, READ]; } }',
            'target',
        ],
        ['an anonymous callback', 'export const api = [1].map((): unknown => READ);', null],
    ])('names %s', (_form, statement, expected) => {
        expect(enclosingFunctionOf(statement)).toBe(expected);
    });

    // Once per branch of the upward walk, not once overall: each branch owns
    // the same ordering choice, so a branch with no nested case can be widened
    // to return the enclosing name — which hands a read hidden inside an
    // allowed function the allowed function's own name.
    it.each([
        [
            'an arrow',
            ['export function outer(): unknown {', '    const inner = (): unknown => READ;'],
            'inner',
        ],
        [
            'a function declaration',
            [
                'export function outer(): unknown {',
                '    function inner(): unknown { return READ; }',
            ],
            'inner',
        ],
        [
            'a method',
            [
                'export function outer(): unknown {',
                '    class Holder { inner(): unknown { return READ; } }',
                '    void Holder;',
            ],
            'inner',
        ],
        [
            'a getter',
            [
                'export function outer(): unknown {',
                '    class Holder { get inner(): unknown { return READ; } }',
                '    void Holder;',
            ],
            'inner',
        ],
        [
            'a named function expression',
            [
                'export function outer(): unknown {',
                '    void (function inner(): unknown { return READ; })();',
            ],
            'inner',
        ],
    ])('names the INNERMOST enclosing %s, not the function around it', (_form, lines, expected) => {
        expect(enclosingFunctionOf([...lines, '    return 1;', '}'].join('\n'))).toBe(expected);
    });

    // The same rule for the constructs the allowance list cannot name. Walking
    // PAST one of these reaches `outer` — and where `outer` is an allowed
    // function, a read buried in a class inside it would inherit the allowance
    // wholesale. `null` is refused by `isAllowedSite`, so stopping here is what
    // keeps the pair a pair.
    it.each([
        [
            'a constructor',
            ['    class Holder { constructor() { void READ; } }', '    void Holder;'],
        ],
        [
            'a class static block',
            ['    class Holder { static { void READ; } }', '    void Holder;'],
        ],
        [
            'a class property initialiser',
            ['    class Holder { api: unknown = READ; }', '    void Holder;'],
        ],
    ])('attributes a read inside %s to no function at all', (_form, lines) => {
        expect(
            enclosingFunctionOf(
                ['export function outer(): unknown {', ...lines, '    return 1;', '}'].join('\n'),
            ),
        ).toBeNull();
    });
});

describe('isAllowedSite — scoped to a function, not a file or a directory', () => {
    const site = (file: string, enclosingFunction: string | null): LogsBridgeRead => ({
        file,
        line: 1,
        enclosingFunction,
    });

    it('allows the accessor every other module calls', () => {
        expect(
            isAllowedSite(site('renderer/logging/rendererLogger.ts', 'readRendererLogsApi')),
        ).toBe(true);
    });

    it('allows the logging bootstrap resolver, which needs a contract the accessor lacks', () => {
        expect(isAllowedSite(site('renderer/app/LoggingBootstrap.tsx', 'resolveLogsApi'))).toBe(
            true,
        );
    });

    it.each([
        // The whole file is NOT allowed: a second reader in the bootstrap is a
        // violation even though `resolveLogsApi` lives beside it.
        ['renderer/app/LoggingBootstrap.tsx', 'ensureInstalled'],
        ['renderer/app/LoggingBootstrap.tsx', null],
        ['renderer/logging/rendererLogger.ts', 'installRendererLogger'],
        // The directory is NOT allowed either, and neither is the function name
        // on its own: both halves of the pair have to match.
        ['renderer/app/OtherBootstrap.tsx', 'resolveLogsApi'],
        ['renderer/logging/otherLogger.ts', 'readRendererLogsApi'],
    ])('refuses %s → %s', (file, enclosingFunction) => {
        expect(isAllowedSite(site(file, enclosingFunction))).toBe(false);
    });

    // The allowance is empty under every root but the engine package, and the
    // match is on the whole repo-relative path rather than on a suffix or a
    // basename. That distinction stops being academic once an app is walked:
    // an app has a `renderer/` directory of its own, and its Next host tree is
    // `apps/<game>/renderer/app/`, so BOTH allowed sites have a path under a
    // game app whose tail reproduces them exactly. Each allowed site is
    // respelled below in the suffix form and the basename form, under each of
    // the two roots the allowance does not cover — and the composition root a
    // game registers through is refused beside them.
    it.each([
        ['apps/tactics/renderer/register.ts', 'readRendererLogsApi'],
        ['apps/tactics/renderer/logging/rendererLogger.ts', 'readRendererLogsApi'],
        ['apps/tactics/logging/rendererLogger.ts', 'readRendererLogsApi'],
        ['apps/tactics/renderer/app/LoggingBootstrap.tsx', 'resolveLogsApi'],
        ['apps/tactics/app/LoggingBootstrap.tsx', 'resolveLogsApi'],
        [
            `${TEMPLATES_ROOT_PARENT}/blank/renderer/logging/rendererLogger.ts`,
            'readRendererLogsApi',
        ],
        [`${TEMPLATES_ROOT_PARENT}/blank/logging/rendererLogger.ts`, 'readRendererLogsApi'],
        [`${TEMPLATES_ROOT_PARENT}/blank/renderer/app/LoggingBootstrap.tsx`, 'resolveLogsApi'],
        [`${TEMPLATES_ROOT_PARENT}/blank/app/LoggingBootstrap.tsx`, 'resolveLogsApi'],
    ])('refuses %s → %s, outside the engine package', (file, enclosingFunction) => {
        expect(isAllowedSite(site(file, enclosingFunction))).toBe(false);
    });
});

describe('censusLogsBridgeReads — the file filter is applied before the scan', () => {
    const inlineRead = [
        'export function reportSomething(): unknown {',
        `    return (globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS};`,
        '}',
        '',
    ].join('\n');

    // One row per root, because a root the filter stopped accepting is a tree
    // the census silently reports nothing about — and nothing about a tree
    // reads the same as a clean one. The exact matched set is asserted, and the
    // unallowed remainder alongside it: under the two roots below the engine
    // package the allowance is empty, so every read there is a violation.
    it.each([
        'renderer/components/shell/StatusPanel.tsx',
        'apps/tactics/renderer/register.ts',
        'apps/tactics/screens/BattleScreen.tsx',
        `${TEMPLATES_ROOT_PARENT}/blank/renderer/register.ts`,
    ])('reports a hand-rolled read from the production module %s', (file) => {
        const reads = censusLogsBridgeReads([{ file, source: inlineRead }]);

        expect(reads).toEqual([{ file, line: 2, enclosingFunction: 'reportSomething' }]);
        expect(reads.filter((entry) => !isAllowedSite(entry))).toEqual(reads);
    });

    it.each([
        'renderer/components/shell/StatusPanel.test.tsx',
        'renderer/types/chimera.d.ts',
        'apps/tactics/manifest.test.ts',
        'apps/tactics/e2e/tests/renderer-logging.spec.ts',
        `${TEMPLATES_ROOT_PARENT}/blank/e2e/tests/boot-smoke.spec.ts`,
        'tools/create-chimera-game/index.ts',
    ])('skips %s', (file) => {
        expect(censusLogsBridgeReads([{ file, source: inlineRead }])).toEqual([]);
    });
});

describe('listCensusRoots — a synthetic tree, so the roots are derived rather than named', () => {
    let fixtureRoot: string;

    beforeAll(() => {
        fixtureRoot = mkdtempSync(resolve(tmpdir(), 'logs-bridge-census-'));
        for (const file of [
            'renderer/logging/rendererLogger.ts',
            'renderer/out/_next/chunk.ts',
            // Not a directory, so not a root — and a directory that is build
            // output or vendored code is not one either.
            'apps/README.md',
            'apps/node_modules/some-package/index.ts',
            'apps/alpha/renderer/register.ts',
            'apps/alpha/dist/register.ts',
            'apps/beta/screens/Play.tsx',
            `${TEMPLATES_ROOT_PARENT}/blank/renderer/register.ts`,
            `${TEMPLATES_ROOT_PARENT}/second/screens/Play.tsx`,
        ]) {
            const path = resolve(fixtureRoot, file);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, '', 'utf8');
        }
    });

    afterAll(() => {
        rmSync(fixtureRoot, { recursive: true, force: true });
    });

    // TWO apps and TWO templates: with one of each, a root list that named
    // `apps/tactics` outright would be indistinguishable from one that read the
    // directory.
    it('names the engine package plus every child of each root parent', () => {
        expect(listCensusRoots(fixtureRoot)).toEqual([
            'renderer',
            'apps/alpha',
            'apps/beta',
            `${TEMPLATES_ROOT_PARENT}/blank`,
            `${TEMPLATES_ROOT_PARENT}/second`,
        ]);
    });

    // The walk starts at each root and must not descend into build output —
    // the filter drops those paths afterwards either way, so nothing but this
    // case reports a walk that reads an app's `dist` tree to throw it away.
    it('walks every root and stops at build output', () => {
        expect(listCensusSourceFiles(fixtureRoot)).toEqual([
            'apps/alpha/renderer/register.ts',
            'apps/beta/screens/Play.tsx',
            'renderer/logging/rendererLogger.ts',
            `${TEMPLATES_ROOT_PARENT}/blank/renderer/register.ts`,
            `${TEMPLATES_ROOT_PARENT}/second/screens/Play.tsx`,
        ]);
    });
});

describe('the walked trees', () => {
    // Walked inside the cases rather than while the suite is collected, and
    // not in a hook either: a root parent holds files as well as directories
    // (`apps/.gitkeep`), so a root list that stopped filtering them throws.
    // Thrown during collection that takes the synthetic cases above down with
    // it, and thrown in a hook it leaves these cases reported as skipped —
    // either way hiding which predicate broke behind a suite that did not run.
    let cachedPaths: string[] | undefined;
    const walkedPaths = (): string[] => (cachedPaths ??= listCensusSourceFiles(repoRoot));

    it('names the roots this repository actually holds', () => {
        // Every child of `apps/` is a root, so a second consumer app joins the
        // census the day it lands rather than needing this guard widened by
        // hand — which is what this list is here to notice.
        expect(listCensusRoots(repoRoot)).toEqual([
            'renderer',
            'apps/action',
            'apps/tactics',
            `${TEMPLATES_ROOT_PARENT}/blank`,
        ]);
    });

    it('walks each root rather than a hand-written list', () => {
        // Guards the derivation: a walk that returned nothing, or stopped at
        // a root directory, would make the census below vacuous.
        expect(walkedPaths().length).toBeGreaterThan(200);
        expect(walkedPaths()).toContain('renderer/logging/rendererLogger.ts');
        expect(walkedPaths()).toContain('renderer/app/LoggingBootstrap.tsx');
        expect(walkedPaths()).toContain('apps/tactics/renderer/register.ts');
        expect(walkedPaths()).toContain('apps/action/renderer/register.ts');
        expect(walkedPaths()).toContain(`${TEMPLATES_ROOT_PARENT}/blank/renderer/register.ts`);
        expect(walkedPaths().some((file) => file.split('/').length > 3)).toBe(true);
        // The walk hands over what the filter is there to drop, so the census
        // below proves the filter runs rather than merely being defined. The
        // Playwright spec is the one that matters most: it holds a real read of
        // the namespace, so a filter that stopped dropping it reds the census.
        expect(walkedPaths()).toContain('renderer/logging/rendererLogger.test.ts');
        expect(walkedPaths()).toContain('renderer/types/chimera.d.ts');
        expect(walkedPaths()).toContain('apps/tactics/e2e/tests/renderer-logging.spec.ts');
    });

    it('reads the log bridge inline at exactly the two allowed sites', () => {
        const reads = censusLogsBridgeReads(
            walkedPaths().map((file) => ({
                file,
                source: readFileSync(resolve(repoRoot, file), 'utf8'),
            })),
        );

        // The exact set, not "no violations": an allowance list that stopped
        // matching, or a scanner that stopped finding anything, passes the
        // violation check and fails this one.
        expect(reads.map(({ file, enclosingFunction }) => ({ file, enclosingFunction }))).toEqual([
            {
                file: 'renderer/app/LoggingBootstrap.tsx',
                enclosingFunction: 'resolveLogsApi',
            },
            {
                file: 'renderer/logging/rendererLogger.ts',
                enclosingFunction: 'readRendererLogsApi',
            },
        ]);
        expect(reads.filter((entry) => !isAllowedSite(entry))).toEqual([]);
    });
});
