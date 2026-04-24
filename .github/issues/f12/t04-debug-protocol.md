> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Declare all typed IPC message shapes for the debug channel in
`simulation/debug/DebugProtocol.ts`. This file is **type-only** — no runtime logic.
It declares two discriminated union types: `DebugRequest` (Inspector Window → Main)
and `DebugResponse` (Main → Inspector Window). The eight request variants and eight
response variants are specified exactly in §4.12. Export both types and all constituent
member shapes from `simulation/debug/index.ts` so that both `debug-bridge.ts` and
`debug-api.ts` can import from `@chimera/simulation/debug` without reaching into
implementation files directly.

## Implementation notes

- File to create: `simulation/debug/DebugProtocol.ts`
- Must NOT import from: `renderer/`, `electron/`, `games/*` (module boundary)
- `DebugRequest` variants: `GET_TICK_LIST`, `GET_SNAPSHOT`, `GET_PROJECTION`, `GET_DIFF`, `GET_ACTION_LOG`, `GET_PERF_STATS`, `SUBSCRIBE_LIVE`, `UNSUBSCRIBE_LIVE`
- `DebugResponse` variants: `TICK_LIST`, `SNAPSHOT`, `PROJECTION`, `DIFF`, `ACTION_LOG`, `PERF_STATS`, `LIVE_TICK`, `ERROR`
- `SNAPSHOT` response carries `GameSnapshot` — this is intentional (debug-only, Inspector Window only)
- Export from `simulation/debug/index.ts`

## Acceptance Criteria

- [ ] `DebugRequest` is a discriminated union with all 8 specified variants
- [ ] `DebugResponse` is a discriminated union with all 8 specified variants
- [ ] TypeScript compiles with `strict: true` — no `any`, no `@ts-ignore`
- [ ] `tsc --noEmit` passes
- [ ] Both types exported from `simulation/debug/index.ts`
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist item "DebugProtocol implemented in simulation/debug/" is green

## Invariants touched

- Invariant 1: `GameSnapshot` in `SNAPSHOT` response is scoped to Inspector Window IPC only — never sent to game renderer window
