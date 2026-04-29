---
applyTo: 'electron/main/**'
---

# Electron Main Process — Rules

Hard constraints; violations are **BLOCK**.

## IPC Input Validation

Every `ipcMain.handle` validates input with Zod before use:

```typescript
ipcMain.handle('chimera:game:send-action', (_event, raw) => {
    const payload = SendActionSchema.parse(raw);
    return simulationHost.dispatch(payload);
});
```

Validate every `JSON.parse` result. Never spread or assign raw parsed objects without schema validation (prototype pollution).

## Snapshot Boundary (Inv #1)

`GameSnapshot` never leaves main. Project to `PlayerSnapshot` first:

```typescript
return projector.project(gameSnapshot, playerId); // ✅
return gameSnapshot; // ❌ BLOCK
```

Applies to WebSocket broadcasts too — only `PlayerSnapshot` crosses any process boundary.

## Electron Security

`BrowserWindow` must use:

```typescript
webPreferences: {
    nodeIntegration: false,   // MANDATORY
    contextIsolation: true,   // MANDATORY
    preload: path.join(__dirname, "preload.js"),
    sandbox: true,
}
```

Never `nodeIntegration: true`. Never `contextIsolation: false`.

## Path Traversal

Sanitise any user-supplied path:

```typescript
const safePath = path.resolve(savesDir, path.basename(userSupplied));
if (!safePath.startsWith(savesDir)) throw new Error('Path traversal attempted');
```

## Hardcoded Secrets

No tokens/keys/passwords/private keys as string literals. Use env vars or system keychain. Any secret literal in diff = immediate BLOCK.

## DOM APIs Forbidden

No `window`/`document`/`navigator`/`localStorage`/`fetch` etc. Use Node.js equivalents.

## IPC Channel Naming

`chimera:<domain>:<verb>` — e.g. `chimera:game:send-action`, `chimera:lobby:host`, `chimera:saves:list`, `chimera:settings:get`. Declare in `electron/main/ipc-handlers.ts`; Zod schema in `electron/main/ipc-schemas.ts`.

## Synchronous FS

Avoid `fs.readFileSync`/`writeFileSync` on the main event loop. Use `fs/promises`. Sync blocks IPC + WebSocket + renderer bridge.
