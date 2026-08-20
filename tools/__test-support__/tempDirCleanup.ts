// tools/__test-support__/tempDirCleanup.ts
//
// The judgement `tools/temp-dir-cleanup-census.test.ts` makes, separated from
// the tree walk that feeds it so it can be handed source text directly.
//
// Read only against the live tree it would be exercised in the negative — no
// file there allocates without removing, which is the point of the census — so
// either pattern below could drift until it cleared everything with nothing
// going red.

/** The allocation the census reads: `mkdtemp`/`mkdtempSync` rooted at `tmpdir()`. */
const ALLOCATES_TEMP_DIR = /mkdtemp(Sync)?\s*\(\s*[^)]*tmpdir\s*\(\s*\)/;

/**
 * A removal CALL — both boundaries load-bearing.
 *
 * The leading `\b` keeps `transform(` and `confirm(` from reading as removals;
 * the trailing `\s*\(` keeps a bare `rmSync` identifier, such as an import left
 * behind when its call was deleted, from clearing a file that no longer removes
 * anything.
 */
const REMOVES_SOMETHING = /\brm\s*\(|\brmSync\s*\(/;

/** Whether `source` allocates a temp directory and removes nothing. */
export function allocatesWithoutRemoving(source: string): boolean {
    return ALLOCATES_TEMP_DIR.test(source) && !REMOVES_SOMETHING.test(source);
}
