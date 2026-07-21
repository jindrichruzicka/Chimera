import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContentConflictError, ContentSchemaError, UnknownDataRefError } from './ContentDatabase';
import { createContentLoader } from './ContentLoader';
import type { DataObject } from './DataRef';

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
    it('validates refs by default — a dangling DataRef rejects with no options passed', async () => {
        const loader = createContentLoader();
        // Invariant #14: refs are checked before the tick loop, so the default
        // production call — `load(sources, { schemas })` — must reject this.
        await expect(
            loader.load([
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
            ]),
        ).rejects.toThrow(UnknownDataRefError);
    });

    it('validateRefs: false explicitly opts out of the check', async () => {
        const loader = createContentLoader();
        // 'player-colors:teal' does not exist — the caller has declared this a
        // deliberately partial load.
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
                    items: [{ id: 'taunt', requiresColor: 'player-colors:teal' }],
                },
            ],
            { validateRefs: false },
        );
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

    // Invariant #13 holds all the way down, over the real JSON.parse path — a
    // shallow freeze would leave every nested object and array mutable.
    it('nested objects and arrays of a directory-loaded item are frozen too', async () => {
        const dir = path.join(tmpDir, 'units');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'warrior.json'),
            JSON.stringify({
                id: 'warrior',
                stats: { hp: 10, armour: { physical: 2 } },
                attacks: [{ name: 'slash', damage: 3 }],
            }),
        );

        const db = await createContentLoader().load([{ type: 'directory', path: tmpDir }]);
        const item = db.getByIdOrThrow<
            DataObject & {
                stats: { hp: number; armour: { physical: number } };
                attacks: { damage: number }[];
            }
        >('units', 'warrior');

        expect(() => {
            item.stats.hp = 99;
        }).toThrow(TypeError);
        expect(() => {
            item.stats.armour.physical = 99;
        }).toThrow(TypeError);
        expect(() => {
            item.attacks[0]!.damage = 99;
        }).toThrow(TypeError);
        expect(item.stats.hp).toBe(10);
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

    // Refs are now checked by default (Invariant #14), so this heuristic runs
    // over every game's content. Prose that happens to start with a collection
    // name must not become a fatal startup error.
    it('does not throw on prose whose prefix is a known collection ("units: 3 required")', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'units',
                items: [{ id: 'warrior', description: 'units: 3 required' }],
            },
        ]);
        expect(db.has('units', 'warrior')).toBe(true);
    });

    it('does not throw on a sentence containing a colon after a known collection name', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            {
                type: 'inline',
                collectionType: 'units',
                items: [{ id: 'warrior', hint: 'units:warrior and friends' }],
            },
        ]);
        expect(db.has('units', 'warrior')).toBe(true);
    });

    it('still throws for a well-formed ref id that resolves nowhere', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                {
                    type: 'inline',
                    collectionType: 'units',
                    items: [{ id: 'warrior', upgradesTo: 'units:champion' }],
                },
            ]),
        ).rejects.toThrow(UnknownDataRefError);
    });

    // A ref is just as legal as an object KEY as it is as a value — a
    // map-shaped field (`resistances: { 'damage-types:fire': 50 }`) is the
    // natural way to author per-ref data. Walking values only would exempt
    // every such ref from the integrity check.
    it('throws for a dangling ref used as an object key', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                { type: 'inline', collectionType: 'damage-types', items: [{ id: 'physical' }] },
                {
                    type: 'inline',
                    collectionType: 'units',
                    items: [{ id: 'warrior', resistances: { 'damage-types:fire': 50 } }],
                },
            ]),
        ).rejects.toThrow(UnknownDataRefError);
    });

    it('throws for a dangling ref key nested inside an array element', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                { type: 'inline', collectionType: 'damage-types', items: [{ id: 'physical' }] },
                {
                    type: 'inline',
                    collectionType: 'units',
                    items: [{ id: 'warrior', tiers: [{ mods: { 'damage-types:fire': 1 } }] }],
                },
            ]),
        ).rejects.toThrow(UnknownDataRefError);
    });

    it('accepts a resolvable ref used as an object key', async () => {
        const loader = createContentLoader();
        const db = await loader.load([
            { type: 'inline', collectionType: 'damage-types', items: [{ id: 'fire' }] },
            {
                type: 'inline',
                collectionType: 'units',
                items: [{ id: 'warrior', resistances: { 'damage-types:fire': 50 } }],
            },
        ]);
        expect(db.has('units', 'warrior')).toBe(true);
    });

    // The id grammar is deliberately "any non-whitespace run", not a slug
    // allow-list: an id may be non-ASCII, dotted, or itself contain colons
    // (`parseRef` splits on the FIRST colon). Narrowing the grammar would make
    // dangling refs to those perfectly legal ids silently unvalidated.
    it.each([
        ['non-ASCII', 'units:héro'],
        ['colon-bearing (parseRef splits on the first colon)', 'units:tier:elite'],
        ['dotted', 'units:v1.0.0'],
        ['slash-bearing', 'units:squad/alpha'],
    ])('still throws for a dangling %s id', async (_label, ref) => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                { type: 'inline', collectionType: 'units', items: [{ id: 'warrior', ref }] },
            ]),
        ).rejects.toThrow(UnknownDataRefError);
    });
});

// ─── Item-id grammar (the precondition ref detection relies on) ───────────────
//
// Ref detection can only treat `"<collection>:<id>"` as a ref when the id half
// is distinguishable from prose. That is sound only if no legal item id can
// look like prose — so the grammar is ENFORCED here rather than assumed. A game
// that ids an item `"Fire Mage"` would otherwise get NO ref validation for it:
// both a correct and a dangling `"units:Fire Mage"` would be skipped as prose.

describe('ContentLoader — item id grammar (Invariant #14 precondition)', () => {
    it.each([
        ['whitespace', 'Fire Mage'],
        ['a tab', 'fire\tmage'],
        ['empty', ''],
        ['whitespace-only', '   '],
    ])('rejects an inline item whose id is %s', async (_label, id) => {
        const loader = createContentLoader();
        await expect(
            loader.load([{ type: 'inline', collectionType: 'units', items: [{ id }] }]),
        ).rejects.toThrow(ContentSchemaError);
    });

    // The only behaviour the merge-time check adds over the factory's: it runs
    // BEFORE the duplicate check, so two items that both lack an id are
    // reported as malformed rather than as a `ContentConflictError` over a Map
    // keyed on `undefined`. Delete the merge-time check and this flips.
    it('reports two id-less items in one source as malformed, not as a duplicate', async () => {
        const loader = createContentLoader();
        const err = await loader
            .load([
                {
                    type: 'inline',
                    collectionType: 'units',
                    items: [{}, {}] as unknown as { id: string }[],
                },
            ])
            .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(ContentSchemaError);
        expect(err).not.toBeInstanceOf(ContentConflictError);
    });

    it('rejects an item whose id is not a string', async () => {
        const loader = createContentLoader();
        await expect(
            loader.load([
                {
                    type: 'inline',
                    collectionType: 'units',
                    // Untyped JSON can carry anything; the cast mirrors what a
                    // hand-authored data file would deliver at runtime.
                    items: [{ id: 42 } as unknown as { id: string }],
                },
            ]),
        ).rejects.toThrow(ContentSchemaError);
    });

    it('rejects a directory-loaded item whose id contains whitespace', async () => {
        const dir = path.join(tmpDir, 'units');
        await fs.mkdir(dir);
        await fs.writeFile(
            path.join(dir, 'Fire Mage.json'),
            JSON.stringify({ id: 'Fire Mage', name: 'Fire Mage' }),
        );

        await expect(
            createContentLoader().load([{ type: 'directory', path: tmpDir }]),
        ).rejects.toThrow(ContentSchemaError);
    });

    it.each([['warrior'], ['tier-1'], ['v1.0.0'], ['héro'], ['tier:elite'], ['squad/alpha']])(
        'accepts the legal id %s',
        async (id) => {
            const db = await createContentLoader().load([
                { type: 'inline', collectionType: 'units', items: [{ id }] },
            ]);
            expect(db.has('units', id)).toBe(true);
        },
    );
});
