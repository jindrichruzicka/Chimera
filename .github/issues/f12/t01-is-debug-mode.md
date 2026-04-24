> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Add the `IS_DEBUG_MODE` boolean constant to `shared/constants.ts`. The value must be
`true` only when `process.env.CHIMERA_DEBUG === '1'` **and** `process.env.NODE_ENV !== 'production'`.
The bundler replaces `process.env` at build time, allowing the entire `simulation/debug/`
module graph to be tree-shaken out of production bundles. Also add a lint rule
(`no-debug-in-production`) — or a comment stub for it — and document the five environment
scenarios from §4.12 in the constant's JSDoc.

## Implementation notes

- File to create or modify: `shared/constants.ts`
- Constant signature: `export const IS_DEBUG_MODE: boolean`
- Must NOT import from: `renderer/`, `electron/`, `games/*` (module boundary rule)
- The constant must evaluate to `false` in all CI environments where `CHIMERA_DEBUG` is absent

## Acceptance Criteria

- [ ] `IS_DEBUG_MODE` is `true` when `CHIMERA_DEBUG=1` and `NODE_ENV=development`
- [ ] `IS_DEBUG_MODE` is `false` when `NODE_ENV=production`, regardless of `CHIMERA_DEBUG`
- [ ] `IS_DEBUG_MODE` is `false` when `CHIMERA_DEBUG` is absent (CI unit/integration env)
- [ ] Unit test covers all five environment scenarios from §4.12 table
- [ ] No forbidden cross-module imports (verified by lint)

## Invariants touched

- Invariant 2: `shared/` has zero DOM dependencies; this constant must remain a pure compile-time expression
