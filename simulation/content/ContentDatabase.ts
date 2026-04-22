// simulation/content/ContentDatabase.ts
// §4.8 — Immutable content database interface and in-memory implementation.
//
// ContentDatabase holds all static game-design data loaded from JSON files.
// It is read-only after creation — no mutation methods are exposed.
// It is intentionally separate from GameSnapshot: game state lives in the
// snapshot; static definitions live here.
//
// Invariants: #13 (immutable after load), #46 (optional in PipelineContext).

import { type DataObject, type DataRef, parseRef } from './DataRef';

// ---------------------------------------------------------------------------
// ContentDatabase interface
// ---------------------------------------------------------------------------

/**
 * Immutable query interface for all game-design content loaded from JSON.
 *
 * All methods are read-only — no mutation surface is exposed.
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
 * Thrown by `ContentLoader` when a Zod schema rejects an item during loading.
 */
export class ContentSchemaError extends Error {
    public readonly collectionType: string;
    public readonly id: string;

    constructor(collectionType: string, id: string, cause: unknown) {
        super(`Schema validation failed for '${collectionType}:${id}'`);
        this.name = 'ContentSchemaError';
        this.collectionType = collectionType;
        this.id = id;
        this.cause = cause;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

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
 */
export function createContentDatabase(collections: readonly ContentCollection[]): ContentDatabase {
    // Build an immutable Map<collectionType, Map<id, DataObject>>
    const store = new Map<string, Map<string, DataObject>>();

    for (const { collectionType, items } of collections) {
        const col = store.get(collectionType) ?? new Map<string, DataObject>();
        for (const item of items) {
            if (col.has(item.id)) {
                throw new ContentConflictError(collectionType, item.id);
            }
            col.set(item.id, Object.freeze(item));
        }
        store.set(collectionType, col);
    }

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
            // parseRef throws MalformedRefError if format is invalid
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
