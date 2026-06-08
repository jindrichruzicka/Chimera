---
title: 'Content Database and DataRefs'
description: 'DataRef<T> branded type, ContentDatabase interface, ContentLoader, JSON file layouts, usage in ActionDefinitions, and all content-related error types.'
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

> **Invariant #13** — `ContentDatabase` is immutable after `ContentLoader.load()` returns. It is never stored inside `GameSnapshot`.
> **Invariant #14** — `ContentDatabase` is loaded and all schemas/refs validated before the tick loop starts. A failed load is a fatal startup error.
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

Any string containing `:` whose left side matches a known collection type is treated as a `DataRef`. TypeScript schemas declare the field type as `DataRef<T>`.

---

## `ContentLoader`

```typescript
type ContentSource =
    | { type: 'directory'; path: string }
    | { type: 'inline'; collectionType: string; items: DataObject[] };

interface ContentLoader {
    // Merges sources in order; later sources add items to earlier collections.
    // Throws ContentConflictError if same (collectionType, id) appears in two sources.
    // Throws ContentSchemaError if a registered schema rejects an item.
    // Throws UnknownDataRefError if validateRefs:true and a ref points nowhere.
    load(sources: ContentSource[], options?: ContentLoadOptions): Promise<ContentDatabase>;
}

interface ContentLoadOptions {
    schemas?: Partial<Record<string, ZodSchema>>;
    validateRefs?: boolean; // default false (warn only)
}
```

### Layering — Base Game + Expansions

```typescript
const db = await createContentLoader().load(
    [
        { type: 'directory', path: 'games/<game>/data' }, // base game
        { type: 'directory', path: 'games/<game>-expansion/data' }, // expansion
    ],
    { schemas: { 'damage-types': DamageTypeSchema, units: UnitSchema }, validateRefs: true },
);
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
        super(`Schema validation failed for '${collectionType}:${id}'`);
        this.cause = cause;
    }
}
```

---

## Cross-References

- [Asset Reference System](asset-reference-system.md) — `AssetRef<T>` for binary assets in data objects
- [Simulation Core](simulation-core-action-pipeline.md) — `ReduceContext.db` where `ContentDatabase` is injected
