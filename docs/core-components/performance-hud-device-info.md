---
title: 'Performance HUD & Device Info'
description: 'PerfHud 9-metric overlay (FPS/frame-time/sim-tick/ping/heap/draw-calls/triangles), PerfProbe R3F collector, perfStore, DeviceInfo interface, SizeClass breakpoints, and useDeviceInfo/usePrimaryInput/useWindowSizeClass hooks.'
tags: [performance, hud, device-info, monitoring, renderer]
---

# Performance HUD & Device Info

> §4.16–§4.17 of the Chimera architecture.
> Related: [Renderer State Stores](renderer-state-stores.md) · [Settings System](settings-system.md) · [Runtime Debug Layer](runtime-debug-layer.md)

---

## 4.16 Performance HUD

### Overview

A lightweight floating overlay showing key performance numbers at a glance. Toggle via `F3` or `engine.gameplay.showPerfHud = true` in settings. Off by default in production. Not a replacement for the Inspector Window (§4.12) — the HUD covers real-time metrics; the Inspector Window covers tick-level history and projection correctness.

### Metrics

| Metric             | Source                                                                | Updated every  |
| ------------------ | --------------------------------------------------------------------- | -------------- |
| FPS                | `useFrame` frame count in rolling 1 s window                          | 500 ms         |
| Frame time avg/p95 | R3F `useFrame` `deltaSeconds`; last 120 frames                        | 500 ms         |
| Sim tick           | `PlayerSnapshot.tick` from `gameStore`                                | On snapshot    |
| Actions/sec        | Rolling count of snapshots received in last 1 s                       | 500 ms         |
| Action round-trip  | `sendAction()` stamp → matching `onSnapshot()` tick advance           | Per own-action |
| Network ping (ms)  | `PING`/`PONG` from `ClientTransport`, via `system.onConnectionStatus` | Every 2 s      |
| Renderer heap (MB) | `performance.memory.usedJSHeapSize` (Chromium)                        | Every 1 s      |
| R3F draw calls     | `gl.info.render.calls`                                                | 500 ms         |
| R3F triangles      | `gl.info.render.triangles`                                            | 500 ms         |

Numbers display with colour markers — green / amber / red — against configurable thresholds (e.g. FPS < 30 = red).

### Interface

```typescript
// renderer/components/shell/perf/PerfHud.tsx

interface PerfSample {
    fps: number;
    frameMsAvg: number;
    frameMsP95: number;
    simTick: number;
    actionsPerSec: number;
    actionRoundTripMs: number | null;
    pingMs: number | null;
    heapMb: number | null;
    drawCalls: number;
    triangles: number;
}

// Mounted once in GameShell. Reads perfStore samples produced by renderer probes.
// Visible if F3-toggled OR engine.gameplay.showPerfHud === true
export function PerfHud(): JSX.Element | null;
```

`PerfProbe` is mounted by `GameCanvas` inside each R3F `<Canvas>` root. It writes
FPS, frame-time, draw-call, and triangle samples into `perfStore`; `PerfHud` reads
those samples from shell chrome without calling R3F hooks outside a canvas.

### Module Tree

```
renderer/components/shell/
└── perf/
    ├── PerfHud.tsx      # Floating panel
    ├── PerfProbe.tsx    # Hidden R3F component: collects per-frame GL stats
    └── perfStore.ts     # Zustand store: rolling samples
```

### Settings Integration

```typescript
interface EngineSettings {
    gameplay: {
        showPerfHud: boolean; // Default: false. Forces HUD visible regardless of F3.
    };
}
```

---

## 4.17 Device Info

### Overview

Exposes reliable Electron-detectable desktop facts — OS, screen layout, window size class, active input modalities — to game screens and GameShell for layout and affordance decisions.

> **Not** a fingerprinting or mobile-detection tool. Electron is desktop-only; `formFactor` is a conservative heuristic among desktop variants.

### DeviceInfo Interface

```typescript
// renderer/device/DeviceInfo.ts

type DeviceFormFactor = 'desktop' | 'laptop' | 'tablet-convertible' | 'unknown';
type InputModality = 'mouse' | 'keyboard' | 'touch' | 'pen' | 'gamepad';
type SizeClass = 'compact' | 'regular' | 'large' | 'ultrawide';

interface DeviceInfo {
    // Platform (from Electron main process)
    readonly os: 'macos' | 'windows' | 'linux';
    readonly osVersion: string;
    readonly arch: 'x64' | 'arm64';
    readonly electronVer: string;
    readonly chromiumVer: string;
    readonly locale: string; // BCP 47 tag

    // Form factor (conservative heuristic)
    readonly formFactor: DeviceFormFactor;

    // Display
    readonly screens: readonly {
        readonly id: number;
        readonly width: number; // logical px
        readonly height: number;
        readonly pixelRatio: number;
        readonly refreshHz: number;
        readonly primary: boolean;
    }[];
    readonly windowSizeClass: SizeClass;

    // Input (detected in renderer)
    readonly inputs: readonly InputModality[];
    readonly primaryInput: InputModality;

    // Battery (laptops only; null on desktops)
    readonly battery: { charging: boolean; level: number } | null;
}
```

### Window Size Class Breakpoints

| Class       | Content width (CSS px) | Typical target                      |
| ----------- | ---------------------- | ----------------------------------- |
| `compact`   | < 960                  | Small laptop windowed, split-screen |
| `regular`   | 960–1440               | Standard laptop / small desktop     |
| `large`     | 1441–2560              | Large desktop monitor               |
| `ultrawide` | > 2560                 | 34"+ monitors, multi-screen spans   |

### Detection Sources

| Field               | Source                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `os/osVersion/arch` | `process.platform`, `os.release()`, `process.arch` (main)                                                          |
| `screens[]`         | `screen.getAllDisplays()` (Electron main)                                                                          |
| `windowSizeClass`   | `BrowserWindow` content size; re-derived on resize                                                                 |
| `inputs[]`          | `navigator.maxTouchPoints`, `PointerEvent` types, `navigator.getGamepads()`                                        |
| `primaryInput`      | Most recent `pointerdown` / `keydown` / `gamepadconnected`                                                         |
| `battery`           | `navigator.getBattery()` where supported                                                                           |
| `formFactor`        | Heuristic: touch-only + small screen → `tablet-convertible`; battery → `laptop`; else `desktop`; unknown if unsure |

### SystemAPI Additions

```typescript
interface SystemAPI {
    getDeviceInfo(): Promise<DeviceInfo>;
    onDeviceInfoChange(cb: (info: DeviceInfo) => void): Unsubscribe;
}
```

### React Hooks

```typescript
// renderer/device/useDeviceInfo.ts
export function useDeviceInfo(): DeviceInfo;
export function usePrimaryInput(): InputModality;
export function useWindowSizeClass(): SizeClass;
```

### Module Tree

```
renderer/device/
├── DeviceInfo.ts          # Interface + types
├── DeviceInfoProvider.ts  # Merges main-process snapshot + live DOM signals
├── useDeviceInfo.ts       # React hooks
└── inputTracker.ts        # pointer/keyboard/gamepad events → updates primaryInput

electron/main/
└── device-probe.ts        # OS/screen facts; pushes updates via system IPC
```

### Where It's Used

| Consumer           | Use                                                           |
| ------------------ | ------------------------------------------------------------- |
| `GameShell.tsx`    | HUD layout based on `windowSizeClass`                         |
| `SettingsPage.tsx` | "About" block: OS / locale / Electron version for bug reports |
| `PerfHud.tsx`      | Optional extra line: `primary: mouse · 2560×1440@144`         |
| Game screens       | Swap pointer vs. touch affordances via `usePrimaryInput()`    |

---

## Cross-References

- [Settings System](settings-system.md) — `gameplay.showPerfHud` setting
- [Runtime Debug Layer](runtime-debug-layer.md) — deeper tick-level performance via Inspector Window
- [Electron Shell](electron-shell-ipc-bridge.md) — `SystemAPI.getDeviceInfo()`
