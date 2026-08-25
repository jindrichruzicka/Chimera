/**
 * renderer/__tests__/quick-start-contract-boundary.test.ts
 *
 * Cross-boundary compatibility guard: the quick-start data contract
 * (`simulation/foundation/quick-start-contract.ts`) must be reachable and
 * type-check from `renderer/` on the SAME contract path the renderer already
 * uses for `game-lobby-contract.js` — no new module-boundary exception
 * (§3 Module Boundary Table: `renderer/` may import the `simulation/foundation`
 * contracts). The electron half of this guard lives in
 * `electron/main/lobby/lobbySetupRegistry.test.ts`.
 *
 * The measuring instrument here is `tsc --noEmit -p renderer/tsconfig.json`
 * (plus `eslint`'s import-boundary zone), not the runtime assertions: the
 * contract is type-only, so the bodies below read back literals they declare
 * and exist to give the compiler something in this zone to check.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 *
 * Tests written first (TDD — red confirmed: the module did not exist before
 * this commit; `tsc --noEmit -p renderer/tsconfig.json` reported
 * "Cannot find module '@chimera-engine/simulation/foundation/quick-start-contract.js'").
 */

import { describe, it, expect } from 'vitest';
import type {
    QuickStartConfig,
    QuickStartSeat,
    QuickStartAiSeat,
} from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import type { GameLobbySetup } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';

describe('QuickStartConfig from renderer/', () => {
    it('type-checks and carries every seat kind', () => {
        const localSeat: QuickStartSeat = { attributes: { team: 'blue' } };
        const aiSeat: QuickStartAiSeat = { attributes: { team: 'green' }, omniscient: true };
        const config: QuickStartConfig = {
            matchSettings: { mapSize: 'small' },
            hostAttributes: { team: 'red' },
            localSeats: [localSeat],
            aiSeats: [aiSeat],
        };

        expect(config.localSeats).toEqual([{ attributes: { team: 'blue' } }]);
        expect(config.aiSeats?.[0]?.omniscient).toBe(true);
    });

    it('rides the optional GameLobbySetup.quickStart defaults block', () => {
        const setup: GameLobbySetup = {
            maxPlayers: 2,
            matchSettingsDefaults: {},
            matchSettingsOptions: {},
            playerAttributeOptions: {},
            resolveDefaultPlayerAttributes: () => ({}),
            quickStart: { aiSeats: [{ attributes: { team: 'green' } }] },
        };

        expect(setup.quickStart?.aiSeats?.[0]?.attributes).toEqual({ team: 'green' });
    });
});
