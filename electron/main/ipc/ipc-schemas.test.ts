import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
    EngineActionSchema,
    GameIdSchema,
    HostLobbyParamsSchema,
    IpcRequestValidationError,
    JoinLobbyParamsSchema,
    PlayerIdSchema,
    SetMatchSettingPayloadSchema,
    SetPlayerAttributePayloadSchema,
    LogEntrySchema,
    RendererLogEntrySchema,
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

describe('GameIdSchema / PlayerIdSchema (non-empty strings)', () => {
    it.each([GameIdSchema, PlayerIdSchema])('accepts any non-empty string', (schema) => {
        expect(schema.safeParse('sample-game').success).toBe(true);
    });

    it.each([GameIdSchema, PlayerIdSchema])('rejects an empty string', (schema) => {
        expect(schema.safeParse('').success).toBe(false);
    });

    it.each([GameIdSchema, PlayerIdSchema])('rejects non-string inputs', (schema) => {
        expect(schema.safeParse(42).success).toBe(false);
        expect(schema.safeParse(null).success).toBe(false);
        expect(schema.safeParse(undefined).success).toBe(false);
    });
});

describe('SlotIdSchema (qualified slot identifier)', () => {
    it.each(['tactics/autosave', 'my-game/slot-1', 'g/s', 'sample-game/quicksave'])(
        'accepts a well-formed "<gameId>/<slotName>": %s',
        (id) => expect(SlotIdSchema.safeParse(id).success).toBe(true),
    );

    it.each(['tactics', '/autosave', 'tactics/', 'TACTICS/slot', 'tactics/slot/extra', ''])(
        'rejects a malformed slotId: %s',
        (id) => expect(SlotIdSchema.safeParse(id).success).toBe(false),
    );

    it('rejects non-string inputs', () => {
        expect(SlotIdSchema.safeParse(42).success).toBe(false);
        expect(SlotIdSchema.safeParse(null).success).toBe(false);
        expect(SlotIdSchema.safeParse(undefined).success).toBe(false);
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

describe('SetMatchSettingPayloadSchema', () => {
    it('accepts a well-formed {key, value}', () => {
        expect(
            SetMatchSettingPayloadSchema.safeParse({ key: 'boardColor', value: 'red' }).success,
        ).toBe(true);
    });

    it('accepts an empty value (e.g. "none")', () => {
        expect(
            SetMatchSettingPayloadSchema.safeParse({ key: 'boardColor', value: '' }).success,
        ).toBe(true);
    });

    it('rejects a missing or empty key', () => {
        expect(SetMatchSettingPayloadSchema.safeParse({ value: 'red' }).success).toBe(false);
        expect(SetMatchSettingPayloadSchema.safeParse({ key: '', value: 'red' }).success).toBe(
            false,
        );
    });

    it('rejects a non-string value', () => {
        expect(
            SetMatchSettingPayloadSchema.safeParse({ key: 'boardColor', value: 42 }).success,
        ).toBe(false);
    });

    it('rejects unknown keys', () => {
        expect(
            SetMatchSettingPayloadSchema.safeParse({ key: 'boardColor', value: 'red', extra: 1 })
                .success,
        ).toBe(false);
    });
});

describe('SetPlayerAttributePayloadSchema', () => {
    it('accepts a well-formed {playerId, key, value}', () => {
        expect(
            SetPlayerAttributePayloadSchema.safeParse({
                playerId: 'p1',
                key: 'unitColor',
                value: 'blue',
            }).success,
        ).toBe(true);
    });

    it('accepts an empty value', () => {
        expect(
            SetPlayerAttributePayloadSchema.safeParse({
                playerId: 'p1',
                key: 'unitColor',
                value: '',
            }).success,
        ).toBe(true);
    });

    it('rejects a missing or empty playerId', () => {
        expect(
            SetPlayerAttributePayloadSchema.safeParse({ key: 'unitColor', value: 'blue' }).success,
        ).toBe(false);
        expect(
            SetPlayerAttributePayloadSchema.safeParse({
                playerId: '',
                key: 'unitColor',
                value: 'blue',
            }).success,
        ).toBe(false);
    });

    it('rejects a missing or empty key', () => {
        expect(
            SetPlayerAttributePayloadSchema.safeParse({ playerId: 'p1', value: 'blue' }).success,
        ).toBe(false);
        expect(
            SetPlayerAttributePayloadSchema.safeParse({ playerId: 'p1', key: '', value: 'blue' })
                .success,
        ).toBe(false);
    });

    it('rejects unknown keys', () => {
        expect(
            SetPlayerAttributePayloadSchema.safeParse({
                playerId: 'p1',
                key: 'unitColor',
                value: 'blue',
                extra: 1,
            }).success,
        ).toBe(false);
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

    it('rejects objects nested deeper than the safe depth limit (DoS guard)', () => {
        // Build a deeply nested object: { a: { a: { a: { ... } } } } depth 10+
        let deep: Record<string, unknown> = { leaf: 'value' };
        for (let i = 0; i < 12; i++) {
            deep = { a: deep };
        }
        expect(UserSettingsPatchSchema.safeParse(deep).success).toBe(false);
    });

    it('accepts objects within the safe depth limit', () => {
        // Typical settings patch: { audio: { masterVolume: 0.5 } } is depth 2
        const valid = { audio: { masterVolume: 0.5 } };
        expect(UserSettingsPatchSchema.safeParse(valid).success).toBe(true);
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

describe('LogEntrySchema', () => {
    const VALID_ENTRY = {
        level: 'info',
        message: 'test message',
        timestamp: 1700000000000,
        source: { process: 'main', module: 'test' },
    };

    it('accepts a valid log entry', () => {
        expect(LogEntrySchema.safeParse(VALID_ENTRY).success).toBe(true);
    });

    it('rejects timestamp: NaN', () => {
        expect(LogEntrySchema.safeParse({ ...VALID_ENTRY, timestamp: NaN }).success).toBe(false);
    });

    it('rejects timestamp: -1 (negative)', () => {
        expect(LogEntrySchema.safeParse({ ...VALID_ENTRY, timestamp: -1 }).success).toBe(false);
    });

    it('rejects timestamp: Infinity', () => {
        expect(LogEntrySchema.safeParse({ ...VALID_ENTRY, timestamp: Infinity }).success).toBe(
            false,
        );
    });

    it('rejects message longer than 4096 characters', () => {
        expect(
            LogEntrySchema.safeParse({ ...VALID_ENTRY, message: 'x'.repeat(4097) }).success,
        ).toBe(false);
    });

    it('accepts message of exactly 4096 characters', () => {
        expect(
            LogEntrySchema.safeParse({ ...VALID_ENTRY, message: 'x'.repeat(4096) }).success,
        ).toBe(true);
    });
});

describe('RendererLogEntrySchema', () => {
    const VALID_RENDERER_ENTRY = {
        level: 'info',
        message: 'hello from renderer',
        timestamp: 123456789,
        source: { module: 'ui-module' },
    };

    it('accepts a valid renderer log entry with source.module only', () => {
        expect(RendererLogEntrySchema.safeParse(VALID_RENDERER_ENTRY).success).toBe(true);
    });

    it('rejects timestamp: NaN', () => {
        expect(
            RendererLogEntrySchema.safeParse({ ...VALID_RENDERER_ENTRY, timestamp: NaN }).success,
        ).toBe(false);
    });

    it('rejects timestamp: -1 (negative)', () => {
        expect(
            RendererLogEntrySchema.safeParse({ ...VALID_RENDERER_ENTRY, timestamp: -1 }).success,
        ).toBe(false);
    });

    it('rejects timestamp: Infinity', () => {
        expect(
            RendererLogEntrySchema.safeParse({
                ...VALID_RENDERER_ENTRY,
                timestamp: Infinity,
            }).success,
        ).toBe(false);
    });

    it('rejects timestamp: 1.5 (non-integer float)', () => {
        expect(
            RendererLogEntrySchema.safeParse({ ...VALID_RENDERER_ENTRY, timestamp: 1.5 }).success,
        ).toBe(false);
    });

    it('rejects message longer than 4096 characters', () => {
        expect(
            RendererLogEntrySchema.safeParse({
                ...VALID_RENDERER_ENTRY,
                message: 'x'.repeat(4097),
            }).success,
        ).toBe(false);
    });

    it('accepts message of exactly 4096 characters', () => {
        expect(
            RendererLogEntrySchema.safeParse({
                ...VALID_RENDERER_ENTRY,
                message: 'x'.repeat(4096),
            }).success,
        ).toBe(true);
    });

    it('strips source.process entirely — renderer-supplied process is never in the parsed output', () => {
        // A renderer claiming to be 'main' must not appear in the parsed source.
        const result = RendererLogEntrySchema.safeParse({
            ...VALID_RENDERER_ENTRY,
            source: { process: 'main', module: 'ui-module' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(Object.keys(result.data.source)).not.toContain('process');
        }
    });

    it('strips source.process when renderer sends "simulation" — forged identity is dropped', () => {
        const result = RendererLogEntrySchema.safeParse({
            ...VALID_RENDERER_ENTRY,
            source: { process: 'simulation', module: 'sim-module' },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(Object.keys(result.data.source)).not.toContain('process');
        }
    });

    it('rejects an entry with missing source.module', () => {
        expect(
            RendererLogEntrySchema.safeParse({
                ...VALID_RENDERER_ENTRY,
                source: { process: 'renderer' },
            }).success,
        ).toBe(false);
    });

    it('rejects an entry with an invalid log level', () => {
        expect(
            RendererLogEntrySchema.safeParse({ ...VALID_RENDERER_ENTRY, level: 'verbose' }).success,
        ).toBe(false);
    });

    it('rejects an entry missing the message field', () => {
        const { message: _msg, ...withoutMessage } = VALID_RENDERER_ENTRY;
        expect(RendererLogEntrySchema.safeParse(withoutMessage).success).toBe(false);
    });

    it('accepts optional context and error fields', () => {
        expect(
            RendererLogEntrySchema.safeParse({
                ...VALID_RENDERER_ENTRY,
                context: { userId: 'u1' },
                error: { name: 'Error', message: 'oops' },
            }).success,
        ).toBe(true);
    });
});
