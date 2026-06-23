export const CHIMERA_RENDERER_PROTOCOL = 'chimera';
export const CHIMERA_RENDERER_HOST = 'renderer';
export const CHIMERA_RENDERER_URL: ChimeraRendererUrl =
    `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/index.html` as ChimeraRendererUrl;

/**
 * Build the renderer launch URL for a hosted game. The production launch URL is
 * no longer a module constant — the host names no game, so `main()` builds it at
 * runtime from the injected hosted game's id (the seam F62 introduces).
 */
export function buildRendererGameLaunchUrl(gameId: string): ChimeraRendererUrl {
    const url = new URL(`${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/main-menu/`);
    url.searchParams.set('gameId', gameId);
    return url.toString() as ChimeraRendererUrl;
}

/**
 * Branded string that represents a validated `chimera://renderer/…` URL.
 *
 * The only way to mint a value of this type at runtime is via
 * `sanitiseE2eInitialUrl`, which verifies protocol and host.  Accepting
 * `ChimeraRendererUrl` in `CreateMainWindowOptions.initialUrl` instead of
 * plain `string` makes it a TypeScript compile-error to pass an unvalidated
 * URL to `createMainWindow`.
 */
export type ChimeraRendererUrl = string & { readonly __brand: 'ChimeraRendererUrl' };
