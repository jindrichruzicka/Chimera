// simulation/content/DataRef.ts
// §4.8 — Typed cross-collection reference primitive.
//
// A DataRef<T> is a branded string of the form "collection-type:item-id".
// The generic parameter T documents which DataObject type lives in the target
// collection; it is erased at runtime — the value is always a plain string.
//
// On the wire (JSON files) a DataRef is just a plain string, e.g.:
//   "damage-types:fire"
//   "abilities:taunt"
//
// Invariants: #1 (no renderer / DOM deps), #13 (pure type utility, no state).

// ---------------------------------------------------------------------------
// DataObject — base constraint for every content-database record
// ---------------------------------------------------------------------------

/** Minimum shape required of every data object stored in the ContentDatabase. */
export interface DataObject {
    readonly id: string;
}

// ---------------------------------------------------------------------------
// DataRef<T> — branded phantom type
// ---------------------------------------------------------------------------

/**
 * A branded string that represents a typed reference to an item in a specific
 * content collection.  The format is `"<collection-type>:<item-id>"`.
 *
 * The `_T` parameter is a phantom — it carries type information for callers
 * but has no runtime representation.  Passing a raw `string` where a
 * `DataRef<T>` is required is a TypeScript compile error.
 */
export type DataRef<_T extends DataObject = DataObject> = string & {
    readonly __dataRef: void;
};

// ---------------------------------------------------------------------------
// buildRef — safe factory
// ---------------------------------------------------------------------------

/**
 * Construct a `DataRef<T>` from its constituent parts.
 *
 * @param collectionType  The content collection, e.g. `"damage-types"`.
 * @param id              The item ID within that collection, e.g. `"fire"`.
 */
export function buildRef<T extends DataObject>(collectionType: string, id: string): DataRef<T> {
    if (collectionType.includes(':')) {
        throw new MalformedRefError(`${collectionType}:${id}`);
    }
    return `${collectionType}:${id}` as DataRef<T>;
}

// ---------------------------------------------------------------------------
// parseRef — decompose a DataRef
// ---------------------------------------------------------------------------

/**
 * Decompose a `DataRef` into its `collectionType` and `id` parts.
 *
 * @throws {MalformedRefError} When the ref does not contain a `:`, or when the
 *   colon appears at position 0 (empty collection type).
 */
export function parseRef(ref: DataRef): {
    readonly collectionType: string;
    readonly id: string;
} {
    const colon = ref.indexOf(':');
    if (colon < 1) throw new MalformedRefError(ref);
    return {
        collectionType: ref.slice(0, colon),
        id: ref.slice(colon + 1),
    };
}

// ---------------------------------------------------------------------------
// MalformedRefError
// ---------------------------------------------------------------------------

/**
 * Thrown by `parseRef` when a string does not conform to the
 * `"<collection-type>:<item-id>"` format.
 */
export class MalformedRefError extends Error {
    /** The raw string that could not be parsed. */
    public readonly ref: string;

    constructor(ref: string) {
        super(`DataRef '${ref}' is malformed — expected format: 'collection-type:item-id'`);
        this.name = 'MalformedRefError';
        this.ref = ref;
        // Maintain proper prototype chain in environments that transpile classes.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
