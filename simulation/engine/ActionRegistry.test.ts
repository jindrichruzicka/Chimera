/**
 * Tests for simulation/engine/ActionRegistry.ts
 *
 * Written first (red phase) per TDD mandate — ActionRegistry.ts does not exist yet.
 *
 * Architecture reference: §4.7
 * Task: F03 / T3 (issue #26)
 *
 * Acceptance criteria (from issue #26):
 *   ✓ register() throws NamespaceCollisionError for any type beginning with engine:
 *   ✓ resolve() throws UnknownActionTypeError for an unregistered type, with the
 *     type string in the error message
 *   ✓ has() returns false for unregistered types and true after registration
 *   ✓ Engine-internal registration path can register engine: types without throwing
 *   ✓ ESLint passes on the new file
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
    ActionRegistry,
    type GameDefinition,
    NamespaceCollisionError,
    UnknownActionTypeError,
} from './ActionRegistry.js';
import { makeStubRng } from './__test-support__/stubs.js';
import type { ActionDefinition, BaseGameSnapshot } from './types.js';
import { playerId as toPlayerId } from './types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal no-op ActionDefinition for testing registration and lookup. */
function makeDefinition(type: string): ActionDefinition<Record<string, unknown>> {
    return {
        type,
        parsePayload: (raw) => raw,
        validate: () => ({ ok: true }),
        reduce: (state) => state,
    };
}

// ─── NamespaceCollisionError ──────────────────────────────────────────────────

describe('NamespaceCollisionError', () => {
    it('is an instance of Error', () => {
        const err = new NamespaceCollisionError('engine:foo');
        expect(err).toBeInstanceOf(Error);
    });

    it('has a code discriminant property equal to "NAMESPACE_COLLISION"', () => {
        const err = new NamespaceCollisionError('engine:bar');
        expect(err.code).toBe('NAMESPACE_COLLISION');
    });

    it('includes the offending type string in the message', () => {
        const err = new NamespaceCollisionError('engine:foo');
        expect(err.message).toContain('engine:foo');
    });

    it('has the correct name property', () => {
        const err = new NamespaceCollisionError('engine:foo');
        expect(err.name).toBe('NamespaceCollisionError');
    });
});

// ─── UnknownActionTypeError ───────────────────────────────────────────────────

describe('UnknownActionTypeError', () => {
    it('is an instance of Error', () => {
        const err = new UnknownActionTypeError('game:unknown_action');
        expect(err).toBeInstanceOf(Error);
    });

    it('has a code discriminant property equal to "UNKNOWN_ACTION_TYPE"', () => {
        const err = new UnknownActionTypeError('game:unknown_action');
        expect(err.code).toBe('UNKNOWN_ACTION_TYPE');
    });

    it('includes the unknown type string in the message', () => {
        const type = 'game:totally_unknown';
        const err = new UnknownActionTypeError(type);
        expect(err.message).toContain(type);
    });

    it('exposes the unknown type on the type property', () => {
        const err = new UnknownActionTypeError('game:missing');
        expect(err.type).toBe('game:missing');
    });

    it('has the correct name property', () => {
        const err = new UnknownActionTypeError('game:foo');
        expect(err.name).toBe('UnknownActionTypeError');
    });
});

// ─── ActionRegistry — register() ─────────────────────────────────────────────

describe('ActionRegistry.register()', () => {
    let registry: ActionRegistry<BaseGameSnapshot>;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('registers a game-namespaced definition without throwing', () => {
        expect(() => {
            registry.register(makeDefinition('mygame:move_unit'));
        }).not.toThrow();
    });

    it('throws NamespaceCollisionError when type begins with engine:', () => {
        expect(() => {
            registry.register(makeDefinition('engine:end_turn'));
        }).toThrow(NamespaceCollisionError);
    });

    it('throws NamespaceCollisionError for any engine: prefix variation', () => {
        expect(() => {
            registry.register(makeDefinition('engine:undo'));
        }).toThrow(NamespaceCollisionError);

        expect(() => {
            registry.register(makeDefinition('engine:redo'));
        }).toThrow(NamespaceCollisionError);
    });

    it('allows registering multiple distinct game-namespaced types', () => {
        expect(() => {
            registry.register(makeDefinition('tactics:move'));
            registry.register(makeDefinition('tactics:attack'));
            registry.register(makeDefinition('puzzle:rotate'));
        }).not.toThrow();
    });
});

// ─── ActionRegistry — resolve() ──────────────────────────────────────────────

describe('ActionRegistry.resolve()', () => {
    let registry: ActionRegistry<BaseGameSnapshot>;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('returns the registered definition for a known type', () => {
        const def = makeDefinition('mygame:fire');
        registry.register(def);
        const resolved = registry.resolve('mygame:fire');
        expect(resolved).toBe(def);
    });

    it('throws UnknownActionTypeError for an unregistered type', () => {
        expect(() => {
            registry.resolve('mygame:does_not_exist');
        }).toThrow(UnknownActionTypeError);
    });

    it('UnknownActionTypeError contains the queried type string', () => {
        const type = 'tactics:phantom_action';
        try {
            registry.resolve(type);
        } catch (err) {
            expect(err).toBeInstanceOf(UnknownActionTypeError);
            expect((err as UnknownActionTypeError).message).toContain(type);
            expect((err as UnknownActionTypeError).type).toBe(type);
        }
        expect.assertions(3);
    });

    it('returns the engine-namespaced definition registered via registerEngineAction()', () => {
        const def = makeDefinition('engine:end_turn');
        registry.registerEngineAction(def);
        const resolved = registry.resolve('engine:end_turn');
        expect(resolved).toBe(def);
    });
});

// ─── ActionRegistry — has() ───────────────────────────────────────────────────

describe('ActionRegistry.has()', () => {
    let registry: ActionRegistry<BaseGameSnapshot>;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('returns false for an unregistered type', () => {
        expect(registry.has('mygame:unknown')).toBe(false);
    });

    it('returns true after the type is registered via register()', () => {
        registry.register(makeDefinition('mygame:move'));
        expect(registry.has('mygame:move')).toBe(true);
    });

    it('returns false for a type before registration and true after', () => {
        const type = 'puzzle:flip';
        expect(registry.has(type)).toBe(false);
        registry.register(makeDefinition(type));
        expect(registry.has(type)).toBe(true);
    });

    it('returns true for engine: types registered via registerEngineAction()', () => {
        registry.registerEngineAction(makeDefinition('engine:undo'));
        expect(registry.has('engine:undo')).toBe(true);
    });

    it('does not bleed state between separate ActionRegistry instances', () => {
        const r1 = new ActionRegistry<BaseGameSnapshot>();
        const r2 = new ActionRegistry<BaseGameSnapshot>();
        r1.register(makeDefinition('game:action_a'));
        expect(r2.has('game:action_a')).toBe(false);
    });
});

// ─── ActionRegistry — registeredTypes() ──────────────────────────────────────

describe('ActionRegistry.registeredTypes()', () => {
    let registry: ActionRegistry<BaseGameSnapshot>;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('returns an empty array when no types have been registered', () => {
        expect(registry.registeredTypes()).toEqual([]);
    });

    it('returns all registered game-namespaced type strings', () => {
        registry.register(makeDefinition('game:a'));
        registry.register(makeDefinition('game:b'));
        const types = registry.registeredTypes();
        expect(types).toContain('game:a');
        expect(types).toContain('game:b');
        expect(types).toHaveLength(2);
    });

    it('includes engine: types registered via registerEngineAction()', () => {
        registry.registerEngineAction(makeDefinition('engine:undo'));
        expect(registry.registeredTypes()).toContain('engine:undo');
    });

    it('returns a readonly array (cannot be mutated externally)', () => {
        registry.register(makeDefinition('game:x'));
        const types = registry.registeredTypes();
        // Mutating the returned array should not affect registry state
        (types as string[]).push('game:injected');
        expect(registry.registeredTypes()).not.toContain('game:injected');
    });
});

// ─── ActionRegistry — registerGame() / resolveGame() ───────────────────────

describe('ActionRegistry game definitions', () => {
    let registry: ActionRegistry<BaseGameSnapshot>;

    beforeEach(() => {
        registry = new ActionRegistry();
    });

    it('returns undefined for an unregistered game id', () => {
        expect(registry.resolveGame('missing-game')).toBeUndefined();
    });

    it('registers and resolves a GameDefinition for a game id', () => {
        const definition: GameDefinition<BaseGameSnapshot> = {
            buildInitialEntities: () => ({}),
        };

        registry.registerGame('tactics', definition);

        expect(registry.resolveGame('tactics')).toBe(definition);
    });

    it('registers a GameDefinition with a game-result resolver hook', () => {
        const definition: GameDefinition<BaseGameSnapshot> = {
            resolveGameResult: () => ({ winnerIds: [toPlayerId('p1')] }),
        };

        registry.registerGame('tactics', definition);

        expect(
            registry.resolveGame('tactics')?.resolveGameResult?.({} as BaseGameSnapshot),
        ).toEqual({ winnerIds: [toPlayerId('p1')] });
    });

    it('keeps action definitions and game definitions in separate registries', () => {
        const definition: GameDefinition<BaseGameSnapshot> = {
            buildInitialEntities: () => ({}),
        };

        registry.register(makeDefinition('tactics:move'));
        registry.registerGame('tactics', definition);

        expect(registry.resolve('tactics:move').type).toBe('tactics:move');
        expect(registry.resolveGame('tactics')).toBe(definition);
    });
});

// ─── Engine-internal registration path ───────────────────────────────────────

describe('ActionRegistry.registerEngineAction() — engine-internal path', () => {
    it('registers an engine: type without throwing NamespaceCollisionError', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();
        expect(() => {
            registry.registerEngineAction(makeDefinition('engine:undo'));
        }).not.toThrow();
    });

    it('makes the engine: type resolvable after registration', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();
        const def = makeDefinition('engine:redo');
        registry.registerEngineAction(def);
        expect(registry.resolve('engine:redo')).toBe(def);
    });

    it('does NOT allow game code to register engine: types via register()', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();
        expect(() => {
            registry.register(makeDefinition('engine:sync_request'));
        }).toThrow(NamespaceCollisionError);
    });
});

// ─── ActionRegistry — error code discriminants (runtime type narrowing) ───────

describe('Error code discriminants', () => {
    it('NamespaceCollisionError.code narrows to literal "NAMESPACE_COLLISION"', () => {
        const err = new NamespaceCollisionError('engine:foo');
        if (err.code === 'NAMESPACE_COLLISION') {
            expect(true).toBe(true); // type guard works
        } else {
            throw new Error('Expected NAMESPACE_COLLISION code');
        }
    });

    it('UnknownActionTypeError.code narrows to literal "UNKNOWN_ACTION_TYPE"', () => {
        const err = new UnknownActionTypeError('game:foo');
        if (err.code === 'UNKNOWN_ACTION_TYPE') {
            expect(true).toBe(true); // type guard works
        } else {
            throw new Error('Expected UNKNOWN_ACTION_TYPE code');
        }
    });
});

// ─── Integration: full round-trip ─────────────────────────────────────────────

describe('ActionRegistry integration', () => {
    it('validates full register → has → resolve → execute round-trip', () => {
        const registry = new ActionRegistry<BaseGameSnapshot>();
        const pid = toPlayerId('player-1');

        const def: ActionDefinition<{ amount: number }> = {
            type: 'game:score',
            parsePayload: (raw) => ({
                amount: typeof raw['amount'] === 'number' ? raw['amount'] : 0,
            }),
            validate: (_payload, _state, _playerId, _ctx) => ({ ok: true }),
            reduce: (state, _payload, _playerId, _ctx) => state,
        };

        registry.register(def);
        expect(registry.has('game:score')).toBe(true);

        const resolved = registry.resolve('game:score');
        const payload = resolved.parsePayload({ amount: 5 });
        const result = resolved.validate(payload, {} as BaseGameSnapshot, pid, {
            rng: makeStubRng(0.5),
            dispatchDepth: 0,
        });
        expect(result.ok).toBe(true);
    });
});
