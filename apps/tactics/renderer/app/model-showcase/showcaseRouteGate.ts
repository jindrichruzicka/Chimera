/**
 * showcaseRouteGate.ts — build-time gate for the `/model-showcase/` route.
 *
 * The model showcase is a TEST screen: it renders the two showcase rigs —
 * `showcase-rig.glb` and `showcase-rig-animated.glb`, placeholder meshes both —
 * and nothing a player would ever want to see, so the packaged app refuses the
 * route.
 *
 * Same flag, same reasoning, same call-time evaluation, and the same
 * refuses-the-route-only reach (the screen's chunk stays in the export) as
 * the engine's component-gallery gate — see
 * `renderer/app/component-gallery/galleryGate.ts` for why the packaged flag
 * rather than `NODE_ENV`.
 *
 * What is specific here: BOTH rigs the asset manifest declares ship regardless
 * of this gate.
 */

export function isModelShowcaseEnabled(): boolean {
    return process.env['NEXT_PUBLIC_CHIMERA_PACKAGED'] !== '1';
}
