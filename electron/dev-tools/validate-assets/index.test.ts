import { chmod, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import type { AudioClipMetadata } from '@chimera-engine/simulation/foundation/audio-cue-sheet.js';
import { describe, expect, it, vi } from 'vitest';

import {
    createNodeWorkspaceFileHost,
    formatAssetValidationReport,
    runValidateAssetsCli,
    toAssetValidationExitCode,
    validateAssetWorkspace,
    type AssetValidationReport,
    type WorkspaceFileHost,
} from './index.js';

const workspaceRoot = '/repo';

describe('validateAssetWorkspace', () => {
    it('returns exit 0 when data JSON and scene requiredAssets refs exist', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['apps/tactics/data/units/soldier.json'],
                sceneSourceFiles: ['apps/tactics/scenes/tactics-scenes.ts'],
                files: {
                    'apps/tactics/data/units/soldier.json': JSON.stringify({
                        id: 'soldier',
                        portrait: 'tactics/portraits/soldier.webp',
                        nested: { sound: 'tactics/audio/sword.ogg' },
                    }),
                    'apps/tactics/scenes/tactics-scenes.ts': `
                        export const scene = {
                            sceneId: 'tactics:arena',
                            requiredAssets: ['tactics/models/arena.glb'],
                        };
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/portraits/soldier.webp', kind: 'texture', priority: 'critical' },
                                { ref: 'tactics/audio/sword.ogg', kind: 'audio-clip', priority: 'critical' },
                                { ref: 'tactics/models/arena.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/portraits/soldier.webp': '',
                    'apps/tactics/assets/audio/sword.ogg': '',
                    'apps/tactics/assets/models/arena.glb': '',
                },
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        // Counts REFERENCES resolved, not distinct files: each of the three refs is
        // declared twice — once in the manifest, once in a scanned source (two in the
        // content JSON, one in a scene's `requiredAssets`) — and each declaration is
        // checked on its own. Manifest refs joined this total so it can fall when a
        // manifest stops being read.
        expect(report.checkedRefs).toBe(6);
        expect(toAssetValidationExitCode(report)).toBe(0);
    });

    it('returns exit 1 and lists every missing data JSON ref', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['apps/tactics/data/units/soldier.json'],
                files: {
                    'apps/tactics/data/units/soldier.json': JSON.stringify({
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
        expect(output).toContain('apps/tactics/data/units/soldier.json');
    });

    it('validates SceneDescriptor.requiredAssets refs in located scene source files', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['apps/tactics/scenes/tactics-scenes.ts'],
                files: {
                    'apps/tactics/scenes/tactics-scenes.ts': `
                        export const scene = {
                            sceneId: 'tactics:arena',
                            defaultScreen: 'playfield',
                            requiredAssets: [
                                'tactics/models/missing-arena.glb',
                                'tactics/textures/existing-floor.webp',
                            ],
                        };
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/missing-arena.glb', kind: 'gltf-model', priority: 'critical' },
                                { ref: 'tactics/textures/existing-floor.webp', kind: 'texture', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/textures/existing-floor.webp': '',
                },
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(report.checkedRefs).toBe(4);
        expect(output).toContain('tactics/models/missing-arena.glb');
        expect(output).not.toContain('tactics/textures/existing-floor.webp');
    });

    it('returns exit 1 when a data JSON ref is not declared in an asset manifest', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['apps/tactics/data/units/soldier.json'],
                files: {
                    'apps/tactics/data/units/soldier.json': JSON.stringify({
                        portrait: 'tactics/portraits/soldier.webp',
                    }),
                    'apps/tactics/assets/portraits/soldier.webp': '',
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
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                files: {
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/voxels/castle.vox', kind: 'tactics:voxel', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/voxels/castle.vox': '',
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
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                assetLoaderSourceFiles: ['apps/tactics/asset-loaders.ts'],
                files: {
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/voxels/castle.vox', kind: 'tactics:voxel', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/asset-loaders.ts': `
                        export const tacticsVoxelLoader = {
                            kind: 'tactics:voxel',
                            async load() {
                                return {};
                            },
                        };
                    `,
                    'apps/tactics/assets/voxels/castle.vox': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
    });

    it('validates self-hosted game font source files owned by the game package', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                gameFontSourceFiles: ['apps/tactics/shell/fonts.ts'],
                files: {
                    'apps/tactics/shell/fonts.ts': `
                        export const tacticsFonts = [
                            { family: 'Cinzel', src: 'tactics/fonts/Cinzel-Regular.woff2', weight: '400', display: 'swap' },
                        ];
                    `,
                    'apps/tactics/assets/fonts/Cinzel-Regular.woff2': '',
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
                gameFontSourceFiles: ['apps/tactics/shell/fonts.ts'],
                files: {
                    'apps/tactics/shell/fonts.ts': `
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
        expect(output).toContain('apps/tactics/assets/fonts/Cinzel-Regular.woff2');
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
                gameFontSourceFiles: ['apps/tactics/shell/fonts.ts'],
                files: {
                    'apps/tactics/shell/fonts.ts': `
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

// ── audio cue sheets (Invariant #125) ────────────────────────────────────────

/**
 * The build-time half of Invariant #125.
 *
 * Reject cases assert the exact reason ARRAY rather than `[0].reason`, so a mutant that
 * appends a spurious extra finding is caught alongside one that changes the first.
 */
describe('audio cue sheet validation', () => {
    it('accepts a well-formed sheet', async () => {
        const sheet: AudioClipMetadata = {
            cues: { intro: 0, loopStart: 4, loopEnd: 86, outro: 86 },
            defaultLoopRegion: ['loopStart', 'loopEnd'],
            durationSeconds: 90,
        };

        const report = await validateManifestEntries(audioClipEntrySource(JSON.stringify(sheet)));

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    it('accepts an audio-clip entry that declares no metadata at all', async () => {
        const report = await validateManifestEntries(
            `{ ref: 'tactics/audio/theme.ogg', kind: 'audio-clip', priority: 'critical' }`,
        );

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    it('accepts durationSeconds on its own, with neither cues nor a loop region', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ durationSeconds: 90 }`),
        );

        expect(report.ok).toBe(true);
    });

    it('leaves a non-audio-clip entry carrying cue-shaped metadata untouched', async () => {
        const report = await validateManifestEntries(
            `{
                ref: 'tactics/audio/theme.ogg',
                kind: 'texture',
                priority: 'critical',
                metadata: { cues: { intro: -1 } },
            }`,
        );

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    it('rejects a cue second beyond durationSeconds, naming the cue and both values', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 91 }, durationSeconds: 90 }`),
        );

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(toAssetValidationExitCode(report)).toBe(1);
        expect(cueSheetReasons(report)).toEqual(['cue "intro" (91) exceeds durationSeconds (90)']);
        expect(report.invalidCueSheets[0]?.ref).toBe('tactics/audio/theme.ogg');
        expect(report.invalidCueSheets[0]?.source.location).toBe('entries[0].metadata');
        expect(output).toContain('Invalid audio cue sheets:');
        expect(output).toContain('tactics/audio/theme.ogg');
        expect(output).toContain('cue "intro" (91) exceeds durationSeconds (90)');
        // The only line naming the file and entry, and so the difference between a build
        // failure an author can act on and one they cannot.
        expect(output).toContain('apps/tactics/asset-manifest.ts entries[0].metadata');
    });

    it('names the entry as unreadable when its ref is not a literal', async () => {
        const report = await validateManifestEntries(
            `{
                ref: refs.theme,
                kind: 'audio-clip',
                priority: 'critical',
                metadata: { cues: { intro: 91 }, durationSeconds: 90 },
            }`,
        );

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(cueSheetReasons(report)).toEqual(['cue "intro" (91) exceeds durationSeconds (90)']);
        expect(report.invalidCueSheets[0]?.ref).toBeUndefined();
        expect(output).toContain('- (unreadable ref)');
    });

    it('rejects an entry that declares metadata under a kind it cannot read', async () => {
        const report = await validateManifestEntries(
            `{
                ref: 'tactics/audio/theme.ogg',
                kind: AUDIO_CLIP,
                priority: 'critical',
                metadata: { cues: { intro: 91 }, durationSeconds: 90 },
            }`,
        );

        expect(cueSheetReasons(report)).toEqual([
            'entry declares metadata but its kind is not a statically-readable literal, so the entry cannot be classified',
        ]);
        expect(report.invalidCueSheets[0]?.ref).toBe('tactics/audio/theme.ogg');
        expect(report.invalidCueSheets[0]?.source.location).toBe('entries[0].metadata');
    });

    // The readability rule reaches the ENTRY too, not just the sheet and its cues: a
    // spread or computed key here means an absent `metadata` property proves nothing.
    it('rejects an audio-clip entry assembled by spreading another object', async () => {
        const report = await validateManifestEntries(
            `{ ref: 'tactics/audio/theme.ogg', kind: 'audio-clip', ...withMetadata }`,
        );

        expect(cueSheetReasons(report)).toEqual([
            'entry contains a member that is not a "name: value" property, so a cue sheet on it cannot be ruled out',
        ]);
    });

    it('rejects an audio-clip entry whose metadata key is computed', async () => {
        const report = await validateManifestEntries(
            `{
                ref: 'tactics/audio/theme.ogg',
                kind: 'audio-clip',
                priority: 'critical',
                ['metadata']: { cues: { intro: 91 }, durationSeconds: 90 },
            }`,
        );

        expect(cueSheetReasons(report)).toEqual([
            'entry contains a member whose key is not a statically-readable name, so a cue sheet on it cannot be ruled out',
        ]);
    });

    it('rejects a builder-authored entry assembled by spreading another object', async () => {
        const report = await validateManifestEntries(
            `audioClipEntry({ ref: 'tactics/audio/theme.ogg', ...withMetadata })`,
        );

        expect(cueSheetReasons(report)).toEqual([
            'entry contains a member that is not a "name: value" property, so a cue sheet on it cannot be ruled out',
        ]);
    });

    it('leaves a non-audio-clip entry assembled by spreading alone', async () => {
        const report = await validateManifestEntries(
            `{ ref: 'tactics/audio/theme.ogg', kind: 'texture', ...rest }`,
        );

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    // Each of these composes two defects that are individually caught, and each pair
    // used to CANCEL: the entry gate needs a readable `'audio-clip'` kind, and the
    // unreadable-kind guard needs a visible `metadata` — hiding one satisfies neither.
    // Only a readable non-audio kind rules a cue sheet out.
    it('rejects an entry hiding both its kind and its metadata behind a spread', async () => {
        const report = await validateManifestEntries(
            `{ ref: 'tactics/audio/theme.ogg', ...withKindAndMetadata }`,
        );

        expect(cueSheetReasons(report)).toEqual([
            'entry contains a member that is not a "name: value" property, so a cue sheet on it cannot be ruled out',
        ]);
    });

    it('rejects an unreadable kind beside a spread-in metadata', async () => {
        const report = await validateManifestEntries(
            `{ ref: 'tactics/audio/theme.ogg', kind: AUDIO_CLIP, ...withMetadata }`,
        );

        expect(cueSheetReasons(report)).toEqual([
            'entry contains a member that is not a "name: value" property, so a cue sheet on it cannot be ruled out',
        ]);
    });

    it('rejects an unreadable kind beside a computed metadata key', async () => {
        const report = await validateManifestEntries(
            `{
                ref: 'tactics/audio/theme.ogg',
                kind: AUDIO_CLIP,
                ['metadata']: { cues: { intro: 91 }, durationSeconds: 90 },
            }`,
        );

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(cueSheetReasons(report)).toEqual([
            'entry contains a member whose key is not a statically-readable name, so a cue sheet on it cannot be ruled out',
        ]);
        // The finding names the entry, not a `.metadata` slot the reader never saw.
        expect(report.invalidCueSheets[0]?.source.location).toBe('entries[0]');
        expect(report.invalidCueSheets[0]?.ref).toBe('tactics/audio/theme.ogg');
        expect(output).toContain('apps/tactics/asset-manifest.ts entries[0]');
    });

    // The one shape the gate deliberately does not reach: an element the walker cannot
    // unwrap to an object literal at all. Pinned so the documented boundary cannot move
    // in either direction unnoticed.
    it('skips an entries element extracted to a constant', async () => {
        const report = await validateManifestEntries(`THEME_ENTRY`);

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    it('leaves an entry with an unreadable kind alone when it declares no metadata', async () => {
        const report = await validateManifestEntries(
            `{ ref: 'tactics/audio/theme.ogg', kind: AUDIO_CLIP, priority: 'critical' }`,
        );

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    it('accepts a cue second exactly equal to durationSeconds', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { outro: 90 }, durationSeconds: 90 }`),
        );

        expect(report.ok).toBe(true);
    });

    it('accepts a cue second of exactly zero', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 0 }, durationSeconds: 90 }`),
        );

        expect(report.ok).toBe(true);
    });

    it('accepts a durationSeconds of exactly zero', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 0 }, durationSeconds: 0 }`),
        );

        expect(report.ok).toBe(true);
    });

    // Real cue sheets are fractional, and a reader that rounds still passes every
    // whole-second fixture. This is the only case that separates the two.
    it('compares fractional cue seconds without rounding', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { outro: 90.5 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cue "outro" (90.5) exceeds durationSeconds (90)',
        ]);
    });

    it('reads numbers through an as-annotation, the way a manifest annotates them', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 4 as number }, durationSeconds: 90 as number }`),
        );

        expect(report.ok).toBe(true);
    });

    // `satisfies` is the idiomatic way to type an inline sheet, and it is a different
    // AST node from `as` — a reader peeling only `as` rejects this as unreadable, which
    // is exactly the wrong answer for a literal written out in full.
    it('reads a sheet and its numbers through a satisfies-annotation', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { intro: 4 satisfies number }, durationSeconds: 90 } satisfies AudioClipMetadata`,
            ),
        );

        expect(report.ok).toBe(true);
    });

    it('gates a sheet reached through a satisfies-annotation', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { intro: 91 }, durationSeconds: 90 } satisfies AudioClipMetadata`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual(['cue "intro" (91) exceeds durationSeconds (90)']);
    });

    // `-1` parses as a minus token wrapping a numeric literal, never as a numeric
    // literal. A reader that does not unwrap it reports the cue as unreadable —
    // still a failure, but the wrong one, telling the author to inline a value they
    // already inlined. Pin the reason, not just the failure.
    it('rejects a negative cue second as negative, not as unreadable', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: -1 }, durationSeconds: 90 }`),
        );

        expect(report.ok).toBe(false);
        expect(cueSheetReasons(report)).toEqual(['cue "intro" (-1) is negative']);
    });

    it('rejects a cue second that is not a statically-readable number literal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: NaN }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cue "intro" is not a statically-readable number literal',
        ]);
    });

    it('rejects a cue second that reads as a non-finite number', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 1e999 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual(['cue "intro" is not finite']);
    });

    it('reports every out-of-range cue in a sheet, not just the first', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { intro: -1, outro: 91, loopStart: 4 }, durationSeconds: 90 }`,
            ),
        );

        expect(report.ok).toBe(false);
        expect(cueSheetReasons(report)).toEqual([
            'cue "intro" (-1) is negative',
            'cue "outro" (91) exceeds durationSeconds (90)',
        ]);
    });

    // `zz` is authored first but sorts second. Drop `reason` from the sort key and this
    // fixture reports in authoring order instead.
    it('orders findings by reason rather than by where the cue was authored', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { zz: -1, aa: 91 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cue "aa" (91) exceeds durationSeconds (90)',
            'cue "zz" (-1) is negative',
        ]);
    });

    // A structurally unreadable table takes a different exit than an out-of-range cue,
    // and both must suppress the region check: reporting a region against a table that
    // was never read yields two findings for one mistake. The spread also pins the
    // fail-fast — the out-of-range `bad` beside it is deliberately not reported.
    it('stops before the region check when the cue table cannot be read', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { ...sharedCues, bad: 999 },
                    defaultLoopRegion: ['a', 'b'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cues contains an entry that is not a "name: seconds" property',
        ]);
    });

    it('stops before the region check when a cue failed, reporting only the cue', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { a: 1, b: 999 },
                    defaultLoopRegion: ['x', 'y'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual(['cue "b" (999) exceeds durationSeconds (90)']);
    });

    // Two entries, and the later one's reason sorts first. Every other fixture here has a
    // single entry, so only the `reason` half of the sort key is exercised — drop the
    // file/location half and findings interleave across entries instead of grouping.
    it('groups findings by entry before ordering them by reason', async () => {
        const report = await validateManifestEntries(
            `${audioClipEntrySource(`{ cues: { zz: 91 }, durationSeconds: 90 }`)},
             ${audioClipEntrySource(`{ cues: { aa: -1 }, durationSeconds: 90 }`)}`,
        );

        expect(
            report.invalidCueSheets.map((sheet) => `${sheet.source.location} ${sheet.reason}`),
        ).toEqual([
            'entries[0].metadata cue "zz" (91) exceeds durationSeconds (90)',
            'entries[1].metadata cue "aa" (-1) is negative',
        ]);
    });

    it('rejects a defaultLoopRegion whose end cue is before its start cue', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { loopStart: 8, loopEnd: 4 },
                    defaultLoopRegion: ['loopStart', 'loopEnd'],
                    durationSeconds: 90,
                }`,
            ),
        );

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion end "loopEnd" (4) must be greater than start "loopStart" (8)',
        ]);
        expect(output).toContain('Invalid audio cue sheets:');
    });

    // The other half of the rounding argument made for cue-vs-duration above: every
    // region fixture uses whole seconds, so a comparator that floors both bounds passes
    // them all while rejecting a loop that is under a second long.
    it('compares fractional defaultLoopRegion bounds without rounding', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { loopStart: 4.2, loopEnd: 4.8 },
                    defaultLoopRegion: ['loopStart', 'loopEnd'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(report.ok).toBe(true);
        expect(report.invalidCueSheets).toHaveLength(0);
    });

    it('rejects a defaultLoopRegion whose bounds are equal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { loopStart: 4, loopEnd: 4 },
                    defaultLoopRegion: ['loopStart', 'loopEnd'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion end "loopEnd" (4) must be greater than start "loopStart" (4)',
        ]);
    });

    it('rejects a defaultLoopRegion whose end names a cue the sheet does not define', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { loopStart: 4 },
                    defaultLoopRegion: ['loopStart', 'loopEnd'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion names cue "loopEnd", which is not present in cues',
        ]);
    });

    // Both bounds carry the same obligation, and every other region fixture puts the
    // defect on the end side — so the start side needs its own cases or a guard that
    // only ever checks `end` passes them all.
    it('rejects a defaultLoopRegion whose start names a cue the sheet does not define', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { loopEnd: 4 },
                    defaultLoopRegion: ['loopStart', 'loopEnd'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion names cue "loopStart", which is not present in cues',
        ]);
    });

    it('rejects a defaultLoopRegion whose start is not a string literal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { a: 1 }, defaultLoopRegion: [3, 'a'], durationSeconds: 90 }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion must be a statically-readable two-element array of cue names',
        ]);
    });

    it('reports a defaultLoopRegion naming one absent cue twice as a single mistake', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { a: 1 }, defaultLoopRegion: ['x', 'x'], durationSeconds: 90 }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion names cue "x", which is not present in cues',
        ]);
    });

    // The only input that produces two region findings, and so the only one that tells
    // the dedupe above apart from a guard that drops the end report whenever the start
    // is also missing.
    it('reports both bounds of a defaultLoopRegion naming two different absent cues', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { a: 1 }, defaultLoopRegion: ['x', 'y'], durationSeconds: 90 }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion names cue "x", which is not present in cues',
            'defaultLoopRegion names cue "y", which is not present in cues',
        ]);
    });

    // An empty table read cleanly is not the same as a table that failed to read: the
    // region check still runs against it, and both names are still missing.
    it('checks a defaultLoopRegion against an empty but readable cue table', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: {}, defaultLoopRegion: ['a', 'b'], durationSeconds: 90 }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion names cue "a", which is not present in cues',
            'defaultLoopRegion names cue "b", which is not present in cues',
        ]);
    });

    it('rejects a defaultLoopRegion on a sheet that declares no cues', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ defaultLoopRegion: ['loopStart', 'loopEnd'], durationSeconds: 90 }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion requires cues, which the sheet does not declare',
        ]);
    });

    it('rejects a defaultLoopRegion that is not a two-element array of cue names', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{
                    cues: { a: 1, b: 2, c: 3 },
                    defaultLoopRegion: ['a', 'b', 'c'],
                    durationSeconds: 90,
                }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion must be a statically-readable two-element array of cue names',
        ]);
    });

    it('rejects a defaultLoopRegion whose end is not a string literal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(
                `{ cues: { a: 1 }, defaultLoopRegion: ['a', 3], durationSeconds: 90 }`,
            ),
        );

        expect(cueSheetReasons(report)).toEqual([
            'defaultLoopRegion must be a statically-readable two-element array of cue names',
        ]);
    });

    it('rejects cues declared without durationSeconds', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 4 } }`),
        );

        expect(report.ok).toBe(false);
        expect(cueSheetReasons(report)).toEqual([
            'durationSeconds is required when cues or defaultLoopRegion is declared',
        ]);
    });

    // Invariant #125 names BOTH triggers. A guard written against `cues` alone
    // passes this sheet, so the two conjuncts need separate cases.
    it('rejects a defaultLoopRegion declared without durationSeconds', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ defaultLoopRegion: ['loopStart', 'loopEnd'] }`),
        );

        expect(report.ok).toBe(false);
        expect(cueSheetReasons(report)).toEqual([
            'durationSeconds is required when cues or defaultLoopRegion is declared',
        ]);
    });

    it('rejects a negative durationSeconds', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ durationSeconds: -5 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'durationSeconds must be a statically-readable finite number >= 0',
        ]);
    });

    it('rejects a non-finite durationSeconds', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 4 }, durationSeconds: 1e999 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'durationSeconds must be a statically-readable finite number >= 0',
        ]);
    });

    // Without this, an unreadable durationSeconds falls through to the cues branch and
    // is reported as MISSING rather than unreadable — a reason that sends the author
    // to add a field they already wrote.
    it('rejects a durationSeconds that is not a statically-readable literal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { intro: 4 }, durationSeconds: DURATION }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'durationSeconds must be a statically-readable finite number >= 0',
        ]);
    });

    it('rejects metadata that is not an object literal', async () => {
        const report = await validateManifestEntries(audioClipEntrySource(`42`));

        expect(cueSheetReasons(report)).toEqual([
            'metadata is not a statically-readable object literal; author the cue sheet inline',
        ]);
    });

    it('rejects cues that are not an object literal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: [4], durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cues must be a statically-readable object literal',
        ]);
    });

    it('rejects metadata referencing a constant instead of an inline literal', async () => {
        const report = await validateManifestEntries(audioClipEntrySource(`SHARED_SHEET`));

        expect(cueSheetReasons(report)).toEqual([
            'metadata is not a statically-readable object literal; author the cue sheet inline',
        ]);
    });

    it('rejects a sheet assembled by spreading another object', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ ...SHARED_SHEET, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'metadata contains an entry that is not a "name: value" property',
        ]);
    });

    it('rejects a cue name that is not a statically-readable key', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { [dynamicName]: 4 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cues contains an entry whose cue name is not a statically-readable key',
        ]);
    });

    it('rejects a sheet whose cues key is computed', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ [CUES]: { intro: 91 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'metadata contains an entry whose key is not a statically-readable name',
        ]);
    });

    it('rejects a sheet whose cues key is a computed string literal', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ ['cues']: { intro: 91 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'metadata contains an entry whose key is not a statically-readable name',
        ]);
    });

    // Minus is the only prefix operator the reader folds. `c` is the case that matters:
    // a reader folding `!` as a negation reads `!0` as -0, which clears every range
    // check and passes silently — where `~`/`+` would at least fail with a wrong reason.
    // The sheet would then pass a gate meant to be stricter than the runtime parser,
    // which rejects the `true` that `!0` actually evaluates to.
    it('rejects a cue second behind a prefix operator other than minus', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { a: ~4, b: +4, c: !0 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cue "a" is not a statically-readable number literal',
            'cue "b" is not a statically-readable number literal',
            'cue "c" is not a statically-readable number literal',
        ]);
    });

    it('rejects cues assembled by spreading another object', async () => {
        const report = await validateManifestEntries(
            audioClipEntrySource(`{ cues: { ...sharedCues, outro: 4 }, durationSeconds: 90 }`),
        );

        expect(cueSheetReasons(report)).toEqual([
            'cues contains an entry that is not a "name: seconds" property',
        ]);
    });

    describe('entries authored through the audioClipEntry builder', () => {
        // The builder is the sanctioned way to author a cue sheet, and it produces a
        // call expression the walker skipped entirely before this branch.
        it('gates a bad sheet passed through audioClipEntry', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                })`,
            );

            expect(cueSheetReasons(report)).toEqual([
                'cue "intro" (91) exceeds durationSeconds (90)',
            ]);
        });

        it('accepts a well-formed sheet passed through audioClipEntry', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 4 }, durationSeconds: 90 },
                })`,
            );

            expect(report.ok).toBe(true);
        });

        it('peels the builder reached through a namespace import', async () => {
            const report = await validateManifestEntries(
                `content.audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                })`,
            );

            expect(cueSheetReasons(report)).toEqual([
                'cue "intro" (91) exceeds durationSeconds (90)',
            ]);
        });

        // The annotation is on the ARGUMENT, not the call. A peel that only handles a
        // bare object literal there drops the element entirely — no cue-sheet check, no
        // ref existence check, no manifest coverage.
        it('gates a builder whose argument is wrapped in an as-annotation', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                } as const)`,
            );

            expect(cueSheetReasons(report)).toEqual([
                'cue "intro" (91) exceeds durationSeconds (90)',
            ]);
        });

        it('gates a builder call wrapped in a satisfies-annotation', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                }) satisfies AssetManifestEntry`,
            );

            expect(cueSheetReasons(report)).toEqual([
                'cue "intro" (91) exceeds durationSeconds (90)',
            ]);
        });

        it('gates a builder call wrapped in an as-annotation', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                }) as AssetManifestEntry`,
            );

            expect(cueSheetReasons(report)).toEqual([
                'cue "intro" (91) exceeds durationSeconds (90)',
            ]);
        });

        // Only the sanctioned builder is peeled. Drop the callee-name guard and every
        // single-argument call in `entries` starts getting range-checked, which is a
        // blast radius no fixture here would otherwise notice.
        it('does not peel a call to some other single-argument builder', async () => {
            const report = await validateManifestEntries(
                `someOtherBuilder({
                    ref: 'tactics/audio/theme.ogg',
                    kind: 'audio-clip',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                })`,
            );

            expect(report.ok).toBe(true);
            expect(report.invalidCueSheets).toHaveLength(0);
        });

        it('does not peel an audioClipEntry call that takes more than one argument', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 91 }, durationSeconds: 90 },
                }, extra)`,
            );

            expect(report.ok).toBe(true);
            expect(report.invalidCueSheets).toHaveLength(0);
        });

        // Without the inferred kind, this sheet is never checked at all.
        it('infers the audio-clip kind that the builder omits from its argument', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({
                    ref: 'tactics/audio/theme.ogg',
                    priority: 'critical',
                    metadata: { cues: { intro: 4 } },
                })`,
            );

            expect(cueSheetReasons(report)).toEqual([
                'durationSeconds is required when cues or defaultLoopRegion is declared',
            ]);
        });

        // A ref named through the game's own `AssetRef` const is the shape the
        // `audioClipEntry` builder invites — the const already exists so screens can
        // name the clip, and repeating the path string on the entry is the duplication
        // it removes. Read as unreadable, the entry contributes NO ref at all, so the
        // file-existence check of Invariant #22 and the declared-ref membership set of
        // Invariant #52 both silently lose it. Same-file only: the const has to be
        // declared in the manifest being walked.
        it('resolves a ref named through a const declared in the same manifest file', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = {
                                theme: 'tactics/audio/theme.ogg',
                                absent: 'tactics/audio/absent.ogg',
                            };
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    audioClipEntry({ ref: tacticsAudioRefs.theme, priority: 'critical' }),
                                    audioClipEntry({ ref: tacticsAudioRefs.absent, priority: 'critical' }),
                                ],
                            };
                        `,
                        'apps/tactics/assets/audio/theme.ogg': '',
                    },
                }),
            });

            // Both resolved: the present one silently, the absent one by failing. A
            // reader that resolved neither would also report an empty `missing` list,
            // so the pair is what distinguishes "checked and fine" from "not checked".
            expect(report.missing.map((entry) => entry.ref)).toEqual(['tactics/audio/absent.ogg']);
            expect(report.ok).toBe(false);
        });

        // The const members are themselves written `'…' as AssetRef<AudioClipAsset>`,
        // so the same annotation migrating onto the entry is one refactor away — and
        // an unwrap that stopped happening would return every such entry to
        // contributing no ref at all rather than to failing loudly.
        it('resolves a const-named ref wrapped in `as` or `satisfies`', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = {
                                viaAs: 'tactics/audio/absent-as.ogg',
                                viaSatisfies: 'tactics/audio/absent-satisfies.ogg',
                            };
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    { ref: tacticsAudioRefs.viaAs as AssetRef<AudioClipAsset>, kind: 'audio-clip', priority: 'critical' },
                                    { ref: tacticsAudioRefs.viaSatisfies satisfies AssetRef<AudioClipAsset>, kind: 'audio-clip', priority: 'critical' },
                                ],
                            };
                        `,
                    },
                }),
            });

            expect(report.missing.map((entry) => entry.ref).sort()).toEqual([
                'tactics/audio/absent-as.ogg',
                'tactics/audio/absent-satisfies.ogg',
            ]);
        });

        // Both halves of the key matter. A reader that matched on the member name
        // alone would cross-resolve as soon as a game splits its refs by asset family,
        // existence-checking one const's file against another const's entry.
        it('keys resolution on the const name, not the member name alone', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = { theme: 'tactics/audio/theme.ogg' };
                            export const tacticsTextureRefs = { theme: 'tactics/textures/absent.png' };
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    { ref: tacticsAudioRefs.theme, kind: 'audio-clip', priority: 'critical' },
                                    { ref: tacticsTextureRefs.theme, kind: 'texture', priority: 'critical' },
                                ],
                            };
                        `,
                        'apps/tactics/assets/audio/theme.ogg': '',
                    },
                }),
            });

            // Only the texture is absent. Resolving on the shared member name would
            // report the audio path (both entries reading the first const) or the
            // texture path twice (both reading the last) — never exactly this.
            expect(report.missing.map((entry) => entry.ref)).toEqual([
                'tactics/textures/absent.png',
            ]);
        });

        // The rejection side of the same rule. `readOwnConstMember` resolves
        // `<Const>.<member>` and refuses to guess at anything else — guessing at a
        // nested access is exactly the cross-resolution the const half of the key
        // exists to prevent. Each of these must contribute NO ref: unreadable is not
        // an error, so the only observable is that nothing lands in `missing`, and the
        // readable control in the same fixture is what makes that non-vacuous.
        it.each([
            { shape: 'a nested access', ref: 'wrapper.tacticsAudioRefs.absent' },
            { shape: 'a computed access', ref: "tacticsAudioRefs['absent']" },
            { shape: 'a bare identifier', ref: 'tacticsAudioRefs' },
        ])('leaves $shape unresolved rather than guessing at it', async ({ ref }) => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = { absent: 'tactics/audio/absent.ogg' };
                            export const wrapper = { tacticsAudioRefs };
                            export const controlRefs = { plain: 'tactics/audio/control-absent.ogg' };
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    { ref: ${ref}, kind: 'audio-clip', priority: 'critical' },
                                    { ref: controlRefs.plain, kind: 'audio-clip', priority: 'critical' },
                                ],
                            };
                        `,
                    },
                }),
            });

            // Only the control resolves. Were the unreadable shape guessed at, its
            // path would appear here too.
            expect(report.missing.map((entry) => entry.ref)).toEqual([
                'tactics/audio/control-absent.ogg',
            ]);
        });

        // The collector is scope-blind — it walks function bodies too — so two consts
        // of one name have to resolve by SOME rule, and Invariant #52 states which:
        // last in source order, not innermost. Both candidates name a missing file, so
        // whichever the reader picked shows up in `missing`; a reader that resolved
        // neither would report an empty list and fail here too.
        it('resolves the LAST same-named const in source order, not the innermost', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = { theme: 'tactics/audio/outer.ogg' };
                            function unused() {
                                const tacticsAudioRefs = { theme: 'tactics/audio/inner.ogg' };
                                return tacticsAudioRefs;
                            }
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    { ref: tacticsAudioRefs.theme, kind: 'audio-clip', priority: 'critical' },
                                ],
                            };
                        `,
                    },
                }),
            });

            // The function-local declaration is LAST in the file and in scope nowhere
            // near the entry — so the two candidate rules disagree here, and the one
            // that wins is source order. Ordered the other way round the two agree and
            // a scope-aware collector would pass unnoticed.
            expect(report.missing.map((entry) => entry.ref)).toEqual(['tactics/audio/inner.ogg']);
        });

        it('resolves a const-named ref on a plain object-literal entry too', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = { absent: 'tactics/audio/absent.ogg' };
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    { ref: tacticsAudioRefs.absent, kind: 'audio-clip', priority: 'critical' },
                                ],
                            };
                        `,
                    },
                }),
            });

            expect(report.missing.map((entry) => entry.ref)).toEqual(['tactics/audio/absent.ogg']);
        });

        // The resolution must not reach across files: a const of the same name in
        // ANOTHER game's manifest must not supply this one's refs. Both consts name a
        // path with no file behind it, so a resolved ref shows up in `missing` and an
        // unresolved one does not — and the same-file control in the same fixture is
        // what keeps the expectation from passing on a reader that resolves nothing.
        it('resolves a const from its own file but not one from another manifest', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    assetManifestFiles: [
                        'apps/tactics/asset-manifest.ts',
                        'apps/chess/asset-manifest.ts',
                    ],
                    files: {
                        'apps/chess/asset-manifest.ts': `
                            export const foreignRefs = { theme: 'chess/audio/absent.ogg' };
                            export const chessAssetManifest = { gameId: 'chess', entries: [] };
                        `,
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAudioRefs = { own: 'tactics/audio/absent.ogg' };
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    { ref: tacticsAudioRefs.own, kind: 'audio-clip', priority: 'critical' },
                                    { ref: foreignRefs.theme, kind: 'audio-clip', priority: 'critical' },
                                ],
                            };
                        `,
                    },
                }),
            });

            expect(report.missing.map((entry) => entry.ref)).toEqual(['tactics/audio/absent.ogg']);
        });

        it('existence-checks the ref of a builder-authored entry', async () => {
            const report = await validateManifestEntries(
                `audioClipEntry({ ref: 'tactics/audio/absent.ogg', priority: 'critical' })`,
            );

            const output = formatAssetValidationReport(report, workspaceRoot);

            expect(report.ok).toBe(false);
            expect(report.missing.map((entry) => entry.ref)).toEqual(['tactics/audio/absent.ogg']);
            expect(output).toContain('Missing asset files:');
        });

        it('counts a builder-authored entry as manifest coverage for a data JSON ref', async () => {
            const report = await validateAssetWorkspace({
                workspaceRoot,
                host: createHost({
                    dataJsonFiles: ['apps/tactics/data/tracks/theme.json'],
                    assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                    files: {
                        'apps/tactics/data/tracks/theme.json': JSON.stringify({
                            track: 'tactics/audio/theme.ogg',
                        }),
                        'apps/tactics/asset-manifest.ts': `
                            export const tacticsAssetManifest = {
                                gameId: 'tactics',
                                entries: [
                                    audioClipEntry({ ref: 'tactics/audio/theme.ogg', priority: 'critical' }),
                                ],
                            };
                        `,
                        'apps/tactics/assets/audio/theme.ogg': '',
                    },
                }),
            });

            expect(report.ok).toBe(true);
            expect(report.unmanifested).toHaveLength(0);
        });
    });
});

function cueSheetReasons(report: AssetValidationReport): readonly string[] {
    return report.invalidCueSheets.map((sheet) => sheet.reason);
}

/** An `'audio-clip'` manifest entry carrying `metadata` verbatim as authored. */
function audioClipEntrySource(metadataSource: string): string {
    return `{
        ref: 'tactics/audio/theme.ogg',
        kind: 'audio-clip',
        priority: 'critical',
        metadata: ${metadataSource},
    }`;
}

async function validateManifestEntries(entriesSource: string): Promise<AssetValidationReport> {
    return validateAssetWorkspace({
        workspaceRoot,
        host: createHost({
            assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            files: {
                'apps/tactics/asset-manifest.ts': `
                    export const tacticsAssetManifest = {
                        gameId: 'tactics',
                        entries: [${entriesSource}],
                    };
                `,
                'apps/tactics/assets/audio/theme.ogg': '',
            },
        }),
    });
}

interface HostFixture {
    readonly dataJsonFiles?: readonly string[];
    readonly sceneSourceFiles?: readonly string[];
    readonly assetManifestFiles?: readonly string[];
    readonly assetLoaderSourceFiles?: readonly string[];
    readonly gameFontSourceFiles?: readonly string[];
    readonly rendererPublicAssetFiles?: readonly string[];
    readonly onDemandLoadSourceFiles?: readonly string[];
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
        findOnDemandLoadSourceFiles: async () =>
            (fixture.onDemandLoadSourceFiles ?? []).map((relativePath) =>
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
                dataJsonFiles: ['apps/tactics/data/units/unit.json'],
                files: {
                    'apps/tactics/data/units/unit.json': JSON.stringify({ id: 'soldier' }),
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(true);
        expect(output).toBe('[validate-assets] Checked 0 asset refs; all files exist.\n');
    });
});

// ── on-demand asset load detection (Invariant #52) ────────────────────────────

describe('on-demand asset load detection', () => {
    it('flags an undeclared on-demand load with a literal ref as a hard error', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        import { useAsset } from '@chimera-engine/renderer';
                        export function Board() {
                            return useAsset('tactics/foo/undeclared.png');
                        }
                    `,
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(false);
        expect(toAssetValidationExitCode(report)).toBe(1);
        expect(report.undeclaredOnDemandLoads.map((load) => load.ref)).toContain(
            'tactics/foo/undeclared.png',
        );
        expect(output).toContain('Undeclared on-demand asset loads');
    });

    it('passes an on-demand load whose literal ref is declared in a manifest', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        export function Board(assets) {
                            return assets.load('tactics/icons/shield.png');
                        }
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/icons/shield.png', kind: 'texture', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/icons/shield.png': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
        // ONE declared ref, counted once. An on-demand load resolves against the
        // declared set rather than joining it, so adding it to the total would inflate
        // the one number the tool prints by however many times a game loads what it
        // already declared.
        expect(report.checkedRefs).toBe(1);
    });

    it('warns without failing when an on-demand load ref is dynamic', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        export function Board(props) {
                            return useAsset(props.ref);
                        }
                    `,
                },
            }),
        });

        const output = formatAssetValidationReport(report, workspaceRoot);

        expect(report.ok).toBe(true);
        expect(toAssetValidationExitCode(report)).toBe(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(1);
        expect(output).toContain('Warning:');
    });

    it('resolves a manifest-const member ref and passes when declared (tier B)', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        import { tacticsAudioRefs } from '../asset-manifest';
                        export function Board(assetManager) {
                            return assetManager.load(tacticsAudioRefs.step);
                        }
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAudioRefs = {
                            step: 'tactics/audio/sfx/step.wav',
                        } as const;
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/audio/sfx/step.wav', kind: 'audio-clip', priority: 'deferred' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/audio/sfx/step.wav': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
    });

    it('flags a manifest-const member ref that is not declared anywhere (tier B)', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        import { tacticsAudioRefs } from '../asset-manifest';
                        export function Board(assetManager) {
                            return assetManager.load(tacticsAudioRefs.reveal);
                        }
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAudioRefs = {
                            reveal: 'tactics/audio/sfx/reveal.wav',
                        } as const;
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [],
                        };
                    `,
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.undeclaredOnDemandLoads.map((load) => load.ref)).toContain(
            'tactics/audio/sfx/reveal.wav',
        );
    });

    it('scopes manifest-const resolution per-game so identical const names never cross-resolve', async () => {
        // Two games each export `const sharedRefs = { icon: '<game>/icon.png' }`. Alpha's
        // on-demand load must resolve to alpha/icon.png (declared → ok), NOT beta/icon.png
        // (which a workspace-global last-wins map would incorrectly pick and flag).
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/alpha/screens/a.tsx'],
                assetManifestFiles: ['apps/alpha/asset-manifest.ts', 'apps/beta/asset-manifest.ts'],
                files: {
                    'apps/alpha/screens/a.tsx': `
                        import { sharedRefs } from '../asset-manifest';
                        export function A(assetManager) {
                            return assetManager.load(sharedRefs.icon);
                        }
                    `,
                    'apps/alpha/asset-manifest.ts': `
                        export const sharedRefs = { icon: 'alpha/icon.png' } as const;
                        export const alphaManifest = {
                            gameId: 'alpha',
                            entries: [{ ref: 'alpha/icon.png', kind: 'texture', priority: 'critical' }],
                        };
                    `,
                    'apps/beta/asset-manifest.ts': `
                        export const sharedRefs = { icon: 'beta/icon.png' } as const;
                        export const betaManifest = { gameId: 'beta', entries: [] };
                    `,
                    'apps/alpha/assets/icon.png': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
    });

    it('derives per-game scope even when an ancestor directory is named "apps"', async () => {
        // A checkout under an ancestor dir literally named `apps` must not collapse every
        // game to the same id: gameId is derived from the path RELATIVE to workspaceRoot.
        const root = '/srv/apps/Chimera';
        const abs = (relativePath: string): string => `${root}/${relativePath}`;
        const files = new Map<string, string>([
            [
                abs('apps/alpha/screens/a.tsx'),
                `
                    import { sharedRefs } from '../asset-manifest';
                    export function A(assetManager) { return assetManager.load(sharedRefs.icon); }
                `,
            ],
            [
                abs('apps/alpha/asset-manifest.ts'),
                `
                    export const sharedRefs = { icon: 'alpha/icon.png' } as const;
                    export const alphaManifest = {
                        gameId: 'alpha',
                        entries: [{ ref: 'alpha/icon.png', kind: 'texture', priority: 'critical' }],
                    };
                `,
            ],
            [
                abs('apps/beta/asset-manifest.ts'),
                `
                    export const sharedRefs = { icon: 'beta/icon.png' } as const;
                    export const betaManifest = { gameId: 'beta', entries: [] };
                `,
            ],
            [abs('apps/alpha/assets/icon.png'), ''],
        ]);
        const host: WorkspaceFileHost = {
            findDataJsonFiles: async () => [],
            findSceneSourceFiles: async () => [],
            findAssetManifestFiles: async () => [
                abs('apps/alpha/asset-manifest.ts'),
                abs('apps/beta/asset-manifest.ts'),
            ],
            findOnDemandLoadSourceFiles: async () => [abs('apps/alpha/screens/a.tsx')],
            readFile: async (filePath) => {
                const contents = files.get(filePath);
                if (contents === undefined) {
                    throw new Error(`Missing fixture file: ${filePath}`);
                }
                return contents;
            },
            fileExists: async (filePath) => files.has(filePath),
        };

        const report = await validateAssetWorkspace({ workspaceRoot: root, host });

        // Alpha's `sharedRefs.icon` must resolve to alpha/icon.png (declared), not beta's.
        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
    });

    it('resolves a buildAssetRef(...) on-demand load and flags it when undeclared', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        export function Board(assetManager) {
                            return assetManager.load(buildAssetRef('tactics', 'foo/x.png'));
                        }
                    `,
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.undeclaredOnDemandLoads.map((load) => load.ref)).toContain(
            'tactics/foo/x.png',
        );
    });

    it('ignores .get/.load calls on non-asset receivers', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/scene/registry.ts'],
                files: {
                    'apps/tactics/scene/registry.ts': `
                        export function boot(store, loader, map, sceneId, key) {
                            store.get('inventory/slot');
                            loader.load('https://example.com/x.png');
                            map.get(key);
                            return this.descriptors.get(sceneId);
                        }
                    `,
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
    });

    it('does not crash or flag an asset-manager call with no arguments', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        export function Board(assetManager) {
                            assetManager.get();
                            return null;
                        }
                    `,
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
    });
});

// ── malformed AssetRef strings ────────────────────────────────────────────────

describe('malformed asset refs', () => {
    it('reports a path-traversal ref in data JSON as malformed', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['apps/tactics/data/units/bad.json'],
                files: {
                    'apps/tactics/data/units/bad.json': JSON.stringify({
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
                dataJsonFiles: ['apps/tactics/data/units/bad.json'],
                files: {
                    'apps/tactics/data/units/bad.json': JSON.stringify({
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
                sceneSourceFiles: ['apps/tactics/scenes/scenes.ts'],
                files: {
                    'apps/tactics/scenes/scenes.ts': `
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
                dataJsonFiles: ['apps/tactics/data/units/unit.json'],
                files: {
                    'apps/tactics/data/units/unit.json': JSON.stringify({
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
                dataJsonFiles: ['apps/tactics/data/units/unit.json'],
                files: {
                    'apps/tactics/data/units/unit.json': JSON.stringify({
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
                dataJsonFiles: ['apps/tactics/data/units/unit.json'],
                files: {
                    'apps/tactics/data/units/unit.json': JSON.stringify({
                        sounds: ['tactics/audio/step.ogg', 'tactics/audio/hit.ogg'],
                    }),
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/audio/step.ogg', kind: 'audio-clip', priority: 'deferred' },
                                { ref: 'tactics/audio/hit.ogg', kind: 'audio-clip', priority: 'deferred' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/audio/step.ogg': '',
                    'apps/tactics/assets/audio/hit.ogg': '',
                },
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(4);
    });

    it('formats special-character JSON keys in bracket notation in the missing-ref report', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                dataJsonFiles: ['apps/tactics/data/units/unit.json'],
                files: {
                    'apps/tactics/data/units/unit.json': JSON.stringify({
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
                sceneSourceFiles: ['apps/tactics/scenes/scenes.ts'],
                files: {
                    'apps/tactics/scenes/scenes.ts': `
                        export const scene = {
                            requiredAssets: ['tactics/models/board.glb'] as const,
                        };
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/board.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/models/board.glb': '',
                },
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(2);
    });

    it('handles requiredAssets wrapped in `satisfies` in a .tsx scene file', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['apps/tactics/scenes/scenes.tsx'],
                files: {
                    'apps/tactics/scenes/scenes.tsx': `
                        export const scene = {
                            requiredAssets: ['tactics/models/board.glb'],
                        } satisfies { requiredAssets: string[] };
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/board.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/models/board.glb': '',
                },
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(2);
    });

    it('handles requiredAssets declared with a string-literal property key', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                sceneSourceFiles: ['apps/tactics/scenes/scenes.ts'],
                files: {
                    'apps/tactics/scenes/scenes.ts': `
                        export const scene = {
                            'requiredAssets': ['tactics/textures/floor.webp'],
                        };
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/textures/floor.webp', kind: 'texture', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/textures/floor.webp': '',
                },
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.checkedRefs).toBe(2);
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

    it('findDataJsonFiles returns JSON files under apps/*/data/ recursively', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const dataDir = join(dir, 'apps', 'tactics', 'data', 'units');
        await mkdir(dataDir, { recursive: true });
        await writeFile(join(dataDir, 'soldier.json'), '{}');
        await writeFile(join(dataDir, 'soldier.ts'), ''); // must be excluded

        const host = createNodeWorkspaceFileHost();
        const files = await host.findDataJsonFiles(dir);

        expect(files).toHaveLength(1);
        expect(files[0]).toContain('soldier.json');
    });

    it('findDataJsonFiles returns an empty array when the apps/ directory does not exist', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));

        const host = createNodeWorkspaceFileHost();
        const files = await host.findDataJsonFiles(dir);

        expect(files).toEqual([]);
    });

    it('findSceneSourceFiles returns .ts files and excludes .d.ts and test files', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const scenesDir = join(dir, 'apps', 'tactics', 'scenes');
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
    it('returns exit code 0 for a workspace whose apps/ holds no games', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await mkdir(join(dir, 'apps'), { recursive: true });
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

        const exitCode = await runValidateAssetsCli([dir]);

        // 0 refs is the honest answer here, not a vacuous one: the crawl root
        // exists and was read. A freshly scaffolded game reports the same,
        // because a blank game genuinely declares no assets yet.
        expect(exitCode).toBe(0);
    });

    // Without `apps/` no game can be discovered, so the run would report
    // "Checked 0 asset refs; all files exist." and exit 0 — success, about a
    // tree it never read. That is the failure mode the bin exists to prevent,
    // arriving through the argument instead of the entry guard, and it is
    // reachable by hand: run bare from a game package and the root defaults to
    // that package.
    it('refuses a root with no apps/ directory instead of passing vacuously', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const exitCode = await runValidateAssetsCli([dir]);

        expect(exitCode).toBe(1);
        const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
        // Both halves of the message are asserted, because each is separately
        // deletable. The CAUSE has to name the directory that is missing — a
        // bare "not a workspace root" does not say what would make it one...
        expect(written).toContain(dir);
        expect(written).toMatch(/no apps\/ directory/u);
        // ...and the FIX has to carry the invocation, since the reachable way
        // to land here is a wrong cwd and the reader would otherwise guess the
        // depth. Delimited, because a plain substring match for `../..` is
        // also satisfied by the `../../..` that names the wrong depth — the one
        // mistake the hint exists to prevent.
        expect(written).toMatch(/`chimera-validate-assets \.\.\/\.\.`/u);
    });

    it('refuses a GAME PACKAGE, whose own simulation/ and renderer/ must not stand in for apps/', async () => {
        // The exact shape the hazard produces: `chimera-validate-assets` run
        // bare from a game package. A game is invited to hold `simulation/`
        // and `renderer/` of its own — the blank template ships both — so a
        // guard that accepted any directory the crawl reads would scan this
        // package as if it were the workspace, discover no games, and report
        // success. Only `apps/` distinguishes a workspace root from a package
        // inside one.
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await mkdir(join(dir, 'simulation', 'scene'), { recursive: true });
        await mkdir(join(dir, 'renderer', 'assets'), { recursive: true });
        await mkdir(join(dir, 'renderer', 'public', 'assets'), { recursive: true });
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        expect(await runValidateAssetsCli([dir])).toBe(1);
    });

    it('reports a permission fault as itself rather than as a missing root', async ({ skip }) => {
        // Root defeats the mode bits and Windows ignores them, so the fault
        // cannot be provoked there. Skip — a bare early return would report
        // this as passing coverage it did not have.
        skip(process.platform === 'win32' || process.getuid?.() === 0, 'needs POSIX mode bits');

        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await mkdir(join(dir, 'apps'), { recursive: true });
        await chmod(dir, 0o000);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        try {
            // `apps/` IS there and the fix is a permission repair, so the
            // refusal's advice would send the reader after the wrong thing.
            // The CLI entry turns the throw into a non-zero exit; what matters
            // here is that the cause is not rewritten.
            await expect(runValidateAssetsCli([dir])).rejects.toThrow(/EACCES/u);
            expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).not.toContain(
                'not a workspace root',
            );
        } finally {
            await chmod(dir, 0o755);
        }
    });

    // The guard keys on `apps/` alone, so the checks fed by the ENGINE-side
    // roots have to be shown still firing — a guard that grew to accept those
    // roots would let a game package (which is invited to hold `simulation/`
    // and `renderer/` of its own) be scanned as a workspace and pass on
    // nothing, while a finder that dropped one of those roots would swallow
    // real findings. These two plant a finding each and assert it is reported.
    it('still reports a forbidden renderer-public game asset', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await mkdir(join(dir, 'apps'), { recursive: true });
        await mkdir(join(dir, 'renderer', 'public', 'assets', 'tactics'), { recursive: true });
        await writeFile(join(dir, 'renderer', 'public', 'assets', 'tactics', 'foo.png'), '');
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        expect(await runValidateAssetsCli([dir])).toBe(1);
        expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
            'renderer/public/assets/tactics/foo.png',
        );
    });

    it('still reports a missing ref declared by an engine-side scene descriptor', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await mkdir(join(dir, 'apps'), { recursive: true });
        await mkdir(join(dir, 'simulation', 'scene'), { recursive: true });
        await writeFile(
            join(dir, 'simulation', 'scene', 'menu.scene.ts'),
            "export const scene = { requiredAssets: ['tactics/missing.webp'] };\n",
        );
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        expect(await runValidateAssetsCli([dir])).toBe(1);
        expect(stderr.mock.calls.map(([chunk]) => String(chunk)).join('')).toContain(
            'tactics/missing.webp',
        );
    });

    it('refuses a workspace root whose apps/ is a file rather than a directory', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await writeFile(join(dir, 'apps'), '');
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        expect(await runValidateAssetsCli([dir])).toBe(1);
    });

    it('accepts a SYMLINKED apps/ and still refuses a dangling one', async () => {
        // The ACCEPT half is what discriminates `stat` from `lstat`: `lstat`
        // reports a symlink as not-a-directory and would refuse this root.
        // pnpm workspaces are built out of symlinks, so following them is the
        // behaviour that has to hold. The dangling half is not a second
        // discriminator — both calls reject it — it pins that following a
        // symlink does not become following it blindly.
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const realApps = join(dir, 'elsewhere');
        await mkdir(realApps, { recursive: true });
        await symlink(realApps, join(dir, 'apps'), 'dir');
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        expect(await runValidateAssetsCli([dir])).toBe(0);

        const dangling = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        await symlink(join(dangling, 'nowhere'), join(dangling, 'apps'), 'dir');

        expect(await runValidateAssetsCli([dangling])).toBe(1);
    });

    it('returns exit code 1 for a workspace with a missing asset reference', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const dataDir = join(dir, 'apps', 'tactics', 'data');
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

// ── on-demand load detection — useModelInstance + the Invariant #96 surfaces ──

describe('on-demand load detection — useModelInstance and the Invariant #96 surfaces', () => {
    it('flags an undeclared useModelInstance load in a game screen as a hard error', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/screens/board.tsx'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        import { useModelInstance } from '@chimera-engine/renderer/assets';
                        export function Board() {
                            return useModelInstance('tactics/models/undeclared.glb');
                        }
                    `,
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(toAssetValidationExitCode(report)).toBe(1);
        expect(report.undeclaredOnDemandLoads.map((load) => load.ref)).toContain(
            'tactics/models/undeclared.glb',
        );
        // The finding's location is labelled with the MATCHED hook name, not a
        // hardcoded 'useAsset'.
        const finding = report.undeclaredOnDemandLoads.find(
            (load) => load.ref === 'tactics/models/undeclared.glb',
        );
        expect(finding?.source.location.startsWith('useModelInstance (')).toBe(true);
    });

    it('reports an undeclared useModelInstance load under apps/<game>/shell/', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/shell/UnitPortrait.tsx'],
                files: {
                    'apps/tactics/shell/UnitPortrait.tsx': `
                        export function UnitPortrait() {
                            return useModelInstance('tactics/models/portrait.glb');
                        }
                    `,
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.undeclaredOnDemandLoads.map((load) => load.ref)).toContain(
            'tactics/models/portrait.glb',
        );
    });

    it('reports an undeclared useModelInstance load under apps/<game>/renderer/', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: ['apps/tactics/renderer/loaders.ts'],
                files: {
                    'apps/tactics/renderer/loaders.ts': `
                        export function preload() {
                            return useModelInstance('tactics/models/hero.glb');
                        }
                    `,
                },
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.undeclaredOnDemandLoads.map((load) => load.ref)).toContain(
            'tactics/models/hero.glb',
        );
    });

    it('passes declared useModelInstance refs across all three Invariant #96 surfaces (negative control)', async () => {
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: createHost({
                onDemandLoadSourceFiles: [
                    'apps/tactics/screens/board.tsx',
                    'apps/tactics/shell/UnitPortrait.tsx',
                    'apps/tactics/renderer/loaders.ts',
                ],
                assetManifestFiles: ['apps/tactics/asset-manifest.ts'],
                files: {
                    'apps/tactics/screens/board.tsx': `
                        export function Board() {
                            // A non-member identifier call with a ref-shaped,
                            // UNDECLARED literal: the matcher must ignore it —
                            // a coarsened matcher would hard-error CI on it.
                            trackTelemetry('tactics/telemetry/board-open');
                            return useModelInstance('tactics/models/knight.glb');
                        }
                    `,
                    'apps/tactics/shell/UnitPortrait.tsx': `
                        export function UnitPortrait() {
                            return useModelInstance('tactics/models/knight.glb');
                        }
                    `,
                    'apps/tactics/renderer/loaders.ts': `
                        export function preload() {
                            return useModelInstance('tactics/models/knight.glb');
                        }
                    `,
                    'apps/tactics/asset-manifest.ts': `
                        export const tacticsAssetManifest = {
                            gameId: 'tactics',
                            entries: [
                                { ref: 'tactics/models/knight.glb', kind: 'gltf-model', priority: 'critical' },
                            ],
                        };
                    `,
                    'apps/tactics/assets/models/knight.glb': '',
                },
            }),
        });

        expect(report.ok).toBe(true);
        expect(report.undeclaredOnDemandLoads).toHaveLength(0);
        expect(report.unresolvedOnDemandLoads).toHaveLength(0);
    });

    it('findOnDemandLoadSourceFiles opens exactly the Invariant #96 surfaces plus the engine scene root', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const plant = async (relPath: string): Promise<void> => {
            const absPath = join(dir, ...relPath.split('/'));
            await mkdir(dirname(absPath), { recursive: true });
            await writeFile(absPath, '');
        };
        await plant('apps/tactics/screens/board.tsx');
        await plant('apps/tactics/shell/UnitPortrait.tsx');
        await plant('apps/tactics/renderer/loaders.ts');
        // NOT scanned: a nested renderer/ dir below the surface position — the
        // widened segments are anchored to apps/<name>/<surface>, never matched
        // as bare path segments.
        await plant('apps/tactics/lib/renderer/util.ts');
        // NOT scanned: the walked roots are apps/ and simulation/scene/, so an
        // engine-shaped tree like renderer/components/shell/ is never walked —
        // and the anchor keeps 'shell'/'renderer' from ever matching as bare
        // segments inside a walked root.
        await plant('renderer/components/shell/GameShell.tsx');
        await plant('simulation/scene/sceneGraph.ts');
        // NOT scanned: build output and test/declaration files stay excluded
        // inside the widened surfaces.
        await plant('apps/tactics/renderer/dist/generated.ts');
        await plant('apps/tactics/shell/UnitPortrait.test.tsx');

        const host = createNodeWorkspaceFileHost();
        if (host.findOnDemandLoadSourceFiles === undefined) {
            throw new Error(
                'createNodeWorkspaceFileHost must provide findOnDemandLoadSourceFiles.',
            );
        }
        const files = (await host.findOnDemandLoadSourceFiles(dir)).map((file) =>
            relative(dir, file).split(sep).join('/'),
        );

        expect(files).toEqual([
            'apps/tactics/renderer/loaders.ts',
            'apps/tactics/screens/board.tsx',
            'apps/tactics/shell/UnitPortrait.tsx',
            'simulation/scene/sceneGraph.ts',
        ]);
    });

    it('finds the widened surfaces even when an ancestor directory is named apps', async () => {
        // Mirrors the per-game-scope ancestor test: a checkout like
        // /srv/apps/Chimera must not anchor the surface check on the ancestor
        // 'apps' segment of the absolute path.
        const dir = await mkdtemp(join(tmpdir(), 'chimera-assets-test-'));
        const workspace = join(dir, 'srv', 'apps', 'Chimera');
        const plant = async (relPath: string): Promise<void> => {
            const absPath = join(workspace, ...relPath.split('/'));
            await mkdir(dirname(absPath), { recursive: true });
            await writeFile(absPath, '');
        };
        await plant('apps/tactics/shell/UnitPortrait.tsx');
        await plant('apps/tactics/renderer/loaders.ts');

        const host = createNodeWorkspaceFileHost();
        if (host.findOnDemandLoadSourceFiles === undefined) {
            throw new Error(
                'createNodeWorkspaceFileHost must provide findOnDemandLoadSourceFiles.',
            );
        }
        const files = (await host.findOnDemandLoadSourceFiles(workspace)).map((file) =>
            relative(workspace, file).split(sep).join('/'),
        );

        expect(files).toEqual([
            'apps/tactics/renderer/loaders.ts',
            'apps/tactics/shell/UnitPortrait.tsx',
        ]);
    });
});
