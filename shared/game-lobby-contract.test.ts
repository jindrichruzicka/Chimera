/**
 * shared/game-lobby-contract.test.ts
 *
 * Type-level and runtime unit tests for the customizable-lobby contract types:
 * LobbyFieldOption, GameLobbySetup, GameSetupConfig, LobbyPendingAction,
 * GameLobbyScreenProps, plus the pure default-resolution / option-lookup helpers
 * (resolveMatchSettingsDefaults, resolvePlayerAttributeDefaults, lookupFieldOption,
 * optionLabel).
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 * Task: #703 (part of #702 — game lobby contract types)
 *
 * Invariants upheld:
 *   §3 Module Boundary Table — `shared/` must not import from `renderer/`,
 *     `games/*`, or `electron/`. The module's sole import is a type-only re-use
 *     of the canonical LobbyState/PlayerId from a sibling `shared/` module
 *     (messages-schemas.ts); type-only imports are erased at build, so the
 *     emitted module has zero runtime imports (cf. messages-schemas.ts local
 *     invariant #2 — zero runtime imports from renderer/, electron/, or DOM).
 *
 * Tests written first (TDD — red confirmed: module did not exist before
 * this commit; `pnpm test` reported "cannot find module").
 */

import { describe, it, expect } from 'vitest';
import type { LobbyState, PlayerId } from './messages-schemas.js';
import type {
    LobbyFieldOption,
    GameLobbySetup,
    GameSetupConfig,
    LobbyPendingAction,
    GameLobbyScreenProps,
} from './game-lobby-contract.js';
import {
    resolveMatchSettingsDefaults,
    resolvePlayerAttributeDefaults,
    lookupFieldOption,
    optionLabel,
} from './game-lobby-contract.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const teamOptions: readonly LobbyFieldOption[] = [
    { value: 'red', label: 'Red Team' },
    { value: 'blue', label: 'Blue Team' },
];

/**
 * A representative game setup: two match settings with defaults + options, one
 * player attribute ("team"), and seat-index-based default attributes that
 * alternate teams so different seats yield different defaults.
 */
const setup: GameLobbySetup = {
    maxPlayers: 4,
    matchSettingsDefaults: { mapSize: 'medium', fogOfWar: 'on' },
    matchSettingsOptions: {
        mapSize: [
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
        ],
        fogOfWar: [
            { value: 'on', label: 'On' },
            { value: 'off', label: 'Off' },
        ],
    },
    playerAttributeOptions: { team: teamOptions },
    resolveDefaultPlayerAttributes: (seatIndex) => ({
        team: seatIndex % 2 === 0 ? 'red' : 'blue',
    }),
};

// ─── LobbyFieldOption ───────────────────────────────────────────────────────────

describe('LobbyFieldOption', () => {
    it('pairs a stored value with a human-readable label', () => {
        const option: LobbyFieldOption = { value: 'red', label: 'Red Team' };
        expect(option.value).toBe('red');
        expect(option.label).toBe('Red Team');
    });
});

// ─── GameLobbySetup — resolveDefaultPlayerAttributes ────────────────────────────

describe('GameLobbySetup.resolveDefaultPlayerAttributes', () => {
    it('resolves seat-specific default attributes', () => {
        expect(setup.resolveDefaultPlayerAttributes(0)).toEqual({ team: 'red' });
        expect(setup.resolveDefaultPlayerAttributes(1)).toEqual({ team: 'blue' });
    });

    it('returns different defaults for different seats', () => {
        const seat0 = setup.resolveDefaultPlayerAttributes(0);
        const seat1 = setup.resolveDefaultPlayerAttributes(1);
        expect(seat0).not.toEqual(seat1);
    });
});

// ─── resolvePlayerAttributeDefaults (pure helper) ───────────────────────────────

describe('resolvePlayerAttributeDefaults', () => {
    it('delegates to the setup resolver for the given seat', () => {
        expect(resolvePlayerAttributeDefaults(setup, 0)).toEqual({ team: 'red' });
        expect(resolvePlayerAttributeDefaults(setup, 3)).toEqual({ team: 'blue' });
    });
});

// ─── resolveMatchSettingsDefaults (pure helper) ─────────────────────────────────

describe('resolveMatchSettingsDefaults', () => {
    it('returns the configured match-setting defaults', () => {
        expect(resolveMatchSettingsDefaults(setup)).toEqual({
            mapSize: 'medium',
            fogOfWar: 'on',
        });
    });

    it('returns a copy that does not alias or mutate the setup defaults', () => {
        const resolved = resolveMatchSettingsDefaults(setup);
        resolved['mapSize'] = 'large';
        expect(setup.matchSettingsDefaults['mapSize']).toBe('medium');
    });
});

// ─── lookupFieldOption (pure helper) ────────────────────────────────────────────

describe('lookupFieldOption', () => {
    it('returns the matching option for a known value', () => {
        expect(lookupFieldOption(teamOptions, 'blue')).toEqual({
            value: 'blue',
            label: 'Blue Team',
        });
    });

    it('returns undefined for an unknown value (no throw)', () => {
        expect(lookupFieldOption(teamOptions, 'green')).toBeUndefined();
    });
});

// ─── optionLabel (pure helper) ──────────────────────────────────────────────────

describe('optionLabel', () => {
    it('returns the label for a known value', () => {
        expect(optionLabel(teamOptions, 'red')).toBe('Red Team');
    });

    it('falls back to the raw value when the option is absent', () => {
        expect(optionLabel(teamOptions, 'green')).toBe('green');
    });
});

// ─── GameSetupConfig ────────────────────────────────────────────────────────────

describe('GameSetupConfig', () => {
    it('carries chosen match settings and per-player attributes keyed by PlayerId', () => {
        const p1: PlayerId = 'p1';
        const p2: PlayerId = 'p2';
        const config: GameSetupConfig = {
            matchSettings: { mapSize: 'large', fogOfWar: 'off' },
            playerAttributes: {
                [p1]: { team: 'red' },
                [p2]: { team: 'blue' },
            },
        };

        expect(config.matchSettings['mapSize']).toBe('large');
        expect(config.playerAttributes[p1]).toEqual({ team: 'red' });
    });
});

// ─── LobbyPendingAction ─────────────────────────────────────────────────────────

describe('LobbyPendingAction', () => {
    it('accepts each in-flight action and the idle null state', () => {
        const actions: LobbyPendingAction[] = [
            'hosting',
            'joining',
            'leaving',
            'starting',
            'updating-ready',
            null,
        ];
        expect(actions).toHaveLength(6);
    });

    it('rejects an unknown action string at compile time', () => {
        // @ts-expect-error: 'dancing' is not a member of the LobbyPendingAction union
        const _: LobbyPendingAction = 'dancing';
        expect(_).toBeDefined();
    });
});

// ─── GameLobbyScreenProps ───────────────────────────────────────────────────────

describe('GameLobbyScreenProps', () => {
    const lobbyState: LobbyState = {
        info: { sessionId: 's1', hostId: 'p1', gameId: 'tactics' },
        players: [{ playerId: 'p1', displayName: 'Host', ready: true }],
    };

    const baseProps: GameLobbyScreenProps = {
        lobbyState,
        localPlayerId: 'p1',
        isHost: true,
        canStartGame: false,
        pendingAction: null,
        setMatchSetting: () => undefined,
        setPlayerAttribute: () => undefined,
        onToggleReady: () => Promise.resolve(),
        onStartGame: () => Promise.resolve(),
        onLeave: () => Promise.resolve(),
    };

    it('accepts a fully-typed props object reusing shared LobbyState/PlayerId', () => {
        expect(baseProps.lobbyState.info.gameId).toBe('tactics');
        expect(baseProps.localPlayerId).toBe('p1');
        expect(baseProps.isHost).toBe(true);
    });

    it('invokes the synchronous setters with key/value pairs', () => {
        const calls: [string, string][] = [];
        const props: GameLobbyScreenProps = {
            ...baseProps,
            setMatchSetting: (key, value) => calls.push([key, value]),
            setPlayerAttribute: (key, value) => calls.push([key, value]),
        };
        props.setMatchSetting('mapSize', 'large');
        props.setPlayerAttribute('team', 'blue');
        expect(calls).toEqual([
            ['mapSize', 'large'],
            ['team', 'blue'],
        ]);
    });

    it('exposes async lifecycle callbacks returning promises', async () => {
        await expect(baseProps.onToggleReady(true)).resolves.toBeUndefined();
        await expect(baseProps.onStartGame()).resolves.toBeUndefined();
        await expect(baseProps.onLeave()).resolves.toBeUndefined();
    });

    it('rejects a props object missing a required field at compile time', () => {
        // @ts-expect-error: onLeave is required and is omitted here
        const _: GameLobbyScreenProps = {
            lobbyState,
            localPlayerId: 'p1',
            isHost: true,
            canStartGame: false,
            pendingAction: null,
            setMatchSetting: () => undefined,
            setPlayerAttribute: () => undefined,
            onToggleReady: () => Promise.resolve(),
            onStartGame: () => Promise.resolve(),
        };
        expect(_).toBeDefined();
    });

    it('rejects a setter requiring more arguments than the contract supplies', () => {
        const _: GameLobbyScreenProps = {
            ...baseProps,
            // @ts-expect-error: the contract calls setMatchSetting with (key, value);
            // a signature that requires a third argument is not assignable.
            setMatchSetting: (key: string, value: string, extra: string) =>
                void [key, value, extra],
        };
        expect(_).toBeDefined();
    });
});
