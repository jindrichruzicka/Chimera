> Part of #<!-- F12_ISSUE_NUMBER -->
> Architecture: §4.12 — `Runtime Debug Layer`

## What to do

Implement `electron/preload/debug-api.ts` — the preload script loaded exclusively by
the Inspector Window. It uses `contextBridge.exposeInMainWorld` to expose
`window.__chimeraDebug` with two methods: `request(req: DebugRequest): Promise<DebugResponse>`
(invokes `chimera:debug` IPC) and `onLiveTick(cb): () => void` (subscribes to
`chimera:debug:live` push events and returns an unsubscribe function). This script
must **never** be loaded by the game renderer window — it must only appear in the
Inspector Window's `webPreferences.preload`. The game renderer's `api.ts` must not
import or reference `debug-api.ts`.

## Implementation notes

- File to create: `electron/preload/debug-api.ts`
- Exposed surface: `window.__chimeraDebug` (NOT `window.__chimera`)
- `request`: wraps `ipcRenderer.invoke('chimera:debug', req)`
- `onLiveTick`: adds `ipcRenderer.on('chimera:debug:live', fn)` and returns `() => ipcRenderer.off('chimera:debug:live', fn)`
- Must NOT be imported by `electron/preload/api.ts` or any game renderer code
- Must NOT import from: `simulation/` beyond type imports from `@chimera/simulation/debug`

## Acceptance Criteria

- [ ] `window.__chimeraDebug.request()` resolves with typed `DebugResponse`
- [ ] `window.__chimeraDebug.onLiveTick()` returns a working unsubscribe function
- [ ] `window.__chimera` is NOT present in Inspector Window (no leakage from `api.ts`)
- [ ] `window.__chimeraDebug` is NOT present in game renderer window
- [ ] `contextIsolation: true` enforced in Inspector Window `BrowserWindow` config (verified in T7)
- [ ] TypeScript compiles with `strict: true`
- [ ] No forbidden cross-module imports (verified by lint)
- [ ] §12 M7 checklist item "debug-api.ts wired" is green

## Invariants touched

- Invariant 1: `window.__chimeraDebug` surface is only exposed to the Inspector Window; the game renderer window has no access to it
