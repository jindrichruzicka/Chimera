> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Write two security/production-isolation tests for the debug layer:

**Test A — IPC security:** Verify that the `chimera:debug` IPC handler in
`debug-bridge.ts` returns `{ type: 'ERROR', message: '...' }` when a request arrives
from any `webContents.id` that is **not** the Inspector Window's `webContents.id`. Use
a mock `ipcMain` and simulate a request from a fake sender. This test must run without
launching Electron.

**Test B — Production build isolation:** Verify that `window.__chimeraDebug` is
`undefined` in the game renderer window when `IS_DEBUG_MODE === false`. This can be
an integration test using Playwright's `electronApp.evaluate()` launched with
`CHIMERA_DEBUG` unset and `NODE_ENV=production`.

## Implementation notes

- Test A file: `electron/main/debug-bridge.test.ts` (or co-located with `debug-bridge.ts`)
- Test B file: `e2e/tests/debug-isolation.spec.ts` (Playwright E2E)
- Test A must mock `BrowserWindow` and `ipcMain` — do not launch a real Electron instance
- Test B should check `mainWindow.evaluate(() => typeof window.__chimeraDebug)` returns `'undefined'`

## Acceptance Criteria

- [ ] Test A: handler returns `{ type: 'ERROR' }` for a request with `event.sender.id !== inspectorWindow.webContents.id`
- [ ] Test A: handler routes correctly when `event.sender.id === inspectorWindow.webContents.id`
- [ ] Test B: `window.__chimeraDebug` evaluates to `undefined` in game renderer window in production build
- [ ] Both tests run in CI and pass
- [ ] §12 M7 checklist items "Ring buffer security test passing" and "IS_DEBUG_MODE=false verified in production build" are green

## Invariants touched

- Invariant 1: `GameSnapshot` must never reach the game renderer window — Test B directly enforces this by verifying the debug surface is absent in production
