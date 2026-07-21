// simulation/content/ContentDatabase.ts
// §4.8 — Immutable content database interface and in-memory implementation.
//
// ContentDatabase holds all static game-design data loaded from JSON files.
// It is read-only after creation — no mutation methods are exposed, and every
// item is frozen recursively so nested objects and arrays are immutable too.
// It is intentionally separate from GameSnapshot: game state lives in the
// snapshot; static definitions live here.
//
// Invariants: #13 (deeply immutable after load), #46 (optional in PipelineContext).

import { type DataObject, type DataRef, parseRef } from './DataRef';

// ---------------------------------------------------------------------------
// ContentDatabase interface
// ---------------------------------------------------------------------------

/**
 * Immutable query interface for all game-design content loaded from JSON.
 *
 * All methods are read-only — no mutation surface is exposed, and every item
 * they return is deeply frozen.
 * Invariant #13: never stored inside `GameSnapshot`.
 * Invariant #46: optional in `PipelineContext`; engines without content pass `undefined`.
 */
export interface ContentDatabase {
    // ── Direct access ──────────────────────────────────────────────────────
    /** Returns `undefined` when the item does not exist (safe lookup). */
    getById<T extends DataObject>(collectionType: string, id: string): T | undefined;
    /** Throws `UnknownDataRefError` when not found (use when absence is a logic error). */
    getByIdOrThrow<T extends DataObject>(collectionType: string, id: string): T;

    getAllIds(collectionType: string): readonly string[];
    getAll<T extends DataObject>(collectionType: string): readonly T[];

    // ── Reference resolution ───────────────────────────────────────────────
    /**
     * Parse `"collection-type:item-id"` → look up the collection → return the typed object.
     * @throws {UnknownDataRefError} when the ref cannot be resolved.
     * @throws {MalformedRefError} when the ref format is invalid.
     */
    resolveRef<T extends DataObject>(ref: DataRef<T>): T;

    // ── Introspection ──────────────────────────────────────────────────────
    collectionTypes(): readonly string[];
    has(collectionType: string, id: string): boolean;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when a `DataRef` or `(collectionType, id)` pair cannot be found in
 * the `ContentDatabase`.
 */
export class UnknownDataRefError extends Error {
    public readonly ref: string;

    constructor(ref: string) {
        super(`Cannot resolve DataRef '${ref}': item not found in ContentDatabase`);
        this.name = 'UnknownDataRefError';
        this.ref = ref;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown by `ContentLoader` when two content sources declare the same
 * `(collectionType, id)` pair — duplicate detection.
 */
export class ContentConflictError extends Error {
    public readonly collectionType: string;
    public readonly id: string;

    constructor(collectionType: string, id: string) {
        super(`Duplicate item id '${id}' in collection '${collectionType}' across content sources`);
        this.name = 'ContentConflictError';
        this.collectionType = collectionType;
        this.id = id;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Thrown when an item is rejected during loading, for either of two reasons:
 * a game-registered Zod schema refused it (`ContentLoader`), or its id violates
 * the engine-level {@link ITEM_ID_SHAPE} grammar (`createContentDatabase`, and
 * `ContentLoader` ahead of its duplicate check).
 *
 * The message deliberately says *content*, not *schema*: the id-grammar branch
 * fires for collections that have no registered schema at all, and naming Zod
 * there would send the reader hunting a schema they never wrote. Which of the
 * two it was is in `cause`.
 */
export class ContentSchemaError extends Error {
    public readonly collectionType: string;
    public readonly id: string;

    constructor(collectionType: string, id: string, cause: unknown) {
        super(`Content validation failed for '${collectionType}:${id}'`, { cause });
        this.name = 'ContentSchemaError';
        this.collectionType = collectionType;
        this.id = id;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

/**
 * Recursively freeze a loaded content item — Invariant #13 holds all the way
 * down, not one level deep. Runs once per item at load time, never per access.
 *
 * The visited marker is `seen`, deliberately not `Object.isFrozen`: a caller may
 * hand in an item it already shallow-froze, whose nested objects and arrays are
 * still mutable. `seen` also makes a self-referential item terminate.
 *
 * Content is JSON (Invariant #15), so plain objects and arrays are the whole
 * recursion domain — `Object.values` covers both. A value JSON cannot produce
 * (a `Map`, `Date` or class instance a programmatic caller passed in) is frozen
 * but not walked: it is outside the content contract, and the engine does not
 * attempt deep immutability there. For a `Map`/`Set`/`Date` the walk would buy
 * nothing — their contents are not own enumerable properties, and `map.set`
 * succeeds on a frozen `Map` regardless; for a class instance it would descend
 * into its fields and everything beneath them, deliberately not attempted.
 *
 * Array-buffer views are skipped entirely: `Object.freeze` throws on a
 * *non-empty* typed array, and skipping every view rather than only the
 * non-empty ones keeps one rule instead of two — either way the alternative is
 * an engine-internal `TypeError` naming neither the collection nor the item.
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || typeof value !== 'object') return value;
    const obj: object = value;
    if (seen.has(obj) || ArrayBuffer.isView(obj)) return value;
    seen.add(obj);
    Object.freeze(obj);
    if (!isPlainJsonContainer(obj)) return value;
    for (const nested of Object.values(obj)) deepFreeze(nested, seen);
    return value;
}

/** An array or a plain object — the two containers `JSON.parse` can produce. */
function isPlainJsonContainer(obj: object): boolean {
    if (Array.isArray(obj)) return true;
    const proto: unknown = Object.getPrototypeOf(obj);
    // The `null` arm is for `Object.create(null)`, not for JSON: `JSON.parse`
    // gives a `"__proto__"` key an own enumerable data property on an
    // ordinary `Object.prototype` object, so it is walked and frozen like any
    // other field.
    return proto === Object.prototype || proto === null;
}

/**
 * The grammar every item id must obey — a non-empty run of non-whitespace.
 *
 * Deliberately permissive about *which* characters (non-ASCII, dots, slashes
 * and colons are all legal ids; `parseRef` splits a `DataRef` on its FIRST
 * colon) and strict about one thing: no whitespace. That single restriction is
 * what makes a `DataRef` distinguishable from prose in untyped JSON, so
 * `ContentLoader`'s ref check is sound rather than a guess — an id like
 * `"Fire Mage"` would otherwise be legal *and* unreferenceable, silently
 * exempting that item from the integrity Invariant #14 promises.
 *
 * Exported so a game can reuse it in its own Zod id schema.
 */
export const ITEM_ID_SHAPE = /^\S+$/;

/**
 * Reject an id that cannot be referenced (Invariant #14's precondition).
 * Enforced at `createContentDatabase`, the single factory every construction
 * path funnels through, so the property holds for a directly-built database too
 * — not only for one `ContentLoader` produced.
 *
 * Exported (module-internally — not through the package barrel) so
 * `ContentLoader` can run the same check earlier without restating the rule or
 * its message; see the call site there for why an earlier copy exists at all.
 */
export function assertValidItemId(collectionType: string, id: unknown): asserts id is string {
    if (typeof id !== 'string' || !ITEM_ID_SHAPE.test(id)) {
        throw new ContentSchemaError(
            collectionType,
            String(id),
            new Error(
                `Item id ${JSON.stringify(id)} is not a valid id: expected a non-empty string with no whitespace`,
            ),
        );
    }
}

/** Shape accepted by `createContentDatabase` to seed a single collection. */
export interface ContentCollection {
    readonly collectionType: string;
    // Items must carry at minimum an `id` field; additional game-defined fields
    // are preserved as-is in the database.
    readonly items: readonly (DataObject & Record<string, unknown>)[];
}

/**
 * Create an immutable `ContentDatabase` from a list of pre-populated
 * collections.
 *
 * This is the primary factory used by `ContentLoader` after it has parsed and
 * validated all JSON sources. It can also be used directly in unit tests to
 * construct a database without touching the filesystem.
 *
 * Items are expected to be JSON-shaped (Invariant #15) — plain objects, arrays
 * and primitives. That is what the deep freeze backing Invariant #13 walks.
 * Outside that domain it does less, in two steps: a `Map`, `Date` or class
 * instance is frozen but not walked, so its contents stay mutable, and an
 * array-buffer view is skipped entirely — neither frozen nor walked, because
 * `Object.freeze` throws on a non-empty typed array. See `deepFreeze` above.
 */
export function createContentDatabase(collections: readonly ContentCollection[]): ContentDatabase {
    const store = new Map<string, Map<string, DataObject>>();

    for (const { collectionType, items } of collections) {
        const col = store.get(collectionType) ?? new Map<string, DataObject>();
        for (const item of items) {
            assertValidItemId(collectionType, item.id);
            if (col.has(item.id)) {
                throw new ContentConflictError(collectionType, item.id);
            }
            col.set(item.id, deepFreeze(item));
        }
        store.set(collectionType, col);
    }

    // `store` and its collection maps are deliberately left unfrozen: they are
    // closure-private and unreachable from the returned interface, and both
    // `getAll` and `getAllIds` hand back a fresh array on every call.

    // Return a frozen plain object — no class, no mutation methods.
    const db: ContentDatabase = {
        getById<T extends DataObject>(collectionType: string, id: string): T | undefined {
            return store.get(collectionType)?.get(id) as T | undefined;
        },

        getByIdOrThrow<T extends DataObject>(collectionType: string, id: string): T {
            const item = store.get(collectionType)?.get(id);
            if (item === undefined) {
                throw new UnknownDataRefError(`${collectionType}:${id}`);
            }
            return item as T;
        },

        getAllIds(collectionType: string): readonly string[] {
            const col = store.get(collectionType);
            if (col === undefined) return [];
            return Array.from(col.keys());
        },

        getAll<T extends DataObject>(collectionType: string): readonly T[] {
            const col = store.get(collectionType);
            if (col === undefined) return [];
            return Array.from(col.values()) as T[];
        },

        resolveRef<T extends DataObject>(ref: DataRef<T>): T {
            const { collectionType, id } = parseRef(ref);
            const item = store.get(collectionType)?.get(id);
            if (item === undefined) {
                throw new UnknownDataRefError(ref);
            }
            return item as T;
        },

        collectionTypes(): readonly string[] {
            return Array.from(store.keys());
        },

        has(collectionType: string, id: string): boolean {
            return store.get(collectionType)?.has(id) ?? false;
        },
    };

    return Object.freeze(db);
}

// Re-export DataObject so callers don't need to import from DataRef directly.
export type { DataObject };
