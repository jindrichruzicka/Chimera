/**
 * tools/create-chimera-game/__test-support__/template-contract.ts
 *
 * Facts about the blank template that more than one test file needs to agree
 * on. It lives here rather than in either test because the two graders sit on
 * opposite sides of the same property and only compose if they use one list:
 *
 *   `blank-template-smoke.test.ts` reads the REAL template tree and asserts
 *   these directories ship, each held by a `.gitkeep`.
 *
 *   `index.test.ts` seeds a SYNTHETIC template with the same names and asserts
 *   the copier carries them into the emitted app.
 *
 * Template-ships × copier-carries ⇒ a scaffolded game has them. That inference
 * is only sound while both sides name the same directories, so a fourth entry
 * added to one list alone would silently weaken it to nothing.
 */

/**
 * The directories the blank template ships EMPTY, each held open by a
 * `.gitkeep` (git cannot track an empty directory, and the copier emits files,
 * so without one they would simply not exist in a scaffolded game).
 *
 * They exist so an author's first agent policy, content payload or scene
 * primitive lands where the guards already reach, rather than after someone
 * notices the directory should have been there.
 */
export const GROWTH_DIRECTORIES = ['ai', 'data', 'scene'] as const;
