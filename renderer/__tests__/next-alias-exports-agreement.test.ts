/**
 * renderer/__tests__/next-alias-exports-agreement.test.ts
 *
 * The renderer's own Next build states the public package surface a SECOND
 * time. `renderer/next.config.ts` aliases each shared `@chimera-engine/renderer/*`
 * subpath back onto its source directory, so that this one bundle — the only
 * one where the renderer source and a mounted game are linked together — holds
 * a single copy of every module-level singleton behind it. Which module the
 * alias lands on is therefore a duplicate of what `package.json`'s `exports`
 * map publishes, and duplicated contracts drift.
 *
 * The gates that look adjacent do not reach it. `package-exports-contract.test.ts`
 * reads the manifest and never the alias; `pnpm typecheck` resolves through the
 * `exports` map, so the alias is invisible to it; the barrel's own guard imports
 * `../index` relatively. A game surface in this bundle would import a name the
 * aliased module does not export and fail at BUILD time.
 *
 * The alias map is obtained by RUNNING the config's `webpack` hook, not by
 * parsing the file. What a bundler resolves is what the hook returns, and the
 * hook can build that object any way JavaScript allows — a literal, a bracket
 * write, a logical assignment, a spread of someone else's map. A reader that
 * recognises shapes answers for the shapes it recognises and silently omits the
 * rest, and an omission here is a smaller census, which passes every assertion
 * a full one does.
 *
 * What is compared is the SOURCE MODULE each side names: the manifest's
 * `./dist/<stem>.js` maps back to `renderer/<stem>.ts(x)`, and the alias target
 * resolves as webpack would (the module itself, or its `index`). A subpath the
 * alias does not carry is not a finding — the alias list is deliberately partial
 * and says so — but every subpath it DOES carry must land on the module the
 * package publishes.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import nextConfig from '../next.config';
import { nodeGraphFileSystem, sourceForDistTarget } from './shellLayoutGraphCensus';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = resolve(__dirname, '..');
const REPO_ROOT = resolve(RENDERER_DIR, '..');

const RENDERER_PACKAGE = '@chimera-engine/renderer';

interface RendererManifest {
    exports?: Record<string, { types?: string; default?: string } | string>;
}

const manifest = JSON.parse(
    readFileSync(resolve(RENDERER_DIR, 'package.json'), 'utf8'),
) as RendererManifest;

interface WebpackConfigShape {
    resolve: { alias: Record<string, string>; extensionAlias: Record<string, string[]> };
}

/**
 * The alias map the config actually produces, from the hook itself. Called with
 * a bare object, which the hook seeds — so what comes back is what this config
 * CONTRIBUTES, without the base map a bundler would have spread in first.
 */
function effectiveAliasMap(): Record<string, string> {
    const hook = nextConfig.webpack as unknown as (config: unknown) => WebpackConfigShape;
    return hook({}).resolve.alias;
}

/** The repo-relative source module `target` resolves to, or `null` when none does. */
export function resolveAliasSource(
    target: string,
    fileExists: (path: string) => boolean,
): string | null {
    const candidates = [
        `${target}.ts`,
        `${target}.tsx`,
        `${target}/index.ts`,
        `${target}/index.tsx`,
    ];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
}

const onDisk = (path: string): boolean => existsSync(resolve(REPO_ROOT, path));

/** Every module specifier `file` imports or re-exports from, read off the AST. */
function specifiersOf(file: string): readonly string[] {
    const parsed = ts.createSourceFile(
        file,
        readFileSync(resolve(REPO_ROOT, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
        const moduleSpecifier =
            ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
                ? node.moduleSpecifier
                : undefined;
        if (moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)) {
            specifiers.push(moduleSpecifier.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(parsed);
    return specifiers;
}

/** `specifier` resolved against `fromDir`, extensionless and POSIX-separated. */
function resolveRelative(fromDir: string, specifier: string): string {
    const segments = `${fromDir}/${specifier.replace(/\.(?:ts|tsx|js|jsx)$/u, '')}`.split('/');
    const out: string[] = [];
    for (const segment of segments) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') {
            out.pop();
            continue;
        }
        out.push(segment);
    }
    return out.join('/');
}

const aliasMap = effectiveAliasMap();
const rendererAliases = Object.entries(aliasMap).filter(([specifier]) =>
    specifier.startsWith(`${RENDERER_PACKAGE}/`),
);

describe('renderer/next.config.ts aliases agree with the published exports map', () => {
    it('runs the hook and reads a map with renderer subpaths in it', () => {
        // A hook that returned an empty map — or one this test filtered down to
        // nothing — would satisfy every case below. Measured against the map:
        // it carries entries beyond the renderer subpaths (the game-registration
        // alias and the tactics package), and `game` is among the ones it does.
        expect(Object.keys(aliasMap).length).toBeGreaterThan(rendererAliases.length);
        expect(rendererAliases.map(([specifier]) => specifier)).toContain(
            `${RENDERER_PACKAGE}/game`,
        );
    });

    it('contributes only targets that are absolute paths inside this repo', () => {
        for (const [specifier, target] of Object.entries(aliasMap)) {
            expect(target.startsWith(REPO_ROOT + sep), `${specifier} → ${target}`).toBe(true);
        }
    });

    it.each(rendererAliases)(
        '%s lands on the module the package publishes',
        (specifier, target) => {
            const exportsKey = `.${specifier.slice(RENDERER_PACKAGE.length)}`;
            const entry = manifest.exports?.[exportsKey];

            expect(
                entry,
                `${specifier} is aliased but ${exportsKey} is not published`,
            ).toBeDefined();
            const distTarget = typeof entry === 'string' ? entry : entry?.default;
            expect(distTarget, `${exportsKey} declares no default condition`).toBeDefined();

            // The shared mapper answers with an absolute path; this comparison
            // is in repo-relative terms, which is what `resolveAliasSource`
            // returns.
            const publishedAbsolute = sourceForDistTarget(
                distTarget ?? '',
                nodeGraphFileSystem,
                REPO_ROOT,
            );
            const published =
                publishedAbsolute === null ? null : relative(REPO_ROOT, publishedAbsolute);
            const aliased = resolveAliasSource(relative(REPO_ROOT, target), onDisk);

            expect(
                published,
                `${exportsKey} → ${String(distTarget)} has no source module`,
            ).not.toBeNull();
            expect(aliased, `${specifier} → ${target} resolves to no source module`).not.toBeNull();
            expect(aliased).toBe(published);
        },
    );
});

describe('the aliased barrel and the engine reach ONE shell-state store', () => {
    it('names the same store module from both halves of the aliased bundle', () => {
        // The alias exists so this bundle holds one instance of every singleton
        // behind the surface it maps. What the barrel's graph reaches is pinned
        // by `game-barrel-side-effects.test.ts`; the shell-state store is
        // singled out here because two physical copies of it would not throw —
        // a game's page would simply read a state nothing writes into.
        const fromBarrel = specifiersOf('renderer/game/index.ts').filter((specifier) =>
            specifier.includes('shellStateStore'),
        );
        const fromBridge = specifiersOf('renderer/components/shell/ShellStateBridge.tsx').filter(
            (specifier) => specifier.includes('shellStateStore'),
        );

        expect(fromBarrel).toHaveLength(1);
        expect(fromBridge).toHaveLength(1);
        expect(resolveRelative('renderer/game', fromBarrel[0] ?? '')).toBe(
            resolveRelative('renderer/components/shell', fromBridge[0] ?? ''),
        );
        expect(resolveRelative('renderer/game', fromBarrel[0] ?? '')).toBe(
            'renderer/shell/shellStateStore',
        );
    });
});

// ── The two resolvers, against synthetic inputs ──────────────────────────────

describe('resolveAliasSource', () => {
    it('prefers the module itself over a directory index', () => {
        const exists = (path: string): boolean =>
            path === 'renderer/game.ts' || path === 'renderer/game/index.ts';

        expect(resolveAliasSource('renderer/game', exists)).toBe('renderer/game.ts');
    });

    it('falls back to the directory index, which is how every barrel alias resolves', () => {
        const exists = (path: string): boolean => path === 'renderer/game/index.ts';

        expect(resolveAliasSource('renderer/game', exists)).toBe('renderer/game/index.ts');
    });

    it('accepts a .tsx module', () => {
        const exists = (path: string): boolean => path === 'renderer/x/index.tsx';

        expect(resolveAliasSource('renderer/x', exists)).toBe('renderer/x/index.tsx');
    });

    it('is null when nothing resolves', () => {
        expect(resolveAliasSource('renderer/nope', () => false)).toBeNull();
    });
});
