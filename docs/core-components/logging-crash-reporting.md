---
title: 'Logging & Crash Reporting'
description: 'LogLevel/LogEntry/LogSource schema, Logger interface (Pino-backed), crash-reporter.ts 3 failure paths, autosave-before-crash-dump, rendererLogger, RootErrorBoundary, Shell-Root mount ordering (ToastHost sibling), LogsAPI IPC, and privacy policy.'
tags: [logging, crash-reporting, error-handling, pino, electron, renderer]
---

# Logging & Crash Reporting

> §4.27 of the Chimera architecture.
> Related: [Save / Load Persistence](save-load-persistence.md) · [Toast Notifications](toast-notification-system.md) · [Electron Shell](electron-shell-ipc-bridge.md)

---

## Overview

Three concerns in one consistent surface:

1. Unhandled errors must not silently lose user data.
2. Developers get structured logs for debugging post-mortems.
3. The React tree cannot crash into an unrecoverable white screen.

---

## Shared Log Schema

```typescript
// shared/logging.ts

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
    readonly level: LogLevel;
    readonly message: string;
    readonly timestamp: number;
    readonly source: LogSource;
    readonly context?: Record<string, unknown>;
    readonly error?: { name: string; message: string; stack?: string };
}

export type LogSource =
    | { process: 'main'; module: string }
    | { process: 'renderer'; module: string }
    | { process: 'simulation'; module: string };
```

---

## Logger Interface (Main Process)

Backed by [Pino](https://getpino.io). Writes to `userData/logs/chimera-YYYY-MM-DD.log` with daily rotation and 14-day retention. Injected into every manager as a constructor parameter.

```typescript
// electron/main/logging/logger.ts

export interface Logger {
    trace(msg: string, ctx?: Record<string, unknown>): void;
    debug(msg: string, ctx?: Record<string, unknown>): void;
    info(msg: string, ctx?: Record<string, unknown>): void;
    warn(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
    fatal(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
    child(ctx: Record<string, unknown>): Logger;
}
```

### Logger Injection

> **Note:** Every main-process manager (`SaveManager`, `LobbyManager`, `SettingsManager`, `ProfileManager`, `ReplayManager`, `ChatRelay`) implicitly receives `logger: Logger` as its first constructor parameter. Earlier sections omit this parameter for brevity. `electron/main/index.ts` constructs the root logger and injects children (`logger.child({ module: 'saves' })`, etc.) at wire-up time.

---

## Crash Reporter (3 Failure Paths)

```typescript
// electron/main/crash-reporter.ts
```

| Path                 | Trigger                                 | Behaviour                                                |
| -------------------- | --------------------------------------- | -------------------------------------------------------- |
| `uncaughtException`  | `process.on('uncaughtException')`       | Log `fatal` + write crash dump + graceful shutdown       |
| `unhandledRejection` | `process.on('unhandledRejection')`      | Log `error`; does NOT shut down by default               |
| Renderer crash       | `webContents.on('render-process-gone')` | Log + write crash dump + attempt single renderer restart |

Crash dump written to `userData/crashes/crash-<iso-timestamp>.json` contains:

- Last 1000 log entries
- `GameSnapshot` snapshot if simulation is live
- `process.versions`, `os.release()`, `app.getVersion()`

> **Autosave before crash dump** — when a live simulation exists, `SaveManager.autoSave()` runs before the dump is written, maximising the player's chance of recovery.

Crash dumps are written atomically (`.tmp` + rename) — a partially-written dump never exists.

---

## Renderer Logging

```typescript
// renderer/logging/rendererLogger.ts
// Forwards: console.warn, console.error, window.onerror, window.onunhandledrejection
// → main process via logs IPC namespace.
// console.log preserved locally but NOT forwarded (PII/volume hygiene).
```

---

## RootErrorBoundary

```tsx
// renderer/components/shell/RootErrorBoundary.tsx

// On catch:
//   1. Forward error via rendererLogger.error()
//   2. Render <CrashFallback /> with:
//        • "An unexpected error occurred."
//        • "Return to Main Menu" (resets app state)
//        • "Restart Application" (calls system.quit() + relaunch)
//        • Crash ID for bug reports
```

---

## Shell-Root Mount Ordering

`ToastHost` (§4.30) must be mounted as a **sibling** of `RootErrorBoundary`, NOT inside it. If a component crashes, the error boundary replaces its subtree with `<CrashFallback />`; a toast inside that subtree would disappear at the moment the user most needs it.

```tsx
// renderer/app/providers.tsx
export function AppShell({ children }: { children: ReactNode }) {
    return (
        <>
            <RootErrorBoundary>{children}</RootErrorBoundary>
            <ToastHost /> {/* sibling — survives boundary catches */}
        </>
    );
}
```

---

## LogsAPI IPC

```typescript
interface LogsAPI {
    emit(entry: LogEntry): void; // Non-blocking; main process batches + writes
    readRecent(maxEntries: number): Promise<ReadonlyArray<LogEntry>>; // For "Export diagnostics"
}
```

---

## Privacy Policy

Log entries are **local-only** by default. Nothing leaves the user's machine unless the player explicitly uses "Export diagnostics" (zips `userData/logs/` + `userData/crashes/`). No automatic telemetry in 1.0.0.

---

## Invariants

| #   | Rule                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #67 | Every main-process manager is constructed with an injected `Logger` child. No module emits logs via raw `console.*` — all structured logging flows through the injected logger. |
| #68 | The crash reporter runs autosave before writing the crash dump when a live simulation is present. Crash dump is created atomically (`.tmp` + rename).                           |
| #69 | No log entry, crash dump, or telemetry ever leaves the user's machine automatically. Export is an explicit, user-initiated action.                                              |

---

## Cross-References

- [Save / Load Persistence](save-load-persistence.md) — autosave triggered by crash reporter
- [Toast Notifications](toast-notification-system.md) — `ToastHost` sibling of `RootErrorBoundary`
- [Electron Shell](electron-shell-ipc-bridge.md) — `LogsAPI` namespace
