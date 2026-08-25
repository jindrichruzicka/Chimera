// tools/autosave-slot-spelling.test.ts
//
// `simulation/foundation/save-slots.ts` is the one production file allowed to
// spell the autosave slot. Every other production spelling is a second source
// of truth for a name several modules have to agree on — the header stamper,
// the writer and every reader of the qualified id — and nothing but this census
// would notice them drifting apart.
//
// The assertion is an allowlist rather than a count, so a new spelling cannot
// hide behind an old one.
//
// Lives beside the other repo-wide censuses rather than next to the module it
// protects, because its subject is the whole tree.

import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { autosaveSlotSpellings } from './__test-support__/autosaveSlotSpelling.js';

const SKIPPED_DIRS = new Set([
    'node_modules',
    'dist',
    '.git',
    '.next',
    'out',
    'coverage',
    'playwright-report',
    'test-results',
]);

/** The one production module entitled to spell the slot. */
const SLOT_CONTRACT_MODULE = 'simulation/foundation/save-slots.ts';

/**
 * Files the walk must reach.
 *
 * A SAMPLE, and named as one: a root dropped from the walk that is not
 * represented here goes unnoticed. Deriving the roots from the same walk being
 * checked would agree with itself whatever the walk did.
 *
 * The last three are `.tsx`, one per root that has any: the extension arm of
 * the walk is separate from the predicate's TSX arm, and a list of `.ts` alone
 * cannot see it narrow to `/\.ts$/`.
 */
const MUST_REACH = [
    'ai/engine/AIBrain.ts',
    'apps/tactics/simulation/actions.ts',
    'electron/main/index.ts',
    'electron/main/saves/SaveManager.ts',
    'electron/main/runtime/SessionRuntime.ts',
    'networking/provider/InMemoryMultiplayerProvider.ts',
    'renderer/state/saveStore.ts',
    'simulation/foundation/save-slots.ts',
    'simulation/persistence/SaveFile.ts',
    'tools/create-chimera-game/index.ts',
    'tools/create-chimera-game/templates/blank/manifest.ts',
    'renderer/app/saves/page.tsx',
    'apps/tactics/screens/TacticsAssetDemoScreen.tsx',
    'tools/create-chimera-game/templates/blank/screens/index.tsx',
];

// Assembled at runtime so this file's own source never spells the slot
// contiguously — a literal fixture would make the census a hit on itself if the
// test-file filter below ever regressed.
const SLOT = `auto${'save'}`;

describe('autosaveSlotSpellings', () => {
    // Fed source text rather than read off the tree: on the tree this predicate
    // returns nothing for all but one file, so every judgement it makes there
    // is a negative one and a widened predicate would look identical.

    it('reports a single-quoted slot literal', () => {
        expect(autosaveSlotSpellings(`const slot = '${SLOT}';`)).toEqual([SLOT]);
    });

    it('reports a double-quoted slot literal', () => {
        expect(autosaveSlotSpellings(`const slot = "${SLOT}";`)).toEqual([SLOT]);
    });

    it('reports a backticked slot literal with no substitution', () => {
        expect(autosaveSlotSpellings('const slot = `' + SLOT + '`;')).toEqual([SLOT]);
    });

    it('reports the qualified id built by interpolation', () => {
        // The exact shape this census was written to catch: the spelling lives
        // in the template's TAIL, which a head-only reader would clear.
        expect(autosaveSlotSpellings('const slot = `${gameId}/' + SLOT + '`;')).toEqual([
            `/${SLOT}`,
        ]);
    });

    it('reports a spelling in a template HEAD as well as a tail', () => {
        expect(autosaveSlotSpellings('const slot = `' + SLOT + '/${suffix}`;')).toEqual([
            `${SLOT}/`,
        ]);
    });

    it('reports a type-position literal', () => {
        expect(autosaveSlotSpellings(`type Slot = '${SLOT}';`)).toEqual([SLOT]);
    });

    it('ignores a line comment naming the slot', () => {
        expect(autosaveSlotSpellings(`// writes to the ${SLOT} slot\nconst x = 1;`)).toEqual([]);
    });

    it('ignores a JSDoc naming the slot in quotes', () => {
        // `SaveFile.ts`, `SaveRepository.ts` and `InMemorySaveRepository.ts`
        // all carry exactly this shape; a text scan would report all three.
        expect(autosaveSlotSpellings(`/** Slot name, e.g. '${SLOT}'. */\nconst x = 1;`)).toEqual(
            [],
        );
    });

    it('ignores an identifier of the same spelling', () => {
        expect(autosaveSlotSpellings(`const ${SLOT} = 1;\nexport { ${SLOT} };`)).toEqual([]);
    });

    it('ignores a property name of the same spelling', () => {
        expect(autosaveSlotSpellings(`const opts = { ${SLOT}: true };`)).toEqual([]);
    });

    it('ignores the camelCase settings keys, which differ only in case', () => {
        expect(
            autosaveSlotSpellings("const keys = ['autoSave', 'autoSaveIntervalTurns'];"),
        ).toEqual([]);
    });

    it('ignores a log message that merely names the slot', () => {
        // Two production log strings have exactly this shape —
        // `crash-reporter.ts` and `HostSessionPipeline.ts` each report a
        // failed autosave in English. A substring test reported both as
        // spellings of the id.
        expect(autosaveSlotSpellings(`log.error('${SLOT} failed after engine:end_turn');`)).toEqual(
            [],
        );
    });

    it('ignores a neighbouring slot name that merely contains the slot name', () => {
        // A `'pre-<slot>'` name is its own slot, not this one: the segment
        // between the delimiters has to BE the slot name.
        expect(autosaveSlotSpellings(`const slot = 'pre-${SLOT}';`)).toEqual([]);
    });

    it('reports the slot name inside a game-qualified id', () => {
        expect(autosaveSlotSpellings(`const slot = 'tactics/${SLOT}';`)).toEqual([
            `tactics/${SLOT}`,
        ]);
    });

    it('reports every spelling in a file, not just the first', () => {
        expect(autosaveSlotSpellings(`const a = '${SLOT}';\nconst b = "x/${SLOT}";`)).toEqual([
            SLOT,
            `x/${SLOT}`,
        ]);
    });

    it('reads a TSX file', () => {
        // The walk includes `.tsx`; parsed as TS, a generic-looking JSX tag is a
        // syntax error and the file would silently report nothing.
        expect(
            autosaveSlotSpellings(
                `const el = <div title='${SLOT}' />;\nconst s = '${SLOT}';`,
                'Comp.tsx',
            ),
        ).toEqual([SLOT, SLOT]);
    });
});

describe('autosave slot spelling census', () => {
    it('reaches the production files it samples across the tree', async () => {
        // The census below asserts a one-entry allowlist, which a walk that
        // collapsed to that one file would also satisfy. This case is what
        // makes that assertion mean something.
        const files = new Set(await collectRelativeProductionFiles());

        for (const sample of MUST_REACH) {
            expect(existsSync(join(repoRoot(), sample)), `${sample} has moved`).toBe(true);
            expect(files.has(sample), `the walk did not reach ${sample}`).toBe(true);
        }
    });

    it('excludes every arm the walk skips — test files, build output, dependencies', async () => {
        // One sample per exclusion ARM, each chosen so no other arm stands in
        // for it — otherwise dropping an arm leaves every sample still excluded
        // and the case stays green. Test files are the arms that matter most,
        // because their fixtures spell the slot on purpose.
        const walked = await collectRelativeProductionFiles();
        const files = new Set(walked);

        // `.test.ts` extension.
        expect(files.has('electron/main/saves/SaveManager.test.ts')).toBe(false);
        expect(files.has(`tools/${SLOT}-slot-spelling.test.ts`)).toBe(false);

        // `.spec.ts` extension. A Playwright spec is a test too:
        // `save-load-ui.spec.ts` and `save-restore-multiplayer.spec.ts` both
        // name the slot, and get away with it today only because they do so in
        // comments, which the parser never sees.
        expect(files.has('apps/tactics/e2e/tests/save-load-ui.spec.ts')).toBe(false);

        // `__test-support__/` directory — this file is NOT a `.test.ts`, so the
        // extension arm cannot cover for the directory arm here.
        expect(
            files.has('simulation/persistence/__test-support__/saveRepositoryContractTests.ts'),
        ).toBe(false);

        // `__tests__/` directory — likewise not a `.test.ts`.
        expect(files.has('renderer/__tests__/logsBridgeReadCensus.ts')).toBe(false);

        // SKIPPED_DIRS, `dist` arm. `pnpm test` builds the packages first, so
        // this emitted declaration is always on disk when the case runs — the
        // existence check keeps a missing build from clearing it vacuously. It
        // declares the slot as a literal type, so a walk that descends into
        // build output reports it.
        const emittedDeclaration = 'simulation/dist/foundation/save-slots.d.ts';
        expect(existsSync(join(repoRoot(), emittedDeclaration)), 'build the packages first').toBe(
            true,
        );
        expect(files.has(emittedDeclaration)).toBe(false);

        // SKIPPED_DIRS, `node_modules` arm. Dropping it is not
        // self-limiting: the walk still finishes, and no dependency source
        // spells the slot, so the census case below stays green either way.
        // Only a sample keeps this arm honest.
        expect(walked.filter((file) => file.includes('node_modules/'))).toEqual([]);
    });

    it('spells the autosave slot in exactly one production module', async () => {
        const offenders: string[] = [];
        for (const path of await collectRelativeProductionFiles()) {
            const source = await readFile(join(repoRoot(), path), 'utf8');
            if (autosaveSlotSpellings(source, path).length > 0) {
                offenders.push(path);
            }
        }

        expect(
            offenders.sort(),
            `only ${SLOT_CONTRACT_MODULE} may spell the autosave slot — ` +
                'the rest must use AUTOSAVE_SLOT_NAME or autosaveSlotId(gameId)',
        ).toEqual([SLOT_CONTRACT_MODULE]);
    });
});

function repoRoot(): string {
    // Found rather than assumed: the suite runs from the workspace root or from
    // a package depending on how it was invoked.
    let dir = process.cwd();
    for (let depth = 0; depth < 6; depth += 1) {
        if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
            return dir;
        }
        dir = join(dir, '..');
    }
    throw new Error('pnpm-workspace.yaml not found above the test cwd');
}

/** Every production source file, repo-relative with forward slashes on every platform. */
async function collectRelativeProductionFiles(): Promise<string[]> {
    const found = await collectProductionFiles(repoRoot());
    return found.map((file) => relative(repoRoot(), file).split(sep).join('/'));
}

/**
 * Walk for `.ts`/`.tsx` files that ship, skipping build output and every kind
 * of test file: `*.test.ts(x)` units, `*.spec.ts(x)` Playwright specs,
 * `__tests__/` suites, and `__test-support__/` doubles. Those spell the slot
 * deliberately — a fixture that could not name the thing it exercises would be
 * no fixture at all.
 */
async function collectProductionFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) {
            if (
                !SKIPPED_DIRS.has(entry.name) &&
                entry.name !== '__tests__' &&
                entry.name !== '__test-support__'
            ) {
                found.push(...(await collectProductionFiles(full)));
            }
            continue;
        }
        if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
            found.push(full);
        }
    }
    return found;
}
