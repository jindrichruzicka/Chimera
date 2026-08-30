/**
 * apps/action/dev/fixtures.test.ts
 *
 * Contract test for this app's dev-harness fixtures (§4.32): every profile under
 * `dev/profiles/` and every scenario under `dev/scenarios/` must parse against
 * the engine's fixture schemas, and every scenario must fit what this game can
 * actually seat — so a change to the seeded primitives can never strand the
 * fixtures at a roster `buildInitialActionEntities` refuses.
 *
 * Reading the co-located fixture JSON is static test data, not runtime FS.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DevScenarioSchema } from '@chimera-engine/simulation/foundation/dev-fixture-contract.js';
import { EngineProfileSchema } from '@chimera-engine/simulation/profile/ProfileSchema.js';
import { playerId } from '@chimera-engine/simulation/engine/types.js';
import type { PlayerId } from '@chimera-engine/simulation/engine/types.js';

import { ACTION_GAME_ID, ACTION_PRIMITIVE_SEEDS } from '../simulation/constants.js';
import { buildInitialActionEntities } from '../simulation/entities.js';

const devDir = dirname(fileURLToPath(import.meta.url));

function readJsonDir(dir: string): ReadonlyMap<string, unknown> {
    return new Map(
        readdirSync(dir)
            .filter((name) => name.endsWith('.json'))
            .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown]),
    );
}

const profiles = readJsonDir(join(devDir, 'profiles'));
const scenarios = readJsonDir(join(devDir, 'scenarios'));

describe('action dev fixtures — profiles', () => {
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

describe('action dev fixtures — scenarios', () => {
    it('ships at least one scenario and every scenario parses against the fixture contract', () => {
        expect(scenarios.size).toBeGreaterThan(0);
        for (const [name, json] of scenarios) {
            const parsed = DevScenarioSchema.safeParse(json);
            expect(parsed.success, `${name} must parse as a DevScenario`).toBe(true);
        }
    });

    it('targets this game', () => {
        for (const [name, json] of scenarios) {
            expect(DevScenarioSchema.parse(json).gameId, `${name} gameId`).toBe(ACTION_GAME_ID);
        }
    });

    it('seats a roster this game can actually build', () => {
        // The real gate, not a restatement of a cap constant: a scenario whose
        // roster exceeds the seeded primitives makes `buildInitialActionEntities`
        // throw at match creation, which is a dev boot that dies on start.
        for (const [name, json] of scenarios) {
            const scenario = DevScenarioSchema.parse(json);
            const roster: readonly PlayerId[] = Array.from(
                { length: scenario.seats.length + (scenario.aiSeats ?? 0) },
                (_unused, index) => playerId(`seat-${String(index)}`),
            );

            expect(() => buildInitialActionEntities(roster), name).not.toThrow();
        }
    });

    it('would refuse a roster longer than the seeded primitives (positive control)', () => {
        // Without this the check above passes against a builder that never
        // throws — and then it is measuring nothing.
        const tooMany: readonly PlayerId[] = Array.from(
            { length: ACTION_PRIMITIVE_SEEDS.length + 1 },
            (_unused, index) => playerId(`seat-${String(index)}`),
        );

        expect(() => buildInitialActionEntities(tooMany)).toThrow();
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

    it('declares no game params — this game reads none', () => {
        // The host passes `gameParams` through to `snapshot.setup`, where nothing
        // in this app looks at them. A value here would be a setting the fixture
        // author expects to matter and that silently does not.
        for (const [name, json] of scenarios) {
            expect(DevScenarioSchema.parse(json).gameParams, `${name} gameParams`).toBeUndefined();
        }
    });

    it('auto-starts, so a dev boot reaches a running match', () => {
        for (const [name, json] of scenarios) {
            expect(DevScenarioSchema.parse(json).autoStart, `${name} autoStart`).toBe(true);
        }
    });

    it('ships a scenario for each of the one- and two-seat variants', () => {
        const seatCounts = [...scenarios.values()]
            .map((json) => DevScenarioSchema.parse(json).seats.length)
            .sort();

        expect(seatCounts).toEqual([1, 2]);
    });
});
