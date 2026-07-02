/**
 * galleryGate.ts — build-time gate for the component-gallery route + button.
 *
 * The dev-only Component Gallery is visible in EVERY launch except the packaged
 * production app: the VSCode build tasks, a bare `electron apps/tactics`, a plain
 * `next build`, and E2E builds all show it. Only the `package:tactics*` scripts
 * set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` before `next build`, which `next`'s
 * DefinePlugin inlines into this bundle and flips the gate off (button hidden,
 * route 404s).
 *
 * Why a packaged flag and not `NODE_ENV`: the renderer is a static export, so
 * `next build` bakes `NODE_ENV='production'` into every bundle — dev launches
 * included — making it useless for distinguishing dev from packaged. The
 * packaging scripts are the only build-time signal that a bundle is destined for
 * the shipped app.
 *
 * Evaluated at call time so unit tests can inject the env before each call.
 */

export function isGalleryEnabled(): boolean {
    return process.env['NEXT_PUBLIC_CHIMERA_PACKAGED'] !== '1';
}
