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
});
