// simulation/content/ContentLoader.ts
// §4.8 — Loads JSON content sources, validates, merges, and builds ContentDatabase.
//
// Supported source formats:
//   directory  — scans for <collection>/<id>.json (one-per-item) and
//                <collection>.json (flat array) entries
//   inline     — accepts a pre-parsed DataObject[] array (testing / programmatic)
//
// Invariants:
//   #14 — failed load throws; never produces a partial DB silently
//   #15 — only .json files are read; executable code in data dirs is never executed
//   #13 — returned ContentDatabase is immutable (via createContentDatabase)

import { promises as fs } from 'fs';
import path from 'path';
import type { ZodType } from 'zod';
import {
    ContentConflictError,
    ContentSchemaError,
    UnknownDataRefError,
    createContentDatabase,
    type ContentDatabase,
} from './ContentDatabase';
import { type DataObject } from './DataRef';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A content source that the loader can consume.
 *
 * - `directory` — the loader scans the given directory path for JSON files.
 * - `inline`    — a pre-parsed array of items (useful in tests / programmatic use).
 */
export type ContentSource =
    | { type: 'directory'; path: string }
    | { type: 'inline'; collectionType: string; items: (DataObject & Record<string, unknown>)[] };

/**
 * Options that control schema validation and ref-integrity checking.
 */
export interface ContentLoadOptions {
    /**
     * Per-collection Zod schema validators.
     * When provided, each item is validated with `schema.safeParse()` after parsing.
     * Items that fail validation throw `ContentSchemaError`.
     */
    schemas?: Partial<Record<string, ZodType>>;
    /**
     * When `true`, every `DataRef`-shaped string value in every item is checked
     * against the final database.  A ref that points to a non-existent item
     * throws `UnknownDataRefError`.
     *
     * Ref detection: any string value of the form `"<collectionType>:<id>"`
     * where `collectionType` is a known collection in the database.
     *
     * Defaults to `false`.
     */
    validateRefs?: boolean;
}

/**
 * Loads and merges one or more content sources into a single immutable
 * `ContentDatabase`.
 */
export interface ContentLoader {
    /**
     * Load and merge sources in order.  Later sources can add items to
     * collections already introduced by earlier sources.
     *
     * @throws {ContentConflictError}  Duplicate `(collectionType, id)` across sources.
     * @throws {ContentSchemaError}    A Zod schema rejected an item.
     * @throws {UnknownDataRefError}   `validateRefs: true` and a ref points nowhere.
     */
    load(sources: ContentSource[], options?: ContentLoadOptions): Promise<ContentDatabase>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a `ContentLoader` instance. */
export function createContentLoader(): ContentLoader {
    return {
        async load(
            sources: ContentSource[],
            options: ContentLoadOptions = {},
        ): Promise<ContentDatabase> {
            // Accumulate items per collection, preserving insertion order.
            const collections = new Map<
                string,
                Map<string, DataObject & Record<string, unknown>>
            >();

            for (const source of sources) {
                if (source.type === 'inline') {
                    mergeItems(collections, source.collectionType, source.items, options);
                } else {
                    await loadDirectory(collections, source.path, options);
                }
            }

            // Build the immutable database.
            const db = createContentDatabase(
                Array.from(collections.entries()).map(([collectionType, items]) => ({
                    collectionType,
                    items: Array.from(items.values()),
                })),
            );

            // Optional ref-integrity check (runs after all sources are merged).
            if (options.validateRefs === true) {
                checkRefs(db);
            }

            return db;
        },
    };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Merge a flat list of items into the mutable accumulator map.
 * Throws `ContentConflictError` on duplicate `(collectionType, id)`.
 */
function mergeItems(
    collections: Map<string, Map<string, DataObject & Record<string, unknown>>>,
    collectionType: string,
    items: (DataObject & Record<string, unknown>)[],
    options: ContentLoadOptions,
): void {
    let col = collections.get(collectionType);
    if (col === undefined) {
        col = new Map();
        collections.set(collectionType, col);
    }

    for (const item of items) {
        if (col.has(item.id)) {
            throw new ContentConflictError(collectionType, item.id);
        }

        // Schema validation (if a schema is registered for this collection).
        const schema = options.schemas?.[collectionType];
        if (schema !== undefined) {
            const result = schema.safeParse(item);
            if (!result.success) {
                throw new ContentSchemaError(collectionType, item.id, result.error);
            }
        }

        col.set(item.id, item);
    }
}

/**
 * Scan a directory and merge its contents into the accumulator.
 *
 * Recognises two layouts:
 *   `<dir>/<collection>/`  — each `*.json` file is one item (filename = id)
 *   `<dir>/<collection>.json` — flat array of items
 */
async function loadDirectory(
    collections: Map<string, Map<string, DataObject & Record<string, unknown>>>,
    dirPath: string,
    options: ContentLoadOptions,
): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (entry.isDirectory()) {
            // One-file-per-item format: subdirectory name = collection type.
            const collectionType = entry.name;
            const collectionDir = path.join(dirPath, entry.name);
            const files = await fs.readdir(collectionDir, {
                withFileTypes: true,
            });
            files.sort((a, b) => a.name.localeCompare(b.name));

            const items: (DataObject & Record<string, unknown>)[] = [];
            for (const file of files) {
                if (!file.isFile() || !file.name.endsWith('.json')) continue;
                const filePath = path.join(collectionDir, file.name);
                const raw = await fs.readFile(filePath, 'utf-8');
                const parsed = JSON.parse(raw) as DataObject & Record<string, unknown>;
                items.push(parsed);
            }

            mergeItems(collections, collectionType, items, options);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            // Flat-array format: <collection>.json at the directory root.
            const collectionType = entry.name.slice(0, -'.json'.length);
            const filePath = path.join(dirPath, entry.name);
            const raw = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(raw) as (DataObject & Record<string, unknown>)[];
            mergeItems(collections, collectionType, parsed, options);
        }
        // All other entry types (symlinks, etc.) are silently ignored.
    }
}

/**
 * Walk every item in every collection and check that all `DataRef`-shaped
 * string values (`"collectionType:id"`) resolve to a known item.
 *
 * Detection: a string is treated as a DataRef candidate only when its left
 * side of the first `:` exactly matches a collection type that exists in the
 * database.  Other colon-containing strings (timestamps, URLs, etc.) are
 * silently skipped.
 *
 * @throws {UnknownDataRefError} When a ref points to a non-existent item in
 *   a known collection.
 */
function checkRefs(db: ContentDatabase): void {
    const knownCollections = new Set(db.collectionTypes());
    for (const collectionType of db.collectionTypes()) {
        for (const item of db.getAll(collectionType)) {
            walkForRefs(item, db, knownCollections);
        }
    }
}

/**
 * Recursively walk a plain object / array looking for DataRef-shaped strings.
 */
function walkForRefs(value: unknown, db: ContentDatabase, knownCollections: Set<string>): void {
    if (typeof value === 'string') {
        const colon = value.indexOf(':');
        if (colon > 0) {
            const collectionType = value.slice(0, colon);
            if (knownCollections.has(collectionType)) {
                const id = value.slice(colon + 1);
                if (!db.has(collectionType, id)) {
                    throw new UnknownDataRefError(value);
                }
            }
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const element of value) {
            walkForRefs(element, db, knownCollections);
        }
        return;
    }

    if (value !== null && typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>)) {
            walkForRefs(v, db, knownCollections);
        }
    }
}
