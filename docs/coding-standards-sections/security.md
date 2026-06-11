---
title: 'Chimera Coding Standards — §11 Security'
description: 'OWASP Top 10 security rules for the Chimera Electron desktop app: input validation, prototype pollution, path traversal, snapshot leakage, node access, and hardcoded secrets.'
tags:
    [
        security,
        OWASP,
        injection,
        path-traversal,
        snapshot-leakage,
        nodeIntegration,
        contextIsolation,
        coding-standards,
    ]
---

# §11 Security

> Part of [Coding Standards Index Hub](../coding-standards.md)

This section maps directly to OWASP Top 10 risks relevant to Electron desktop applications.

---

## 11.1 Input validation (A03 — Injection)

- **All IPC input is untrusted.** Validate with Zod before any use. This applies to `ipcMain.handle` payloads, `ws` message bodies, and any data read from `userData`.
- Never pass IPC-received data to `eval`, `Function()`, `child_process.exec`, or any shell-executing API.

## 11.2 Prototype pollution (A08 — Software and Data Integrity)

- Never spread (`...`) a `JSON.parse` result directly onto an object without schema validation.
- Use `Object.create(null)` for plain-data dictionaries that may receive user-controlled keys.

## 11.3 Path traversal (A01 — Broken Access Control)

- All file-system operations use paths derived from `app.getPath('userData')` or compile-time constants.
- Never accept a path string from IPC input or `ws` messages and pass it to `fs` APIs.

## 11.4 Snapshot leakage (A01)

- `GameSnapshot` must never appear in an IPC response, a WebSocket message, or a log line. Only `PlayerSnapshot` crosses any boundary. Exception: the debug layer (`debug-bridge.ts`) returns full snapshots to the Inspector Window over `chimera:debug*` ("full truth — debug only", §4.12); it loads solely under the `IS_DEBUG_MODE` gate (Invariant 27) and validates every request sender against the Inspector's `webContents.id` (Invariant 29).
- Reviewer must run `assertNoLeakedFields()` logic against the diff for any change touching IPC handlers or `StateBroadcaster`.

## 11.5 Electron node access (A05 — Security Misconfiguration)

- `nodeIntegration: false` and `contextIsolation: true` on every window — no exceptions.
- Never call `shell.openExternal()` with a URL derived from IPC input.
- Never load remote URLs in a `BrowserWindow` in production.

## 11.6 Hardcoded secrets

- No API keys, tokens, signing certificates, or passwords as string literals in source.
- Signing keys are injected via CI environment variables only.
