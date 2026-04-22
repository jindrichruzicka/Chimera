---
applyTo: 'electron/main/**'
---

# Electron Main Process — Rules

These rules apply to every file under `electron/main/`. They are hard constraints; violations are **BLOCK** findings at review.

## IPC Input Validation (BLOCK if violated)

Every `ipcMain.handle` registration **must** validate its input with Zod before using the data:

```typescript
// ✅ Validated with Zod before use
ipcMain.handle('chimera:game:send-action', (_event, raw) => {
    const payload = SendActionSchema.parse(raw); // throws ZodError on bad input
    return simulationHost.dispatch(payload);
});

// ❌ BLOCK — raw input passed directly to simulation without validation
ipcMain.handle('chimera:game:send-action', (_event, payload) => {
    return simulationHost.dispatch(payload);
});
```

Any `JSON.parse` result must also be validated with Zod (or equivalent schema validation) before use. Never spread (`...`) or assign a raw parsed object directly without schema validation — this is a prototype pollution vector.

## Snapshot Boundary (Invariant #1 — BLOCK if violated)

`GameSnapshot` must **never** leave the main process. Every IPC handler that returns game state must project it to a `PlayerSnapshot` first:

```typescript
// ✅ Projected to PlayerSnapshot before sending
const playerView = projector.project(gameSnapshot, playerId);
return playerView;

// ❌ BLOCK — full GameSnapshot sent over IPC
return gameSnapshot;
```

This applies to WebSocket broadcasts as well — only `PlayerSnapshot` values cross any process boundary.

## Electron Security (BLOCK if violated)

All `BrowserWindow` instances must be created with:

```typescript
webPreferences: {
    nodeIntegration: false,   // MANDATORY — must NEVER be true
    contextIsolation: true,   // MANDATORY — must NEVER be false
    preload: path.join(__dirname, "preload.js"),
    sandbox: true,            // recommended
}
```

**Never** set `nodeIntegration: true`. **Never** set `contextIsolation: false`. These are security violations regardless of the justification.

## Path Traversal Prevention (BLOCK if violated)

Any file-system operation that accepts a user-supplied path must sanitise the path before use:

```typescript
// ✅ Sanitised — resolve against a known safe base, then verify it stays within it
const safePath = path.resolve(savesDir, path.basename(userSuppledName));
if (!safePath.startsWith(savesDir)) throw new Error("Path traversal attempted");

// ❌ BLOCK — user-supplied path used directly
fs.readFile(userSuppliedPath, ...);
```

## Hardcoded Secrets (BLOCK if found)

No tokens, API keys, passwords, or private keys may appear as string literals in source. Use environment variables or the system keychain. Any secret literal found in a diff is an immediate BLOCK.

## DOM APIs Forbidden

`electron/main/` must never use DOM APIs (`window`, `document`, `navigator`, `localStorage`, `fetch`, etc.). These are renderer-only APIs. Use Node.js equivalents for networking, file I/O, and timers.

## IPC Channel Naming

All IPC channels must follow the `chimera:<domain>:<verb>` pattern:

```
chimera:game:send-action
chimera:lobby:host
chimera:saves:list
chimera:settings:get
```

No ad-hoc or undocumented channel names. Every new channel must be declared in `electron/main/ipc-handlers.ts` and validated in `electron/main/ipc-schemas.ts` with a corresponding Zod schema.

## Synchronous FS Operations

Avoid synchronous file-system calls (`fs.readFileSync`, `fs.writeFileSync`) on the main event loop. Use `fs/promises` equivalents. Blocking the event loop blocks all IPC, the WebSocket server, and the renderer bridge simultaneously.
