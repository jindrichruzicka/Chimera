import { describe, expect, it } from 'vitest';
import {
    ContentConflictError,
    ContentSchemaError,
    UnknownDataRefError,
    createContentDatabase,
} from './ContentDatabase';
import { buildRef } from './DataRef';

// ---------------------------------------------------------------------------
// ContentDatabase — in-memory implementation
// §4.8 — simulation/content/ContentDatabase.ts
//
// `player-colors` is used here only as a sample collection; the database is
// generic and stores any `{ id, ... }` items.
// ---------------------------------------------------------------------------

// Helper: build a simple database pre-seeded with two collections
function makeDb() {
    return createContentDatabase([
        {
            collectionType: 'player-colors',
            items: [
                { id: 'blue', name: 'Blue' },
                { id: 'red', name: 'Red' },
                { id: 'green', name: 'Green' },
            ],
        },
        {
            collectionType: 'abilities',
            items: [
                { id: 'taunt', description: 'Force enemies to attack' },
                { id: 'rally', description: 'Buff nearby allies' },
            ],
        },
    ]);
}

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe('ContentDatabase.getById', () => {
    it('returns the item when the collection and id both exist', () => {
        const db = makeDb();
        const item = db.getById('player-colors', 'blue');
        expect(item).toEqual({ id: 'blue', name: 'Blue' });
    });

    it('returns undefined for an unknown id in a known collection', () => {
        const db = makeDb();
        expect(db.getById('player-colors', 'teal')).toBeUndefined();
    });

    it('returns undefined for an unknown collection type', () => {
        const db = makeDb();
        expect(db.getById('units', 'warrior')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// getByIdOrThrow
// ---------------------------------------------------------------------------

describe('ContentDatabase.getByIdOrThrow', () => {
    it('returns the item when found', () => {
        const db = makeDb();
        const item = db.getByIdOrThrow('player-colors', 'red');
        expect(item).toEqual({ id: 'red', name: 'Red' });
    });

    it('throws UnknownDataRefError for an unknown id', () => {
        const db = makeDb();
        expect(() => db.getByIdOrThrow('player-colors', 'teal')).toThrow(UnknownDataRefError);
    });

    it('throws UnknownDataRefError for an unknown collection', () => {
        const db = makeDb();
        expect(() => db.getByIdOrThrow('units', 'warrior')).toThrow(UnknownDataRefError);
    });

    it('includes the ref string in the UnknownDataRefError message', () => {
        const db = makeDb();
        expect(() => db.getByIdOrThrow('player-colors', 'teal')).toThrow(/player-colors:teal/);
    });
});

// ---------------------------------------------------------------------------
// getAllIds
// ---------------------------------------------------------------------------

describe('ContentDatabase.getAllIds', () => {
    it('returns all ids in a known collection', () => {
        const db = makeDb();
        const ids = db.getAllIds('player-colors');
        expect([...ids].sort()).toEqual(['blue', 'green', 'red']);
    });

    it('returns an empty array for an unknown collection', () => {
        const db = makeDb();
        expect(db.getAllIds('units')).toEqual([]);
    });

    it('returns a readonly array', () => {
        const db = makeDb();
        const ids = db.getAllIds('player-colors');
        // readonly — TypeScript enforces this; at runtime it is still an array
        expect(Array.isArray(ids)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getAll
// ---------------------------------------------------------------------------

describe('ContentDatabase.getAll', () => {
    it('returns all items in a known collection', () => {
        const db = makeDb();
        const items = db.getAll('abilities');
        expect(items).toHaveLength(2);
        const ids = items.map((i) => i.id).sort();
        expect(ids).toEqual(['rally', 'taunt']);
    });

    it('returns an empty array for an unknown collection', () => {
        const db = makeDb();
        expect(db.getAll('units')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// resolveRef
// ---------------------------------------------------------------------------

describe('ContentDatabase.resolveRef', () => {
    it('resolves a known DataRef to its object', () => {
        const db = makeDb();
        const ref = buildRef('player-colors', 'blue');
        const item = db.resolveRef(ref);
        expect(item).toEqual({ id: 'blue', name: 'Blue' });
    });

    it('throws UnknownDataRefError for a ref pointing to a missing item', () => {
        const db = makeDb();
        const ref = buildRef('player-colors', 'teal');
        expect(() => db.resolveRef(ref)).toThrow(UnknownDataRefError);
    });

    it('throws UnknownDataRefError for a ref pointing to a missing collection', () => {
        const db = makeDb();
        const ref = buildRef('units', 'warrior');
        expect(() => db.resolveRef(ref)).toThrow(UnknownDataRefError);
    });
});

// ---------------------------------------------------------------------------
// collectionTypes
// ---------------------------------------------------------------------------

describe('ContentDatabase.collectionTypes', () => {
    it('returns all registered collection type names', () => {
        const db = makeDb();
        const types = [...db.collectionTypes()].sort();
        expect(types).toEqual(['abilities', 'player-colors']);
    });

    it('returns an empty array when the database has no collections', () => {
        const db = createContentDatabase([]);
        expect(db.collectionTypes()).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// has
// ---------------------------------------------------------------------------

describe('ContentDatabase.has', () => {
    it('returns true when the item exists', () => {
        const db = makeDb();
        expect(db.has('player-colors', 'blue')).toBe(true);
    });

    it('returns false for an unknown id in a known collection', () => {
        const db = makeDb();
        expect(db.has('player-colors', 'teal')).toBe(false);
    });

    it('returns false for an unknown collection', () => {
        const db = makeDb();
        expect(db.has('units', 'warrior')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Immutability — the returned object has no mutation methods
// ---------------------------------------------------------------------------

describe('ContentDatabase immutability', () => {
    it('exposes only the documented query methods — no mutation surface', () => {
        const db = makeDb();
        expect(typeof db.getById).toBe('function');
        expect(typeof db.getByIdOrThrow).toBe('function');
        expect(typeof db.getAllIds).toBe('function');
        expect(typeof db.getAll).toBe('function');
        expect(typeof db.resolveRef).toBe('function');
        expect(typeof db.collectionTypes).toBe('function');
        expect(typeof db.has).toBe('function');
        // No mutation methods
        // as unknown as Record is safe here: we are intentionally probing the
        // runtime shape of the frozen object to verify no mutation methods exist.
        const dbAsRecord = db as unknown as Record<string, unknown>;
        expect(dbAsRecord['set']).toBeUndefined();
        expect(dbAsRecord['add']).toBeUndefined();
        expect(dbAsRecord['delete']).toBeUndefined();
        expect(dbAsRecord['clear']).toBeUndefined();
    });

    it('the db object itself is frozen (Object.isFrozen)', () => {
        const db = makeDb();
        expect(Object.isFrozen(db)).toBe(true);
    });

    it('items retrieved via getById are frozen (invariant #13)', () => {
        const db = makeDb();
        const item = db.getById('player-colors', 'blue');
        expect(Object.isFrozen(item)).toBe(true);
    });

    it('items retrieved via getAll are frozen', () => {
        const db = makeDb();
        const items = db.getAll('abilities');
        for (const item of items) {
            expect(Object.isFrozen(item)).toBe(true);
        }
    });

    it('items retrieved via resolveRef are frozen', () => {
        const db = makeDb();
        const ref = buildRef('player-colors', 'blue');
        const item = db.resolveRef(ref);
        expect(Object.isFrozen(item)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// createContentDatabase — factory
// ---------------------------------------------------------------------------

describe('createContentDatabase', () => {
    it('accepts an empty collection list', () => {
        const db = createContentDatabase([]);
        expect(db.collectionTypes()).toEqual([]);
    });

    it("accepts items with extra fields beyond 'id'", () => {
        const db = createContentDatabase([
            {
                collectionType: 'units',
                items: [{ id: 'warrior', hp: 120, speed: 3 }],
            },
        ]);
        expect(db.getById('units', 'warrior')).toEqual({
            id: 'warrior',
            hp: 120,
            speed: 3,
        });
    });

    it('throws ContentConflictError on duplicate id within a single items array', () => {
        expect(() =>
            createContentDatabase([
                {
                    collectionType: 'player-colors',
                    items: [
                        { id: 'blue', name: 'Blue' },
                        { id: 'blue', name: 'Blue (dup)' },
                    ],
                },
            ]),
        ).toThrow(ContentConflictError);
    });

    it('throws ContentConflictError when two ContentCollection entries share a collectionType and duplicate id', () => {
        expect(() =>
            createContentDatabase([
                {
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue' }],
                },
                {
                    collectionType: 'player-colors',
                    items: [{ id: 'blue', name: 'Blue (dup)' }],
                },
            ]),
        ).toThrow(ContentConflictError);
    });

    it('ContentConflictError from createContentDatabase includes collectionType and id', () => {
        try {
            createContentDatabase([
                {
                    collectionType: 'player-colors',
                    items: [
                        { id: 'blue', name: 'Blue' },
                        { id: 'blue', name: 'Dup' },
                    ],
                },
            ]);
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(ContentConflictError);
            const e = err as ContentConflictError;
            expect(e.collectionType).toBe('player-colors');
            expect(e.id).toBe('blue');
        }
    });
});

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

describe('UnknownDataRefError', () => {
    it('is an instance of Error', () => {
        const err = new UnknownDataRefError('player-colors:teal');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes .ref', () => {
        const err = new UnknownDataRefError('player-colors:teal');
        expect(err.ref).toBe('player-colors:teal');
    });

    it('has the exact §4.8 message', () => {
        const err = new UnknownDataRefError('player-colors:teal');
        expect(err.message).toBe(
            "Cannot resolve DataRef 'player-colors:teal': item not found in ContentDatabase",
        );
    });
});

describe('ContentConflictError', () => {
    it('is an instance of Error', () => {
        const err = new ContentConflictError('player-colors', 'blue');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes .collectionType and .id', () => {
        const err = new ContentConflictError('player-colors', 'blue');
        expect(err.collectionType).toBe('player-colors');
        expect(err.id).toBe('blue');
    });

    it('has the exact §4.8 message', () => {
        const err = new ContentConflictError('player-colors', 'blue');
        expect(err.message).toBe(
            "Duplicate item id 'blue' in collection 'player-colors' across content sources",
        );
    });
});

describe('ContentSchemaError', () => {
    it('is an instance of Error', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('player-colors', 'blue', cause);
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes .collectionType and .id', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('player-colors', 'blue', cause);
        expect(err.collectionType).toBe('player-colors');
        expect(err.id).toBe('blue');
    });

    it('has the exact §4.8 message', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('player-colors', 'blue', cause);
        expect(err.message).toBe("Schema validation failed for 'player-colors:blue'");
    });

    it('preserves the cause', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('player-colors', 'blue', cause);
        expect(err.cause).toBe(cause);
    });

    it('cause is set via super() options and is non-enumerable (M1)', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('player-colors', 'blue', cause);
        // When cause is passed through super(msg, { cause }), it is a non-enumerable
        // own property set by the Error constructor — not visible in Object.keys().
        expect(Object.keys(err)).not.toContain('cause');
        // But it must still be accessible.
        expect(err.cause).toBe(cause);
    });
});
