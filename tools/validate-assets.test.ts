import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    createNodeWorkspaceFileHost,
    formatAssetValidationReport,
    isDirectInvocation,
    runValidateAssetsCli,
    toAssetValidationExitCode,
    validateAssetWorkspace,
    type WorkspaceFileHost,
} from './validate-assets.js';

const workspaceRoot = '/repo';

describe('validateAssetWorkspace', () => {
    it('returns exit 0 when data JSON and scene requiredAssets refs exist', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/soldier.json'],
                sceneSourceFiles: ['games/tactics/scenes/tactics-scenes.ts'],
                files: {
                    'games/tactics/data/units/soldier.json': JSON.stringify({
                        id: 'soldier',
                        portrait: 'tactics/portraits/soldier.webp',
                        nested: { sound: 'tactics/audio/sword.ogg' },
                    }),
                    'games/tactics/scenes/tactics-scenes.ts': `
                        export const scene = {
                            sceneId: 'tactics:arena',
                            requiredAssets: ['tactics/models/arena.glb'],
                        };
                    `,
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/portraits/soldier.webp', kind: 'texture', priority: 'critical' },
                                { ref: 'tactics/audio/sword.ogg', kind: 'audio-clip', priority: 'critical' },
                                { ref: 'tactics/models/arena.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/assets/portraits/soldier.webp': '',
                    'games/tactics/assets/audio/sword.ogg': '',
                    'games/tactics/assets/models/arena.glb': '',
                },
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(3);
        expect(toAssetValidationExitCode(report)).toBe(0);
    });

    it('returns exit 1 and lists every missing data JSON ref', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/soldier.json'],
                files: {
                    'games/tactics/data/units/soldier.json': JSON.stringify({
                        portrait: 'tactics/portraits/missing.webp',
                        attack: 'tactics/audio/missing.ogg',
                    }),
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(toAssetValidationExitCode(report)).toBe(1);
        expect(output).toContain('tactics/portraits/missing.webp');
        expect(output).toContain('tactics/audio/missing.ogg');
        expect(output).toContain('games/tactics/data/units/soldier.json');
    });

    it('validates SceneDescriptor.requiredAssets refs in located scene source files', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['games/tactics/scenes/tactics-scenes.ts'],
                files: {
                    'games/tactics/scenes/tactics-scenes.ts': `
                        export const scene = {
                            sceneId: 'tactics:arena',
                            defaultScreen: 'board',
                            requiredAssets: [
                                'tactics/models/missing-arena.glb',
                                'tactics/textures/existing-floor.webp',
                            ],
                        };
                    `,
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/missing-arena.glb', kind: 'gltf-model', priority: 'critical' },
                                { ref: 'tactics/textures/existing-floor.webp', kind: 'texture', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/assets/textures/existing-floor.webp': '',
                },
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(report.checkedRefs).toBe(2);
        expect(output).toContain('tactics/models/missing-arena.glb');
        expect(output).not.toContain('tactics/textures/existing-floor.webp');
    });

    it('returns exit 1 when a data JSON ref is not declared in an asset manifest', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/soldier.json'],
                files: {
                    'games/tactics/data/units/soldier.json': JSON.stringify({
                        portrait: 'tactics/portraits/soldier.webp',
                    }),
                    'games/tactics/assets/portraits/soldier.webp': '',
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(toAssetValidationExitCode(report)).toBe(1);
        expect(output).toContain('Asset refs missing from manifests:');
        expect(output).toContain('tactics/portraits/soldier.webp');
    });

    it('returns exit 1 when a manifest entry kind has no loader coverage', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
                files: {
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/voxels/castle.vox', kind: 'tactics:voxel', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/assets/voxels/castle.vox': '',
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(output).toContain('Manifest kinds without loader coverage:');
        expect(output).toContain('tactics:voxel');
    });

    it('accepts game-contributed loader kinds discovered from loader source files', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
                assetLoaderSourceFiles: ['games/tactics/asset-loaders.ts'],
                files: {
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/voxels/castle.vox', kind: 'tactics:voxel', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/asset-loaders.ts': `
                        export const tacticsVoxelLoader = {
                            kind: 'tactics:voxel',
                            async load() {
                                return {};
                            },
                        };
                    `,
                    'games/tactics/assets/voxels/castle.vox': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
    });

    it('validates self-hosted game font source files owned by the game package', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                gameFontSourceFiles: ['games/tactics/shell/fonts.ts'],
                files: {
                    'games/tactics/shell/fonts.ts': `
                        export const tacticsFonts = [
                            { family: 'Cinzel', src: 'tactics/fonts/Cinzel-Regular.woff2', weight: '400', display: 'swap' },
                        ];
                    `,
                    'games/tactics/assets/fonts/Cinzel-Regular.woff2': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(1);
    });

    it('reports missing game font source files', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                gameFontSourceFiles: ['games/tactics/shell/fonts.ts'],
                files: {
                    'games/tactics/shell/fonts.ts': `
                        export const tacticsFonts = [
                            { family: 'Cinzel', src: 'tactics/fonts/Cinzel-Regular.woff2', weight: '400', display: 'swap' },
                        ];
                    `,
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(output).toContain('Missing font source files:');
        expect(output).toContain('games/tactics/assets/fonts/Cinzel-Regular.woff2');
    });

    it('rejects renderer-public game asset files so the renderer cannot own game assets', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                rendererPublicAssetFiles: [
                    'renderer/public/assets/tactics/fonts/Cinzel-Regular.woff2',
                ],
                files: {
                    'renderer/public/assets/tactics/fonts/Cinzel-Regular.woff2': '',
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(output).toContain('Renderer-public game assets are forbidden:');
        expect(output).toContain('renderer/public/assets/tactics/fonts/Cinzel-Regular.woff2');
    });

    it('rejects external Google font URLs in game font declarations', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                gameFontSourceFiles: ['games/tactics/shell/fonts.ts'],
                files: {
                    'games/tactics/shell/fonts.ts': `
                        export const tacticsFonts = [
                            { family: 'Cinzel', src: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900' },
                        ];
                    `,
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(report.malformed).toHaveLength(1);
        expect(output).toContain(
            'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900',
        );
    });
});

interface HostFixture {
    readonly dataJsonFiles?: readonly string[];
    readonly sceneSourceFiles?: readonly string[];
    readonly assetManifestFiles?: readonly string[];
    readonly assetLoaderSourceFiles?: readonly string[];
    readonly gameFontSourceFiles?: readonly string[];
    readonly rendererPublicAssetFiles?: readonly string[];
    readonly files: Readonly<Record<string, string>>;
}

function createHost(fixture: HostFixture): WorkspaceFileHost {
    const files = new Map(
        Object.entries(fixture.files).map(([relativePath, contents]) => [
            toAbsolutePath(relativePath),
            contents,
        ]),
    );

    return {
        findDataJsonFiles: async () =>
            (fixture.dataJsonFiles ?? []).map((relativePath) => toAbsolutePath(relativePath)),
        findSceneSourceFiles: async () =>
            (fixture.sceneSourceFiles ?? []).map((relativePath) => toAbsolutePath(relativePath)),
        findAssetManifestFiles: async () =>
            (fixture.assetManifestFiles ?? []).map((relativePath) => toAbsolutePath(relativePath)),
        findAssetLoaderSourceFiles: async () =>
            (fixture.assetLoaderSourceFiles ?? []).map((relativePath) =>
                toAbsolutePath(relativePath),
            ),
        findGameFontSourceFiles: async () =>
            (fixture.gameFontSourceFiles ?? []).map((relativePath) => toAbsolutePath(relativePath)),
        findRendererPublicAssetFiles: async () =>
            (fixture.rendererPublicAssetFiles ?? []).map((relativePath) =>
                toAbsolutePath(relativePath),
            ),
        readFile: async (filePath) => {
            const contents = files.get(filePath);
            if (contents === undefined) {
                throw new Error(`Missing fixture file: ${filePath}`);
            }
            return contents;
        },
        fileExists: async (filePath) => files.has(filePath),
    };
}

function toAbsolutePath(relativePath: string): string {
    return `${workspaceRoot}/${relativePath}`;
}

// ── formatAssetValidationReport ───────────────────────────────────────────────

describe('formatAssetValidationReport', () => {
    it('returns the success message when the report is ok', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/unit.json'],
                files: {
                    'games/tactics/data/units/unit.json': JSON.stringify({ id: 'soldier' }),
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(true);
        expect(output).toBe('[validate-assets] Checked 0 asset refs; all files exist.\n');
    });
});

// ── malformed AssetRef strings ────────────────────────────────────────────────

describe('malformed asset refs', () => {
    it('reports a path-traversal ref in data JSON as malformed', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/bad.json'],
                files: {
                    'games/tactics/data/units/bad.json': JSON.stringify({
                        portrait: 'game/../traversal.webp',
                    }),
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(report.malformed).toHaveLength(1);
        expect(toAssetValidationExitCode(report)).toBe(1);
        expect(output).toContain('game/../traversal.webp');
        expect(output).toContain('Malformed asset refs:');
        expect(output).toContain('reason:');
    });

    it('sorts multiple malformed refs deterministically', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/bad.json'],
                files: {
                    'games/tactics/data/units/bad.json': JSON.stringify({
                        z: 'zzz/../z.webp',
                        a: 'aaa/../a.webp',
                    }),
                },
            }),
        });

        expect(report.malformed).toHaveLength(2);
        expect(report.malformed[0]!.ref).toBe('aaa/../a.webp');
        expect(report.malformed[1]!.ref).toBe('zzz/../z.webp');
    });

    it('reports a path-traversal ref in requiredAssets as malformed', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['games/tactics/scenes/scenes.ts'],
                files: {
                    'games/tactics/scenes/scenes.ts': `
                        export const scene = {
                            requiredAssets: ['game/../bad.glb'],
                        };
                    `,
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.malformed).toHaveLength(1);
        expect(report.malformed[0]!.ref).toBe('game/../bad.glb');
    });
});

// ── data JSON collection edge cases ───────────────────────────────────────────

describe('data JSON collection edge cases', () => {
    it('reports missing parser-accepted refs with broad game ids and paths', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/unit.json'],
                files: {
                    'games/tactics/data/units/unit.json': JSON.stringify({
                        hidden: 'tactics/_hidden/missing.webp',
                        dottedGame: 'my.game/textures/missing.webp',
                    }),
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.missing.map((missing) => missing.ref)).toEqual([
            'my.game/textures/missing.webp',
            'tactics/_hidden/missing.webp',
        ]);
    });

    it('ignores strings that do not match the AssetRef candidate pattern', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/unit.json'],
                files: {
                    'games/tactics/data/units/unit.json': JSON.stringify({
                        id: 'soldier',
                        displayName: 'Soldier',
                    }),
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(0);
    });

    it('collects refs inside array-valued fields and records JSON path with index notation', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/unit.json'],
                files: {
                    'games/tactics/data/units/unit.json': JSON.stringify({
                        sounds: ['tactics/audio/step.ogg', 'tactics/audio/hit.ogg'],
                    }),
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/audio/step.ogg', kind: 'audio-clip', priority: 'deferred' },
                                { ref: 'tactics/audio/hit.ogg', kind: 'audio-clip', priority: 'deferred' },
                            ],
                        };
                    `,
                    'games/tactics/assets/audio/step.ogg': '',
                    'games/tactics/assets/audio/hit.ogg': '',
                },
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(2);
    });

    it('formats special-character JSON keys in bracket notation in the missing-ref report', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['games/tactics/data/units/unit.json'],
                files: {
                    'games/tactics/data/units/unit.json': JSON.stringify({
                        'some-key': 'tactics/textures/special.webp',
                    }),
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(output).toContain('["some-key"]');
    });
});

// ── scene source file collection edge cases ───────────────────────────────────

describe('scene source file collection edge cases', () => {
    it('handles requiredAssets wrapped in `as const`', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['games/tactics/scenes/scenes.ts'],
                files: {
                    'games/tactics/scenes/scenes.ts': `
                        export const scene = {
                            requiredAssets: ['tactics/models/board.glb'] as const,
                        };
                    `,
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/board.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/assets/models/board.glb': '',
                },
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(1);
    });

    it('handles requiredAssets wrapped in `satisfies` in a .tsx scene file', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['games/tactics/scenes/scenes.tsx'],
                files: {
                    'games/tactics/scenes/scenes.tsx': `
                        export const scene = {
                            requiredAssets: ['tactics/models/board.glb'],
                        } satisfies { requiredAssets: string[] };
                    `,
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/board.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/assets/models/board.glb': '',
                },
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(1);
    });

    it('handles requiredAssets declared with a string-literal property key', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['games/tactics/scenes/scenes.ts'],
                files: {
                    'games/tactics/scenes/scenes.ts': `
                        export const scene = {
                            'requiredAssets': ['tactics/textures/floor.webp'],
                        };
                    `,
                    'games/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/textures/floor.webp', kind: 'texture', priority: 'critical' },
                            ],
                        };
                    `,
                    'games/tactics/assets/textures/floor.webp': '',
                },
                assetManifestFiles: ['games/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(1);
    });
});

// ── isDirectInvocation ────────────────────────────────────────────────────────

describe('isDirectInvocation', () => {
    it('returns false when argv1 is undefined', () => {
        expect(isDirectInvocation('file:///path/to/file.ts', undefined)).toBe(false);
    });

    it('returns false when importMetaUrl does not start with file://', () => {
        expect(isDirectInvocation('https://example.com/file.ts', '/path/to/file.ts')).toBe(false);
    });

    it('returns true when importMetaUrl resolves to the same absolute path as argv1', () => {
        const filePath = resolve('/tmp/validate-assets.ts');
        expect(isDirectInvocation(`file://${filePath}`, filePath)).toBe(true);
    });

    it('returns false when importMetaUrl resolves to a different path', () => {
        expect(isDirectInvocation('file:///tmp/a.ts', '/tmp/b.ts')).toBe(false);
    });
});

// ── createNodeWorkspaceFileHost (real FS integration) ─────────────────────────

describe('createNodeWorkspaceFileHost', () => {
    it('fileExists returns true for an existing file', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const filePath = join(dir, 'asset.webp');
        await writeFile(filePath, '');

        const host = createNodeWorkspaceFileHost();

        expect(await host.fileExists(filePath)).toBe(true);
    });

    it('fileExists returns false for a file that does not exist', async () => {
        const host = createNodeWorkspaceFileHost();

        expect(await host.fileExists('/nonexistent-path-chimera/asset.webp')).toBe(false);
    });

    it('readFile returns the file contents as a string', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const filePath = join(dir, 'data.json');
        await writeFile(filePath, '{"ok":true}');

        const host = createNodeWorkspaceFileHost();

        expect(await host.readFile(filePath)).toBe('{"ok":true}');
    });

    it('findDataJsonFiles returns JSON files under games/*/data/ recursively', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const dataDir = join(dir, 'games', 'tactics', 'data', 'units');
        await mkdir(dataDir, { recursive: true });
        await writeFile(join(dataDir, 'soldier.json'), '{}');
        await writeFile(join(dataDir, 'soldier.ts'), ''); // must be excluded

        const host = createNodeWorkspaceFileHost();
        const files = await host.findDataJsonFiles(dir);

        expect(files).toHaveLength(1);
        expect(files[0]).toContain('soldier.json');
    });

    it('findDataJsonFiles returns an empty array when the games/ directory does not exist', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));

        const host = createNodeWorkspaceFileHost();
        const files = await host.findDataJsonFiles(dir);

        expect(files).toEqual([]);
    });

    it('findSceneSourceFiles returns .ts files and excludes .d.ts and test files', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const scenesDir = join(dir, 'games', 'tactics', 'scenes');
        await mkdir(scenesDir, { recursive: true });
        await writeFile(join(scenesDir, 'scenes.ts'), '');
        await writeFile(join(scenesDir, 'scenes.d.ts'), ''); // excluded
        await writeFile(join(scenesDir, 'scenes.test.ts'), ''); // excluded
        await writeFile(join(scenesDir, 'scenes.spec.ts'), ''); // excluded

        const host = createNodeWorkspaceFileHost();
        const files = await host.findSceneSourceFiles(dir);

        expect(files).toHaveLength(1);
        expect(files[0]).toContain('scenes.ts');
    });

    it('findSceneSourceFiles returns an empty array when neither search root exists', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));

        const host = createNodeWorkspaceFileHost();
        const files = await host.findSceneSourceFiles(dir);

        expect(files).toEqual([]);
    });
});

// ── runValidateAssetsCli (real FS integration) ────────────────────────────────

describe('runValidateAssetsCli', () => {
    it('returns exit code 0 for a workspace that contains no game data files', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        const exitCode = await runValidateAssetsCli([dir]);

        expect(exitCode).toBe(0);
    });

    it('returns exit code 1 for a workspace with a missing asset reference', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const dataDir = join(dir, 'games', 'tactics', 'data');
        await mkdir(dataDir, { recursive: true });
        await writeFile(
            join(dataDir, 'unit.json'),
            JSON.stringify({ portrait: 'tactics/missing.webp' }),
        );
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const exitCode = await runValidateAssetsCli([dir]);

        expect(exitCode).toBe(1);
    });
});
