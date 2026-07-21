---
title: 'Content Database and DataRefs'
description: 'DataRef<T> branded type, ContentDatabase interface, ContentLoader, JSON file layouts, the enforced item-id grammar, what load-time ref validation does and does not catch, usage in ActionDefinitions, and all content-related error types.'
tags: [content, database, data-refs, json, game-data, simulation]
---

# Content Database and DataRefs

> §4.8 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Asset Reference System](asset-reference-system.md)

---

## Design Rationale

Games need large sets of static, designer-authored data: cards, units, damage types, abilities, terrain tiles. This data is:

- **Pure** — no behaviour, only values. Behaviour lives in `ActionDefinition`.
- **Read-only at runtime** — the engine never adds, edits, or removes items while running.
- **Externally authored** — JSON files edited offline by game designers.
- **Cross-referencing** — a `Unit` data object may reference a `DamageType` by ID.

`ContentDatabase` is intentionally separated from `GameSnapshot`. Static definitions (what "Fire Bolt" is) belong in the database. Runtime state (who holds "Fire Bolt" in hand) belongs in the snapshot. The two are loaded independently on different lifecycles.

---

## `DataRef<T>` — Typed Cross-Collection References

```typescript
// simulation/content/DataRef.ts

// Branded string — format: "<collection-type>:<item-id>"
// Example: "damage-types:fire", "abilities:taunt"
type DataRef<_T extends DataObject = DataObject> = string & { readonly __dataRef: void };

function buildRef<T extends DataObject>(collectionType: string, id: string): DataRef<T> {
    return `${collectionType}:${id}` as DataRef<T>;
}

function parseRef(ref: DataRef): { collectionType: string; id: string } {
    const colon = ref.indexOf(':');
    if (colon < 1) throw new MalformedRefError(ref);
    return { collectionType: ref.slice(0, colon), id: ref.slice(colon + 1) };
}
```

---

## `ContentDatabase` Interface

```typescript
// simulation/content/ContentDatabase.ts

interface ContentDatabase {
    // Safe lookup — returns undefined if not found
    getById<T extends DataObject>(collectionType: string, id: string): T | undefined;
    // Throws UnknownDataRefError if absent (use when absence is a logic error)
    getByIdOrThrow<T extends DataObject>(collectionType: string, id: string): T;

    getAllIds(collectionType: string): readonly string[];
    getAll<T extends DataObject>(collectionType: string): readonly T[];

    // Parses "damage-types:fire" → looks up in damage-types collection → returns typed object
    resolveRef<T extends DataObject>(ref: DataRef<T>): T; // throws UnknownDataRefError

    collectionTypes(): readonly string[];
    has(collectionType: string, id: string): boolean;
}

// All data objects must carry an id — the only engine-level content contract.
interface DataObject {
    readonly id: string;
}
```

> **Invariant #13** — `ContentDatabase` is immutable after `ContentLoader.load()` returns: every item is frozen **recursively**, so nested objects and arrays are immutable too (within the JSON domain Invariant #15 mandates — a non-JSON value reachable only through the programmatic factory is frozen but not descended into, and an array-buffer view is skipped entirely, since `Object.freeze` throws on a non-empty typed array). It is never stored inside `GameSnapshot`.
> **Invariant #14** — `ContentDatabase` is loaded and all schemas/refs validated before the tick loop starts. A failed load is a fatal startup error and the app terminates (`app.exit(1)`). Ref validation is **on by default** (`ContentLoadOptions.validateRefs`), and its soundness rests on the enforced [item-id grammar](#item-id-grammar) — both below.
> **Invariant #15** — Game content must never contain executable code. Only JSON; pure data.
> **Invariant #46** — `ContentDatabase` is optional. Games that declare no content (e.g. Tic Tac Toe) pass no `db` to `PipelineContext`.

---

## File Layout

**Preferred: one directory per collection, one file per item** (easy to diff/review in git)

```
games/<game>/data/
├── damage-types/
│   ├── fire.json
│   └── physical.json
└── units/
    ├── warrior.json
    └── mage.json
```

**Alternative: flat array file** (for small collections)

```
games/<game>/data/
└── abilities.json   ← [{ "id": "taunt", ... }, { "id": "rally", ... }]
```

The `ContentLoader` detects which format is in use by checking whether the path is a directory or a `.json` file. Both layouts can be mixed in the same `data/` directory.

---

## Example JSON with DataRefs

```json
// units/warrior.json
{
    "id": "warrior",
    "name": "Warrior",
    "stats": { "maxHp": 120, "speed": 3, "armor": 20 },
    "attacks": [
        {
            "name": "Sword Strike",
            "baseDamage": 18,
            "damageType": "damage-types:physical"
        }
    ],
    "resistances": ["damage-types:fire"],
    "abilities": ["abilities:taunt"]
}
```

A string is treated as a `DataRef` when **both** halves qualify: the part left of the first `:` matches a known collection type, and the part right of it satisfies the item-id grammar below. TypeScript schemas declare the field type as `DataRef<T>`.

Refs are recognised wherever a string appears in loaded JSON — as a value, inside an array, and as an **object key**, at any depth ([exact scope](#what-ref-validation-does-and-does-not-catch)). A map keyed by ref is a first-class authoring shape:

```json
// units/warrior.json — per-ref data, keyed by ref
{ "id": "warrior", "resistances": { "damage-types:fire": 50, "damage-types:physical": 20 } }
```

Both halves matter because ref validation runs on every load (Invariant #14, below): the left-side rule keeps timestamps and URLs (`2024-01-01T00:00:00Z`, `https://…`) from being mistaken for refs, and the id-half rule does the same for prose that happens to open with a collection name (`"units: 3 required"`).

### Item-id grammar

Every item id must be a **non-empty string with no whitespace** (`ITEM_ID_SHAPE`, `/^\S+$/`). Non-ASCII, dotted, slashed and colon-bearing ids are all legal — `parseRef` splits a ref on its **first** colon, so `units:tier:elite` resolves id `tier:elite`. A violating id is rejected as a `ContentSchemaError` by `createContentDatabase` — the single factory every construction path funnels through, so a directly-built database obeys the grammar too. `ContentLoader` repeats the check at merge time for one reason: it runs before the duplicate check, so two id-less items are reported as malformed rather than as a `ContentConflictError`. The regex is exported from `@chimera-engine/simulation/content` for reuse in a game's own Zod id schema.

The grammar is enforced, not merely assumed, because ref detection depends on it. An id like `"Fire Mage"` would otherwise be legal _and_ unreferenceable: both a correct and a dangling `"units:Fire Mage"` would be skipped as prose, silently exempting that item from ref validation. With the grammar enforced, a string the id-half rule rejects cannot name any item, so skipping it can never skip a resolvable ref.

### What ref validation does and does not catch

Stated so it can be falsified: **every string reachable from a loaded item through object entries and array elements — keys as well as values, at any depth — whose prefix names a known collection and whose id half matches `ITEM_ID_SHAPE` must resolve, or the load fails.** Anything that sentence does not cover is not diagnosed at load. Those two traversals are exactly what JSON can express, so the only strings outside them live in shapes a programmatic `inline` source can build and a JSON file cannot: a symbol-keyed property, a non-index property on an array, a `Map`/`Set`'s contents.

| String                               | At load       | Why                                           |
| ------------------------------------ | ------------- | --------------------------------------------- |
| `units:champion` (no such item)      | **fatal**     | both halves qualify — the case #14 exists for |
| `{ "units:champion": 1 }` (as a key) | **fatal**     | keys are walked too                           |
| `units:` / `units:Fire Mage`         | not diagnosed | cannot name a legal item (id grammar)         |
| `unit:warrior` (prefix typo)         | not diagnosed | prefix names no known collection              |
| `2024-01-01T00:00:00Z`, `https://…`  | not diagnosed | prefix names no known collection              |
| `units:warrior_name` (i18n key)      | **fatal**     | indistinguishable from a ref                  |

The undiagnosed strings reach `resolveRef()` at call time and throw `UnknownDataRefError` there. The last row is the deliberate converse cost: in untyped JSON nothing separates a ref from a string shaped like one, so a game that names a collection after another of its namespaces will hit a false positive. `validateRefs: false` is the escape hatch.

---

## `ContentLoader`

```typescript
type ContentSource =
    | { type: 'directory'; path: string }
    | { type: 'inline'; collectionType: string; items: DataObject[] };

interface ContentLoader {
    // Merges sources in order; later sources add items to earlier collections.
    // Throws ContentConflictError if same (collectionType, id) appears in two sources.
    // Throws ContentSchemaError if a registered schema rejects an item, or if an
    // id violates ITEM_ID_SHAPE — that branch fires with no schema registered.
    // Throws UnknownDataRefError if a ref points nowhere (unless validateRefs:false).
    load(sources: ContentSource[], options?: ContentLoadOptions): Promise<ContentDatabase>;
}

interface ContentLoadOptions {
    schemas?: Partial<Record<string, ZodSchema>>;
    // Default TRUE — Invariant #14 requires refs validated before the tick loop,
    // so a plain load(sources, { schemas }) checks them. Pass false only for a
    // deliberately partial load whose refs resolve against a database this call
    // does not build (e.g. staged base/expansion loads).
    validateRefs?: boolean;
}
```

### Layering — Base Game + Expansions

```typescript
const db = await createContentLoader().load(
    [
        { type: 'directory', path: 'games/<game>/data' }, // base game
        { type: 'directory', path: 'games/<game>-expansion/data' }, // expansion
    ],
    { schemas: { 'damage-types': DamageTypeSchema, units: UnitSchema } },
);
// Both sources are merged before refs are checked, so an expansion may point at
// base-game items. A staged load — one `load()` call per source — would need
// `validateRefs: false` on every call but the last.
```

---

## Using `ContentDatabase` in ActionDefinitions

```typescript
validate(payload, state, playerId, ctx): ValidationResult {
    const unitDef = ctx.db!.getByIdOrThrow<UnitData>('units', attacker.unitDefId);
    if (unitDef.attacks.length === 0) return { ok: false, reason: 'unit_cannot_attack' };
    return { ok: true };
},

reduce(state, payload, playerId, ctx): MyGameSnapshot {
    const attack = ctx.db!.getByIdOrThrow<UnitData>('units', attacker.unitDefId).attacks[0];
    const damageType = ctx.db!.resolveRef<DamageTypeData>(attack.damageType);
    const variance = ctx.rng.int(-2, 2);
    const effectiveDamage = computeDamage(attack.baseDamage + variance, damageType, target.resistances);
    return applyDamage(state, payload.targetId, effectiveDamage);
},
```

---

## Error Types

```typescript
class UnknownDataRefError extends Error {
    constructor(public readonly ref: string) {
        super(`Cannot resolve DataRef '${ref}': item not found`);
    }
}

class MalformedRefError extends Error {
    constructor(public readonly ref: string) {
        super(`DataRef '${ref}' is malformed — expected 'collection-type:item-id'`);
    }
}

class ContentConflictError extends Error {
    constructor(
        public readonly collectionType: string,
        public readonly id: string,
    ) {
        super(`Duplicate item id '${id}' in collection '${collectionType}' across sources`);
    }
}

class ContentSchemaError extends Error {
    constructor(
        public readonly collectionType: string,
        public readonly id: string,
        cause: unknown,
    ) {
        // "content", not "schema": also thrown for an id-grammar violation in a
        // collection that has no registered schema. The reason is in `cause`.
        super(`Content validation failed for '${collectionType}:${id}'`);
        this.cause = cause;
    }
}
```

---

## Cross-References

- [Asset Reference System](asset-reference-system.md) — `AssetRef<T>` for binary assets in data objects
- [Simulation Core](simulation-core-action-pipeline.md) — `ReduceContext.db` where `ContentDatabase` is injected
