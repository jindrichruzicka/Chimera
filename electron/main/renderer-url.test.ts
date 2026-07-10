import { describe, expect, it } from 'vitest';
import {
    buildRendererGameLaunchUrl,
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
} from './renderer-url';

describe('buildRendererGameLaunchUrl', () => {
    it('builds the main-menu URL carrying the explicit game id', () => {
        // Game-agnostic: the launch URL is now built per hosted game at runtime,
        // so this asserts the shape for an arbitrary id (no game constant needed).
        expect(buildRendererGameLaunchUrl('demo')).toBe(
            `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/main-menu/?gameId=demo`,
        );
    });

    it('builds a custom-route URL in the trailing-slash form of the static export', () => {
        expect(buildRendererGameLaunchUrl('demo', '/logo-screen')).toBe(
            `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/logo-screen/?gameId=demo`,
        );
    });

    it('does not double the slash for a route already in trailing-slash form', () => {
        expect(buildRendererGameLaunchUrl('demo', '/logo-screen/')).toBe(
            `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/logo-screen/?gameId=demo`,
        );
    });

    it('keeps a protocol-relative-looking route in the path — the renderer host stays the origin', () => {
        // '//evil.com' passes the contract's leading-slash check; the URL must
        // treat it as a path so createMainWindow's protocol/host guard holds.
        const url = new URL(buildRendererGameLaunchUrl('demo', '//evil.com'));
        expect(url.host).toBe(CHIMERA_RENDERER_HOST);
        expect(url.protocol).toBe(`${CHIMERA_RENDERER_PROTOCOL}:`);
    });
});
