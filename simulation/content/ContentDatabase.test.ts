import { describe, expect, it } from 'vitest';
import {
    ContentConflictError,
    ContentSchemaError,
    UnknownDataRefError,
    createContentDatabase,
} from './ContentDatabase';
import { buildRef, type DataObject } from './DataRef';

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
// Deep immutability (invariant #13) — nested objects and arrays are frozen too
//
// A shallow `Object.freeze(item)` leaves every nested object and array mutable,
// so "immutable after load" would hold exactly one level deep. Today's shipping
// content items are flat, so these tests are the only thing standing between a
// nested content field and a silently mutable ContentDatabase.
// ---------------------------------------------------------------------------

// Item with two levels of nesting: an object, an array of primitives, and an
// array of objects.
function makeNestedDb() {
    return createContentDatabase([
        {
            collectionType: 'units',
            items: [
                {
                    id: 'warrior',
                    stats: { hp: 10, armour: { physical: 2 } },
                    tags: ['melee', 'frontline'],
                    attacks: [{ name: 'slash', damage: 3 }],
                },
            ],
        },
    ]);
}

describe('ContentDatabase deep immutability (invariant #13)', () => {
    it('a nested object field cannot be mutated', () => {
        const item = makeNestedDb().getByIdOrThrow<
            DataObject & { stats: { hp: number; armour: { physical: number } } }
        >('units', 'warrior');
        expect(() => {
            item.stats.hp = 99;
        }).toThrow(TypeError);
        expect(item.stats.hp).toBe(10);
    });

    it('a doubly-nested object field cannot be mutated', () => {
        const item = makeNestedDb().getByIdOrThrow<
            DataObject & { stats: { armour: { physical: number } } }
        >('units', 'warrior');
        expect(() => {
            item.stats.armour.physical = 99;
        }).toThrow(TypeError);
        expect(item.stats.armour.physical).toBe(2);
    });

    it('a nested array cannot have an element replaced or appended', () => {
        const item = makeNestedDb().getByIdOrThrow<DataObject & { tags: string[] }>(
            'units',
            'warrior',
        );
        expect(() => {
            item.tags[0] = 'ranged';
        }).toThrow(TypeError);
        expect(() => item.tags.push('siege')).toThrow(TypeError);
        expect(item.tags).toEqual(['melee', 'frontline']);
    });

    it('objects inside a nested array cannot be mutated', () => {
        const item = makeNestedDb().getByIdOrThrow<
            DataObject & { attacks: { name: string; damage: number }[] }
        >('units', 'warrior');
        expect(() => {
            item.attacks[0]!.damage = 99;
        }).toThrow(TypeError);
        expect(item.attacks[0]!.damage).toBe(3);
    });

    it('freezes nested values of an item the caller already shallow-froze', () => {
        // `Object.isFrozen` is not a sound visited-marker: this item is already
        // frozen at the top level, but its array is not.
        const preFrozen = Object.freeze({ id: 'mage', tags: ['caster'] });
        const db = createContentDatabase([{ collectionType: 'units', items: [preFrozen] }]);
        const item = db.getByIdOrThrow<DataObject & { tags: string[] }>('units', 'mage');
        expect(() => {
            item.tags[0] = 'melee';
        }).toThrow(TypeError);
    });

    // `createContentDatabase` is documented for direct programmatic/test use, so
    // it can be handed values JSON could never produce. Those are outside the
    // freeze domain, but they must not blow up the load with an engine-internal
    // TypeError that names neither the collection nor the item.
    it('does not throw on a value outside the JSON domain (typed array)', () => {
        const lookup = new Uint8Array([1, 2, 3]);
        const empty = new Uint8Array();
        const db = createContentDatabase([
            { collectionType: 'units', items: [{ id: 'warrior', lookup, empty }] },
        ]);
        expect(db.has('units', 'warrior')).toBe(true);
        expect(Object.isFrozen(db.getById('units', 'warrior'))).toBe(true);
        // An array-buffer view is skipped outright — not frozen either. One rule
        // for every view rather than two, and the docs say so; pinned here so
        // they can be falsified. (`Object.freeze` throws only on a non-empty
        // view, so the empty one proves the skip is by kind, not by luck.)
        expect(Object.isFrozen(lookup)).toBe(false);
        expect(Object.isFrozen(empty)).toBe(false);
    });

    // The recursion domain is JSON. These pin each branch of that decision —
    // without them the whole plain-container check can be deleted and the suite
    // stays green.
    it('freezes a nested non-JSON container but does not walk it', () => {
        const inner = { hp: 10 };
        const nested = new Map([['a', inner]]);
        const db = createContentDatabase([
            { collectionType: 'units', items: [{ id: 'warrior', nested }] },
        ]);

        expect(Object.isFrozen(nested)).toBe(true);
        // Documented limit: a Map's entries are not own enumerable properties,
        // so freezing it does not make its contents immutable.
        expect(Object.isFrozen(inner)).toBe(false);
        expect(db.has('units', 'warrior')).toBe(true);
    });

    it('freezes a nested class instance but does not walk into it', () => {
        class Vec {
            constructor(public parts: { x: number }) {}
        }
        const pos = new Vec({ x: 1 });
        createContentDatabase([{ collectionType: 'units', items: [{ id: 'warrior', pos }] }]);

        expect(Object.isFrozen(pos)).toBe(true);
        // Deliberate: a class instance is outside the JSON content contract, so
        // the engine does not attempt deep immutability there.
        expect(Object.isFrozen(pos.parts)).toBe(false);
    });

    it('walks a nested null-prototype object', () => {
        const inner = { hp: 10 };
        const bare = Object.assign(Object.create(null) as Record<string, unknown>, { inner });
        createContentDatabase([{ collectionType: 'units', items: [{ id: 'warrior', bare }] }]);

        expect(Object.isFrozen(bare)).toBe(true);
        expect(Object.isFrozen(inner)).toBe(true);
    });

    it('terminates on a self-referential item instead of recursing forever', () => {
        const cyclic: DataObject & Record<string, unknown> = { id: 'loop' };
        cyclic['self'] = cyclic;
        const db = createContentDatabase([{ collectionType: 'units', items: [cyclic] }]);
        expect(Object.isFrozen(db.getById('units', 'loop'))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Item-id grammar (invariant #14's precondition)
//
// `ContentLoader` rejects a malformed id at merge time for a well-attributed
// error, but the grammar is a property of every ContentDatabase, not just
// loaded ones: ref detection is only sound because no item id can look like
// prose. Enforcing at the factory — the single funnel every construction path
// goes through, the same reasoning as the deep freeze — keeps that true for a
// database built directly, so a future ref check over a caller-supplied db
// cannot silently reopen the hole.
// ---------------------------------------------------------------------------

describe('createContentDatabase item-id grammar (invariant #14)', () => {
    it.each([
        ['whitespace', 'Fire Mage'],
        ['empty', ''],
        ['non-string', 42 as unknown as string],
    ])('rejects an item whose id is %s', (_label, id) => {
        expect(() => createContentDatabase([{ collectionType: 'units', items: [{ id }] }])).toThrow(
            ContentSchemaError,
        );
    });

    it.each([['warrior'], ['tier-1'], ['héro'], ['tier:elite']])(
        'accepts the legal id %s',
        (id) => {
            expect(
                createContentDatabase([{ collectionType: 'units', items: [{ id }] }]).has(
                    'units',
                    id,
                ),
            ).toBe(true);
        },
    );
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
        expect(err.message).toBe("Content validation failed for 'player-colors:blue'");
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
