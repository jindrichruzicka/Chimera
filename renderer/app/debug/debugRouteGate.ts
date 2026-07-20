/**
 * debugRouteGate.ts — build-time gate for the Inspector route (§4.12).
 *
 * The Inspector UI is a dev-only surface, visible in EVERY launch except the
 * packaged production app: the VSCode build tasks, a bare `electron apps/tactics`,
 * a plain `next build`, and E2E builds all serve it. Only the `package:tactics*`
 * scripts set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` before `next build`, which `next`'s
 * DefinePlugin inlines into this bundle and flips the gate off (route 404s).
 *
 * Why a packaged flag and not `NODE_ENV`: the renderer is a static export, so
 * `next build` bakes `NODE_ENV='production'` into every bundle — dev launches
 * included — making it useless for distinguishing dev from packaged. The
 * packaging scripts are the only build-time signal that a bundle is destined for
 * the shipped app. Identical reasoning to `galleryGate`; see it for the long form.
 *
 * This is defence in depth, not the primary control. A distributable never
 * creates the Inspector window in the first place: `electron/main/index.ts` gates
 * the debug bridge on an expression the app bundler folds to `false`, and the
 * packaged build ships no `debug-api.js` preload, so `window.__chimeraDebug` can
 * never exist. Gating here turns a reachable-but-inert route into a 404.
 *
 * It does NOT remove the panel JavaScript: Next still emits the route's chunk,
 * and only the prerendered page becomes a 404 (identical to `galleryGate` — the
 * known behaviour of this pattern, measured, not an oversight here). The bytes
 * are saved on the Electron side, not this one.
 *
 * Evaluated at call time so unit tests can inject the env before each call.
 */

export function isDebugInspectorRouteEnabled(): boolean {
    return process.env['NEXT_PUBLIC_CHIMERA_PACKAGED'] !== '1';
}
