import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { __GAME_CONSTANT___GAME_ID } from './simulation/constants.js';
import { __gameCamel__Manifest } from './manifest.js';

// Manifest unit smoke — proves the game's registration descriptor wires up from one
// source of truth (the canonical game-id constant). Assert only on the blank seams
// every scaffolded game starts with; replace/extend as your manifest grows.
describe('__gameCamel__Manifest', () => {
    it('uses the canonical __game_kebab__ game id', () => {
        expect(__gameCamel__Manifest.gameId).toBe(__GAME_CONSTANT___GAME_ID);
    });

    it('displays as "__Game Title__"', () => {
        expect(__gameCamel__Manifest.displayName).toBe('__Game Title__');
    });

    it('is turn-based: realtime is false so no heartbeat ticker runs', () => {
        expect(__gameCamel__Manifest.realtime).toBe(false);
    });

    it('brands the app with its own committed icon under the game asset dir', () => {
        // Renderer-relative path the F67 resolver maps to apps/<gameId>/assets/icons/icon.png;
        // electron-builder reuses the same PNG for the distributable bundle icon.
        expect(__gameCamel__Manifest.icon).toBe('icons/icon.png');
    });

    it('declares the engine default logo screen so a packaged boot lands on it', () => {
        expect(__gameCamel__Manifest.logoScreen).toEqual({ route: '/logo-screen' });
    });

    it('re-exports the engine logo-screen page at the declared route', () => {
        const pageSource = readFileSync(
            fileURLToPath(new URL('./renderer/app/logo-screen/page.tsx', import.meta.url)),
            'utf8',
        );
        expect(pageSource).toContain(
            "export { default } from '@chimera-engine/renderer/shell/logo-screen/page';",
        );
    });
});
