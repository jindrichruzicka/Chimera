> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Implement `startDebugBridge` in `electron/main/debug-bridge.ts`. This function is
dynamically imported in `electron/main/index.ts` only when `IS_DEBUG_MODE === true`.
It constructs a `SnapshotInspector` from the provided `SimulationHost` and
`StateProjector`, spawns a second `BrowserWindow` (the Inspector Window) with
`contextIsolation: true`, `nodeIntegration: false`, and the `debug-api.js` preload,
then registers the `chimera:debug` `ipcMain.handle` handler. The handler routes all
eight `DebugRequest` variants to the appropriate `SnapshotInspector` method and returns
a typed `DebugResponse`. The `SUBSCRIBE_LIVE` path wires `ringBuffer.onRecord` to push
`LIVE_TICK` events to the Inspector Window. Security: the handler must verify
`event.sender.id === inspectorWindow.webContents.id` and return `{ type: 'ERROR' }` for
any request from another sender.

## Implementation notes

- File to create: `electron/main/debug-bridge.ts`
- Must NOT be imported unconditionally — always behind `if (IS_DEBUG_MODE)` dynamic import in `index.ts`
- Inspector Window `BrowserWindow` options: `contextIsolation: true`, `nodeIntegration: false`, preload = `debug-api.js`
- URL: `file://${path.join(__dirname, '../../renderer/out/debug/index.html')}`
- IPC channel: `chimera:debug` (request/response), `chimera:debug:live` (push)
- Must NOT import from: `simulation/` internals beyond `@chimera/simulation/debug` public API; must NOT import from `renderer/`

## Acceptance Criteria

- [ ] `startDebugBridge` is only called when `IS_DEBUG_MODE === true`
- [ ] Inspector Window is created with `contextIsolation: true` and `nodeIntegration: false`
- [ ] `chimera:debug` handler routes all 8 `DebugRequest` types correctly
- [ ] Handler returns `{ type: 'ERROR', message: 'Unauthorised...' }` for requests not from Inspector Window
- [ ] `SUBSCRIBE_LIVE` wires `ringBuffer.onRecord`; `UNSUBSCRIBE_LIVE` clears it
- [ ] `chimera:debug:live` is only sent when Inspector Window is not destroyed
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist item "debug-bridge.ts wired; Inspector Window launches when CHIMERA_DEBUG=1" is green

## Invariants touched

- Invariant 1: `GameSnapshot` in `SNAPSHOT` / `LIVE_TICK` responses is sent **only** to the Inspector Window (`inspectorWindow.webContents.id`) — never to the game renderer window
