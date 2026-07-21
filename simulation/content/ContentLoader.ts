// simulation/content/ContentLoader.ts
// §4.8 — Loads JSON content sources, validates, merges, and builds ContentDatabase.
//
// Supported source formats:
//   directory  — scans for <collection>/<id>.json (one-per-item) and
//                <collection>.json (flat array) entries
//   inline     — accepts a pre-parsed DataObject[] array (testing / programmatic)
//
// Invariants:
//   #14 — schemas AND refs are validated on every load (refs by default, see
//         ContentLoadOptions.validateRefs); a failed load throws and never
//         produces a partial DB silently
//   #15 — only .json files are read; executable code in data dirs is never executed
//   #13 — returned ContentDatabase is deeply immutable (via createContentDatabase)

import { promises as fs } from 'fs';
import path from 'path';
import type { ZodType } from 'zod';
import {
    ContentConflictError,
    ContentSchemaError,
    ITEM_ID_SHAPE,
    UnknownDataRefError,
    assertValidItemId,
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
     * When enabled, every `DataRef`-shaped string value in every item is checked
     * against the final database.  A ref that points to a non-existent item
     * throws `UnknownDataRefError`.
     *
     * Ref detection: any string value of the form `"<collectionType>:<id>"`
     * where `collectionType` is a known collection in the database and `<id>`
     * satisfies the enforced item-id grammar (see `walkForRefs`).
     *
     * **Defaults to `true`** — Invariant #14 requires refs validated before the
     * tick loop, so every production load checks them without opting in. Pass
     * `false` only for a deliberately partial load whose refs resolve against a
     * database this call does not build (e.g. staged base/expansion loads).
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
     * @throws {ContentSchemaError}    A registered Zod schema rejected an item,
     *   or an item id violates {@link ITEM_ID_SHAPE} — which fires even for a
     *   collection with no registered schema.
     * @throws {UnknownDataRefError}   A ref points nowhere (unless `validateRefs: false`).
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

            const db = createContentDatabase(
                Array.from(collections.entries()).map(([collectionType, items]) => ({
                    collectionType,
                    items: Array.from(items.values()),
                })),
            );

            // Ref-integrity check (runs after all sources are merged). On by
            // default — Invariant #14; `validateRefs: false` is the explicit
            // opt-out for a deliberately partial load.
            if (options.validateRefs !== false) {
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
 * Throws `ContentSchemaError` when an id is missing, non-string, or violates
 * {@link ITEM_ID_SHAPE}.
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
        // The property's home is `createContentDatabase` (Invariant #14's
        // precondition), which would catch every case below. Calling the same
        // assertion here — rather than restating the rule — buys exactly one
        // thing: it runs BEFORE the duplicate check, so two id-less items are
        // reported as malformed instead of as a `ContentConflictError` over a
        // Map keyed on `undefined`. Both throws are otherwise identical.
        assertValidItemId(collectionType, item.id);

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

            const jsonFiles = files.filter((f) => f.isFile() && f.name.endsWith('.json'));
            const items = await Promise.all(
                jsonFiles.map(async (file) => {
                    const filePath = path.join(collectionDir, file.name);
                    const raw = await fs.readFile(filePath, 'utf-8');
                    let parsed: DataObject & Record<string, unknown>;
                    try {
                        parsed = JSON.parse(raw) as DataObject & Record<string, unknown>;
                    } catch (err) {
                        throw new Error(
                            `Failed to parse JSON in ${filePath}: ${
                                err instanceof Error ? err.message : String(err)
                            }`,
                            { cause: err },
                        );
                    }
                    const expectedId = path.parse(file.name).name;
                    if (parsed.id !== expectedId) {
                        throw new ContentSchemaError(
                            collectionType,
                            expectedId,
                            new Error(
                                `Item id '${parsed.id}' does not match filename '${file.name}' (expected id '${expectedId}')`,
                            ),
                        );
                    }
                    return parsed;
                }),
            );

            mergeItems(collections, collectionType, items, options);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            // Flat-array format: <collection>.json at the directory root.
            const collectionType = entry.name.slice(0, -'.json'.length);
            const filePath = path.join(dirPath, entry.name);
            const raw = await fs.readFile(filePath, 'utf-8');
            let parsed: (DataObject & Record<string, unknown>)[];
            try {
                parsed = JSON.parse(raw) as (DataObject & Record<string, unknown>)[];
            } catch (err) {
                throw new Error(
                    `Failed to parse JSON in ${filePath}: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                    { cause: err },
                );
            }
            mergeItems(collections, collectionType, parsed, options);
        }
        // All other entry types (symlinks, etc.) are silently ignored.
    }
}

/**
 * Walk every item in every collection and check that all `DataRef`-shaped
 * string values (`"collectionType:id"`) resolve to a known item.
 *
 * Detection lives in {@link walkForRefs} — see it for the two conditions a
 * string must satisfy.  Everything else (timestamps, URLs, prose) is skipped.
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
 *
 * Every string reachable through object entries and array elements is examined
 * — **keys** as well as values, at any depth — because a map keyed by ref is a
 * legitimate way to author per-ref data.  Those two traversals are exactly what
 * JSON can express, so loaded content is covered in full; a shape only an
 * `inline` source can supply (a symbol key, a non-index property on an array, a
 * `Map`/`Set`'s contents) is not reached.
 *
 * A string is a ref candidate only when **both** halves qualify: the part left
 * of the first `:` exactly matches a known collection type, and the part right
 * of it matches {@link ITEM_ID_SHAPE}.  Everything else — timestamps, URLs,
 * prose — is skipped.
 *
 * The id half is tested against the *same* grammar `mergeItems` enforces on
 * every item id, which is what makes the second condition sound rather than a
 * guess: a string it rejects cannot name any item in the database, so skipping
 * it can never skip a resolvable ref.
 */
function walkForRefs(value: unknown, db: ContentDatabase, knownCollections: Set<string>): void {
    if (typeof value === 'string') {
        const colon = value.indexOf(':');
        if (colon > 0) {
            const collectionType = value.slice(0, colon);
            if (knownCollections.has(collectionType)) {
                const id = value.slice(colon + 1);
                if (ITEM_ID_SHAPE.test(id) && !db.has(collectionType, id)) {
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
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            // Keys are checked as well as values: a map-shaped field keyed by
            // ref (`resistances: { 'damage-types:fire': 50 }`) is a first-class
            // way to author per-ref data, and walking values alone would exempt
            // every ref written that way from the integrity check. An ordinary
            // field name contains no colon, so it exits at the first test.
            walkForRefs(k, db, knownCollections);
            walkForRefs(v, db, knownCollections);
        }
    }
}
