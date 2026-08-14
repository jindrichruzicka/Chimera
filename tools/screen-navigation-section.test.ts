/**
 * tools/screen-navigation-section.test.ts
 *
 * Anti-rot guard for the "Within-Scene Screen Navigation" section of
 * `docs/core-components/gameshell-ui-design-system.md` — the section an adopter
 * reads to learn the screen-navigation contract.
 *
 * The section used to state the scene-entry reset as a literal ("resets the key
 * to `'playfield'`") where the engine applies a precedence cascade, so a game
 * declaring `sceneDefaultScreens` was told its entry would be ignored. The
 * repair replaced the literal with a POINTER at the code that applies the
 * cascade: the cascade has several consumers, and a copy of it in prose is one
 * more place for it to drift.
 *
 * A pointer is only worth more than a restatement while it resolves, so three
 * things are pinned here and each rots on its own.
 *
 * - **Every source path the section names is tracked.** This is not
 *   hypothetical: the section shipped with a code-block header naming
 *   `renderer/hooks/useScreenNav.ts`, a path that has never existed in this
 *   repo — the hooks it heads are declared in `renderer/state/uiStore.ts`.
 * - **The pointer is still written, and its symbol still exists.** A sentence
 *   that loses the pointer is back to being an unchecked claim; a pointer at a
 *   renamed local reads as evidence and is not.
 * - **`'playfield'` is still only the LAST fallback.** The section says so, and
 *   that sentence goes false the moment the cascade in `SceneRouter.tsx`
 *   collapses to a single source or ends on a different literal.
 *
 * Scope limits, stated rather than left to be discovered:
 *
 * - Only `.ts`/`.tsx` paths carrying a directory segment are collected. A bare
 *   basename in prose resolves nowhere and is not treated as a path claim here;
 *   markdown links are the business of `tools/docs-link-resolution.test.ts`.
 * - The cascade is read as the text between `const <symbol> =` and the next
 *   `;`. That is the shape `SceneRouter.tsx` writes; a semicolon inside a string
 *   literal in the initializer would cut it short.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const SECTION_DOC = 'docs/core-components/gameshell-ui-design-system.md';
const SECTION_HEADING = '### Within-Scene Screen Navigation';

/**
 * The pointer the section's reset sentence carries: a symbol, and the file that
 * declares it. Both halves are asserted to be WRITTEN in the section as well as
 * to resolve, so deleting the pointer fails here rather than passing on an
 * unchecked sentence.
 */
const RESET_POINTER = {
    symbol: 'defaultScreenKey',
    file: 'renderer/components/scene/SceneRouter.tsx',
} as const;

/** The literal the section names as the cascade's last fallback. */
const LAST_FALLBACK = `'playfield'`;

/**
 * The number of source paths the section named at the tree that introduced this
 * guard (`renderer/state/uiStore.ts` and `SceneRouter.tsx`). A floor, not a
 * count: it exists so a collector that stopped matching cannot turn the
 * tracked-path check into a pass over an empty list.
 */
const MIN_SOURCE_PATHS = 2;

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

/**
 * The blank-line-delimited paragraph of `body` that carries `marker`, or `''`.
 *
 * The file and last-fallback conjuncts resolve against this rather than against
 * the whole section, because the section names `'playfield'` twice for two
 * unrelated reasons: once as this cascade's last fallback, and once in the
 * `useNavigateToScreen` comment, which is a claim about NAVIGATION and not about
 * the reset. Asked of the whole section, "the last fallback is named" passes on
 * the navigation sentence alone — measured, and it did.
 *
 * The symbol conjunct is the exception and stays section-wide: the symbol is
 * what LOCATES the paragraph.
 */
function paragraphNaming(marker: string, body: string): string {
    return body.split(/\n\s*\n/).find((paragraph) => paragraph.includes(marker)) ?? '';
}

// ─── Source-path collection ─────────────────────────────────────────────────────

/** A run of the characters a repo-relative path is written from. */
const PATH_TOKEN = /[\w./-]+/g;

/** Every character `PATH_TOKEN` admits — the set a widened trim could reach into. */
const PATH_CHARACTERS = [
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789',
    ...'_./-',
];

/** The full stops a path ends on when it ends a sentence — punctuation, not path. */
const SENTENCE_END = /\.+$/;

/**
 * A repo-relative TypeScript source path: at least one directory segment, then a
 * `.ts`/`.tsx` basename. The directory segment is required because a bare
 * basename names no file to resolve against, and admitting one would report
 * every module mentioned by name in prose.
 */
const SOURCE_PATH = /^[\w.-]+(?:\/[\w.-]+)+\.tsx?$/;

/** Every repo-relative TypeScript source path `text` names, in order, deduplicated. */
function sourcePathsIn(text: string): string[] {
    const found = (text.match(PATH_TOKEN) ?? [])
        .map((run) => run.replace(SENTENCE_END, ''))
        .filter((candidate) => SOURCE_PATH.test(candidate));
    return [...new Set(found)];
}

// ─── Cascade parsing ────────────────────────────────────────────────────────────

/**
 * The `??` operands of `const <symbol> = …;` in `source`, or `null` when the
 * source declares no such const.
 *
 * `?.` is not `??`, so an optional-chained index inside an operand — which is
 * exactly what the middle operand of the real cascade is — must not split it.
 */
function cascadeOperands(source: string, symbol: string): string[] | null {
    const declaration = new RegExp(`\\bconst\\s+${symbol}\\s*=`).exec(source);
    if (declaration === null) {
        return null;
    }
    const from = declaration.index + declaration[0].length;
    const terminator = source.indexOf(';', from);
    if (terminator < 0) {
        return null;
    }
    return source
        .slice(from, terminator)
        .split('??')
        .map((operand) => operand.trim());
}

// ─── The tree ───────────────────────────────────────────────────────────────────

function trackedFiles(): Set<string> {
    const output = execFileSync('git', ['ls-files', '-z'], {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
    return new Set(output.split('\0').filter((file) => file.length > 0));
}

/** The members of `paths` the tree does not track — the phantom pointers, in order. */
function untrackedAmong(paths: readonly string[], tracked: ReadonlySet<string>): string[] {
    return paths.filter((candidate) => !tracked.has(candidate));
}

describe('within-scene screen navigation section', () => {
    const body = sectionBody(SECTION_HEADING);
    const operands = (): string[] | null =>
        cascadeOperands(read(RESET_POINTER.file), RESET_POINTER.symbol);

    it('is found in the design-system doc', () => {
        expect(
            body.trim().length,
            `${SECTION_DOC} has no "${SECTION_HEADING}" section`,
        ).toBeGreaterThan(0);
    });

    it('names at least the source paths it named when this guard was written', () => {
        expect(
            sourcePathsIn(body).length,
            `no source path parsed out of "${SECTION_HEADING}" — the collector stopped matching`,
        ).toBeGreaterThanOrEqual(MIN_SOURCE_PATHS);
    });

    it('names no source path the repo does not track', () => {
        expect(untrackedAmong(sourcePathsIn(body), trackedFiles())).toEqual([]);
    });

    it('names somewhere the symbol the scene-entry reset is applied under', () => {
        expect(
            body,
            `the section must name \`${RESET_POINTER.symbol}\` — it locates the reset paragraph`,
        ).toContain(RESET_POINTER.symbol);
    });

    it('names the file that applies the scene-entry reset', () => {
        expect(
            paragraphNaming(RESET_POINTER.symbol, body),
            `the reset paragraph must name ${RESET_POINTER.file}`,
        ).toContain(RESET_POINTER.file);
    });

    it('points at a symbol the named file still declares', () => {
        expect(operands()).not.toBeNull();
    });

    it('names the last fallback in the paragraph that describes the reset', () => {
        expect(
            paragraphNaming(RESET_POINTER.symbol, body),
            `the reset paragraph must name ${LAST_FALLBACK} as the last fallback`,
        ).toContain(LAST_FALLBACK);
    });

    it('describes a cascade the source still resolves over more than one source', () => {
        expect(
            operands()?.length ?? 0,
            `${RESET_POINTER.symbol} is no longer a cascade — the section calls it one`,
        ).toBeGreaterThan(1);
    });

    it("ends that cascade on 'playfield', the fallback the section names last", () => {
        expect(operands()?.at(-1)).toBe(LAST_FALLBACK);
    });
});

describe('untrackedAmong', () => {
    it('reports a path the tree does not track', () => {
        expect(untrackedAmong(['renderer/hooks/useScreenNav.ts'], new Set(['a/b.ts']))).toEqual([
            'renderer/hooks/useScreenNav.ts',
        ]);
    });

    it('reports the phantom out of a list whose other members resolve', () => {
        const tracked = new Set(['renderer/state/uiStore.ts']);
        expect(
            untrackedAmong(
                ['renderer/state/uiStore.ts', 'renderer/hooks/useScreenNav.ts'],
                tracked,
            ),
        ).toEqual(['renderer/hooks/useScreenNav.ts']);
    });

    it('reports nothing when every path resolves', () => {
        expect(untrackedAmong(['a/b.ts'], new Set(['a/b.ts']))).toEqual([]);
    });
});

describe('sourcePathsIn', () => {
    it('collects a path written as a code-fence header comment', () => {
        expect(sourcePathsIn('```typescript\n// renderer/state/uiStore.ts\n```')).toEqual([
            'renderer/state/uiStore.ts',
        ]);
    });

    it('collects a path written inside an inline code span', () => {
        expect(
            sourcePathsIn('applied in `renderer/components/scene/SceneRouter.tsx` at entry'),
        ).toEqual(['renderer/components/scene/SceneRouter.tsx']);
    });

    it('trims a full stop that ends the sentence rather than the path', () => {
        expect(sourcePathsIn('see renderer/state/uiStore.ts.')).toEqual([
            'renderer/state/uiStore.ts',
        ]);
    });

    it('trims the full stop and no other character a path may end on', () => {
        const kept = PATH_CHARACTERS.filter(
            (character) => `a/b.ts${character}`.replace(SENTENCE_END, '') === `a/b.ts${character}`,
        );
        expect(kept).toEqual(PATH_CHARACTERS.filter((character) => character !== '.'));
    });

    it('ignores a bare basename, which names no file to resolve', () => {
        expect(sourcePathsIn('`SceneRouter.tsx` resolves the key')).toEqual([]);
    });

    it('ignores an identifier and a call written as prose', () => {
        expect(sourcePathsIn('`useActiveScreen()` reads `uiStore.activeScreenKey`')).toEqual([]);
    });

    it('reports each named path once however often the section repeats it', () => {
        expect(sourcePathsIn('a/b.ts then a/b.ts again')).toEqual(['a/b.ts']);
    });
});

describe('cascadeOperands', () => {
    it('splits the cascade without splitting an optional-chained index inside an operand', () => {
        const source = [
            'const defaultScreenKey =',
            "    sceneDefaultScreen ?? registry.sceneDefaultScreens?.[String(sceneId)] ?? 'playfield';",
        ].join('\n');

        expect(cascadeOperands(source, 'defaultScreenKey')).toEqual([
            'sceneDefaultScreen',
            'registry.sceneDefaultScreens?.[String(sceneId)]',
            "'playfield'",
        ]);
    });

    it('reports a single operand for a declaration bound straight to the literal', () => {
        expect(
            cascadeOperands("const defaultScreenKey = 'playfield';", 'defaultScreenKey'),
        ).toEqual(["'playfield'"]);
    });

    it('reports the last operand a cascade actually ends on', () => {
        const source = "const defaultScreenKey = sceneDefaultScreen ?? 'lobby';";
        expect(cascadeOperands(source, 'defaultScreenKey')?.at(-1)).toBe("'lobby'");
    });

    it('returns null when the source declares no such const', () => {
        expect(cascadeOperands("const otherKey = 'playfield';", 'defaultScreenKey')).toBeNull();
    });

    it('does not match a longer identifier that ends with the symbol', () => {
        expect(
            cascadeOperands("const myDefaultScreenKey = 'playfield';", 'defaultScreenKey'),
        ).toBeNull();
    });

    it('does not read a declaration out of a site that merely assigns the name', () => {
        expect(cascadeOperands('<Cover defaultScreenKey={key} />;', 'defaultScreenKey')).toBeNull();
    });

    it('reads the initializer after the declaration, not from the top of the file', () => {
        const source = ["import x from 'y';", "const defaultScreenKey = x ?? 'playfield';"].join(
            '\n',
        );
        expect(cascadeOperands(source, 'defaultScreenKey')).toEqual(['x', "'playfield'"]);
    });

    it('does not read a declaration out of a word that merely ends in const', () => {
        expect(
            cascadeOperands("myconst defaultScreenKey = 'playfield';", 'defaultScreenKey'),
        ).toBeNull();
    });
});

describe('paragraphNaming', () => {
    it('returns only the paragraph carrying the marker', () => {
        const body = ['before `playfield`', '', 'the `symbol` paragraph', '', 'after'].join('\n');
        expect(paragraphNaming('`symbol`', body)).toBe('the `symbol` paragraph');
    });

    it('does not reach a neighbouring paragraph across the blank line', () => {
        const body = ['`playfield` here', '', 'the `symbol` paragraph'].join('\n');
        expect(paragraphNaming('`symbol`', body)).not.toContain('`playfield`');
    });

    it('splits on a blank line that carries indentation', () => {
        const body = ['`playfield` here', '   ', 'the `symbol` paragraph'].join('\n');
        expect(paragraphNaming('`symbol`', body)).toBe('the `symbol` paragraph');
    });

    it('returns empty when no paragraph carries the marker', () => {
        expect(paragraphNaming('`symbol`', 'nothing here')).toBe('');
    });
});

describe('sectionBody', () => {
    it('stops at the next heading rather than running into the following section', () => {
        const synthetic = [
            '### Within-Scene Screen Navigation',
            'kept',
            '### Next',
            'dropped',
        ].join('\n');
        expect(sectionBody(SECTION_HEADING, () => synthetic)).toBe('kept');
    });

    it('stops at a heading one level up as well as at a sibling', () => {
        const synthetic = [
            '### Within-Scene Screen Navigation',
            'kept',
            '## Parent',
            'dropped',
        ].join('\n');
        expect(sectionBody(SECTION_HEADING, () => synthetic)).toBe('kept');
    });

    it('returns empty when the heading is absent, so the floor above reports it', () => {
        expect(sectionBody(SECTION_HEADING, () => '## Something else\nbody')).toBe('');
    });
});
