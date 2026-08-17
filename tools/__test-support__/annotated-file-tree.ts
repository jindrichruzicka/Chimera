/**
 * tools/__test-support__/annotated-file-tree.ts
 *
 * How a row in one of the repo's annotated ASCII file trees is read.
 *
 * Guards that walk those trees want different traversals — one asks what sits directly
 * under a named directory, another rebuilds whole paths inside a single fence. What
 * they must not disagree on is the row grammar underneath: which lines are entries at
 * all, and how many columns one nesting level is worth. So the grammar lives here and
 * the traversals stay with their callers.
 *
 * Importing it is what shares it. `root-eslint-config.test.ts` and
 * `e2e-file-tree-single-source.test.ts` do; guards that spell the grammar themselves
 * are unaffected by anything here.
 */

/** Columns one nesting level adds — the width of `│   ` and of the blank that replaces it. */
export const LEVEL_WIDTH = 4;

/** An entry row: a gutter of gap/pipe columns, a tee or elbow, then the name. */
export const TREE_LINE = /^(?<gutter>[│ ]*)[├└]── (?<name>\S+)/u;

/** One entry read off a tree row. */
export interface TreeRow {
    /** Columns of gutter before the tee — the raw indent, not the depth. */
    readonly column: number;
    /** Depth in levels, so a caller can index a path stack by it directly. */
    readonly depth: number;
    /** The entry's name, with any trailing `/` removed. */
    readonly name: string;
    /** Whether the row drew it as a directory. */
    readonly isDirectory: boolean;
}

/** Undefined for anything that is not an entry row — only those carry a name. */
export function parseTreeRow(line: string): TreeRow | undefined {
    const groups = TREE_LINE.exec(line)?.groups;
    if (groups === undefined) return undefined;
    const column = (groups['gutter'] ?? '').length;
    const spelled = groups['name'] ?? '';
    return {
        column,
        depth: Math.floor(column / LEVEL_WIDTH),
        name: spelled.replace(/\/$/u, ''),
        isDirectory: spelled.endsWith('/'),
    };
}
