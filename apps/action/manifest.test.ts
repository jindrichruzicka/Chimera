import { describe, expect, it } from 'vitest';
import { resolveGameLanguages } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { ACTION_GAME_ID, ACTION_TICK_RATE_MS } from './simulation/constants.js';
import { actionManifest } from './manifest.js';

// The action app is the engine's first REALTIME consumer, and this manifest is
// what makes it one: `realtime: true` is the single flag the host reads to start
// a `RealtimeTicker`. The rest of the assertions hold the surface deliberately
// minimal — the shell tasks add the menu-facing declarations later.
describe('actionManifest', () => {
    it('uses the canonical action game id', () => {
        expect(actionManifest.gameId).toBe(ACTION_GAME_ID);
    });

    it('displays as "Action"', () => {
        expect(actionManifest.displayName).toBe('Action');
    });

    it('opts into the wall-clock heartbeat', () => {
        expect(actionManifest.realtime).toBe(true);
    });

    it('pins the heartbeat to the simulation’s own tick rate', () => {
        // One source of truth: the sim's beat pass and the host's ticker must
        // agree, so the manifest reads the constant rather than a second literal.
        expect(actionManifest.tickRateMs).toBe(ACTION_TICK_RATE_MS);
    });

    it('declares no cursor, logo screen or icon override', () => {
        // This app ships no cursor art and no boot sequence, so the engine
        // defaults apply.
        expect(actionManifest.cursor).toBeUndefined();
        expect(actionManifest.logoScreen).toBeUndefined();
        expect(actionManifest.icon).toBeUndefined();
    });

    it('names the ONE locale its translation bundle is keyed at', () => {
        // The registry loader dev-warns for every contributed bundle whose
        // locale matches no declared language, so an app that ships a bundle
        // owes the declaration even when it ships only one.
        expect(actionManifest.languages).toEqual([{ code: 'en-US', label: 'English' }]);
    });

    it('is single-language, so the engine hides the language selector', () => {
        // Asserted through `resolveGameLanguages`, the engine's own reader, so
        // the claim is about what the engine SEES rather than about the field:
        // one declared language resolves to `undefined`, exactly as none does.
        expect(resolveGameLanguages(actionManifest)).toBeUndefined();
    });

    it('admits no spectators', () => {
        expect(actionManifest.spectators).toBeUndefined();
    });
});
