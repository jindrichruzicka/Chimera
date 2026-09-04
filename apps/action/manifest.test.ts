import { describe, expect, it } from 'vitest';
import {
    resolveGameLanguages,
    resolveMatchHistorySupport,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

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

    it('declares no undo and keeps replay recording', () => {
        expect(actionManifest.matchHistory).toStrictEqual({ undo: false, replay: true });
    });

    it('leaves retainActions to the real-time default', () => {
        // Declared explicitly for `undo`/`replay` because the intent is worth
        // reading off the manifest; the retention bound has no such intent, so
        // it stays whatever the mode resolves to.
        expect(actionManifest.matchHistory?.retainActions).toBeUndefined();
    });

    it('resolves to the same capability the real-time default would give it', () => {
        // Asserted through the engine's own reader: the declaration is
        // documentation, not a behaviour change, so removing it must resolve
        // identically.
        const { matchHistory: _declared, ...undeclared } = actionManifest;

        expect(resolveMatchHistorySupport(actionManifest)).toStrictEqual(
            resolveMatchHistorySupport(undeclared),
        );
        expect(resolveMatchHistorySupport(actionManifest).undo).toBe(false);
        expect(resolveMatchHistorySupport(actionManifest).replay).toBe(true);
    });
});
