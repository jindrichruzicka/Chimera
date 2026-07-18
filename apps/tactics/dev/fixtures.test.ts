/**
 * apps/tactics/dev/fixtures.test.ts
 *
 * Contract test for this game's dev-harness fixtures (§4.32): every profile
 * under `dev/profiles/` and every scenario under `dev/scenarios/` must parse
 * against the engine's fixture schemas, and every scenario value must belong
 * to this game's own lobby vocabulary (content-driven colours, turn modes) —
 * so a palette or setting rename can never silently strand the fixtures.
 *
 * This file is the pattern a game copies to keep its own `dev/` honest.
 * Reading the co-located fixture JSON is static test data, not runtime FS.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
    DevScenarioSchema,
    type DevScenario,
} from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';
import { EngineProfileSchema } from '@chimera-engine/simulation/profile/ProfileSchema.js';
import { ALLOW_SPECTATORS_SETTING } from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import {
    TACTICS_GAME_ID,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera-engine/tactics/simulation/constants.js';
import { TACTICS_MAX_PLAYERS } from '@chimera-engine/tactics/lobby/lobby-setup.js';

const devDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(devDir);

function readJsonDir(dir: string): ReadonlyMap<string, unknown> {
    return new Map(
        readdirSync(dir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown]),
    );
}

const profiles = readJsonDir(join(devDir, 'profiles'));
const scenarios = readJsonDir(join(devDir, 'scenarios'));

/** Content-driven vocabulary: the ids under data/<collection> ARE the palette. */
function contentIds(collection: string): readonly string[] {
    return [...readJsonDir(join(appDir, 'data', collection)).values()].map(
        (entry) => (entry as { id: string }).id,
    );
}

const boardColorIds = contentIds('board-colors');
const playerColorIds = contentIds('player-colors');
const turnModes = ['sequential', 'commitment'];

describe('tactics dev fixtures — profiles', () => {
    it('ships at least one profile and every profile parses as an engine profile', () => {
        expect(profiles.size).toBeGreaterThan(0);
        for (const [name, json] of profiles) {
            const parsed = EngineProfileSchema.safeParse(json);
            expect(parsed.success, `${name} must parse as an EngineProfile`).toBe(true);
        }
    });

    it('gives every profile a distinct localProfileId (join-gate namespaces collide otherwise)', () => {
        const ids = [...profiles.values()].map(
            (json) => (json as { localProfileId: string }).localProfileId,
        );
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('tactics dev fixtures — scenarios', () => {
    it('ships at least one scenario and every scenario parses against the fixture contract', () => {
        expect(scenarios.size).toBeGreaterThan(0);
        for (const [name, json] of scenarios) {
            const parsed = DevScenarioSchema.safeParse(json);
            expect(parsed.success, `${name} must parse as a DevScenario`).toBe(true);
        }
    });

    it('targets this game and fits its seat cap', () => {
        for (const [name, json] of scenarios) {
            const scenario = DevScenarioSchema.parse(json);
            expect(scenario.gameId, `${name} gameId`).toBe(TACTICS_GAME_ID);
            expect(
                scenario.seats.length + (scenario.aiSeats ?? 0),
                `${name} total seats`,
            ).toBeLessThanOrEqual(TACTICS_MAX_PLAYERS);
        }
    });

    it('references only profile files that exist in dev/profiles/', () => {
        for (const [name, json] of scenarios) {
            const scenario = DevScenarioSchema.parse(json);
            for (const seat of scenario.seats) {
                if (seat.profile !== undefined) {
                    expect(profiles.has(seat.profile), `${name} references ${seat.profile}`).toBe(
                        true,
                    );
                }
            }
        }
    });

    it("uses only this game's match-setting vocabulary and content-palette values", () => {
        const knownSettings = new Set([
            'boardColor',
            TACTICS_TURN_MODE_SETTING,
            ALLOW_SPECTATORS_SETTING,
        ]);
        for (const [name, json] of scenarios) {
            const scenario: DevScenario = DevScenarioSchema.parse(json);
            for (const [key, value] of Object.entries(scenario.matchSettings ?? {})) {
                expect(knownSettings.has(key), `${name} match setting "${key}"`).toBe(true);
                if (key === 'boardColor') {
                    expect(boardColorIds, `${name} boardColor "${value}"`).toContain(value);
                }
                if (key === TACTICS_TURN_MODE_SETTING) {
                    expect(turnModes, `${name} turnMode "${value}"`).toContain(value);
                }
            }
        }
    });

    it('assigns every seat a colour from the content palette, with no duplicates per scenario', () => {
        for (const [name, json] of scenarios) {
            const scenario = DevScenarioSchema.parse(json);
            const seatColors = scenario.seats
                .map((seat) => seat.attributes?.['color'])
                .filter((color): color is string => color !== undefined);
            for (const color of seatColors) {
                expect(playerColorIds, `${name} seat colour "${color}"`).toContain(color);
            }
            expect(new Set(seatColors).size, `${name} duplicate seat colours`).toBe(
                seatColors.length,
            );
        }
    });
});
