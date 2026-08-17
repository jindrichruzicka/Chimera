/**
 * tools/root-eslint-config.test.ts
 *
 * Anti-rot guard for the monorepo's own ESLint entry point after the `chimera`
 * plugin moved into `@chimera-engine/electron` and became a published subpath.
 *
 * The relocation is only finished when the repo eats its own dog food: the root
 * config must load the COMPILED plugin through `@chimera-engine/electron/eslint`
 * — the same artifact a standalone game gets. Any other acquisition means the
 * monorepo and its consumers enforce different code from different files, and
 * only one of them is tested.
 *
 * Several properties are pinned, because each rots differently:
 *
 *   - the config IMPORTS the subpath, read from the AST. A substring match is
 *     equally satisfied by the specifier appearing in a comment — and this
 *     file's own prose is proof that it does appear in comments;
 *   - the rule blocks USE the binding that import produced. Acquiring the
 *     plugin somewhere else and registering THAT is what actually decides which
 *     rules run; an import nothing references is decoration;
 *   - the retired tree is GONE from disk. A config repointed while the old
 *     directory survives leaves a second, unreferenced copy of the rules for
 *     the next reader to edit;
 *   - NOTHING TRACKED still names the retired path. Enumerated from the git
 *     index rather than a hand-listed set of files, because an allowlist's
 *     omissions are silent — and the two docs that named it were nowhere near
 *     the config.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    ScriptKind,
    ScriptTarget,
    createSourceFile,
    forEachChild,
    isIdentifier,
    isImportDeclaration,
    isNamedImports,
    isObjectLiteralExpression,
    isPropertyAssignment,
    isStringLiteral,
} from 'typescript';
import type { Node, ObjectLiteralExpression, PropertyAssignment, SourceFile } from 'typescript';
import { describe, expect, it } from 'vitest';
import { LEVEL_WIDTH, parseTreeRow } from './__test-support__/annotated-file-tree.js';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const rootConfigPath = path.join(workspaceRoot, 'eslint.config.mjs');

const PLUGIN_SUBPATH = '@chimera-engine/electron/eslint';

/**
 * The retired home, assembled rather than written: the tracked-file sweep below
 * reads every text file the repo contains, including this one.
 */
const RETIRED_PLUGIN_HOME = ['tools', 'eslint-plugin-chimera'].join('/');

function parse(file: string): SourceFile {
    return createSourceFile(
        file,
        readFileSync(file, 'utf8'),
        ScriptTarget.ESNext,
        /* setParentNodes */ false,
        ScriptKind.JS,
    );
}

/**
 * The named bindings each module specifier is imported with, from real imports.
 * Accumulated rather than assigned: two import declarations naming the same
 * module are legal, and letting the second overwrite the first would hide one.
 */
function namedImportsBySpecifier(source: SourceFile): Map<string, string[]> {
    const found = new Map<string, string[]>();

    const visit = (node: Node): void => {
        if (isImportDeclaration(node) && isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.importClause?.namedBindings;
            const names =
                bindings !== undefined && isNamedImports(bindings)
                    ? bindings.elements.map((element) => element.name.text)
                    : [];
            const already = found.get(node.moduleSpecifier.text) ?? [];
            found.set(node.moduleSpecifier.text, [...already, ...names]);
        }
        forEachChild(node, visit);
    };
    forEachChild(source, visit);

    return found;
}

/** Source texts a rule severity can take to mean "off". */
const OFF_SEVERITIES = new Set(["'off'", '"off"', '0']);

/** A property key's literal text, or `undefined` if it is computed. */
function staticKeyOf(property: PropertyAssignment): string | undefined {
    if (isIdentifier(property.name)) return property.name.text;
    if (isStringLiteral(property.name)) return property.name.text;
    return undefined;
}

/** The named property of an object literal, if it has one with a static key. */
function propertyNamed(
    object: ObjectLiteralExpression,
    key: string,
): PropertyAssignment | undefined {
    for (const property of object.properties) {
        if (!isPropertyAssignment(property)) continue;
        if (staticKeyOf(property) === key) return property;
    }
    return undefined;
}

interface ConfigBlock {
    /** The expression registered as the `chimera` plugin, if any. */
    readonly registers: string | undefined;
    /** Every `chimera/*` rule id this block configures, at any severity. */
    readonly mentions: readonly string[];
    /** `chimera/*` rule ids this block sets to something other than `'off'`. */
    readonly enables: readonly string[];
    /** A `plugins` or `rules` key this scan could not read statically. */
    readonly opaque: readonly string[];
}

/**
 * Every flat-config block that mentions the plugin, read from the AST.
 *
 * `plugins: { chimera: <x> }` is the value ESLint loads rules from, so it — not
 * the import — decides which code runs. Keys are read in EVERY static form
 * (`chimera` and `'chimera'` are the same config), and a computed key is
 * recorded as opaque rather than skipped: a scan that silently drops a
 * registration site cannot report the one failure it exists to catch.
 */
function chimeraConfigBlocks(source: SourceFile): readonly ConfigBlock[] {
    const blocks: ConfigBlock[] = [];

    const visit = (node: Node): void => {
        if (isObjectLiteralExpression(node)) {
            const plugins = propertyNamed(node, 'plugins');
            const rules = propertyNamed(node, 'rules');

            if (plugins !== undefined || rules !== undefined) {
                const opaque: string[] = [];
                let registers: string | undefined;
                const mentions: string[] = [];
                const enables: string[] = [];

                if (plugins !== undefined && isObjectLiteralExpression(plugins.initializer)) {
                    for (const property of plugins.initializer.properties) {
                        if (!isPropertyAssignment(property)) continue;
                        const key = staticKeyOf(property);
                        if (key === undefined) opaque.push('plugins:<computed>');
                        else if (key === 'chimera')
                            registers = property.initializer.getText(source);
                    }
                }

                if (rules !== undefined && isObjectLiteralExpression(rules.initializer)) {
                    for (const property of rules.initializer.properties) {
                        if (!isPropertyAssignment(property)) continue;
                        const key = staticKeyOf(property);
                        if (key === undefined) {
                            opaque.push('rules:<computed>');
                        } else if (key.startsWith('chimera/')) {
                            mentions.push(key);
                            // Every spelling ESLint accepts for "off". Reading
                            // only the repo's own `'off'` would score `0` as
                            // enabled — a false alarm rather than silence, but
                            // an avoidable one.
                            const severity = property.initializer.getText(source);
                            if (!OFF_SEVERITIES.has(severity)) enables.push(key);
                        }
                    }
                }

                if (registers !== undefined || mentions.length > 0 || opaque.length > 0) {
                    blocks.push({ registers, mentions, enables, opaque });
                }
            }
        }
        forEachChild(node, visit);
    };
    forEachChild(source, visit);

    return blocks;
}

/** Every tracked text file that contains `needle`, as repo-relative paths. */
function trackedFilesContaining(needle: string): readonly string[] {
    // `git grep -I` skips binaries; a zero-hit search exits 1, which is the
    // expected outcome here rather than a failure to run.
    try {
        const listing = execFileSync('git', ['grep', '-I', '--name-only', '-F', '-z', needle], {
            cwd: workspaceRoot,
            encoding: 'utf8',
        });
        return listing.split('\0').filter((entry) => entry.length > 0);
    } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 1) return [];
        throw error;
    }
}

describe('root eslint.config.mjs', () => {
    it('imports the plugin from the published electron subpath', () => {
        const imports = namedImportsBySpecifier(parse(rootConfigPath));

        expect([...imports.keys()]).toContain(PLUGIN_SUBPATH);
        expect(imports.get(PLUGIN_SUBPATH)).toContain('chimeraPlugin');
    });

    it('imports the plugin from nowhere else', () => {
        // A repoint that ADDS the subpath import while leaving the old one in
        // place satisfies the assertion above and still loads the other one.
        const specifiers = [...namedImportsBySpecifier(parse(rootConfigPath)).keys()];

        expect(specifiers.filter((specifier) => specifier.includes('chimera'))).toEqual([
            PLUGIN_SUBPATH,
        ]);
    });

    it('registers that import — and only that import — as the chimera plugin', () => {
        // The property the two assertions above only approach. `plugins: {
        // chimera: <x> }` is what ESLint reads rules from, so a config that
        // imports the subpath and then registers a plugin acquired some other
        // way (a dynamic `import()`, a `createRequire`, a local object) passes
        // both of them while running entirely different code.
        const source = parse(rootConfigPath);
        const imported = namedImportsBySpecifier(source).get(PLUGIN_SUBPATH) ?? [];
        const blocks = chimeraConfigBlocks(source);

        // Exactly one local name, so comparing each registration against
        // `imported[0]` is a complete comparison rather than a lucky one.
        expect(imported).toHaveLength(1);
        expect(blocks.flatMap((block) => block.opaque)).toEqual([]);

        for (const block of blocks) {
            if (block.registers === undefined) continue;
            expect(block.registers).toBe(imported[0]);
        }
    });

    it('registers the plugin in exactly the blocks that switch a chimera rule on', () => {
        // An EXACT pairing rather than a count floor. Every block that enables
        // a `chimera/*` rule must register the plugin, and no block registers
        // it for nothing — so a registration site that vanishes from the scan
        // (a syntax this reader cannot see) or from the config (leaving the
        // rule resolved through some other matching block) both red, instead
        // of being absorbed by slack. The `'off'` exemption blocks deliberately
        // register nothing and are the negative half.
        //
        // The scope is blocks reached through a STATICALLY NAMED `plugins` or
        // `rules` key. A block written with both keys computed is invisible to
        // this reader — but it is also invisible on both sides of the pairing at
        // once, so it cannot make one plugin object stand in for another, which
        // is the failure this exists to catch.
        const blocks = chimeraConfigBlocks(parse(rootConfigPath));

        const enabling = blocks.filter((block) => block.enables.length > 0);
        const registering = blocks.filter((block) => block.registers !== undefined);
        const exempting = blocks.filter(
            (block) => block.mentions.length > 0 && block.enables.length === 0,
        );

        // Floor: both halves must be non-empty, or the pairing is vacuous.
        expect(enabling.length).toBeGreaterThan(0);
        expect(exempting.length).toBeGreaterThan(0);

        expect(registering.map((block) => block.enables)).toEqual(
            enabling.map((block) => block.enables),
        );
    });
});

describe('retired eslint-plugin-chimera tree', () => {
    it('no longer exists on disk', () => {
        expect(existsSync(path.join(workspaceRoot, RETIRED_PLUGIN_HOME))).toBe(false);
    });

    it('is named by nothing the repository tracks', () => {
        // Sourced from the index, not a directory walk: "tracked" IS the
        // operational definition of hand-written. It needs no skip-set, and it
        // cannot red on a scratch file the repo does not contain.
        expect(trackedFilesContaining(RETIRED_PLUGIN_HOME)).toEqual([]);
    });

    it('has a working sweep — the same search finds the path that replaced it', () => {
        // Floor. An `expect(...).toEqual([])` above is equally satisfied by a
        // search that never runs, matches nothing, or silently swallows its
        // own failure, so the identical mechanism is asked a question with a
        // known non-empty answer.
        //
        // The needle is the published SPECIFIER and the anchor is the root
        // config, because that hit is a real `import` declaration — it cannot
        // be deleted while the feature works. The source DIRECTORY would have
        // been the weaker choice: most of its occurrences are
        // `// Rule implementation:` comments, so a comment tidy-up would red a
        // floor anchored on it while the sweep was fine.
        const hits = trackedFilesContaining(PLUGIN_SUBPATH);

        expect(hits).toContain('eslint.config.mjs');
    });
});

describe('module-boundaries file tree', () => {
    const fileTree = readFileSync(
        path.join(workspaceRoot, 'docs/executive-architecture/module-boundaries-file-tree.md'),
        'utf8',
    ).split('\n');

    interface TreeEntry {
        readonly index: number;
        readonly column: number;
        readonly name: string;
    }

    // The row grammar and the level width come from __test-support__ because a second
    // guard (tools/e2e-file-tree-single-source.test.ts) walks this same tree with a
    // different traversal. The traversals differ on purpose; what they must not differ
    // on is which lines are entries and how wide a level is.
    function treeEntries(): readonly TreeEntry[] {
        return fileTree.flatMap((line, index) => {
            const row = parseTreeRow(line);
            if (row === undefined) return [];
            return [{ index, column: row.column, name: row.name }];
        });
    }

    function childrenOf(entries: readonly TreeEntry[], parent: TreeEntry): readonly TreeEntry[] {
        const children: TreeEntry[] = [];
        for (const entry of entries) {
            if (entry.index <= parent.index) continue;
            if (entry.column <= parent.column) break; // parent's subtree is over
            if (entry.column === parent.column + LEVEL_WIDTH) children.push(entry);
        }
        return children;
    }

    // The sibling relocations (`electron/dev-tools/*/relocation.test.ts`) each
    // pin their own entry this way, and the reason is the same here: the rules
    // moved, and a doc that still draws them somewhere else is the one surface
    // no other assertion on this branch reads.
    it('documents the rules under electron/dev-tools/, in exactly one place', () => {
        const entries = treeEntries();

        const electron = entries.find((entry) => entry.column === 0 && entry.name === 'electron');
        expect(electron, 'the file tree has no top-level electron/ entry').toBeDefined();

        const devTools = childrenOf(entries, electron!).find((entry) => entry.name === 'dev-tools');
        expect(devTools, 'electron/ has no dev-tools/ child entry').toBeDefined();

        expect(childrenOf(entries, devTools!).map((entry) => entry.name)).toContain('eslint');

        // Walked to, not name-matched doc-wide: an entry re-homed under some
        // other parent, or duplicated into a second tree, satisfies a bare
        // name search while the documented home is wrong.
        expect(entries.filter((entry) => entry.name === 'eslint').length).toBe(1);
    });
});
