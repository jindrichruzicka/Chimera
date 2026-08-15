/**
 * tools/component-gallery-gate-section.test.ts
 *
 * Anti-rot guard for the "Component Gallery" section of
 * `docs/core-components/gameshell-ui-design-system.md` — the section an adopter
 * reads to learn when the dev-only gallery route is reachable.
 *
 * The section used to restate the gate as two conditions the gate does not read:
 * a non-production `NODE_ENV`, and `NEXT_PUBLIC_CHIMERA_E2E=1`. `isGalleryEnabled`
 * reads exactly one flag, `NEXT_PUBLIC_CHIMERA_PACKAGED`, and the module header
 * explains why the environment marker is useless here — the renderer is a static
 * export, so `next build` bakes `NODE_ENV='production'` into dev bundles too. A
 * reader following the doc concluded the gallery needed an E2E flag to be
 * reachable outside development, when in fact only the packaging flag closes it.
 *
 * So the property pinned here is not "the prose says today's sentence". It is:
 *
 * - **Every environment flag the section names is one the gate reads.** This is
 *   the defect class, stated as a set relation rather than as a spelling. It
 *   failed on the prose this branch replaced, and it fails again the day the
 *   gate stops reading a flag the section still advertises.
 * - **Every flag the gate reads is named.** A gate that grew a second condition
 *   silently leaves the section describing half a gate.
 * - **The pointer still resolves.** The section names `isGalleryEnabled`, and the
 *   module still declares a function by that name; a pointer at a renamed symbol
 *   reads as evidence and is not. Declares, not exports: no modifier is checked,
 *   so a gate that stops being exported is not reported here.
 *
 * Both directions are parsed out of `galleryGate.ts` with the TypeScript AST
 * rather than grepped, so a rewrite that keeps the flag name in a comment while
 * changing what the function reads does not pass.
 *
 * Scope limits, stated rather than left to be discovered:
 *
 * - Only `process.env` reads written INSIDE the named function are collected —
 *   bracket or dot form, literal key. A flag reached through a module-level
 *   const, a helper, or a computed key is invisible to the collector, which is
 *   why the anti-vacuity floor below requires the parse to find at least one:
 *   an empty read-set would otherwise make "every flag is named" pass over
 *   nothing.
 * - The floor is a FLOOR, not a count: a second flag reached through a helper
 *   or a const is invisible for the same reason, and the section's "one flag"
 *   would go quietly stale. Only an all-invisible gate is reported.
 * - A consequence of the first conjunct, deliberate: the section cannot discuss
 *   the REJECTED flag by name. That rationale belongs in the module header,
 *   which already carries it — a second copy in prose is what rotted here.
 * - The section ends at the first line starting with `#`, so a `#` comment
 *   inside a fenced block within the section would truncate it. The section
 *   carries no fence today.
 * - Link targets are not resolved; `tools/docs-link-resolution.test.ts` owns
 *   that.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const SECTION_DOC = 'docs/core-components/gameshell-ui-design-system.md';
const SECTION_HEADING = '### Component Gallery (`/component-gallery/`)';

/** The gate the section points at: the module, and the function it exports. */
const GATE = {
    file: 'renderer/app/component-gallery/galleryGate.ts',
    symbol: 'isGalleryEnabled',
} as const;

// ─── Section extraction ─────────────────────────────────────────────────────────

/**
 * The body of the `###` section headed by `heading`, up to the next heading at
 * any level. Fed a `readText` so the parser itself can be measured against
 * synthetic input rather than only against the tree.
 */
function sectionBody(heading: string, readText: (rel: string) => string = read): string {
    const lines = readText(SECTION_DOC).split('\n');
    const start = lines.indexOf(heading);
    if (start < 0) {
        return '';
    }
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => line.startsWith('#'));
    return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

// ─── Environment flags named in prose ───────────────────────────────────────────

/**
 * A shell-style environment name: upper-case runs joined by underscores. The
 * underscore is required, which is what keeps a bare acronym written as prose
 * (`E2E`, `CSS`) from reading as a flag the gate would have to justify.
 */
const ENV_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Every environment-flag name `text` writes, deduplicated, in order. */
function envNamesIn(text: string): string[] {
    return [...new Set(text.match(ENV_NAME) ?? [])];
}

// ─── Environment flags the gate reads ───────────────────────────────────────────

/** `true` for the `process.env` of a `process.env[…]` / `process.env.…` read. */
function isProcessEnv(node: ts.Node): boolean {
    return (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === 'env' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'process'
    );
}

/** The body of the function `name` declares in `source`, or `undefined`. */
function functionBody(source: ts.SourceFile, name: string): ts.Node | undefined {
    let found: ts.Node | undefined;
    const visit = (node: ts.Node): void => {
        if (
            found === undefined &&
            ts.isFunctionDeclaration(node) &&
            node.name?.text === name &&
            node.body !== undefined
        ) {
            found = node.body;
            return;
        }
        if (
            found === undefined &&
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name &&
            node.initializer !== undefined &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
            found = node.initializer.body;
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

/**
 * Every literal `process.env` key read inside the function `name` declares in
 * `text`, deduplicated, or `null` when `text` declares no such function.
 *
 * `null` and `[]` are distinct on purpose: an absent function is a broken
 * pointer, an empty read-set is a gate the collector cannot see into. The suite
 * reports them separately.
 */
function envKeysReadBy(text: string, name: string): string[] | null {
    const source = ts.createSourceFile('gate.ts', text, ts.ScriptTarget.Latest, true);
    const body = functionBody(source, name);
    if (body === undefined) {
        return null;
    }
    const keys: string[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isElementAccessExpression(node) && isProcessEnv(node.expression)) {
            if (ts.isStringLiteralLike(node.argumentExpression)) {
                keys.push(node.argumentExpression.text);
            }
        } else if (ts.isPropertyAccessExpression(node) && isProcessEnv(node.expression)) {
            keys.push(node.name.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(body);
    return [...new Set(keys)];
}

describe('component gallery gate section', () => {
    const body = sectionBody(SECTION_HEADING);
    const gateKeys = (): string[] | null => envKeysReadBy(read(GATE.file), GATE.symbol);

    it('is found in the design-system doc', () => {
        expect(
            body.trim().length,
            `${SECTION_DOC} has no "${SECTION_HEADING}" section`,
        ).toBeGreaterThan(0);
    });

    it('points at a symbol the gate module still declares', () => {
        expect(gateKeys(), `${GATE.file} no longer declares ${GATE.symbol}`).not.toBeNull();
    });

    it('names the gate function the section is describing', () => {
        expect(body, `the section must name \`${GATE.symbol}\``).toContain(GATE.symbol);
    });

    it('reads a gate the parse can still see an environment flag inside', () => {
        expect(
            gateKeys() ?? [],
            `no process.env read parsed out of ${GATE.symbol} — the collector stopped matching`,
        ).not.toEqual([]);
    });

    it('names every environment flag the gate reads', () => {
        const named = envNamesIn(body);
        expect((gateKeys() ?? []).filter((key) => !named.includes(key))).toEqual([]);
    });

    it('names no environment flag the gate does not read', () => {
        const keys = gateKeys() ?? [];
        expect(envNamesIn(body).filter((named) => !keys.includes(named))).toEqual([]);
    });
});

describe('envNamesIn', () => {
    it('collects a flag written with an assignment in prose', () => {
        expect(envNamesIn('set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` before the build')).toEqual([
            'NEXT_PUBLIC_CHIMERA_PACKAGED',
        ]);
    });

    it('collects a flag written bare, without an assignment', () => {
        expect(envNamesIn('gated on `NODE_ENV` alone')).toEqual(['NODE_ENV']);
    });

    it('collects each flag a sentence names, once however often it repeats', () => {
        expect(envNamesIn('NODE_ENV, then NODE_ENV again, then CHIMERA_PACKAGED_BUILD')).toEqual([
            'NODE_ENV',
            'CHIMERA_PACKAGED_BUILD',
        ]);
    });

    it('ignores an acronym written as prose, which names no flag', () => {
        expect(envNamesIn('a development and E2E-only fixture rendered in HTML')).toEqual([]);
    });

    it('ignores a lower-case identifier and a section reference', () => {
        expect(envNamesIn('`isGalleryEnabled()` implements the §4.35 gate')).toEqual([]);
    });
});

describe('envKeysReadBy', () => {
    it('reads the key out of a bracket-form access', () => {
        const source = [
            'export function isGalleryEnabled(): boolean {',
            "    return process.env['NEXT_PUBLIC_CHIMERA_PACKAGED'] !== '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual(['NEXT_PUBLIC_CHIMERA_PACKAGED']);
    });

    it('reads the key out of a dot-form access, so a refactor cannot empty the set', () => {
        const source = [
            'export function isGalleryEnabled(): boolean {',
            "    return process.env.NEXT_PUBLIC_CHIMERA_PACKAGED !== '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual(['NEXT_PUBLIC_CHIMERA_PACKAGED']);
    });

    it('reads a gate declared as an exported arrow const', () => {
        const source =
            "export const isGalleryEnabled = (): boolean => process.env['A_B'] !== '1';\n";
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual(['A_B']);
    });

    it('reports every key a gate with more than one condition reads', () => {
        const source = [
            'export function isGalleryEnabled(): boolean {',
            "    return process.env['A_B'] !== '1' && process.env['C_D'] === '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual(['A_B', 'C_D']);
    });

    it('does not read a key out of a different function in the same module', () => {
        const source = [
            'export function isGalleryEnabled(): boolean {',
            "    return process.env['A_B'] !== '1';",
            '}',
            'export function other(): boolean {',
            "    return process.env['C_D'] === '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual(['A_B']);
    });

    it('does not read a key out of the module header comment', () => {
        const source = [
            "// Why not process.env['NODE_ENV']: next build bakes it.",
            'export function isGalleryEnabled(): boolean {',
            "    return process.env['A_B'] !== '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual(['A_B']);
    });

    it('does not read a key off an object that merely ends in env', () => {
        const source = [
            'export function isGalleryEnabled(): boolean {',
            "    return launchEnv['A_B'] !== '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual([]);
    });

    it('reports an empty set for a gate whose flag is reached through a const', () => {
        const source = [
            "const FLAG = process.env['A_B'];",
            'export function isGalleryEnabled(): boolean {',
            "    return FLAG !== '1';",
            '}',
        ].join('\n');
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toEqual([]);
    });

    it('returns null when the module declares no function by that name', () => {
        expect(
            envKeysReadBy('export function other(): boolean { return true; }', 'isGalleryEnabled'),
        ).toBeNull();
    });

    it('does not match a longer identifier that ends with the symbol', () => {
        const source = 'export function myIsGalleryEnabled(): boolean { return true; }';
        expect(envKeysReadBy(source, 'isGalleryEnabled')).toBeNull();
    });
});

describe('sectionBody', () => {
    it('stops at the next heading rather than running into the following section', () => {
        const synthetic = [SECTION_HEADING, 'kept', '### Next', 'dropped'].join('\n');
        expect(sectionBody(SECTION_HEADING, () => synthetic)).toBe('kept');
    });

    it('stops at a heading one level up as well as at a sibling', () => {
        const synthetic = [SECTION_HEADING, 'kept', '## Parent', 'dropped'].join('\n');
        expect(sectionBody(SECTION_HEADING, () => synthetic)).toBe('kept');
    });

    it('returns empty when the heading is absent, so the floor above reports it', () => {
        expect(sectionBody(SECTION_HEADING, () => '## Something else\nbody')).toBe('');
    });
});
