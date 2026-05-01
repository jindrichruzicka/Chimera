---
title: 'Chimera Coding Standards — §8 Electron / IPC'
description: 'Electron BrowserWindow security settings, preload surface constraints, IPC input validation, and file-system safety rules.'
tags: [electron, ipc, security, nodeIntegration, contextIsolation, preload, Zod, coding-standards]
---

# §8 Electron / IPC

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 8.1 Security settings — non-negotiable

Every `BrowserWindow` must be created with:

```typescript
webPreferences: {
  nodeIntegration:  false,
  contextIsolation: true,
  preload: path.join(__dirname, '../preload/api.js'),
}
```

These settings are **Invariants 3 and 4** in [Architecture Invariants](../executive-architecture/architecture-invariants.md). Any new `BrowserWindow` without them is a **BLOCK** finding.

## 8.2 Preload surface

- The preload script exposes only `window.__chimera` via `contextBridge.exposeInMainWorld`.
- The exposed API is typed in nine namespace files: `game-api.ts`, `lobby-api.ts`, `saves-api.ts`, `settings-api.ts`, `profile-api.ts`, `replay-api.ts`, `chat-api.ts`, `logs-api.ts`, `system-api.ts`.
- `debug-api.ts` is **not** part of `window.__chimera`. It exposes `window.__chimeraDebug` exclusively on the Inspector Window (`CHIMERA_DEBUG=1`). The game renderer window never has access to it.
- No additional globals, property extensions, or undocumented channels are permitted.

## 8.3 IPC input validation

- Every `ipcMain.handle` handler must validate its input with Zod before passing it to any domain object. Unvalidated input from the renderer is untrusted user input.
- Handlers must never return a full `GameSnapshot`. They return only `PlayerSnapshot` or purpose-built response DTOs.

## 8.4 File system

- All file writes use an atomic write pattern: write to `<target>.tmp`, then `fs.rename` to the final path. Direct writes to the final path are forbidden (crash-safe writes, Invariant 38).
- User file paths must be derived from `app.getPath('userData')` only. No user-supplied path is ever used without sanitisation.
