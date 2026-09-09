/**
 * renderer/__tests__/named-mode-mapping-table-placement.test.ts
 *
 * A named-mode prop's engine-name → `three`-constant table stays off the
 * always-mounted shell layout graph (§4.22, §4.10, §4.37).
 *
 * The tone-mapping and output-colour-space knobs each need such a table, and
 * the sampling and blending modes still to come will need more.
 * `shell-layout-graph-census.test.ts` is what forbids the edge those tables
 * would add, and this file is what keeps that census SHARP: a census whose
 * predicate silently stopped matching would go on passing, and a shrunken graph
 * passes for the wrong reason.
 *
 * The guard mutates a FILE SYSTEM, never the tree. It runs the real walk from
 * each app's real layout, with one real module's source overlaid by the same
 * source plus a `three` value import — which is exactly what moving a mapping
 * table into a module the layout reaches would do — and asserts the census
 * reports it, by that file's name. The overlaid module is one the layout
 * demonstrably reaches, which the anti-vacuity case below pins independently:
 * an overlay of a module the walk never visits would prove nothing.
 *
 * Three arms, because the useful property has three halves and each is
 * defeatable alone: the census REPORTS a value import (it bites), it reports
 * NOTHING for the same module unmutated (the bite is caused by the mutation,
 * not by something already there), and it reports nothing for a TYPE-only
 * import (the exception the placement rule leans on — a table may name `three`
 * types freely, and a rule that forbade them would push authors into casts).
 *
 * Tests written first (TDD — red confirmed: with the overlay applied but no
 * import injected, the "reports" arm failed with an empty edge list, which is
 * what proves the assertion is not vacuous).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    createConsumerBareResolver,
    nodeGraphFileSystem,
    walkStaticValueGraph,
    type GraphFileSystem,
    type ShellLayoutGraph,
} from './shellLayoutGraphCensus';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * The module the mapping table is imagined into. It is on the layout graph and
 * is the shape of module a careless author would reach for — asset wiring the
 * shell already mounts. Named as a constant because two arms have to agree on
 * it, and a mismatch would make the anti-vacuity arm cover a different file
 * from the one the bite arm mutates.
 */
const HOST_MODULE = 'renderer/assets/criticalAssetPreload.ts';

/**
 * The consumer apps whose layouts the census walks — every `apps/*` directory
 * that has a renderer host with its own `app/layout.tsx`.
 *
 * The same rule the census uses, repeated rather than shared: extracting it
 * would mean editing the census test, and this task's whole point is that the
 * census lands here untouched. The engine's own Next host under `renderer/` is
 * out of scope by where this LOOKS — the walk starts at `apps/` — rather than by
 * anything the filters reject.
 */
function consumerAppRendererDirs(): string[] {
    return readdirSync(resolve(repoRoot, 'apps'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `apps/${entry.name}/renderer`)
        .filter((dir) => existsSync(resolve(repoRoot, dir, 'app/layout.tsx')))
        .sort();
}

/**
 * The real file system with one module's source rewritten. Everything else
 * resolves and reads exactly as it does on disk, so the walk is the real walk
 * over the real graph — only the one module's content differs.
 */
function fileSystemWithPrefix(repoPath: string, prefix: string): GraphFileSystem {
    const target = resolve(repoRoot, repoPath);

    return {
        isFile: nodeGraphFileSystem.isFile,
        readFile: (absolutePath) =>
            absolutePath === target
                ? `${prefix}${nodeGraphFileSystem.readFile(absolutePath)}`
                : nodeGraphFileSystem.readFile(absolutePath),
    };
}

function layoutGraphWith(appRendererDir: string, fileSystem: GraphFileSystem): ShellLayoutGraph {
    return walkStaticValueGraph(resolve(repoRoot, appRendererDir, 'app/layout.tsx'), repoRoot, {
        resolveBare: createConsumerBareResolver({ repoRoot, appRendererDir }),
        fileSystem,
    });
}

/** The webgl edges the census attributes to the overlaid module. */
function edgesFromHostModule(graph: ShellLayoutGraph): readonly { file: string }[] {
    return graph.webglEdges.filter((edge) => edge.file === HOST_MODULE);
}

describe.each(consumerAppRendererDirs())(
    'a named-mode mapping table in the %s layout graph',
    (appRendererDir) => {
        it('is reached by the walk at all, so the arms below are not vacuous', () => {
            expect(layoutGraphWith(appRendererDir, nodeGraphFileSystem).files).toContain(
                HOST_MODULE,
            );
        });

        it('adds no edge while the module is unmutated', () => {
            expect(
                edgesFromHostModule(layoutGraphWith(appRendererDir, nodeGraphFileSystem)),
            ).toEqual([]);
        });

        it('is REPORTED by name when its table imports a three constant', () => {
            const mutated = layoutGraphWith(
                appRendererDir,
                fileSystemWithPrefix(
                    HOST_MODULE,
                    "import { ACESFilmicToneMapping } from 'three';\n",
                ),
            );

            expect(mutated.webglEdges).toEqual(
                expect.arrayContaining([{ file: HOST_MODULE, specifier: 'three', line: 1 }]),
            );
        });

        // The exception the placement rule leans on, and the reason a table may
        // be typed against `three` even when it may not name a constant.
        it('is not reported when the table only imports three TYPES', () => {
            const mutated = layoutGraphWith(
                appRendererDir,
                fileSystemWithPrefix(HOST_MODULE, "import type { ToneMapping } from 'three';\n"),
            );

            expect(edgesFromHostModule(mutated)).toEqual([]);
        });
    },
);
