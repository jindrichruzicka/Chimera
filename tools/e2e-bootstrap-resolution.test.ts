// tools/e2e-bootstrap-resolution.test.ts
//
// Each consumer app's Playwright `global-setup.ts` must LOAD before any engine
// `dist` exists, because loading it is what triggers the build that creates one.
// Which runners this bites is stated in each suite's own `e2e/tsconfig.json`,
// beside the mapping that makes it work; `TREES` below enumerates them.
//
// Every tree is checked here, in one place, because the fix is per-tsconfig and
// each copy has to make it for itself: the template shipped the engine import with
// no matching `paths` entry, which is the same blocker one copy further out, and a
// second consumer app arrives with the same one copy sideways. The
// template tree is outside vitest and outside `tsconfig.json`, so a pin on it
// has to live in `tools/` — as `packaged-build-flag.test.ts` already does for
// the drivers themselves. (Standalone scaffolds never reach this: the initializer
// strips every engine mapping and the runner resolves the prebuilt engine from
// `node_modules`, so the template's entry serves the `--workspace` path.)
//
// This is a RESOLUTION test, not a `toContain` on the tsconfig: what matters is
// where a specifier lands, and a mapping is only as good as the file at the end
// of it.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

import { normalizeGameName } from './create-chimera-game/normalize.js';
import { substituteTokens } from './create-chimera-game/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE_DIR = path.join(ROOT, 'tools/create-chimera-game/templates/blank');

/**
 * The copier's own substitution, so the template parses as the real config a
 * scaffolded game gets. Reusing `substituteTokens` rather than spelling the
 * replacement here means a token the vocabulary gains is covered automatically;
 * an unsubstituted `__game_kebab__` in a path mapping resolves to nothing and
 * would make every case below vacuously "unresolvable" for the wrong reason.
 */
const substitute = (source: string): string =>
    substituteTokens(source, normalizeGameName('probe-game'));

/**
 * One e2e suite as the Playwright runner sees it.
 *
 * `dir` is where the files are READ from; the tsconfig's `baseUrl` is asserted
 * separately and resolved against this repo root for both, because that is what
 * it means in each case — `apps/tactics/e2e/../../..` IS the repo root, and a
 * `--workspace` scaffold's `apps/<game>/e2e/../../..` is this same repo root.
 */
interface Tree {
    readonly label: string;
    readonly dir: string;
    readonly read: (file: string) => string;
}

const TREES: readonly Tree[] = [
    {
        label: 'apps/tactics',
        dir: path.join(ROOT, 'apps/tactics/e2e'),
        read: (file) => readFileSync(file, 'utf8'),
    },
    {
        label: 'apps/action',
        dir: path.join(ROOT, 'apps/action/e2e'),
        read: (file) => readFileSync(file, 'utf8'),
    },
    {
        label: 'blank template',
        dir: path.join(TEMPLATE_DIR, 'e2e'),
        read: (file) => substitute(readFileSync(file, 'utf8')),
    },
];

/** The `paths` mappings of one e2e tsconfig, with the `baseUrl` it declares. */
function tsconfigPaths(tree: Tree): {
    baseUrl: string;
    mappings: { key: string; values: readonly string[] }[];
} {
    const raw = tree.read(path.join(tree.dir, 'tsconfig.json'));
    const parsed = ts.parseConfigFileTextToJson('tsconfig.json', raw).config as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
    };
    const options = parsed.compilerOptions ?? {};
    return {
        baseUrl: options.baseUrl ?? '.',
        mappings: Object.entries(options.paths ?? {}).map(([key, values]) => ({ key, values })),
    };
}

/** The file `candidate` names, trying the extensions a TS-aware loader tries. */
function existingFile(candidate: string): string | undefined {
    const suffixes = ['', '.ts', '.tsx', '.js', '.jsx', '.d.ts'];
    const isFile = (file: string): boolean => {
        try {
            return statSync(file).isFile();
        } catch {
            return false;
        }
    };
    for (const suffix of suffixes) {
        if (isFile(`${candidate}${suffix}`)) return `${candidate}${suffix}`;
    }
    for (const suffix of suffixes.slice(1)) {
        const file = path.join(candidate, `index${suffix}`);
        if (isFile(file)) return file;
    }
    return undefined;
}

/**
 * Playwright's `resolveHook`, reproduced: the mapping with the LONGEST key
 * prefix whose target actually exists wins, and a mapping that resolves to
 * nothing is skipped so Node resolution takes over. Both halves matter here —
 * the first is why an exact key beats the `@chimera-engine/electron/*` wildcard,
 * the second is why the same exact key is inert rather than broken wherever the
 * source tree it names is absent.
 */
function resolveThroughPaths(tree: Tree, specifier: string): string | undefined {
    const { mappings } = tsconfigPaths(tree);
    let longestPrefix = -1;
    let winner: string | undefined;

    for (const { key, values } of mappings) {
        const [keyPrefix = '', keySuffix] = key.split('*');
        let matched = specifier;
        if (key.includes('*')) {
            if (!specifier.startsWith(keyPrefix)) continue;
            matched = matched.slice(keyPrefix.length);
            if (keySuffix !== undefined && keySuffix !== '') {
                if (!specifier.endsWith(keySuffix)) continue;
                matched = matched.slice(0, matched.length - keySuffix.length);
            }
        } else if (specifier !== key) {
            continue;
        }
        if (keyPrefix.length <= longestPrefix) continue;
        for (const value of values) {
            const found = existingFile(path.resolve(ROOT, value.replace('*', matched)));
            if (found !== undefined) {
                longestPrefix = keyPrefix.length;
                winner = found;
            }
        }
    }
    return winner;
}

/** Static import/export specifiers of one file. */
function specifiersOf(file: string, source: string): string[] {
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteralLike(node.moduleSpecifier)
        ) {
            found.push(node.moduleSpecifier.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    return found;
}

/** Every bare `@chimera-engine/*` specifier statically reachable from `global-setup.ts`. */
function engineSpecifiersReachableFrom(tree: Tree): string[] {
    const seen = new Set<string>();
    const engine = new Set<string>();
    const queue = [path.join(tree.dir, 'global-setup.ts')];

    while (queue.length > 0) {
        const file = queue.pop();
        if (file === undefined || seen.has(file)) continue;
        seen.add(file);

        for (const specifier of specifiersOf(file, tree.read(file))) {
            if (specifier.startsWith('@chimera-engine/')) {
                engine.add(specifier);
                continue;
            }
            if (!specifier.startsWith('.')) continue; // node builtins, esbuild, …
            const resolved = existingFile(
                path.resolve(path.dirname(file), specifier.replace(/\.js$/u, '')),
            );
            if (resolved !== undefined) queue.push(resolved);
        }
    }
    return [...engine];
}

describe.each(TREES.map((tree) => [tree.label, tree] as const))(
    'clean-checkout e2e bootstrap — %s',
    (_label, tree) => {
        const specifiers = engineSpecifiersReachableFrom(tree);

        it('declares the baseUrl this suite resolves its mappings against', () => {
            // The cases below resolve every mapping against the repo root. That
            // is only what the config MEANS while the suite sits three levels
            // under it — `apps/<game>/e2e`. Pinned rather than assumed, because
            // a moved suite would silently turn every resolution below into a
            // statement about the wrong tree.
            expect(tsconfigPaths(tree).baseUrl).toBe('../../..');
        });

        it('reaches the engine bundle plan at module load (guards the walk itself)', () => {
            // The floor. Without it, an import graph that stopped resolving —
            // a renamed driver, a specifier shape the walk cannot follow —
            // would make the per-specifier cases below VANISH rather than fail.
            expect(specifiers).toContain('@chimera-engine/electron/build-main');
        });

        it.each(specifiers)('resolves %s without any engine dist', (specifier) => {
            const resolved = resolveThroughPaths(tree, specifier);
            expect(
                resolved,
                `${specifier} resolves through no e2e tsconfig path mapping. On a clean ` +
                    'checkout the Playwright runner cannot load global-setup at all, so the ' +
                    'build:packages call inside it never runs.',
            ).toBeDefined();

            const relative = path.relative(ROOT, resolved ?? '');
            expect(
                relative.split(path.sep).includes('dist'),
                `${specifier} resolves to ${relative}, a BUILD OUTPUT that global-setup is ` +
                    'itself responsible for producing. Map this subpath onto engine source in ' +
                    'e2e/tsconfig.json, or the e2e suite only runs after a build it cannot assume.',
            ).toBe(false);
        });
    },
);
