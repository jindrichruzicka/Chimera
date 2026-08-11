/**
 * renderer/__tests__/logs-bridge-read-shape.test.ts
 *
 * Source census for the renderer's read of the preload log bridge (§4.27,
 * Invariant #67): a production renderer module reaches the bridge's log
 * namespace through `readRendererLogsApi()`, never by casting the global and
 * narrowing to that namespace inline.
 *
 * Consolidating the inline reads left that property as a measurement of one
 * tree — nothing re-runs a commit body. This census is the ratchet.
 *
 * The properties below are independent — each is defeatable without the others:
 *
 * 1. **File filter** — `isProductionRendererSource` decides what the census
 *    reads at all. Pinned at BOTH ends of every anchor: a leading segment that
 *    merely contains `renderer`, a suffix that merely contains `.ts`, and the
 *    near-misses (`ad.ts` is not a declaration file, `latest.ts` is not a test)
 *    that a sloppier suffix test would silently exempt.
 * 2. **Match pattern** — `scanLogsBridgeReads` parses; it does not grep. What
 *    it reaches is the case list below: `globalThis` and `window`, dotted and
 *    bracketed, three quote styles, the split cast-then-narrow form through the
 *    wrappers and the binding constructs enumerated there, and the
 *    destructuring forms — plus the negatives (prose, type positions, a
 *    different namespace, a local merely compared against the bridge) that say
 *    the pattern discriminates rather than matching the token.
 * 3. **Attribution** — a read buried in a callback, a constructor, or a class
 *    body inside an allowed function does not inherit that function's name.
 * 4. **Allowance classifier** — `isAllowedSite` keys on file AND enclosing
 *    function. `LoggingBootstrap.resolveLogsApi` is a permanent exception, not
 *    a migration item: it reads `window` behind a `typeof window` guard,
 *    validates both `emit` and `readRecent`, and returns `LogsAPI | null` — a
 *    contract `readRendererLogsApi` does not offer. Pinned to prove the
 *    allowance covers that function rather than its file or its directory.
 * 5. **Composition and the tree** — `censusLogsBridgeReads` applies the filter
 *    before it parses, and over `renderer/` it matches EXACTLY the two allowed
 *    sites. Asserted as a set rather than as "no violations", so the case
 *    cannot pass by finding nothing at all. A game's own renderer tree,
 *    `apps/<game>/renderer`, is outside the walk.
 *
 * The probed tokens are assembled at runtime here and in the census module, per
 * the source-scan guard convention in the TDD skill's green-confirmation
 * checklist.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    censusLogsBridgeReads,
    isAllowedSite,
    isProductionRendererSource,
    listRendererSourceFiles,
    scanLogsBridgeReads,
    type LogsBridgeRead,
} from './logsBridgeReadCensus';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../');

// Never spelled literally — see the file header.
const BRIDGE = `__${'chimera'}`;
const LOGS = `lo${'gs'}`;

describe('isProductionRendererSource — what the census reads', () => {
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

        // Start anchor, both ends: the path must BEGIN with the package.
        ['xrenderer/logging/rendererLogger.ts', false],
        ['apps/tactics/renderer/register.ts', false],
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
    ])('classifies %s as production=%s', (relPath, expected) => {
        expect(isProductionRendererSource(relPath)).toBe(expected);
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
});

describe('censusLogsBridgeReads — the file filter is applied before the scan', () => {
    const inlineRead = [
        'export function reportSomething(): unknown {',
        `    return (globalThis as { ${BRIDGE}?: { ${LOGS}?: unknown } }).${BRIDGE}?.${LOGS};`,
        '}',
        '',
    ].join('\n');

    it('reports a hand-rolled read from a production renderer module', () => {
        const reads = censusLogsBridgeReads([
            { file: 'renderer/components/shell/StatusPanel.tsx', source: inlineRead },
        ]);

        expect(reads).toEqual([
            {
                file: 'renderer/components/shell/StatusPanel.tsx',
                line: 2,
                enclosingFunction: 'reportSomething',
            },
        ]);
        expect(reads.filter((entry) => !isAllowedSite(entry))).toHaveLength(1);
    });

    it.each([
        'renderer/components/shell/StatusPanel.test.tsx',
        'renderer/types/chimera.d.ts',
        'apps/tactics/renderer/register.ts',
    ])('skips %s', (file) => {
        expect(censusLogsBridgeReads([{ file, source: inlineRead }])).toEqual([]);
    });
});

describe('the renderer tree', () => {
    const paths = listRendererSourceFiles(repoRoot);

    it('walks the package rather than a hand-written list', () => {
        // Guards the derivation: a walk that returned nothing, or stopped at
        // the package root, would make the census below vacuous.
        expect(paths.length).toBeGreaterThan(200);
        expect(paths).toContain('renderer/logging/rendererLogger.ts');
        expect(paths).toContain('renderer/app/LoggingBootstrap.tsx');
        expect(paths.some((file) => file.split('/').length > 3)).toBe(true);
        // The walk hands over what the filter is there to drop, so the census
        // below proves the filter runs rather than merely being defined.
        expect(paths).toContain('renderer/logging/rendererLogger.test.ts');
        expect(paths).toContain('renderer/types/chimera.d.ts');
    });

    it('reads the log bridge inline at exactly the two allowed sites', () => {
        const reads = censusLogsBridgeReads(
            paths.map((file) => ({
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
