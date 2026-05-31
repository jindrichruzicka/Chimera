import { TACTICS_GAME_ID } from '@chimera/shared/tactics.js';

export const CHIMERA_RENDERER_PROTOCOL = 'chimera';
export const CHIMERA_RENDERER_HOST = 'renderer';
export const CHIMERA_RENDERER_URL: ChimeraRendererUrl =
    `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/index.html` as ChimeraRendererUrl;
export const CHIMERA_RENDERER_LAUNCH_URL: ChimeraRendererUrl =
    buildRendererGameLaunchUrl(TACTICS_GAME_ID);

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
