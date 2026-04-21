import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    EngineActionSchema,
    GameIdSchema,
    HostLobbyParamsSchema,
    IpcRequestValidationError,
    JoinLobbyParamsSchema,
    PlayerIdSchema,
    SaveRequestSchema,
    SlotIdSchema,
    UserSettingsPatchSchema,
    parseInvokeRequest,
} from './ipc-schemas.js';

describe('IpcRequestValidationError', () => {
    it('captures the channel and preserves the issues array verbatim', () => {
        const issues: z.ZodIssue[] = [
            { code: 'custom', message: 'bad', path: ['payload'], input: undefined },
        ];
        const err = new IpcRequestValidationError('chimera:test:channel', issues);
        expect(err.channel).toBe('chimera:test:channel');
        expect(err.issues).toBe(issues);
        expect(err.name).toBe('IpcRequestValidationError');
        expect(err).toBeInstanceOf(Error);
    });

    it('renders a summary that names the channel and each issue path', () => {
        const issues: z.ZodIssue[] = [
            { code: 'custom', message: 'bad', path: ['gameId'], input: undefined },
            { code: 'custom', message: 'also bad', path: ['nested', 'field'], input: undefined },
        ];
        const err = new IpcRequestValidationError('chimera:x:y', issues);
        expect(err.message).toContain('chimera:x:y');
        expect(err.message).toContain('gameId: bad');
        expect(err.message).toContain('nested.field: also bad');
    });

    it('renders <root> when an issue has an empty path', () => {
        const issues: z.ZodIssue[] = [
            { code: 'custom', message: 'whole payload rejected', path: [], input: undefined },
        ];
        const err = new IpcRequestValidationError('chimera:x:y', issues);
        expect(err.message).toContain('<root>: whole payload rejected');
    });
});

describe('parseInvokeRequest', () => {
    it('returns parsed data when the value conforms to the schema', () => {
        const schema = z.object({ a: z.number() });
        expect(parseInvokeRequest(schema, 'chimera:x:y', { a: 1 })).toEqual({ a: 1 });
    });

    it('throws IpcRequestValidationError carrying the channel and Zod issues', () => {
        const schema = z.object({ a: z.number() });
        try {
            parseInvokeRequest(schema, 'chimera:x:y', { a: 'not-a-number' });
            throw new Error('parseInvokeRequest should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(IpcRequestValidationError);
            const e = err as IpcRequestValidationError;
            expect(e.channel).toBe('chimera:x:y');
            expect(e.issues.length).toBeGreaterThan(0);
            expect(e.issues[0]?.path).toEqual(['a']);
        }
    });
});

describe('GameIdSchema / SlotIdSchema / PlayerIdSchema (non-empty strings)', () => {
    it.each([GameIdSchema, SlotIdSchema, PlayerIdSchema])(
        'accepts any non-empty string',
        (schema) => {
            expect(schema.safeParse('sample-game').success).toBe(true);
        },
    );

    it.each([GameIdSchema, SlotIdSchema, PlayerIdSchema])('rejects an empty string', (schema) => {
        expect(schema.safeParse('').success).toBe(false);
    });

    it.each([GameIdSchema, SlotIdSchema, PlayerIdSchema])('rejects non-string inputs', (schema) => {
        expect(schema.safeParse(42).success).toBe(false);
        expect(schema.safeParse(null).success).toBe(false);
        expect(schema.safeParse(undefined).success).toBe(false);
    });
});

describe('HostLobbyParamsSchema', () => {
    it('accepts a well-formed HostLobbyParams', () => {
        expect(
            HostLobbyParamsSchema.safeParse({ gameId: 'sample-game', maxPlayers: 4 }).success,
        ).toBe(true);
    });

    it('rejects a missing field', () => {
        expect(HostLobbyParamsSchema.safeParse({ gameId: 'sample-game' }).success).toBe(false);
        expect(HostLobbyParamsSchema.safeParse({ maxPlayers: 4 }).success).toBe(false);
    });

    it('rejects non-positive or non-integer maxPlayers', () => {
        expect(
            HostLobbyParamsSchema.safeParse({ gameId: 'sample-game', maxPlayers: 0 }).success,
        ).toBe(false);
        expect(
            HostLobbyParamsSchema.safeParse({ gameId: 'sample-game', maxPlayers: -1 }).success,
        ).toBe(false);
        expect(
            HostLobbyParamsSchema.safeParse({ gameId: 'sample-game', maxPlayers: 1.5 }).success,
        ).toBe(false);
    });

    it('rejects an empty gameId', () => {
        expect(HostLobbyParamsSchema.safeParse({ gameId: '', maxPlayers: 4 }).success).toBe(false);
    });
});

describe('JoinLobbyParamsSchema', () => {
    it('accepts a well-formed JoinLobbyParams', () => {
        expect(JoinLobbyParamsSchema.safeParse({ address: 'ws://127.0.0.1:7777' }).success).toBe(
            true,
        );
    });

    it('rejects a missing or empty address', () => {
        expect(JoinLobbyParamsSchema.safeParse({}).success).toBe(false);
        expect(JoinLobbyParamsSchema.safeParse({ address: '' }).success).toBe(false);
    });

    it('rejects a non-string address', () => {
        expect(JoinLobbyParamsSchema.safeParse({ address: 42 }).success).toBe(false);
    });
});

describe('SaveRequestSchema', () => {
    it('accepts a minimal SaveRequest (gameId only)', () => {
        expect(SaveRequestSchema.safeParse({ gameId: 'sample-game' }).success).toBe(true);
    });

    it('accepts optional slotId and label', () => {
        expect(
            SaveRequestSchema.safeParse({
                gameId: 'sample-game',
                slotId: 'slot-a',
                label: 'autosave',
            }).success,
        ).toBe(true);
    });

    it('rejects a missing gameId', () => {
        expect(SaveRequestSchema.safeParse({}).success).toBe(false);
    });

    it('rejects a non-string label', () => {
        expect(SaveRequestSchema.safeParse({ gameId: 'sample-game', label: 42 }).success).toBe(
            false,
        );
    });

    it('rejects an empty slotId (if provided)', () => {
        expect(SaveRequestSchema.safeParse({ gameId: 'sample-game', slotId: '' }).success).toBe(
            false,
        );
    });
});

describe('UserSettingsPatchSchema', () => {
    it('accepts an empty object', () => {
        expect(UserSettingsPatchSchema.safeParse({}).success).toBe(true);
    });

    it('accepts arbitrary keys with unknown values (structural only)', () => {
        expect(
            UserSettingsPatchSchema.safeParse({ masterVolume: 0.5, theme: 'dark' }).success,
        ).toBe(true);
    });

    it('rejects arrays, primitives, and null (must be a record)', () => {
        expect(UserSettingsPatchSchema.safeParse([]).success).toBe(false);
        expect(UserSettingsPatchSchema.safeParse('patch').success).toBe(false);
        expect(UserSettingsPatchSchema.safeParse(42).success).toBe(false);
        expect(UserSettingsPatchSchema.safeParse(null).success).toBe(false);
    });
});

describe('EngineActionSchema', () => {
    it('accepts a well-formed EngineAction envelope', () => {
        expect(
            EngineActionSchema.safeParse({
                type: 'noop',
                playerId: 'p1',
                tick: 0,
                payload: {},
            }).success,
        ).toBe(true);
    });

    it('rejects a missing field', () => {
        expect(EngineActionSchema.safeParse({ playerId: 'p1', tick: 0, payload: {} }).success).toBe(
            false,
        );
        expect(EngineActionSchema.safeParse({ type: 'noop', tick: 0, payload: {} }).success).toBe(
            false,
        );
        expect(
            EngineActionSchema.safeParse({ type: 'noop', playerId: 'p1', payload: {} }).success,
        ).toBe(false);
        expect(
            EngineActionSchema.safeParse({ type: 'noop', playerId: 'p1', tick: 0 }).success,
        ).toBe(false);
    });

    it('rejects a negative or non-integer tick', () => {
        expect(
            EngineActionSchema.safeParse({
                type: 'noop',
                playerId: 'p1',
                tick: -1,
                payload: {},
            }).success,
        ).toBe(false);
        expect(
            EngineActionSchema.safeParse({
                type: 'noop',
                playerId: 'p1',
                tick: 1.5,
                payload: {},
            }).success,
        ).toBe(false);
    });

    it('rejects an array or primitive payload', () => {
        expect(
            EngineActionSchema.safeParse({
                type: 'noop',
                playerId: 'p1',
                tick: 0,
                payload: [],
            }).success,
        ).toBe(false);
        expect(
            EngineActionSchema.safeParse({
                type: 'noop',
                playerId: 'p1',
                tick: 0,
                payload: 'string',
            }).success,
        ).toBe(false);
        expect(
            EngineActionSchema.safeParse({
                type: 'noop',
                playerId: 'p1',
                tick: 0,
                payload: null,
            }).success,
        ).toBe(false);
    });
});
