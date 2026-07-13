/**
 * deterministicReplayGate.ts — build-time gate for the deterministic replay
 * surface in the replay browser (§4.28).
 *
 * Deterministic replays (`.chimera-replay`, Invariant #71) are a debug artifact:
 * they re-simulate from a seed + full action log and are useful for debugging,
 * but confusing to players. They are always written to disk; this gate only
 * decides whether the replay browser *surfaces* them. Perspective replays —
 * what the player recorded from their own point of view — are always shown.
 *
 * Visible in EVERY launch except the packaged production app: the VSCode build
 * tasks, a bare `electron apps/tactics`, a plain `next build`, and E2E builds
 * all show them. Only the `package:tactics*` scripts set
 * `NEXT_PUBLIC_CHIMERA_PACKAGED=1` before `next build`, which `next`'s
 * DefinePlugin inlines into this bundle and flips the gate off.
 *
 * Why a packaged flag and not `NODE_ENV` (nor the main-process `CHIMERA_DEBUG`
 * env): the renderer is a static export, so `next build` bakes
 * `NODE_ENV='production'` into every bundle — dev launches included — and the
 * runtime debug env never reaches the frozen renderer bundle. The packaging
 * scripts are the only build-time signal that a bundle is destined for the
 * shipped app. Shares this rationale with `component-gallery/galleryGate.ts`.
 *
 * Evaluated at call time so unit tests can inject the env before each call.
 */

export function areDeterministicReplaysVisible(): boolean {
    return process.env['NEXT_PUBLIC_CHIMERA_PACKAGED'] !== '1';
}
