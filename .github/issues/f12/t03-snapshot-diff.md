> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Implement `SnapshotDiff` and `computeSnapshotDiff` in `simulation/debug/SnapshotDiff.ts`
as specified in §4.12. The function performs a recursive structural diff of two
`GameSnapshot` objects, producing a flat list of `DiffEntry` items with dot-delimited
JSON paths and `kind` values of `'added'`, `'removed'`, or `'changed'`. The result
includes a `summary` with counts per kind. Export `DiffKind`, `DiffEntry`,
`SnapshotDiff`, and `computeSnapshotDiff` from `simulation/debug/index.ts`. Write
unit tests covering flat field changes, nested object diffs, added keys, removed keys,
and array element changes.

## Implementation notes

- File to create: `simulation/debug/SnapshotDiff.ts`
- Must NOT import from: `renderer/`, `electron/`, `games/*` (module boundary)
- Path format: dot-delimited JSON path — e.g. `'entities.unit-1.hp'`
- Arrays are diffed as objects (index as key) — no LCS needed for M7
- Export from `simulation/debug/index.ts`

## Acceptance Criteria

- [ ] `computeSnapshotDiff` returns `{ fromTick, toTick, entries, summary }` correctly
- [ ] `kind: 'added'` for keys present in `to` but not in `from`
- [ ] `kind: 'removed'` for keys present in `from` but not in `to`
- [ ] `kind: 'changed'` for keys present in both with different primitive values
- [ ] Nested object paths use dot notation (e.g. `'entities.unit-1.hp'`)
- [ ] `summary` counts match the number of entries per kind
- [ ] Unit tests pass for all of the above
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist item "SnapshotDiff implemented in simulation/debug/" is green

## Invariants touched

- Invariant 2: `simulation/debug/` must have zero imports from `renderer/`, `electron/`, or `games/*`
