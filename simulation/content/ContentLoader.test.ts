import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContentConflictError, ContentSchemaError, UnknownDataRefError } from './ContentDatabase';
import { createContentLoader } from './ContentLoader';

// ---------------------------------------------------------------------------
// ContentLoader — unit and integration tests
// §4.8 — simulation/content/ContentLoader.ts
//
// These engine-level tests use `player-colors` purely as a sample collection;
// the loader is generic and knows nothing about colours (callers supply schemas).
// ---------------------------------------------------------------------------

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests — inline source only (no filesystem)
// ─────────────────────────────────────────────────────────────────────────────

describe('ContentLoader — inline source', () => {
    it('loads items from a single inline source', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'player-colors',
                items: [
                    { id: 'blue', name: 'Blue' },
                    { id: 'red', name: 'Red' },
                ],
            },
        ]);
        expect(db.getById('player-colors', 'blue')).toEqual({
            id: 'blue',
            name: 'Blue',
        });
        expect(db.getById('player-colors', 'red')).toEqual({
            id: 'red',
            name: 'Red',
        });
    });

    it('merges multiple inline sources for the same collection', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'player-colors',
                items: [{ id: 'blue', name: 'Blue' }],
            },
            {
                type: 'inline',
                collectionType: 'player-colors',
                items: [{ id: 'red', name: 'Red' }],
            },
        ]);
        expect([...db.getAllIds('player-colors')].sort()).toEqual(['blue', 'red']);
    });

    it('merges inline sources for different collections', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'player-colors',
                items: [{ id: 'blue', name: 'Blue' }],
            },
            {
                type: 'inline',
                collectionType: 'abilities',
                items: [{ id: 'taunt', description: 'Force attack' }],
            },
        ]);
        expect([...db.collectionTypes()].sort()).toEqual(['abilities', 'player-colors']);
        expect(db.has('abilities', 'taunt')).toBe(true);
    });

    it('throws ContentConflictError when duplicate id appears across two sources', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue' }],
                },
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue (duplicate)' }],
                },
            ]),
        ).rejects.toThrow(ContentConflictError);
    });

    it('ContentConflictError includes collection type and id', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue' }],
                },
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Dup' }],
                },
            ]),
        ).rejects.toThrow(/player-colors.*blue|blue.*player-colors/);
    });

    it('accepts an empty inline source list and returns an empty db', async () => {
        const loader = createContentLoader();
        const db = await loader.load([]);
        expect(db.collectionTypes()).toEqual([]);
    });

    it('accepts an empty items array in inline source', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            { type: 'inline', collectionType: 'player-colors', items: [] },
        ]);
        expect(db.getAllIds('player-colors')).toEqual([]);
    });
});

// ─── Zod schema validation ────────────────────────────────────────────────────

describe('ContentLoader — schema validation', () => {
    const ColorSchema = z.object({
        id: z.string(),
        name: z.string(),
    });

    it('accepts items that pass their registered schema', async () => {
        const loader = createContentLoader();
        const db = await loader.load(
            [
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue' }],
                },
            ],
            { schemas: { 'player-colors': ColorSchema } },
        );
        expect(db.has('player-colors', 'blue')).toBe(true);
    });

    it('throws ContentSchemaError when an item fails schema validation', async () => {
        const loader = createContentLoader();
        // 'name' is missing — fails schema
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'player-colors',
                        items: [{ id: 'blue' }],
                    },
                ],
                { schemas: { 'player-colors': ColorSchema } },
            ),
        ).rejects.toThrow(ContentSchemaError);
    });

    it('ContentSchemaError includes collectionType and id', async () => {
        const loader = createContentLoader();
        try {
            await loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'player-colors',
                        items: [{ id: 'blue' }],
                    },
                ],
                { schemas: { 'player-colors': ColorSchema } },
            );
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ContentSchemaError);
            const schemaErr = err as ContentSchemaError;
            expect(schemaErr.collectionType).toBe('player-colors');
            expect(schemaErr.id).toBe('blue');
        }
    });

    it('does not validate collections that have no registered schema', async () => {
        const loader = createContentLoader();
        // No schema for 'abilities' — should not throw
        const db = await loader.load(
            [
                {
                    type: 'inline',
                    collectionType: 'abilities',
                    items: [{ id: 'taunt', whatever: 42 }],
                },
            ],
            { schemas: { 'player-colors': ColorSchema } },
        );
        expect(db.has('abilities', 'taunt')).toBe(true);
    });
});

// ─── Ref-integrity validation ─────────────────────────────────────────────────

describe('ContentLoader — ref-integrity validation', () => {
    it('validateRefs: false (default) does not throw on a dangling DataRef', async () => {
        const loader = createContentLoader();
        // 'player-colors:teal' does not exist — but validateRefs defaults to false
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'abilities',
                items: [{ id: 'taunt', requiresColor: 'player-colors:teal' }],
            },
        ]);
        expect(db.has('abilities', 'taunt')).toBe(true);
    });

    it('validateRefs: true throws UnknownDataRefError for a dangling DataRef when collection is known', async () => {
        const loader = createContentLoader();
        // 'player-colors' is a known collection but 'teal' does not exist in it
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'player-colors',
                        items: [{ id: 'blue', name: 'Blue' }],
                    },
                    {
                        type: 'inline',
                        collectionType: 'abilities',
                        items: [{ id: 'taunt', requiresColor: 'player-colors:teal' }],
                    },
                ],
                { validateRefs: true },
            ),
        ).rejects.toThrow(UnknownDataRefError);
    });

    it('validateRefs: true does not throw when all DataRefs resolve', async () => {
        const loader = createContentLoader();
        const db = await loader.load(
            [
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue' }],
                },
                {
                    type: 'inline',
                    collectionType: 'abilities',
                    items: [{ id: 'blue-strike', color: 'player-colors:blue' }],
                },
            ],
            { validateRefs: true },
        );
        expect(db.has('abilities', 'blue-strike')).toBe(true);
    });

    it('validateRefs: true checks refs nested in arrays when collection is known', async () => {
        const loader = createContentLoader();
        // 'player-colors' is a known collection but 'red' does not exist
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'player-colors',
                        items: [{ id: 'blue', name: 'Blue' }],
                    },
                    {
                        type: 'inline',
                        collectionType: 'units',
                        items: [
                            {
                                id: 'warrior',
                                affinities: ['player-colors:blue', 'player-colors:red'],
                            },
                        ],
                    },
                ],
                { validateRefs: true },
            ),
        ).rejects.toThrow(UnknownDataRefError);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests — real temp directory (directory-scan and flat-array formats)
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chimera-content-test-'));
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ContentLoader — directory source (one-file-per-item format)', () => {
    it('loads items from a subdirectory where each .json file is one item', async () => {
        // Create: tmpDir/player-colors/blue.json, red.json
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );
        await fs.writeFile(path.join(dir, 'red.json'), JSON.stringify({ id: 'red', name: 'Red' }));

        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: tmpDir }]);

        expect(db.has('player-colors', 'blue')).toBe(true);
        expect(db.has('player-colors', 'red')).toBe(true);
        expect(db.getById('player-colors', 'blue')).toEqual({
            id: 'blue',
            name: 'Blue',
        });
    });

    it('loads multiple collections from different subdirectories', async () => {
        const colorDir = path.join(tmpDir, 'player-colors');
        const abDir = path.join(tmpDir, 'abilities');
        await fs.mkdir(colorDir);
        await fs.mkdir(abDir);
        await fs.writeFile(
            path.join(colorDir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );
        await fs.writeFile(
            path.join(abDir, 'taunt.json'),
            JSON.stringify({ id: 'taunt', description: 'Force attack' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect([...db.collectionTypes()].sort()).toEqual(['abilities', 'player-colors']);
    });

    it('ignores non-.json files in collection subdirectories', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );
        await fs.writeFile(path.join(dir, 'README.md'), 'ignore me');

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect(db.getAllIds('player-colors')).toEqual(['blue']);
    });
});

describe('ContentLoader — directory source (flat-array format)', () => {
    it('loads a flat-array .json file at the directory root as a collection', async () => {
        // Create: tmpDir/abilities.json  (array)
        const items = [
            { id: 'taunt', description: 'Force attack' },
            { id: 'rally', description: 'Buff allies' },
        ];
        await fs.writeFile(path.join(tmpDir, 'abilities.json'), JSON.stringify(items));

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect([...db.getAllIds('abilities')].sort()).toEqual(['rally', 'taunt']);
    });

    it('mixes flat-array and subdirectory formats in the same directory', async () => {
        // flat-array at root
        await fs.writeFile(
            path.join(tmpDir, 'abilities.json'),
            JSON.stringify([{ id: 'taunt', description: 'Force attack' }]),
        );
        // subdirectory format
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect([...db.collectionTypes()].sort()).toEqual(['abilities', 'player-colors']);
        expect(db.has('abilities', 'taunt')).toBe(true);
        expect(db.has('player-colors', 'blue')).toBe(true);
    });
});

describe('ContentLoader — conflict detection across sources', () => {
    it('throws ContentConflictError for duplicate id across a directory and inline source', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );

        const loader = createContentLoader();
        await expect(
            loader.load([
                { type: 'directory', path: tmpDir },
                {
                    type: 'inline',
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue (dup)' }],
                },
            ]),
        ).rejects.toThrow(ContentConflictError);
    });
});

describe('ContentLoader — items are frozen (M7)', () => {
    it('items loaded from a directory source are frozen in the resulting db', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        const item = db.getById('player-colors', 'blue');
        expect(Object.isFrozen(item)).toBe(true);
    });

    it('items loaded from an inline source are frozen in the resulting db', async () => {
        const db = await createContentLoader().load([
            {
                type: 'inline',
                collectionType: 'player-colors',
                items: [{ id: 'blue', name: 'Blue' }],
            },
        ]);
        const item = db.getById('player-colors', 'blue');
        expect(Object.isFrozen(item)).toBe(true);
    });
});

describe('ContentLoader — schema validation on directory source', () => {
    it('throws ContentSchemaError when a directory-loaded item fails schema', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        // Missing required 'name' field
        await fs.writeFile(path.join(dir, 'blue.json'), JSON.stringify({ id: 'blue' }));

        const ColorSchema = z.object({ id: z.string(), name: z.string() });
        await expect(
            createContentLoader().load([{ type: 'directory', path: tmpDir }], {
                schemas: { 'player-colors': ColorSchema },
            }),
        ).rejects.toThrow(ContentSchemaError);
    });
});

describe('ContentLoader — JSON.parse error context (H7)', () => {
    it('includes the file path in the error when a one-per-item .json file is malformed', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(path.join(dir, 'blue.json'), '{ invalid json }');

        await expect(
            createContentLoader().load([{ type: 'directory', path: tmpDir }]),
        ).rejects.toThrow(/blue\.json/);
    });

    it('includes the file path in the error when a flat-array .json file is malformed', async () => {
        await fs.writeFile(path.join(tmpDir, 'abilities.json'), '[ broken');

        await expect(
            createContentLoader().load([{ type: 'directory', path: tmpDir }]),
        ).rejects.toThrow(/abilities\.json/);
    });
});

describe('ContentLoader — filename equals item id (H8)', () => {
    it('throws ContentSchemaError when filename stem does not match item.id', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        // file is blue.json but id inside is "teal"
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'teal', name: 'Teal' }),
        );

        await expect(
            createContentLoader().load([{ type: 'directory', path: tmpDir }]),
        ).rejects.toThrow(ContentSchemaError);
    });

    it('ContentSchemaError from id mismatch includes collectionType and expected id', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'teal', name: 'Teal' }),
        );

        try {
            await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ContentSchemaError);
            const e = err as ContentSchemaError;
            expect(e.collectionType).toBe('player-colors');
            expect(e.id).toBe('blue');
        }
    });

    it('does not throw when filename stem matches item.id', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect(db.has('player-colors', 'blue')).toBe(true);
    });
});

describe('ContentLoader — deterministic load order (H6)', () => {
    it('loads subdirectory items in alphabetical order regardless of filesystem order', async () => {
        const dir = path.join(tmpDir, 'player-colors');
        await fs.mkdir(dir);
        // Write in reverse alphabetical order
        await fs.writeFile(path.join(dir, 'red.json'), JSON.stringify({ id: 'red', name: 'Red' }));
        await fs.writeFile(
            path.join(dir, 'green.json'),
            JSON.stringify({ id: 'green', name: 'Green' }),
        );
        await fs.writeFile(
            path.join(dir, 'blue.json'),
            JSON.stringify({ id: 'blue', name: 'Blue' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect(db.getAllIds('player-colors')).toEqual(['blue', 'green', 'red']);
    });

    it('loads subdirectories (collections) in alphabetical order', async () => {
        const zdDir = path.join(tmpDir, 'zones');
        const adDir = path.join(tmpDir, 'abilities');
        await fs.mkdir(zdDir);
        await fs.mkdir(adDir);
        await fs.writeFile(
            path.join(zdDir, 'z1.json'),
            JSON.stringify({ id: 'z1', name: 'Zone 1' }),
        );
        await fs.writeFile(
            path.join(adDir, 'a1.json'),
            JSON.stringify({ id: 'a1', name: 'Ability 1' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect(db.collectionTypes()).toEqual(['abilities', 'zones']);
    });
});

// ─── validateRefs false-positive prevention ───────────────────────────────────

describe('ContentLoader — validateRefs false-positive prevention (H5)', () => {
    it('does not throw on a timestamp string (ISO 8601 contains colons)', async () => {
        const loader = createContentLoader();
        const db = await loader.load(
            [
                {
                    type: 'inline',
                    collectionType: 'events',
                    items: [{ id: 'evt1', createdAt: '2024-01-01T00:00:00Z' }],
                },
            ],
            { validateRefs: true },
        );
        expect(db.has('events', 'evt1')).toBe(true);
    });

    it('does not throw on a URL string (contains colon)', async () => {
        const loader = createContentLoader();
        const db = await loader.load(
            [
                {
                    type: 'inline',
                    collectionType: 'events',
                    items: [{ id: 'evt1', link: 'https://example.com/path' }],
                },
            ],
            { validateRefs: true },
        );
        expect(db.has('events', 'evt1')).toBe(true);
    });

    it('still throws UnknownDataRefError for a string whose left side is a known collection', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'player-colors',
                        items: [{ id: 'blue', name: 'Blue' }],
                    },
                    {
                        type: 'inline',
                        collectionType: 'abilities',
                        items: [{ id: 'strike', color: 'player-colors:teal' }],
                    },
                ],
                { validateRefs: true },
            ),
        ).rejects.toThrow(UnknownDataRefError);
    });
});
