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
// ---------------------------------------------------------------------------

// Helper: build a simple database pre-seeded with two collections
function makeDb() {
    return createContentDatabase([
        {
            collectionType: 'damage-types',
            items: [
                { id: 'fire', name: 'Fire' },
                { id: 'cold', name: 'Cold' },
                { id: 'physical', name: 'Physical' },
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
        const item = db.getById('damage-types', 'fire');
        expect(item).toEqual({ id: 'fire', name: 'Fire' });
    });

    it('returns undefined for an unknown id in a known collection', () => {
        const db = makeDb();
        expect(db.getById('damage-types', 'lightning')).toBeUndefined();
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
        const item = db.getByIdOrThrow('damage-types', 'cold');
        expect(item).toEqual({ id: 'cold', name: 'Cold' });
    });

    it('throws UnknownDataRefError for an unknown id', () => {
        const db = makeDb();
        expect(() => db.getByIdOrThrow('damage-types', 'lightning')).toThrow(UnknownDataRefError);
    });

    it('throws UnknownDataRefError for an unknown collection', () => {
        const db = makeDb();
        expect(() => db.getByIdOrThrow('units', 'warrior')).toThrow(UnknownDataRefError);
    });

    it('includes the ref string in the UnknownDataRefError message', () => {
        const db = makeDb();
        expect(() => db.getByIdOrThrow('damage-types', 'lightning')).toThrow(
            /damage-types:lightning/,
        );
    });
});

// ---------------------------------------------------------------------------
// getAllIds
// ---------------------------------------------------------------------------

describe('ContentDatabase.getAllIds', () => {
    it('returns all ids in a known collection', () => {
        const db = makeDb();
        const ids = db.getAllIds('damage-types');
        expect([...ids].sort()).toEqual(['cold', 'fire', 'physical']);
    });

    it('returns an empty array for an unknown collection', () => {
        const db = makeDb();
        expect(db.getAllIds('units')).toEqual([]);
    });

    it('returns a readonly array', () => {
        const db = makeDb();
        const ids = db.getAllIds('damage-types');
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
        const ref = buildRef('damage-types', 'fire');
        const item = db.resolveRef(ref);
        expect(item).toEqual({ id: 'fire', name: 'Fire' });
    });

    it('throws UnknownDataRefError for a ref pointing to a missing item', () => {
        const db = makeDb();
        const ref = buildRef('damage-types', 'poison');
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
        expect(types).toEqual(['abilities', 'damage-types']);
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
        expect(db.has('damage-types', 'fire')).toBe(true);
    });

    it('returns false for an unknown id in a known collection', () => {
        const db = makeDb();
        expect(db.has('damage-types', 'lightning')).toBe(false);
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
});

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

describe('UnknownDataRefError', () => {
    it('is an instance of Error', () => {
        const err = new UnknownDataRefError('damage-types:lightning');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes .ref', () => {
        const err = new UnknownDataRefError('damage-types:lightning');
        expect(err.ref).toBe('damage-types:lightning');
    });

    it('has the exact §4.8 message', () => {
        const err = new UnknownDataRefError('damage-types:lightning');
        expect(err.message).toBe(
            "Cannot resolve DataRef 'damage-types:lightning': item not found in ContentDatabase",
        );
    });
});

describe('ContentConflictError', () => {
    it('is an instance of Error', () => {
        const err = new ContentConflictError('damage-types', 'fire');
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes .collectionType and .id', () => {
        const err = new ContentConflictError('damage-types', 'fire');
        expect(err.collectionType).toBe('damage-types');
        expect(err.id).toBe('fire');
    });

    it('has the exact §4.8 message', () => {
        const err = new ContentConflictError('damage-types', 'fire');
        expect(err.message).toBe(
            "Duplicate item id 'fire' in collection 'damage-types' across content sources",
        );
    });
});

describe('ContentSchemaError', () => {
    it('is an instance of Error', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('damage-types', 'fire', cause);
        expect(err).toBeInstanceOf(Error);
    });

    it('exposes .collectionType and .id', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('damage-types', 'fire', cause);
        expect(err.collectionType).toBe('damage-types');
        expect(err.id).toBe('fire');
    });

    it('has the exact §4.8 message', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('damage-types', 'fire', cause);
        expect(err.message).toBe("Schema validation failed for 'damage-types:fire'");
    });

    it('preserves the cause', () => {
        const cause = new Error('bad schema');
        const err = new ContentSchemaError('damage-types', 'fire', cause);
        expect(err.cause).toBe(cause);
    });
});
