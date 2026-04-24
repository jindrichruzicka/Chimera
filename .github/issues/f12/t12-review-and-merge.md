> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

This is the final integration and review task for Feature F12 (Runtime Debug Layer, §4.12).
Run the **Chimera Code Reviewer** agent against all F12 changes before merging to main.

The reviewer must check:

1. **Invariant 1** — `GameSnapshot` never leaves the main process boundary except to the Inspector Window in debug mode; the game renderer window never receives `GameSnapshot` through any path
2. **Invariant 2** — `simulation/debug/` has zero imports from `renderer/`, `electron/`, `games/*`, or any DOM API
3. **Invariant 43** — No `Math.random()` or `Date.now()` used for simulation-time purposes within `simulation/debug/`
4. **IPC security** — `chimera:debug` handler verifies `event.sender.id === inspectorWindow.webContents.id` before dispatching any request
5. **Production isolation** — `IS_DEBUG_MODE=false` in production bundle; `window.__chimeraDebug` absent from game renderer
6. **Module boundary** — `debug-bridge.ts` and `debug-api.ts` are behind a dynamic import gated on `IS_DEBUG_MODE`
7. **TypeScript** — `strict: true` throughout all new files; no `any`, no `@ts-ignore`

## Acceptance Criteria

- [ ] All F12 child tasks (#T1 – #T11) are closed
- [ ] Code review by Chimera Code Reviewer passes with no BLOCK findings
- [ ] All invariants listed above verified clean
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` exit 0 on main after merge
- [ ] §12 M7 checklist items for the debug layer are all green
- [ ] PR merged to main
