---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': patch
---

`ContentDatabase` items are now frozen **recursively**, `ContentLoader.load()` validates `DataRef`
integrity **by default**, and item ids are constrained to a grammar that makes that validation sound
— the two halves of Invariants #13 and #14 that the code declared but did not deliver.

**Deep freeze (#13).** `createContentDatabase` called `Object.freeze(item)`, which is shallow: every
nested object and array inside a loaded content item stayed mutable after `load()` returned, so
"immutable after load" held exactly one level deep. Nothing mutated in practice only because every
shipping content item is flat (`{ id, name, hex, order }`) — the guarantee would have lapsed
silently on the first game to author a `stats: {...}` or `attacks: [...]` field. Items are now frozen
through a recursive walk at the single freeze site every construction path funnels through, so
`ContentLoader.load()` and direct `createContentDatabase()` calls are covered alike. The walk's
visited marker is a `WeakSet`, deliberately not `Object.isFrozen`: an item the caller already
shallow-froze must still have its nested values frozen, and a self-referential item must terminate.
Cost is one pass per item at load time, never per access.

Two adopter-facing consequences. Freezing is transitive, so an object a caller **shares** into an
inline item (a module-level constant reused across items) is frozen along with it — shallow freezing
never reached past the item itself. And because the query methods return `T` rather than a deep
`Readonly<T>`, code that shallow-copies a nested content value and writes through the copy
(`const s = {...item}; s.stats.hp -= 5`) still type-checks but now throws `TypeError` where it
previously succeeded. Both were already Invariant #2/#13 violations; nothing first-party does either.
The walk's domain is JSON (Invariant #15): a value JSON cannot produce — a `Map` or `Date` from a
programmatic caller — is frozen but not walked, since freezing does not make those immutable anyway.
An array-buffer view is skipped outright, neither frozen nor walked: `Object.freeze` throws on a
non-empty typed array, and one rule for every view beats two.

**Ref validation (#14).** `ContentLoadOptions.validateRefs` defaulted to `false` and the engine's
only production call site (`loadAllGameContent`) passed just `{ schemas }`, so the ref half of
Invariant #14 never ran outside tests: a game shipping a dangling `DataRef` booted fine and failed
later as an `UnknownDataRefError` thrown from inside a reducer, mid-match, instead of fatally at
startup. The default is now `true`. This is a **behavioural change to a published default**: a
`load()` that previously tolerated a dangling ref now rejects. `validateRefs: false` remains as a
narrow opt-out for a deliberately partial load whose refs resolve against a database that call does
not build (staged base/expansion loads); no production startup path may use it.

Refs are now recognised in object **keys** as well as values, at any depth. A map keyed by ref
(`resistances: { 'damage-types:fire': 50 }`) is a first-class way to author per-ref data, and
walking values alone exempted every ref written that way — a dangling one loaded clean and surfaced
from `resolveRef()` mid-match instead. Ordinary field names contain no colon and exit the check
immediately; the cost is that the false-positive class above now applies to keys too.

The default was flipped rather than opted into at the electron call site so the guarantee has a
single home — every current and future loader call site (scaffolded games, expansions, a second host
path) is covered without remembering to ask. The startup path is pinned by its own test against a
temp assets root, so the guard survives both a default flip-back and a call-site opt-out.

**Item ids now have an enforced grammar** (`ITEM_ID_SHAPE`, `/^\S+$/` — non-empty, no whitespace).
Non-ASCII, dotted, slashed and colon-bearing ids stay legal; `parseRef` splits a ref on its first
colon, so `units:tier:elite` resolves id `tier:elite`. `ContentLoader` rejects a violating id as a
`ContentSchemaError`, enforced at `createContentDatabase` — the single factory every construction
path funnels through, the same siting as the deep freeze. `ContentLoader` repeats the check at merge
time for one narrow reason: it runs before the duplicate check, so two id-less items are reported as
malformed rather than as a `ContentConflictError` over a `Map` keyed on `undefined`. This is what
makes ref detection sound
rather than a guess. Detection needs to tell `"units:warrior"` from prose like `"units: 3 required"`,
and can only do that by testing the id half — but that test is safe only if no _legal_ id can look
like prose. Without the grammar an item ided `"Fire Mage"` would be legal and unreferenceable: both a
correct and a dangling `"units:Fire Mage"` would be skipped, silently exempting that item from the
integrity check. With it, a string the rule rejects cannot name any item, so skipping one can never
skip a resolvable ref.

**Two upgrade breaks follow from that, both intended.** First, the grammar is a new rejection: an
item ided `"Fire Mage"` loaded before and now fails with a `ContentSchemaError`. It was legal but
unreferenceable, which is precisely the state the grammar exists to make impossible — rename the id
(and any ref to it). Second, with refs checked by default, any **non-ref** string of the form
`<knownCollection>:<no-whitespace>` is now a fatal load error: an i18next-style `"units:warrior_name"`
in a game that also has a `units` collection will stop the load. Nothing in untyped JSON distinguishes
that from a real ref. A game hits it only by naming a collection after another of its namespaces;
rename the collection, or pass `validateRefs: false`.

The limits of the guarantee, stated on Invariant #14 rather than left implied. Not diagnosed at load,
each reaching `resolveRef()` at call time instead: an id half that is empty or contains whitespace
(`units:`, `units:Fire Mage`), which cannot name a legal item; a mistyped collection prefix
(`unit:warrior`), which is not recognised as a ref at all; and a ref into a collection the loader
never saw. The falsifiable form of what _is_ guaranteed: every string reachable from a loaded item
through object entries and array elements — keys as well as values, at any depth — whose prefix names
a known collection and whose id half matches `ITEM_ID_SHAPE` must resolve, or the load fails. Those
two traversals are exactly what JSON can express; strings outside them (a symbol-keyed property, a
non-index property on an array, a `Map`/`Set`'s contents) live in shapes only a programmatic `inline`
source can build, and are not examined.

`ContentSchemaError`'s message now reads `Content validation failed for '<collection>:<id>'` rather
than `Schema validation failed…`: it also covers the id-grammar rejection, which fires for
collections that have no registered schema at all. The specific reason stays in `cause`.

`ITEM_ID_SHAPE` is exported from `@chimera-engine/simulation/content` so a game can reuse it in its
own Zod id schema.

**A failed content load now terminates the app.** `main()` logged the failure and rethrew, but the
composition root launches it as `void main(...)`, so the throw was only an unhandled rejection —
Electron printed a warning and kept the process alive with no window. Invariant #14 says the game
does not start; it now calls `app.exit(1)`, matching the Invariant #27 startup guard (and, for the
same reason, deliberately no modal `showErrorBox`, which would hang a non-interactive launch). The
reason is reported through the injected `logger` and the pino sink is drained with a guarded
`flushSync()` first — the sink buffers (`minLength: 4096`) and `app.exit()` emits no `before-quit`,
so without that flush the refusal would leave no record at all. The
per-game load is also wrapped so a failure names the game and its data directory, keeping the loader
error as `cause` — the loader is game-agnostic and its errors carry only a ref string.

No shipping content changes behaviour: the reference game's content is flat, its ids are slugs, and
it carries no colon-bearing values.
