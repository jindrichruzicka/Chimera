---
title: 'Toast Notification System'
description: 'ToastSeverity enum, Toast interface (id/severity/title/body/durationMs/action/createdAt), ToastStore, ToastHost.tsx (sibling of RootErrorBoundary, reducedMotion-aware), engine-wired event sources table, and Invariant #74.'
tags: [toast, notification, ui, renderer, accessibility]
---

# Toast Notification System

> §4.30 of the Chimera architecture.
> Related: [Logging & Crash Reporting](logging-crash-reporting.md) · [Chat System](chat-system.md) · [Player Profiles & Directory](player-profiles-directory.md)

---

## Overview

Ephemeral in-app notification banners ("toasts") surface engine and system events to the player without requiring interactive acknowledgement. Toasts outlive React subtree crashes and match the current accessibility preferences.

---

## Core Types

```typescript
// renderer/state/toastStore.ts

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
    readonly id: string; // UUID, assigned at creation
    readonly severity: ToastSeverity;
    readonly title: string;
    readonly body?: string; // Optional supporting text
    readonly durationMs?: number; // If absent, uses severity default
    readonly action?: {
        readonly label: string;
        readonly onClick: () => void;
    };
    readonly createdAt: number; // performance.now()
}
```

### Default Durations by Severity

| Severity  | Duration |
| --------- | -------- |
| `info`    | 4 000 ms |
| `success` | 3 000 ms |
| `warning` | 6 000 ms |
| `error`   | 8 000 ms |

---

## ToastStore (Zustand)

```typescript
interface ToastStore {
    readonly queue: ReadonlyArray<Toast>;
    push(toast: Omit<Toast, 'id' | 'createdAt'>): void;
    dismiss(id: string): void;
    dismissAll(): void;
}
```

---

## ToastHost.tsx

```tsx
// renderer/components/shell/ToastHost.tsx

// Renders stacked toast banners anchored to the bottom-right.
// Animated with CSS transitions; honours prefers-reduced-motion.
// Must be mounted as a sibling of RootErrorBoundary — NOT inside it (see §4.27).
```

Stack order: newest toast on bottom (slides up on enter, fades out on dismiss). `prefers-reduced-motion: reduce` suppresses slide animation, retaining fade.

---

## Engine-Wired Sources

Engine systems push toasts via `toastStore.push()` automatically without game code involvement:

| Trigger                    | Severity  | Title                          |
| -------------------------- | --------- | ------------------------------ |
| Opponent disconnected      | `warning` | "Player disconnected"          |
| Opponent reconnected       | `info`    | "Player reconnected"           |
| Save failed                | `error`   | "Save failed"                  |
| Replay saved (save intent) | `success` | "Replay saved"                 |
| Chat rate-limited          | `warning` | "Sending messages too quickly" |
| Profile admission rejected | `error`   | "Profile rejected: {reason}"   |

The replay-exported toast (`chimera:replay:exported`) fires only when the post-game **Save Replay** action is taken (`exportCurrentMatch('save')`). The **Replay** action calls `exportCurrentMatch('view')` purely to obtain a stable on-disk path for `openInPlayer`; the main handler suppresses the push for the `'view'` intent so no misleading "Replay saved" toast appears (§4.28 / Invariant #74).

---

## Shell-Root Mount Ordering

As covered in §4.27, `ToastHost` must be a **sibling** of `RootErrorBoundary`, not a descendant:

```tsx
export function AppShell({ children }: { children: ReactNode }) {
    return (
        <>
            <RootErrorBoundary>{children}</RootErrorBoundary>
            <ToastHost /> {/* survives error-boundary catches */}
        </>
    );
}
```

---

## Invariant

| #   | Rule                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #74 | `ToastHost` is mounted as a sibling of `RootErrorBoundary`, never inside it. Severity-to-duration defaults are the single source of truth for display lifetime — individual call sites must not invent arbitrary durations except for exceptional cases with a code comment. |

---

## Cross-References

- [Logging & Crash Reporting](logging-crash-reporting.md) — `RootErrorBoundary` sibling requirement
- [Chat System](chat-system.md) — chat rate-limit toast source
- [Player Profiles & Directory](player-profiles-directory.md) — profile rejection toast source
