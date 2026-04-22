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
                collectionType: 'damage-types',
                items: [
                    { id: 'fire', name: 'Fire' },
                    { id: 'cold', name: 'Cold' },
                ],
            },
        ]);
        expect(db.getById('damage-types', 'fire')).toEqual({
            id: 'fire',
            name: 'Fire',
        });
        expect(db.getById('damage-types', 'cold')).toEqual({
            id: 'cold',
            name: 'Cold',
        });
    });

    it('merges multiple inline sources for the same collection', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'damage-types',
                items: [{ id: 'fire', name: 'Fire' }],
            },
            {
                type: 'inline',
                collectionType: 'damage-types',
                items: [{ id: 'cold', name: 'Cold' }],
            },
        ]);
        expect([...db.getAllIds('damage-types')].sort()).toEqual(['cold', 'fire']);
    });

    it('merges inline sources for different collections', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'damage-types',
                items: [{ id: 'fire', name: 'Fire' }],
            },
            {
                type: 'inline',
                collectionType: 'abilities',
                items: [{ id: 'taunt', description: 'Force attack' }],
            },
        ]);
        expect([...db.collectionTypes()].sort()).toEqual(['abilities', 'damage-types']);
        expect(db.has('abilities', 'taunt')).toBe(true);
    });

    it('throws ContentConflictError when duplicate id appears across two sources', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                {
                    type: 'inline',
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Fire' }],
                },
                {
                    type: 'inline',
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Fire (duplicate)' }],
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
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Fire' }],
                },
                {
                    type: 'inline',
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Dup' }],
                },
            ]),
        ).rejects.toThrow(/damage-types.*fire|fire.*damage-types/);
    });

    it('accepts an empty inline source list and returns an empty db', async () => {
        const loader = createContentLoader();
        const db = await loader.load([]);
        expect(db.collectionTypes()).toEqual([]);
    });

    it('accepts an empty items array in inline source', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            { type: 'inline', collectionType: 'damage-types', items: [] },
        ]);
        expect(db.getAllIds('damage-types')).toEqual([]);
    });
});

// ─── Zod schema validation ────────────────────────────────────────────────────

describe('ContentLoader — schema validation', () => {
    const DamageTypeSchema = z.object({
        id: z.string(),
        name: z.string(),
    });

    it('accepts items that pass their registered schema', async () => {
        const loader = createContentLoader();
        const db = await loader.load(
            [
                {
                    type: 'inline',
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Fire' }],
                },
            ],
            { schemas: { 'damage-types': DamageTypeSchema } },
        );
        expect(db.has('damage-types', 'fire')).toBe(true);
    });

    it('throws ContentSchemaError when an item fails schema validation', async () => {
        const loader = createContentLoader();
        // 'name' is missing — fails schema
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'damage-types',
                        items: [{ id: 'fire' }],
                    },
                ],
                { schemas: { 'damage-types': DamageTypeSchema } },
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
                        collectionType: 'damage-types',
                        items: [{ id: 'fire' }],
                    },
                ],
                { schemas: { 'damage-types': DamageTypeSchema } },
            );
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ContentSchemaError);
            const schemaErr = err as ContentSchemaError;
            expect(schemaErr.collectionType).toBe('damage-types');
            expect(schemaErr.id).toBe('fire');
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
            { schemas: { 'damage-types': DamageTypeSchema } },
        );
        expect(db.has('abilities', 'taunt')).toBe(true);
    });
});

// ─── Ref-integrity validation ─────────────────────────────────────────────────

describe('ContentLoader — ref-integrity validation', () => {
    it('validateRefs: false (default) does not throw on a dangling DataRef', async () => {
        const loader = createContentLoader();
        // 'damage-types:poison' does not exist — but validateRefs defaults to false
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'abilities',
                items: [{ id: 'taunt', requiresDamageType: 'damage-types:poison' }],
            },
        ]);
        expect(db.has('abilities', 'taunt')).toBe(true);
    });

    it('validateRefs: true throws UnknownDataRefError for a dangling DataRef when collection is known', async () => {
        const loader = createContentLoader();
        // 'damage-types' is a known collection but 'poison' does not exist in it
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'damage-types',
                        items: [{ id: 'fire', name: 'Fire' }],
                    },
                    {
                        type: 'inline',
                        collectionType: 'abilities',
                        items: [{ id: 'taunt', requiresDamageType: 'damage-types:poison' }],
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
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Fire' }],
                },
                {
                    type: 'inline',
                    collectionType: 'abilities',
                    items: [{ id: 'fire-strike', damageType: 'damage-types:fire' }],
                },
            ],
            { validateRefs: true },
        );
        expect(db.has('abilities', 'fire-strike')).toBe(true);
    });

    it('validateRefs: true checks refs nested in arrays when collection is known', async () => {
        const loader = createContentLoader();
        // 'damage-types' is a known collection but 'cold' does not exist
        await expect(
            loader.load(
                [
                    {
                        type: 'inline',
                        collectionType: 'damage-types',
                        items: [{ id: 'fire', name: 'Fire' }],
                    },
                    {
                        type: 'inline',
                        collectionType: 'units',
                        items: [
                            {
                                id: 'warrior',
                                resistances: ['damage-types:fire', 'damage-types:cold'],
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
        // Create: tmpDir/damage-types/fire.json, cold.json
        const dtDir = path.join(tmpDir, 'damage-types');
        await fs.mkdir(dtDir);
        await fs.writeFile(
            path.join(dtDir, 'fire.json'),
            JSON.stringify({ id: 'fire', name: 'Fire' }),
        );
        await fs.writeFile(
            path.join(dtDir, 'cold.json'),
            JSON.stringify({ id: 'cold', name: 'Cold' }),
        );

        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: tmpDir }]);

        expect(db.has('damage-types', 'fire')).toBe(true);
        expect(db.has('damage-types', 'cold')).toBe(true);
        expect(db.getById('damage-types', 'fire')).toEqual({
            id: 'fire',
            name: 'Fire',
        });
    });

    it('loads multiple collections from different subdirectories', async () => {
        const dtDir = path.join(tmpDir, 'damage-types');
        const abDir = path.join(tmpDir, 'abilities');
        await fs.mkdir(dtDir);
        await fs.mkdir(abDir);
        await fs.writeFile(
            path.join(dtDir, 'fire.json'),
            JSON.stringify({ id: 'fire', name: 'Fire' }),
        );
        await fs.writeFile(
            path.join(abDir, 'taunt.json'),
            JSON.stringify({ id: 'taunt', description: 'Force attack' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect([...db.collectionTypes()].sort()).toEqual(['abilities', 'damage-types']);
    });

    it('ignores non-.json files in collection subdirectories', async () => {
        const dtDir = path.join(tmpDir, 'damage-types');
        await fs.mkdir(dtDir);
        await fs.writeFile(
            path.join(dtDir, 'fire.json'),
            JSON.stringify({ id: 'fire', name: 'Fire' }),
        );
        await fs.writeFile(path.join(dtDir, 'README.md'), 'ignore me');

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect(db.getAllIds('damage-types')).toEqual(['fire']);
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
        const dtDir = path.join(tmpDir, 'damage-types');
        await fs.mkdir(dtDir);
        await fs.writeFile(
            path.join(dtDir, 'fire.json'),
            JSON.stringify({ id: 'fire', name: 'Fire' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect([...db.collectionTypes()].sort()).toEqual(['abilities', 'damage-types']);
        expect(db.has('abilities', 'taunt')).toBe(true);
        expect(db.has('damage-types', 'fire')).toBe(true);
    });
});

describe('ContentLoader — conflict detection across sources', () => {
    it('throws ContentConflictError for duplicate id across a directory and inline source', async () => {
        const dtDir = path.join(tmpDir, 'damage-types');
        await fs.mkdir(dtDir);
        await fs.writeFile(
            path.join(dtDir, 'fire.json'),
            JSON.stringify({ id: 'fire', name: 'Fire' }),
        );

        const loader = createContentLoader();
        await expect(
            loader.load([
                { type: 'directory', path: tmpDir },
                {
                    type: 'inline',
                    collectionType: 'damage-types',
                    items: [{ id: 'fire', name: 'Fire (dup)' }],
                },
            ]),
        ).rejects.toThrow(ContentConflictError);
    });
});

describe('ContentLoader — schema validation on directory source', () => {
    it('throws ContentSchemaError when a directory-loaded item fails schema', async () => {
        const dtDir = path.join(tmpDir, 'damage-types');
        await fs.mkdir(dtDir);
        // Missing required 'name' field
        await fs.writeFile(path.join(dtDir, 'fire.json'), JSON.stringify({ id: 'fire' }));

        const DamageTypeSchema = z.object({ id: z.string(), name: z.string() });
        await expect(
            createContentLoader().load([{ type: 'directory', path: tmpDir }], {
                schemas: { 'damage-types': DamageTypeSchema },
            }),
        ).rejects.toThrow(ContentSchemaError);
    });
});

describe('ContentLoader — deterministic load order (H6)', () => {
    it('loads subdirectory items in alphabetical order regardless of filesystem order', async () => {
        const dtDir = path.join(tmpDir, 'damage-types');
        await fs.mkdir(dtDir);
        // Write in reverse alphabetical order
        await fs.writeFile(
            path.join(dtDir, 'physical.json'),
            JSON.stringify({ id: 'physical', name: 'Physical' }),
        );
        await fs.writeFile(
            path.join(dtDir, 'fire.json'),
            JSON.stringify({ id: 'fire', name: 'Fire' }),
        );
        await fs.writeFile(
            path.join(dtDir, 'cold.json'),
            JSON.stringify({ id: 'cold', name: 'Cold' }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        expect(db.getAllIds('damage-types')).toEqual(['cold', 'fire', 'physical']);
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
                        collectionType: 'damage-types',
                        items: [{ id: 'fire', name: 'Fire' }],
                    },
                    {
                        type: 'inline',
                        collectionType: 'abilities',
                        items: [{ id: 'strike', damageType: 'damage-types:poison' }],
                    },
                ],
                { validateRefs: true },
            ),
        ).rejects.toThrow(UnknownDataRefError);
    });
});
