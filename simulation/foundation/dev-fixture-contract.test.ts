import { describe, expect, it } from 'vitest';

import {
    DEV_FIXTURE_SCHEMA_VERSION,
    DEV_SCENARIO_MAX_AI_SEATS,
    DEV_SCENARIO_MAX_SEATS,
    DevAnnounceSchema,
    DevScenarioSchema,
    devScenarioAutoStart,
    devScenarioHumanSeats,
    devScenarioMaxPlayers,
    devScenarioSeat,
    devSeatReady,
    generatedDevProfileId,
    matchGeneratedDevProfileSeat,
    type DevScenario,
} from './dev-fixture-contract.js';
import {
    WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH,
    WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH,
} from './messages-schemas.js';

function makeScenario(overrides: Partial<DevScenario> = {}): DevScenario {
    return DevScenarioSchema.parse({ seats: [{}], ...overrides });
}

describe('DevScenarioSchema', () => {
    it('parses a minimal scenario — one empty seat, everything else defaulted', () => {
        const result = DevScenarioSchema.safeParse({ seats: [{}] });
        expect(result.success).toBe(true);
    });

    it('parses a full scenario with profiles, attributes, ready flags, AI seats and match settings', () => {
        const result = DevScenarioSchema.safeParse({
            schemaVersion: DEV_FIXTURE_SCHEMA_VERSION,
            gameId: 'sample',
            seats: [
                { profile: 'alice.json', attributes: { deck: '["strike","guard"]' } },
                { profile: 'bob.json', attributes: { deck: '["fang"]' }, ready: false },
            ],
            aiSeats: 2,
            matchSettings: { arena: 'lava-pit', turnMode: 'commitment' },
            autoStart: false,
        });
        expect(result.success).toBe(true);
    });

    it('rejects an empty seat list — a scenario must describe at least one human seat', () => {
        expect(DevScenarioSchema.safeParse({ seats: [] }).success).toBe(false);
    });

    it(`rejects more than ${DEV_SCENARIO_MAX_SEATS} human seats (harness spawn cap)`, () => {
        const seats = Array.from({ length: DEV_SCENARIO_MAX_SEATS + 1 }, () => ({}));
        expect(DevScenarioSchema.safeParse({ seats }).success).toBe(false);
        expect(DEV_SCENARIO_MAX_SEATS).toBe(8);
    });

    it(`rejects more than ${DEV_SCENARIO_MAX_AI_SEATS} AI seats`, () => {
        const result = DevScenarioSchema.safeParse({
            seats: [{}],
            aiSeats: DEV_SCENARIO_MAX_AI_SEATS + 1,
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown keys at the scenario root (strict — typos must not pass silently)', () => {
        expect(DevScenarioSchema.safeParse({ seats: [{}], autostart: true }).success).toBe(false);
    });

    it('rejects unknown keys inside a seat (strict)', () => {
        expect(DevScenarioSchema.safeParse({ seats: [{ profil: 'a.json' }] }).success).toBe(false);
    });

    it('rejects a wrong schemaVersion', () => {
        expect(DevScenarioSchema.safeParse({ schemaVersion: 2, seats: [{}] }).success).toBe(false);
    });

    it('rejects an empty gameId', () => {
        expect(DevScenarioSchema.safeParse({ gameId: '', seats: [{}] }).success).toBe(false);
    });

    it.each([
        ['parent traversal', '../evil.json'],
        ['nested path', 'dir/profile.json'],
        ['absolute path', '/etc/profile.json'],
        ['leading dot', '.hidden.json'],
        ['non-json extension', 'profile.txt'],
        ['bare name without extension', 'profile'],
    ])('rejects a seat profile ref that is not a bare .json filename (%s)', (_label, profile) => {
        expect(DevScenarioSchema.safeParse({ seats: [{ profile }] }).success).toBe(false);
    });

    it('accepts a bare .json profile filename with dots, dashes and underscores', () => {
        const result = DevScenarioSchema.safeParse({
            seats: [{ profile: 'dev-p1.v2_final.json' }],
        });
        expect(result.success).toBe(true);
    });

    it('rejects an empty attribute key', () => {
        expect(DevScenarioSchema.safeParse({ seats: [{ attributes: { '': 'x' } }] }).success).toBe(
            false,
        );
    });

    it('rejects an attribute key over the wire key cap', () => {
        const key = 'k'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH + 1);
        expect(
            DevScenarioSchema.safeParse({ seats: [{ attributes: { [key]: 'x' } }] }).success,
        ).toBe(false);
    });

    it('accepts an attribute value at the coarse wire value cap (a JSON deck fits)', () => {
        const value = 'v'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH);
        const result = DevScenarioSchema.safeParse({ seats: [{ attributes: { deck: value } }] });
        expect(result.success).toBe(true);
    });

    it('rejects an attribute value over the coarse wire value cap', () => {
        const value = 'v'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH + 1);
        expect(
            DevScenarioSchema.safeParse({ seats: [{ attributes: { deck: value } }] }).success,
        ).toBe(false);
    });

    it('rejects an empty match-setting key', () => {
        expect(
            DevScenarioSchema.safeParse({ seats: [{}], matchSettings: { '': 'x' } }).success,
        ).toBe(false);
    });
});

describe('DevScenario pure helpers', () => {
    it('devScenarioHumanSeats counts the seat list', () => {
        expect(devScenarioHumanSeats(makeScenario({ seats: [{}, {}, {}] }))).toBe(3);
    });

    it('devScenarioMaxPlayers adds AI seats to human seats', () => {
        expect(devScenarioMaxPlayers(makeScenario({ seats: [{}, {}], aiSeats: 2 }))).toBe(4);
    });

    it('devScenarioMaxPlayers treats absent aiSeats as zero', () => {
        expect(devScenarioMaxPlayers(makeScenario({ seats: [{}, {}] }))).toBe(2);
    });

    it('devScenarioSeat resolves 1-based seat indices', () => {
        const scenario = makeScenario({
            seats: [{ profile: 'alice.json' }, { profile: 'bob.json' }],
        });
        expect(devScenarioSeat(scenario, 1)?.profile).toBe('alice.json');
        expect(devScenarioSeat(scenario, 2)?.profile).toBe('bob.json');
    });

    it('devScenarioSeat returns undefined out of range — never throws', () => {
        const scenario = makeScenario({ seats: [{}] });
        expect(devScenarioSeat(scenario, 0)).toBeUndefined();
        expect(devScenarioSeat(scenario, 2)).toBeUndefined();
        expect(devScenarioSeat(scenario, -1)).toBeUndefined();
    });

    it('devScenarioAutoStart defaults to true — the harness boots straight into a match', () => {
        expect(devScenarioAutoStart(makeScenario())).toBe(true);
        expect(devScenarioAutoStart(makeScenario({ autoStart: false }))).toBe(false);
        expect(devScenarioAutoStart(makeScenario({ autoStart: true }))).toBe(true);
    });

    it('devSeatReady defaults to true and honours an explicit false', () => {
        expect(devSeatReady(undefined)).toBe(true);
        expect(devSeatReady({})).toBe(true);
        expect(devSeatReady({ ready: false })).toBe(false);
    });
});

describe('generated dev-profile ids (the no-fixture fallback contract)', () => {
    it('round-trips: the id the orchestrator emits is the id the instance recognises', () => {
        expect(generatedDevProfileId(1)).toBe('dev-p1');
        expect(matchGeneratedDevProfileSeat(generatedDevProfileId(3))).toBe(3);
        expect(matchGeneratedDevProfileSeat(generatedDevProfileId(8))).toBe(8);
    });

    it('does not recognise foreign or malformed ids — normal profile resolution applies', () => {
        expect(matchGeneratedDevProfileSeat('my-custom-profile')).toBeUndefined();
        expect(matchGeneratedDevProfileSeat('dev-p0')).toBeUndefined();
        expect(matchGeneratedDevProfileSeat('dev-p')).toBeUndefined();
        expect(matchGeneratedDevProfileSeat('dev-p1x')).toBeUndefined();
    });
});

describe('DevAnnounceSchema', () => {
    it('parses a valid announce payload', () => {
        const result = DevAnnounceSchema.safeParse({
            lobbyCode: '127.0.0.1:52110:token',
            gameId: 'sample',
        });
        expect(result.success).toBe(true);
    });

    it('accepts an explicit schemaVersion', () => {
        const result = DevAnnounceSchema.safeParse({
            schemaVersion: DEV_FIXTURE_SCHEMA_VERSION,
            lobbyCode: '127.0.0.1:52110:token',
            gameId: 'sample',
        });
        expect(result.success).toBe(true);
    });

    it('rejects a missing or empty lobbyCode', () => {
        expect(DevAnnounceSchema.safeParse({ gameId: 'sample' }).success).toBe(false);
        expect(DevAnnounceSchema.safeParse({ lobbyCode: '', gameId: 'sample' }).success).toBe(
            false,
        );
    });

    it('rejects unknown keys (strict)', () => {
        const result = DevAnnounceSchema.safeParse({
            lobbyCode: '127.0.0.1:52110:token',
            gameId: 'sample',
            port: 52110,
        });
        expect(result.success).toBe(false);
    });
});
