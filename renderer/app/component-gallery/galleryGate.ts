/**
 * galleryGate.ts — runtime gate for the component-gallery route.
 *
 * Evaluates env vars at call time so unit tests can inject values before each call.
 */

export function isGalleryEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' || process.env['NEXT_PUBLIC_CHIMERA_E2E'] === '1';
}
