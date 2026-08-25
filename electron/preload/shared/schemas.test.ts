// electron/preload/schemas.test.ts
//
// Unit tests for the preload invoke-response validator and its schemas.
// Covers both the helper's contract (throws PreloadIpcValidationError with
// the offending channel name on malformed input, passes conforming values
// through untouched) and a representative malformed payload per schema so
// drift between main and the preload contract is caught immediately at the
// boundary.

import { describe, expect, it } from 'vitest';
import {
    WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH,
    WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH,
} from '@chimera-engine/simulation/foundation/messages-schemas.js';
import type { LobbyState } from '../api-types.js';
import { MAX_SAVE_LABEL_LENGTH } from '../api-types.js';
import {
    ActionRejectionSchema,
    DeviceInfoSchema,
    LobbyInfoSchema,
    LobbyStateSchema,
    PerspectiveReplayListSchema,
    PerspectiveReplayPlaybackInfoSchema,
    PlatformInfoSchema,
    PreloadIpcValidationError,
    ReplayListSchema,
    ResolvedSettingsSchema,
    RestoreStatusEventSchema,
    SaveSlotListSchema,
    SaveSlotMetaSchema,
    parseInvokeResponse,
} from './schemas.js';

describe('parseInvokeResponse', () => {
    it('returns the parsed value when the payload conforms', () => {
        const value = { os: 'macos', version: '14.0' };
        const result = parseInvokeResponse(PlatformInfoSchema, 'chimera:system:platform', value);
        expect(result).toEqual(value);
    });

    it('throws PreloadIpcValidationError naming the channel on malformed payload', () => {
        expect.assertions(3);
        try {
            parseInvokeResponse(PlatformInfoSchema, 'chimera:system:platform', {
                os: 'plan9',
                version: '1.0',
            });
        } catch (error) {
            expect(error).toBeInstanceOf(PreloadIpcValidationError);
            const validationError = error as PreloadIpcValidationError;
            expect(validationError.channel).toBe('chimera:system:platform');
            expect(validationError.message).toContain('chimera:system:platform');
        }
    });

    it('exposes structured issues on the thrown error', () => {
        try {
            parseInvokeResponse(LobbyInfoSchema, 'chimera:lobby:host', { sessionId: 42 });
            throw new Error('Expected PreloadIpcValidationError to be thrown');
        } catch (error) {
            expect(error).toBeInstanceOf(PreloadIpcValidationError);
            const validationError = error as PreloadIpcValidationError;
            expect(validationError.issues.length).toBeGreaterThan(0);
            // At least one issue must name a known field path so callers can
            // include it in error reports without guessing where to dig.
            const paths = validationError.issues.flatMap((issue) => issue.path);
            expect(paths).toContain('sessionId');
        }
    });
});

describe('PlatformInfoSchema', () => {
    it('accepts the three supported OS values', () => {
        for (const os of ['macos', 'windows', 'linux'] as const) {
            expect(PlatformInfoSchema.parse({ os, version: '1.0' })).toEqual({
                os,
                version: '1.0',
            });
        }
    });

    it('rejects unknown OS values', () => {
        expect(() => PlatformInfoSchema.parse({ os: 'freebsd', version: '1.0' })).toThrow();
    });

    it('rejects missing version', () => {
        expect(() => PlatformInfoSchema.parse({ os: 'macos' })).toThrow();
    });
});

describe('LobbyInfoSchema', () => {
    it('accepts a well-formed lobby info', () => {
        const info = { sessionId: 'S1', hostId: 'P1', gameId: 'tactics' };
        expect(LobbyInfoSchema.parse(info)).toEqual(info);
    });

    it('rejects a non-string sessionId', () => {
        expect(() =>
            LobbyInfoSchema.parse({ sessionId: 1, hostId: 'P1', gameId: 'tactics' }),
        ).toThrow();
    });
});

describe('LobbyStateSchema — player role (spectator)', () => {
    const info = { sessionId: 'S1', hostId: 'P1', gameId: 'tactics' };

    it('preserves a spectator role across the IPC boundary (not stripped)', () => {
        const state = {
            info,
            players: [
                { playerId: 'P2', displayName: 'Bob', ready: false, role: 'spectator' as const },
            ],
        };
        const parsed = LobbyStateSchema.parse(state);
        expect(parsed.players[0]?.role).toBe('spectator');
    });

    it('accepts a roster entry that omits role (backward-compatible)', () => {
        const state = {
            info,
            players: [{ playerId: 'P1', displayName: 'Alice', ready: true }],
        };
        const parsed = LobbyStateSchema.parse(state);
        expect(parsed.players[0]?.role).toBeUndefined();
    });

    it('rejects a roster entry with an unknown role value', () => {
        const state = {
            info,
            players: [{ playerId: 'P1', displayName: 'Alice', ready: true, role: 'observer' }],
        };
        expect(() => LobbyStateSchema.parse(state)).toThrow();
    });
});

describe('LobbyStateSchema — nothing is stripped from chimera:lobby:get-current-state', () => {
    // Every optional key of every nested shape, populated. `Required<…>` is the
    // anchor: adding an optional field to `LobbyState`, `LobbyPlayerEntry`, or
    // `LobbyAgentSlot` stops this fixture compiling until it is populated here,
    // and the round-trip below then fails until the schema carries it. Written
    // as literals, never a spread — a spread defeats excess-property checking.
    // The element types are derived from `LobbyState` itself, so the fixture is
    // pinned to exactly the shape this schema must carry — not to a
    // same-named interface that could drift from it.
    type FullAgentSlot = Required<NonNullable<LobbyState['agentSlots']>[number]>;
    type FullPlayerEntry = Required<LobbyState['players'][number]>;

    const agentSlot: FullAgentSlot = {
        slotIndex: 1,
        kind: 'ai',
        omniscient: true,
        attributes: { character: 'rogue' },
    };
    const playerEntry: FullPlayerEntry = {
        playerId: 'P1',
        displayName: 'Alice',
        ready: true,
        role: 'player',
        attributes: { unitColor: 'red' },
    };
    const fullState: Required<LobbyState> = {
        info: { sessionId: 'S1', hostId: 'P1', gameId: 'tactics' },
        players: [playerEntry],
        matchSettings: { boardColor: 'blue' },
        agentSlots: [agentSlot],
    };

    it('round-trips a fully-populated LobbyState with no field dropped', () => {
        expect(LobbyStateSchema.parse(fullState)).toEqual(fullState);
    });

    it('preserves host-authored matchSettings across the IPC boundary', () => {
        expect(LobbyStateSchema.parse(fullState).matchSettings).toEqual({ boardColor: 'blue' });
    });

    it("preserves each player's owner-authored attributes across the IPC boundary", () => {
        expect(LobbyStateSchema.parse(fullState).players[0]?.attributes).toEqual({
            unitColor: 'red',
        });
    });

    it('preserves an AI agent slot attributes map across the IPC boundary', () => {
        expect(LobbyStateSchema.parse(fullState).agentSlots?.[0]?.attributes).toEqual({
            character: 'rogue',
        });
    });

    it('rejects a matchSettings entry with a non-string value', () => {
        expect(() =>
            LobbyStateSchema.parse({
                info: fullState.info,
                players: [{ playerId: 'P1', displayName: 'Alice', ready: true }],
                matchSettings: { boardColor: 42 },
            }),
        ).toThrow();
    });

    it('rejects a player attributes entry with a non-string value', () => {
        expect(() =>
            LobbyStateSchema.parse({
                info: fullState.info,
                players: [
                    { playerId: 'P1', displayName: 'Alice', ready: true, attributes: { c: 42 } },
                ],
            }),
        ).toThrow();
    });

    it('rejects an agent-slot attributes entry with a non-string value', () => {
        expect(() =>
            LobbyStateSchema.parse({
                info: fullState.info,
                players: [{ playerId: 'P1', displayName: 'Alice', ready: true }],
                agentSlots: [{ slotIndex: 1, kind: 'ai', attributes: { character: 42 } }],
            }),
        ).toThrow();
    });

    it('mirrors the wire caps on an agent slot: at the cap accepted, one over rejected', () => {
        const slotWith = (attributes: Record<string, string>) => ({
            info: fullState.info,
            players: [{ playerId: 'P1', displayName: 'Alice', ready: true }],
            agentSlots: [{ slotIndex: 1, kind: 'ai', attributes }],
        });
        const atCap = {
            ['k'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH)]: 'v'.repeat(
                WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH,
            ),
        };
        expect(() => LobbyStateSchema.parse(slotWith(atCap))).not.toThrow();
        expect(() =>
            LobbyStateSchema.parse(
                slotWith({ ['k'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_LENGTH + 1)]: 'v' }),
            ),
        ).toThrow();
        expect(() =>
            LobbyStateSchema.parse(
                slotWith({ c: 'v'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH + 1) }),
            ),
        ).toThrow();
        expect(() => LobbyStateSchema.parse(slotWith({ '': 'v' }))).toThrow();
    });

    it('leaves matchSettings and player attributes uncapped, exactly as the wire does', () => {
        // Their caps live on their own write frames, so capping them here would
        // reject a state the host legitimately broadcast.
        const long = 'v'.repeat(WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH + 1);
        expect(() =>
            LobbyStateSchema.parse({
                info: fullState.info,
                players: [
                    { playerId: 'P1', displayName: 'Alice', ready: true, attributes: { c: long } },
                ],
                matchSettings: { boardColor: long },
            }),
        ).not.toThrow();
    });

    it('still accepts a bare state with every optional field absent', () => {
        const bare = {
            info: fullState.info,
            players: [{ playerId: 'P1', displayName: 'Alice', ready: true }],
        };
        const parsed = LobbyStateSchema.parse(bare);
        expect(parsed.matchSettings).toBeUndefined();
        expect(parsed.agentSlots).toBeUndefined();
        expect(parsed.players[0]?.attributes).toBeUndefined();
    });
});

describe('SaveSlotMetaSchema', () => {
    it('accepts a meta without an optional label', () => {
        const meta = { slotId: 'slot-1', gameId: 'tactics', tick: 0, savedAt: 0 };
        expect(SaveSlotMetaSchema.parse(meta)).toEqual(meta);
    });

    it('accepts a meta with an optional label', () => {
        const meta = {
            slotId: 'slot-1',
            gameId: 'tactics',
            tick: 10,
            savedAt: 1_700_000_000,
            label: 'mid-battle',
        };
        expect(SaveSlotMetaSchema.parse(meta)).toEqual(meta);
    });

    it('rejects a meta missing a required field', () => {
        expect(() =>
            SaveSlotMetaSchema.parse({ slotId: 'slot-1', gameId: 'tactics', tick: 0 }),
        ).toThrow();
    });
});

describe('SaveSlotListSchema', () => {
    it('accepts an empty array', () => {
        expect(SaveSlotListSchema.parse([])).toEqual([]);
    });

    it('rejects a non-array value', () => {
        expect(() => SaveSlotListSchema.parse({})).toThrow();
    });

    it('rejects an array containing a malformed meta', () => {
        expect(() =>
            SaveSlotListSchema.parse([
                { slotId: 'slot-1', gameId: 'tactics', tick: 0, savedAt: 0 },
                { slotId: 'slot-2' },
            ]),
        ).toThrow();
    });
});

describe('RestoreStatusEventSchema', () => {
    const waiting = {
        state: 'waiting',
        gameId: 'sample-game',
        matchId: 'match-1',
        lobbyCode: '127.0.0.1:7777:token',
        pendingSeats: ['remote-a', 'remote-b'],
    };

    it('accepts a waiting event with lobbyCode and pending seats', () => {
        expect(RestoreStatusEventSchema.safeParse(waiting).success).toBe(true);
    });

    it('accepts ready / cancelled / failed events without a lobbyCode', () => {
        for (const state of ['ready', 'cancelled', 'failed']) {
            expect(
                RestoreStatusEventSchema.safeParse({
                    state,
                    gameId: 'sample-game',
                    matchId: 'match-1',
                    pendingSeats: [],
                }).success,
            ).toBe(true);
        }
    });

    it('accepts an empty matchId (failure before a validated matchId exists)', () => {
        expect(
            RestoreStatusEventSchema.safeParse({
                state: 'failed',
                gameId: 'sample-game',
                matchId: '',
                pendingSeats: [],
            }).success,
        ).toBe(true);
    });

    it('rejects coordinator-internal and unknown states', () => {
        for (const state of ['idle', 'hosting', 'waiting-for-players', 'complete', 'aborted']) {
            expect(RestoreStatusEventSchema.safeParse({ ...waiting, state }).success).toBe(false);
        }
    });

    it('rejects an empty gameId', () => {
        expect(RestoreStatusEventSchema.safeParse({ ...waiting, gameId: '' }).success).toBe(false);
    });

    it('rejects missing, non-array, and empty-string pendingSeats entries', () => {
        const { pendingSeats: _dropped, ...withoutSeats } = waiting;
        expect(RestoreStatusEventSchema.safeParse(withoutSeats).success).toBe(false);
        expect(
            RestoreStatusEventSchema.safeParse({ ...waiting, pendingSeats: 'remote-a' }).success,
        ).toBe(false);
        expect(RestoreStatusEventSchema.safeParse({ ...waiting, pendingSeats: [''] }).success).toBe(
            false,
        );
    });

    it('rejects a non-string or empty lobbyCode', () => {
        expect(RestoreStatusEventSchema.safeParse({ ...waiting, lobbyCode: 42 }).success).toBe(
            false,
        );
        expect(RestoreStatusEventSchema.safeParse({ ...waiting, lobbyCode: '' }).success).toBe(
            false,
        );
    });

    it('rejects a waiting event without a lobbyCode (the overlay needs the join code)', () => {
        const { lobbyCode: _dropped, ...withoutCode } = waiting;
        expect(RestoreStatusEventSchema.safeParse(withoutCode).success).toBe(false);
    });

    it('rejects ready / cancelled / failed events carrying a lobbyCode', () => {
        for (const state of ['ready', 'cancelled', 'failed']) {
            expect(
                RestoreStatusEventSchema.safeParse({
                    state,
                    gameId: 'sample-game',
                    matchId: 'match-1',
                    lobbyCode: '127.0.0.1:7777:token',
                    pendingSeats: [],
                }).success,
            ).toBe(false);
        }
    });

    it('rejects a waiting event with no pending seats (the coordinator emits ready instead)', () => {
        expect(RestoreStatusEventSchema.safeParse({ ...waiting, pendingSeats: [] }).success).toBe(
            false,
        );
    });

    it('rejects ready / cancelled / failed events carrying pending seats', () => {
        for (const state of ['ready', 'cancelled', 'failed']) {
            expect(
                RestoreStatusEventSchema.safeParse({
                    state,
                    gameId: 'sample-game',
                    matchId: 'match-1',
                    pendingSeats: ['remote-a'],
                }).success,
            ).toBe(false);
        }
    });
});

describe('ResolvedSettingsSchema', () => {
    it('accepts an empty record', () => {
        expect(ResolvedSettingsSchema.parse({})).toEqual({});
    });

    it('accepts a record with arbitrary unknown values', () => {
        const settings = { audio: { master: 0.8 }, controls: { invertY: true } };
        expect(ResolvedSettingsSchema.parse(settings)).toEqual(settings);
    });

    it('rejects a null value', () => {
        expect(() => ResolvedSettingsSchema.parse(null)).toThrow();
    });

    it('rejects an array', () => {
        expect(() => ResolvedSettingsSchema.parse([])).toThrow();
    });

    it('rejects a primitive', () => {
        expect(() => ResolvedSettingsSchema.parse('settings')).toThrow();
    });
});

describe('PerspectiveReplayPlaybackInfoSchema', () => {
    it('accepts a well-formed perspective playback info (single locked viewer, no playerIds)', () => {
        const info = { gameId: 'tactics', totalTicks: 9, viewerId: 'p1' };
        expect(PerspectiveReplayPlaybackInfoSchema.parse(info)).toEqual(info);
    });

    it('rejects a missing viewerId', () => {
        expect(() =>
            PerspectiveReplayPlaybackInfoSchema.parse({ gameId: 'tactics', totalTicks: 9 }),
        ).toThrow();
    });

    it('rejects a non-integer totalTicks', () => {
        expect(() =>
            PerspectiveReplayPlaybackInfoSchema.parse({
                gameId: 'tactics',
                totalTicks: 9.5,
                viewerId: 'p1',
            }),
        ).toThrow();
    });
});

describe('PerspectiveReplayListSchema', () => {
    it('accepts an empty array', () => {
        expect(PerspectiveReplayListSchema.parse([])).toEqual([]);
    });

    it('accepts items with an optional name (present and absent)', () => {
        const items = [
            { path: '/p/a.chimera-perspective-replay', name: 'My Point of View' },
            { path: '/p/b.chimera-perspective-replay' },
        ];
        expect(PerspectiveReplayListSchema.parse(items)).toEqual(items);
    });

    it('rejects a non-array value', () => {
        expect(() => PerspectiveReplayListSchema.parse('not-an-array')).toThrow();
    });

    it('rejects an item with an empty path', () => {
        expect(() => PerspectiveReplayListSchema.parse([{ path: '' }])).toThrow();
    });

    it('rejects a bare string element (paths are no longer the item shape)', () => {
        expect(() =>
            PerspectiveReplayListSchema.parse(['/p/a.chimera-perspective-replay']),
        ).toThrow();
    });

    it('degrades an over-long name to undefined instead of rejecting the whole list', () => {
        // A crafted/legacy replay file could carry a name past the request-path
        // bound; the response boundary must not ship it verbatim to the renderer,
        // nor brick the whole list. The row falls back to "Untitled replay".
        const [item] = PerspectiveReplayListSchema.parse([
            {
                path: '/p/a.chimera-perspective-replay',
                name: 'x'.repeat(MAX_SAVE_LABEL_LENGTH + 1),
            },
        ]);
        expect(item?.path).toBe('/p/a.chimera-perspective-replay');
        expect(item?.name).toBeUndefined();
    });
});

describe('ReplayListSchema', () => {
    const baseItem = {
        path: '/r/a.chimera-replay',
        gameId: 'tactics',
        gameVersion: '1.2.3',
        engineVersion: '0.9.0',
        recordedAt: '2026-07-14T12:00:00.000Z',
        durationTicks: 42,
        playerIds: ['alice', 'bob'],
    };

    it('accepts items with an optional name (present and absent)', () => {
        const items = [{ ...baseItem, name: 'Grand Finale' }, { ...baseItem }];
        expect(ReplayListSchema.parse(items)).toEqual(items);
    });

    it('degrades an over-long name to undefined instead of rejecting the whole list', () => {
        const [item] = ReplayListSchema.parse([
            { ...baseItem, name: 'x'.repeat(MAX_SAVE_LABEL_LENGTH + 1) },
        ]);
        expect(item?.path).toBe(baseItem.path);
        expect(item?.name).toBeUndefined();
    });
});

describe('ActionRejectionSchema', () => {
    it('accepts a well-formed rejection with actionType', () => {
        const rejection = {
            reason: 'ipc-validation:chimera:game:send-action',
            tick: 7,
            actionType: 'noop',
        };
        expect(ActionRejectionSchema.parse(rejection)).toEqual(rejection);
    });

    it('accepts a rejection without the optional actionType', () => {
        const rejection = { reason: 'pipeline:rejected', tick: 0 };
        expect(ActionRejectionSchema.parse(rejection)).toEqual(rejection);
    });

    it('accepts tick: -1 (unknown-tick sentinel, §4.3 REJECT parity)', () => {
        const rejection = { reason: 'ipc-validation:x', tick: -1 };
        expect(ActionRejectionSchema.parse(rejection)).toEqual(rejection);
    });

    it('rejects an empty reason', () => {
        expect(() => ActionRejectionSchema.parse({ reason: '', tick: 0 })).toThrow();
    });

    it('rejects a non-integer tick', () => {
        expect(() => ActionRejectionSchema.parse({ reason: 'x', tick: 1.5 })).toThrow();
    });

    it('rejects a non-string actionType', () => {
        expect(() =>
            ActionRejectionSchema.parse({ reason: 'x', tick: 0, actionType: 42 }),
        ).toThrow();
    });

    it('rejects a null payload', () => {
        expect(() => ActionRejectionSchema.parse(null)).toThrow();
    });
});

describe('DeviceInfoSchema', () => {
    const validInfo = {
        os: 'macos' as const,
        osVersion: '14.5.0',
        arch: 'arm64' as const,
        electronVer: '33.2.0',
        chromiumVer: '130.0.0.0',
        locale: 'en-US',
        formFactor: 'unknown' as const,
        screens: [
            { id: 1, width: 1920, height: 1080, pixelRatio: 2, refreshHz: 60, primary: true },
        ],
        windowSizeClass: 'large' as const,
        inputs: ['mouse', 'keyboard'] as const,
        primaryInput: 'mouse' as const,
        battery: null,
    };

    it('accepts a fully conforming DeviceInfo', () => {
        expect(DeviceInfoSchema.parse(validInfo)).toMatchObject({
            os: 'macos',
            arch: 'arm64',
            windowSizeClass: 'large',
        });
    });

    it('accepts all valid os values', () => {
        for (const os of ['macos', 'windows', 'linux'] as const) {
            expect(() => DeviceInfoSchema.parse({ ...validInfo, os })).not.toThrow();
        }
    });

    it('rejects unknown os value', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, os: 'plan9' })).toThrow();
    });

    it('accepts all valid arch values', () => {
        for (const arch of ['x64', 'arm64'] as const) {
            expect(() => DeviceInfoSchema.parse({ ...validInfo, arch })).not.toThrow();
        }
    });

    it('rejects unknown arch value', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, arch: 'ia32' })).toThrow();
    });

    it('accepts all valid windowSizeClass values', () => {
        for (const windowSizeClass of ['compact', 'regular', 'large', 'ultrawide'] as const) {
            expect(() => DeviceInfoSchema.parse({ ...validInfo, windowSizeClass })).not.toThrow();
        }
    });

    it('accepts battery: null', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, battery: null })).not.toThrow();
    });

    it('accepts a battery object', () => {
        expect(() =>
            DeviceInfoSchema.parse({ ...validInfo, battery: { charging: true, level: 0.75 } }),
        ).not.toThrow();
    });

    it('rejects battery levels outside the Battery API range', () => {
        expect(() =>
            DeviceInfoSchema.parse({ ...validInfo, battery: { charging: true, level: -0.01 } }),
        ).toThrow();
        expect(() =>
            DeviceInfoSchema.parse({ ...validInfo, battery: { charging: true, level: 1.01 } }),
        ).toThrow();
    });

    it('accepts multiple screens', () => {
        const twoScreens = [
            { id: 1, width: 1920, height: 1080, pixelRatio: 1, refreshHz: 60, primary: true },
            { id: 2, width: 2560, height: 1440, pixelRatio: 2, refreshHz: 144, primary: false },
        ];
        expect(() => DeviceInfoSchema.parse({ ...validInfo, screens: twoScreens })).not.toThrow();
    });

    it('rejects when a required field is missing', () => {
        const { os: _os, ...withoutOs } = validInfo;
        expect(() => DeviceInfoSchema.parse(withoutOs)).toThrow();
    });

    it('rejects when screens is empty array', () => {
        expect(() => DeviceInfoSchema.parse({ ...validInfo, screens: [] })).toThrow();
    });

    it('rejects a non-object payload', () => {
        expect(() => DeviceInfoSchema.parse(null)).toThrow();
        expect(() => DeviceInfoSchema.parse('device')).toThrow();
    });
});
