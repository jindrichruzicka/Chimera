---
title: 'Chimera Coding Standards — §10 Error Handling'
description: 'Typed domain errors, result types vs exceptions, and IPC error propagation rules for the Chimera engine.'
tags:
    [
        error-handling,
        typed-errors,
        result-types,
        exceptions,
        IPC,
        RootErrorBoundary,
        coding-standards,
    ]
---

# §10 Error Handling

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 10.1 Error types

- Domain errors are typed and documented in the architecture spec. Use the exact class names and shapes declared there (e.g. `UnknownActionTypeError`, `ContentConflictError`, `SaveSchemaTooNewError`).
- Do not throw plain `new Error('string')` in domain code. Create a typed error class extending `Error` with a descriptive `name` property.
- Do not use `try/catch` to swallow errors silently. Either handle and recover, or re-throw with added context.

## 10.2 Result types vs exceptions

- Use exceptions for **programmer errors** and **unrecoverable failures** (e.g. invariant violations, corrupt data, missing required config).
- Use result types (`{ ok: true; value: T } | { ok: false; error: E }`) for **expected failure paths** at domain boundaries (e.g. `validate()` returning a `ValidationResult`).

## 10.3 IPC error propagation

- IPC handler errors are caught by the preload bridge and surfaced as typed rejections to the renderer. Never let an uncaught exception crash the main process from an IPC handler.
- The renderer's `RootErrorBoundary` catches render-phase errors and renders a recovery UI.
