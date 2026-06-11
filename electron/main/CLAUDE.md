# Electron Main Process — Rules

Source of truth:

- [Electron IPC standards](../../docs/coding-standards-sections/electron-ipc.md)
- [Security standards](../../docs/coding-standards-sections/security.md)
- [Module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md)
- [Architecture invariants](../../docs/executive-architecture/architecture-invariants.md)

Use this file only as the fast BLOCK checklist:

- Validate every IPC and `JSON.parse` boundary with Zod before data reaches managers, stores, or simulation.
- Declare IPC handlers in `electron/main/ipc/ipc-handlers.ts`, schemas in `electron/main/ipc/ipc-schemas.ts`, and preload exposure in `electron/preload/api.ts`; keep channel names `chimera:<domain>:<verb>`. Exception: the debug layer (`debug-bridge.ts`) self-contains its `chimera:debug*` handlers and schemas so the debug graph stays out of the production bundle (Invariant #27, §4.12).
- Keep `GameSnapshot` host-local; project to `PlayerSnapshot` before IPC or network send. Exception: the `chimera:debug*` handlers in `debug-bridge.ts` return full snapshots to the Inspector window ("full truth — debug only", §4.12, Invariants #27/#29).
- Preserve secure `BrowserWindow` defaults: no `nodeIntegration`, `contextIsolation` on, approved preload bridge, sandbox where supported.
- Resolve user paths inside owned roots and write app data atomically (`.tmp` + rename).
- Use `fs/promises`; avoid sync FS on the main event loop.
- No DOM APIs, renderer imports, provider-specific imports, or hardcoded secrets.
