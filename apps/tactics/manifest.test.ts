import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { resolveSpectatorSupport } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { TACTICS_GAME_ID } from './simulation/constants.js';
import { tacticsManifest } from './manifest.js';

/** Width/height from a PNG's IHDR chunk (bytes 16-23, big-endian u32 pair). */
function readPngSize(relativePath: string): { width: number; height: number } {
    const bytes = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)));
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('tacticsManifest', () => {
    it('uses the canonical tactics game id', () => {
        expect(tacticsManifest.gameId).toBe(TACTICS_GAME_ID);
    });

    it('displays as "Tactics"', () => {
        expect(tacticsManifest.displayName).toBe('Tactics');
    });

    it('is turn-based: realtime is false so no heartbeat ticker runs', () => {
        expect(tacticsManifest.realtime).toBe(false);
    });

    it('does not override the app icon (defaults to the Chimera icon)', () => {
        expect(tacticsManifest.icon).toBeUndefined();
    });

    it('declares a hardware cursor texture for every engine cursor role (#847)', () => {
        expect(tacticsManifest.cursor).toEqual({
            default: { image: 'cursors/default.png' },
            pointer: { image: 'cursors/pointer.png' },
            disabled: { image: 'cursors/disabled.png' },
        });
    });

    it.each(['default', 'pointer', 'disabled'])(
        'ships the %s cursor as a 32x32 placeholder PNG (user-overwrite stand-in)',
        (role) => {
            expect(readPngSize(`./assets/cursors/${role}.png`)).toEqual({
                width: 32,
                height: 32,
            });
        },
    );

    it('declares the engine default logo screen so a packaged boot lands on it (#856)', () => {
        expect(tacticsManifest.logoScreen).toEqual({ route: '/logo-screen' });
    });

    it('re-exports the engine logo-screen page at the declared route (#856)', () => {
        const pageSource = readFileSync(
            fileURLToPath(new URL('./renderer/app/logo-screen/page.tsx', import.meta.url)),
            'utf8',
        );
        expect(pageSource).toContain(
            "export { default } from '@chimera-engine/renderer/shell/logo-screen/page';",
        );
    });

    it('declares English and Czech UI languages, English first (default)', () => {
        expect(tacticsManifest.languages).toEqual([
            { code: 'en-US', label: 'English' },
            { code: 'cs-CZ', label: 'Čeština' },
        ]);
    });

    it('opts into perspective-following spectators (#882)', () => {
        expect(tacticsManifest.spectators).toEqual({ mode: 'perspective' });
        expect(resolveSpectatorSupport(tacticsManifest)).toEqual({ mode: 'perspective' });
    });
});
