// electron/main/game/mainGameRegistry.test.ts
//
// The main-side game registry FACTORY. These tests pin the generic, game-agnostic
// derivation the host bootstrap (index.ts) consumes: given the injected set of
// MainGameContributions, `createMainGameRegistry` selects the hosted game and
// derives the gameId-keyed lookup maps. Game-specific wiring (the tactics
// contribution) is asserted in the composition-root test
// (apps/tactics/electron/main.test.ts) — this file imports NO game, mirroring the
// package boundary F62 establishes.

import { describe, expect, it } from 'vitest';

import type { GameManifest } from '@chimera/simulation/foundation/game-manifest-contract.js';
import type { VisibilityRules } from '@chimera/simulation/projection/index.js';

import { createMainGameRegistry, type MainGameContribution } from './mainGameRegistry.js';

/** A minimal, game-agnostic contribution stub for exercising the factory. */
function makeStubContribution(
    gameId: string,
    gameVersion: string,
    overrides: Partial<MainGameContribution> = {},
): MainGameContribution {
    const manifest: GameManifest = { gameId, displayName: gameId, realtime: false };
    const visibilityRules = { stubFor: gameId } as unknown as VisibilityRules;
    return {
        gameId,
        gameVersion,
        manifest,
        registerActions: () => undefined,
        registerSettings: () => undefined,
        visibilityRules,
        resolveFirstPlayer: (config) => config.firstPlayer ?? config.hostPlayerId,
        ...overrides,
    };
}

describe('createMainGameRegistry', () => {
    it('selects the single injected contribution as the hosted game (M1 single-game lifecycle)', () => {
        const contribution = makeStubContribution('alpha', '1.2.3');

        const view = createMainGameRegistry([contribution]);

        expect(view.hostedGame).toBe(contribution);
        expect(view.mainGameRegistry['alpha']).toBe(contribution);
    });

    it('throws when zero contributions are injected (the host needs a game to run)', () => {
        expect(() => createMainGameRegistry([])).toThrow();
    });

    it('throws when more than one contribution is injected (no multi-game selection until F18)', () => {
        expect(() =>
            createMainGameRegistry([
                makeStubContribution('alpha', '1.0.0'),
                makeStubContribution('beta', '2.0.0'),
            ]),
        ).toThrow();
    });

    it('derives knownGameIds from the injected set', () => {
        const view = createMainGameRegistry([makeStubContribution('alpha', '1.0.0')]);

        expect(view.knownGameIds).toEqual(['alpha']);
    });

    it('derives the gameId → version map ReplayManager stamps onto replays', () => {
        const view = createMainGameRegistry([makeStubContribution('alpha', '4.5.6')]);

        expect(view.gameVersions.get('alpha')).toBe('4.5.6');
        expect(view.gameVersions.size).toBe(view.knownGameIds.length);
    });

    it('derives the gameId → visibility rules map for the projection resolver', () => {
        const contribution = makeStubContribution('alpha', '1.0.0');

        const view = createMainGameRegistry([contribution]);

        expect(view.visibilityRulesByGameId['alpha']).toBe(contribution.visibilityRules);
    });

    it('derives the gameId → manifest map', () => {
        const contribution = makeStubContribution('alpha', '1.0.0');

        const view = createMainGameRegistry([contribution]);

        expect(view.manifestsByGameId['alpha']).toBe(contribution.manifest);
        expect(Object.keys(view.manifestsByGameId)).toEqual(view.knownGameIds);
    });
});
