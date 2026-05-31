import { describe, expect, it } from 'vitest';
import { TACTICS_GAME_ID } from '@chimera/shared/tactics.js';
import {
    buildRendererGameLaunchUrl,
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_LAUNCH_URL,
    CHIMERA_RENDERER_PROTOCOL,
} from './renderer-url';

describe('buildRendererGameLaunchUrl', () => {
    it('builds the main menu URL with explicit launch game context', () => {
        expect(buildRendererGameLaunchUrl(TACTICS_GAME_ID)).toBe(
            `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/main-menu/?gameId=tactics`,
        );
    });

    it('exposes the default app launch URL with the Tactics game id', () => {
        expect(CHIMERA_RENDERER_LAUNCH_URL).toBe(buildRendererGameLaunchUrl(TACTICS_GAME_ID));
    });
});
