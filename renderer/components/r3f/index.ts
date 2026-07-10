/**
 * renderer/components/r3f/index.ts
 *
 * Public in-Canvas component barrel (`@chimera-engine/renderer/components/r3f`).
 * Engine-owned R3F components a game mounts inside its own <Canvas> — the only
 * renderer R3F surface game apps may import (Invariant #96).
 *
 * Keep this barrel curated: internals (GameCanvas, InteractionBlocker, shell/*)
 * are NOT exported.
 */

export { PerfProbe } from '../shell/perf/PerfProbe';
