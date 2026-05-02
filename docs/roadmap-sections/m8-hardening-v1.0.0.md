---
title: 'M8 — Hardening (v1.0.0)'
description: 'F43–F49: Crash Reporter/Error Boundaries, Replay System, Chat System, Toast Notification System, Debug Inspector, Multiplayer/Obfuscation Soak Tests, and Performance Baseline/NAT Diagnostics. Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified.'
tags:
    [
        milestone,
        m8,
        hardening,
        crash-reporter,
        replay,
        chat,
        toast,
        debug-inspector,
        soak-tests,
        performance,
        nat,
    ]
---

# M8 — Hardening (v1.0.0)

> **Goal**: Production-grade quality: soak tests pass, Debug Inspector ships, performance baseline met, commitment anti-tamper verified.
> Architecture sections: §4.12, §4.27, §4.28, §4.29, §4.30, §10, §11

---

## F43 — Crash Reporter and Error Boundaries `§4.27`

**Note**: Pino backing and `createPinoSink()` are already implemented in `logging/logger.ts`. This issue focuses on crash-dump configuration and error boundaries.

Implement `crash-reporter.ts` (`uncaughtException`, `unhandledRejection`, `render-process-gone` handlers), autosave-before-crash-dump, atomic crash dump write, and `ToastHost` / `RootErrorBoundary` sibling mount ordering. Wire `rendererLogger` forwards to main via `window.__chimera.logs`. Configure Pino daily log rotation (userData/logs/) with retention policy.

---

## F44 — Replay System `§4.28`

Implement `ReplayFile`, `ReplaySerializer` (JSON + compressed), `ReplayPlayer` (reuses live `ActionPipeline`), and `ReplayManager` (record, finalise, load, list). Wire `window.__chimera.replay` IPC surface. Add cross-version compatibility guard.

---

## F45 — Chat System `§4.29`

Implement `ChatRelay` (token bucket rate limiting, length cap, scope filter), `chatStore` (500-entry rolling buffer), `ChatPanel.tsx`, `window.__chimera.chat` IPC surface, and mute/unmute. Wire `CHAT` messages as `SideChannelMessage`, not `EngineAction`.

---

## F46 — Toast Notification System `§4.30`

Implement `toastStore`, `ToastHost.tsx` (stacked, animated, `reducedMotion`-aware), auto-dismiss durations, and engine-wired sources (disconnect, save failure, replay export, chat rate-limit, profile rejection).

---

## F47 — Debug Inspector `§4.12`

Implement `SnapshotRingBuffer`, `SnapshotInspector`, `SnapshotDiff`, `DebugProtocol`, `debug-bridge.ts`, and `debug-api.ts`. Launch Inspector `BrowserWindow` when `CHIMERA_DEBUG=1`. Build all six Inspector panels (Timeline, Snapshot Inspector, Projection Explorer, Diff View, Action Log, Performance). Enforce `IS_DEBUG_MODE` production guard.

---

## F48 — Multiplayer Soak and Obfuscation Soak Tests `§10`

Run 1 000-tick, 4-client soak with checksum convergence at every step. Run 10 000-snapshot obfuscation soak asserting zero `owner-only` field leaks. Verify commitment anti-tamper (tampered `REVEAL` value and nonce detected by `verify()`).

---

## F49 — Performance Baseline and NAT Diagnostics `§11, §6`

Establish and gate: main process tick ≤ 16 ms at 20 Hz, renderer heap ≤ 32 MB. Implement connection diagnostics UI (local IP, port-forward guide). Add STUN relay extension point in `ServerConnection.ts` without core changes.

---

## Cross-References

- [Logging & Crash Reporting](../core-components/logging-crash-reporting.md)
- [Replay System](../core-components/replay-system.md)
- [Chat System](../core-components/chat-system.md)
- [Toast Notification System](../core-components/toast-notification-system.md)
- [Runtime Debug Layer](../core-components/runtime-debug-layer.md)
- [Testing Strategy](../testing/property-tests-soak.md) — soak test scenarios
- [E2E Testing (Playwright)](../testing/e2e-testing-playwright.md) — multiplayer-soak.spec.ts, obfuscation.spec.ts
