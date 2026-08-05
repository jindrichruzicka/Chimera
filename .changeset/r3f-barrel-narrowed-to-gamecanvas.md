---
'@chimera-engine/renderer': minor
---

Narrow the public r3f barrel (`@chimera-engine/renderer/components/r3f`) to `GameCanvas`, `useModelAnimation`, and the camera types. Removed exports: `PerfProbe`, `FrameRateLimiter`, `useEngineFrameloop`, and the `EngineFrameloop` type.

The three runtime exports existed only so a game owning its own `<Canvas>` could re-wire what `GameCanvas` already wires — the perf probe, the frame-rate-cap driver, and the `frameloop` prop. That hatch is closed inside the 1.0.0 RC window: `GameCanvas` (`role="main" | "overlay"`) is the only canvas root a game mounts, wires all three itself, and a minimap or preview mounts as a second `<GameCanvas role="overlay">` instead of a raw `<Canvas>`. The modules stay in the engine and keep being mounted by `GameCanvas`; only their public re-export is gone.
