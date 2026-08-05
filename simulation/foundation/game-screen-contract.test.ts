/**
 * simulation/foundation/game-screen-contract.test.ts
 *
 * Type-level and runtime unit tests for the in-game-menu contract additions:
 * the optional `GameScreenRegistry.inGameMenu` slot and the `InGameMenuProps`
 * interface handed to a game's in-game menu component.
 *
 * Architecture reference: §4.33–§4.34 — GameScreenRegistry / GameShell
 *
 * Invariants upheld:
 *   #80 — the in-game menu is supplied only via `GameScreenRegistry`; the slot is
 *     just a `GameScreenComponent`, so `GameShell` never imports `apps/*`.
 *   #81 — `playfield` remains the only required slot; `inGameMenu` is optional (a
 *     registry providing only `playfield` type-checks).
 *   §3 Module Boundary — `simulation/` must not import from `renderer/`, `apps/*`,
 *     or `electron/main`. This test imports React types and the contract module
 *     only; the contract's `PlayerId` comes from the sibling
 *     `./engine-contract.js`.
 *
 * Tests written first (TDD — red confirmed: `InGameMenuProps` was not exported
 * before this commit; the import below fails to resolve / type-check).
 */

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import type { PlayerId } from './engine-contract.js';
import type {
    GameScreenComponent,
    GameScreenProps,
    GameScreenRegistry,
    InGameMenuProps,
} from './game-screen-contract.js';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

// `PlayerId` is a branded type at the preload boundary; a bare string literal is
// not assignable. Cast rather than import simulation's `playerId()` helper, which
// would be a runtime import crossing out of the foundation leaf (§3).
const localPlayerId = 'p1' as unknown as PlayerId;

const playfield: GameScreenComponent<GameScreenProps> = () => null;

function InGameMenu(props: InGameMenuProps): React.ReactElement | null {
    void props;
    return null;
}

const LazyInGameMenu: React.LazyExoticComponent<React.ComponentType<InGameMenuProps>> = React.lazy(
    () => Promise.resolve({ default: InGameMenu }),
);

// ─── InGameMenuProps ──────────────────────────────────────────────────────────

describe('InGameMenuProps', () => {
    it('accepts a fully-typed props object and invokes its void callbacks', () => {
        const calls: string[] = [];
        const props: InGameMenuProps = {
            closeMenu: () => calls.push('close'),
            leaveGame: () => calls.push('leave'),
            isHost: true,
            localPlayerId,
        };

        props.closeMenu();
        props.leaveGame();

        expect(calls).toEqual(['close', 'leave']);
        expect(props.isHost).toBe(true);
        expect(props.localPlayerId).toBe('p1');
    });

    it('treats localPlayerId as optional (props without it type-check)', () => {
        const props: InGameMenuProps = {
            closeMenu: () => undefined,
            leaveGame: () => undefined,
            isHost: false,
        };
        expect(props.localPlayerId).toBeUndefined();
    });

    it('rejects a props object missing the required isHost field at compile time', () => {
        // @ts-expect-error: isHost is required and is omitted here
        const _: InGameMenuProps = {
            closeMenu: () => undefined,
            leaveGame: () => undefined,
        };
        expect(_).toBeDefined();
    });
});

// ─── GameScreenRegistry.inGameMenu slot ───────────────────────────────────────

describe('GameScreenRegistry.inGameMenu', () => {
    it('is optional — a registry providing only playfield is valid (Invariant #81)', () => {
        const registry: GameScreenRegistry = { playfield };
        expect(registry.inGameMenu).toBeUndefined();
    });

    it('accepts a plain React component override (GameScreenComponent)', () => {
        const registry: GameScreenRegistry = { playfield, inGameMenu: InGameMenu };
        expect(registry.inGameMenu).toBe(InGameMenu);
    });

    it('accepts a React.lazy component override (LazyExoticComponent)', () => {
        const registry: GameScreenRegistry = { playfield, inGameMenu: LazyInGameMenu };
        expect(registry.inGameMenu).toBe(LazyInGameMenu);
    });

    it("accepts the 'none' opt-out sentinel", () => {
        const registry: GameScreenRegistry = { playfield, inGameMenu: 'none' };
        expect(registry.inGameMenu).toBe('none');
    });

    it('rejects an unknown string sentinel at compile time', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: 'off' is not a valid inGameMenu sentinel (only 'none')
            inGameMenu: 'off',
        };
        expect(registry.inGameMenu).toBe('off');
    });

    it('rejects a component whose props are incompatible with InGameMenuProps', () => {
        const registry: GameScreenRegistry = {
            playfield,
            // @ts-expect-error: a component requiring an unrelated prop is not assignable
            inGameMenu: (props: { gameResult: string }) => {
                void props;
                return null;
            },
        };
        expect(registry.inGameMenu).toBeDefined();
    });
});
