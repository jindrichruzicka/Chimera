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
// simulation/foundation/logging.ts

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

### Sinks

The root logger owns level tagging and context merging; a `LoggerSink` owns transport. The logger itself applies **no** level threshold — every entry reaches every sink — so a sink that wants less is wrapped in `createMinLevelSink(minLevel, sink)`.

`main()` does not hand the root logger the fan-out directly. The chain is:

```
logger ─► LogRingBufferSink ─► combinedSink ─┬─► createPinoSink   (file)
          (retains last 1000)                ├─► createMemorySink (ring buffer)
                                             ├─► createStdoutSink (harness only)
                                             └─► createStderrSink (dev mirror, error+)
```

| Sink                             | Active when                                                   | Purpose                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LogRingBufferSink`              | always — the sink the root logger is constructed with         | Retains the last 1000 entries and forwards each one on. `drain()` is what fills the crash dump's `recentLogs` (wired as `getRecentLogs` in `registerCrashReporter`).                                                                                                                                          |
| `createPinoSink` (file)          | always                                                        | The durable record: `userData/logs/chimera-YYYY-MM-DD.log`. Buffered (`minLength: 4096`), so an exiting process must `flushSync()` to keep it.                                                                                                                                                                |
| `createMemorySink` (ring buffer) | always                                                        | Backs the `chimera:logs:readRecent` IPC handler — its only reader.                                                                                                                                                                                                                                            |
| `createStdoutSink`               | `CHIMERA_DEV_HARNESS=1`                                       | §4.32 live streaming — the `dev:mp` orchestrator prefixes and interleaves each instance's stdout.                                                                                                                                                                                                             |
| `createStderrSink` (dev mirror)  | unpackaged **and** non-harness, filtered to `error` and above | Puts failures — above all the fatal startup refusals — in the terminal a dev launch was started from. Unpackaged because a shipped binary is normally launched with no terminal reading its streams, so the log file is its record; non-harness because the `dev:mp` orchestrator already streams everything. |

> A sink writing to stdout/stderr is transport, not a `console.*` call site: modules keep logging through their injected `Logger` (Invariant #67).

Two layers of isolation, for one rule — **a logging call must never throw into its call site**. `createFanOutSink` wraps each leg, so one transport's failure mode (a full disk, a rotated-away file descriptor, a closed pipe) cannot deny the others the entry; without it, list order silently decided what survived, and the Pino sink is written first. The console sinks additionally swallow both a failing write and an entry they cannot render (a circular `context`, which `JSON.stringify` throws on) — defence in depth, since every production wiring of them goes through the fan-out, and what keeps them safe when a test hands one straight to `createLogger`.

Isolation on its own would make a broken transport **invisible**, which is not the same thing. No sink reports its own failures, and in production nothing calls them except the fan-out, so a Pino sink that starts throwing on a bad fd would silently stop recording for the rest of the session. The fan-out therefore announces a failed leg **by name** on the legs that still work, after they have taken the entry that provoked it. If the only survivors are the console mirrors, the notice is at least on the terminal; if none survive, there is nothing left to say it with.

Announced once per _run_ of failures — not once per entry, and not once per session. Both bounds are load-bearing, because the file sink has two unrelated failure modes: a dead fd recurs on every write and would flood the survivors, while an entry it cannot serialise (a circular or `BigInt` `context`) is transient and leaves the sink healthy. Latching for the session would let one bad `context` spend that leg's only announcement and then swallow the genuine `EBADF` that follows, so the latch clears the moment the leg writes successfully again.

### Fatal refusals

`main()` has one refusal helper, `refuseToStart(logger, sink, message, err)`, and every refusal raised after the root logger exists goes through it — the content-load failure (Invariant #14), the settings-registration failure (Invariant #35), and the dev-harness bootstrap failure. It reports through the injected logger, drains the sink, then calls `app.exit(1)`. The drain is what makes the report real: the sink buffers (`minLength: 4096`) and `app.exit()` emits no `before-quit`, so an unflushed entry dies in the buffer. Both steps are guarded so that neither can cost the exit — a consumer root launches the engine as `void main(...)`, where a bare throw is only an unhandled rejection and leaves a live, windowless process. (The report guard is defence in depth, since `createFanOutSink` already isolates the sinks; the exit must not depend on every layer of the logging stack staying total.) `handleUncaughtException` holds the same property by the same means, without the helper: its `logger.fatal` sits outside the `try…finally` that owns `proc.exit(1)` and its `flush()` runs inside that `finally`, so both are guarded individually and a crashed process still exits when the logging stack is what failed. Callers rethrow after `refuseToStart` returns where an awaiting caller needs the error. There is deliberately no `dialog.showErrorBox`: it is modal and would hang a non-interactive launch.

The one refusal that cannot use it is the Invariant #27/#77 startup guard, which must be the first statement in `main()` — before the root logger exists. It is the single sanctioned `console.error` in the main process.

---

## Crash Reporter (3 Failure Paths)

```typescript
// electron/main/logging/crash-reporter.ts
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
