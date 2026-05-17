// @vitest-environment jsdom
/**
 * renderer/input/InputManager.test.ts
 *
 * Unit tests for InputManager (§4.26 — Input & Keybindings).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only.
 * Invariant #66: Key bindings are settings, not profile data.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InputActionId } from './InputAction.js';
import type { InputEvent } from './InputAction.js';
import type { KeyBinding, EngineBindings } from './InputBindingSchema.js';
import { createInputActionRegistry } from './InputActionRegistry.js';
import { createInputManager } from './InputManager.js';
import type { InputManager } from './InputManager.js';
import type { KeyBindingRepository } from './KeyBindingRepository.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRepo(bindings: EngineBindings): KeyBindingRepository {
    const store: EngineBindings = { ...bindings };
    return {
        getAll: () => ({ ...store }),
        get: (id) => store[id],
        save: vi.fn(async (id: InputActionId, binding: KeyBinding) => {
            store[id] = binding;
        }),
    };
}

function fireKeydown(
    code: string,
    opts: {
        ctrlKey?: boolean;
        shiftKey?: boolean;
        altKey?: boolean;
        metaKey?: boolean;
        repeat?: boolean;
    } = {},
): void {
    window.dispatchEvent(
        new KeyboardEvent('keydown', {
            code,
            ctrlKey: opts.ctrlKey ?? false,
            shiftKey: opts.shiftKey ?? false,
            altKey: opts.altKey ?? false,
            metaKey: opts.metaKey ?? false,
            repeat: opts.repeat ?? false,
            bubbles: true,
        }),
    );
}

function fireKeyup(
    code: string,
    opts: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean } = {},
): void {
    window.dispatchEvent(
        new KeyboardEvent('keyup', {
            code,
            ctrlKey: opts.ctrlKey ?? false,
            shiftKey: opts.shiftKey ?? false,
            altKey: opts.altKey ?? false,
            metaKey: opts.metaKey ?? false,
            bubbles: true,
        }),
    );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UNDO_ACTION = {
    id: 'engine:undo' as InputActionId,
    description: 'Undo last action',
    category: 'Engine',
    oneShot: true,
};
const REDO_ACTION = {
    id: 'engine:redo' as InputActionId,
    description: 'Redo last undone action',
    category: 'Engine',
    oneShot: true,
};
const TOGGLE_MENU_ACTION = {
    id: 'engine:toggle-menu' as InputActionId,
    description: 'Toggle menu',
    category: 'Engine',
    oneShot: true,
};
const MOVE_ACTION = {
    id: 'game:move' as InputActionId,
    description: 'Move unit',
    category: 'Gameplay',
    oneShot: false,
};

const DEFAULT_BINDINGS: EngineBindings = {
    'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
    'engine:redo': { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] },
    'engine:toggle-menu': { primary: 'Escape' },
    'game:move': { primary: 'KeyM' },
};

// ─── Lifecycle tests ──────────────────────────────────────────────────────────

describe('InputManager — lifecycle', () => {
    let registry: ReturnType<typeof createInputActionRegistry>;
    let repo: KeyBindingRepository;
    let manager: InputManager;

    beforeEach(() => {
        registry = createInputActionRegistry([UNDO_ACTION, TOGGLE_MENU_ACTION]);
        repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
    });

    afterEach(() => {
        manager.stop();
    });

    it('attaches keydown and keyup listeners when started', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        manager.start();
        const calls = addSpy.mock.calls.map((c) => c[0]);
        expect(calls).toContain('keydown');
        expect(calls).toContain('keyup');
        addSpy.mockRestore();
    });

    it('start() is idempotent — listeners are not added twice', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        manager.start();
        manager.start(); // second call should be a no-op
        const keydownCalls = addSpy.mock.calls.filter((c) => c[0] === 'keydown').length;
        expect(keydownCalls).toBe(1);
        addSpy.mockRestore();
    });

    it('stop() removes the listeners attached by start()', () => {
        const removeSpy = vi.spyOn(window, 'removeEventListener');
        manager.start();
        manager.stop();
        const calls = removeSpy.mock.calls.map((c) => c[0]);
        expect(calls).toContain('keydown');
        expect(calls).toContain('keyup');
        removeSpy.mockRestore();
    });

    it('stop() is idempotent — safe to call multiple times', () => {
        manager.start();
        expect(() => {
            manager.stop();
            manager.stop();
        }).not.toThrow();
    });

    it('stop() before start() does not throw', () => {
        expect(() => manager.stop()).not.toThrow();
    });

    it('events do not fire after stop()', () => {
        const cb = vi.fn();
        manager.onAction('engine:toggle-menu', cb);
        manager.start();
        manager.stop();
        fireKeydown('Escape');
        expect(cb).not.toHaveBeenCalled();
    });
});

// ─── onAction subscription tests ─────────────────────────────────────────────

describe('InputManager — onAction subscriptions', () => {
    let registry: ReturnType<typeof createInputActionRegistry>;
    let repo: KeyBindingRepository;
    let manager: InputManager;

    beforeEach(() => {
        registry = createInputActionRegistry([
            UNDO_ACTION,
            REDO_ACTION,
            TOGGLE_MENU_ACTION,
            MOVE_ACTION,
        ]);
        repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
    });

    afterEach(() => {
        manager.stop();
    });

    it('callback fires when the bound key is pressed', () => {
        const cb = vi.fn();
        manager.onAction('engine:toggle-menu', cb);
        fireKeydown('Escape');
        expect(cb).toHaveBeenCalledOnce();
    });

    it('callback receives a correctly shaped InputEvent', () => {
        const cb = vi.fn<(event: InputEvent) => void>();
        manager.onAction('engine:toggle-menu', cb);
        fireKeydown('Escape');
        const event: InputEvent = cb.mock.calls[0]![0];
        expect(event.actionId).toBe('engine:toggle-menu');
        expect(event.code).toBe('Escape');
        expect(event.pressed).toBe(true);
        expect(event.repeat).toBe(false);
        expect(typeof event.timestamp).toBe('number');
    });

    it('returns an unsubscribe function that stops callback delivery', () => {
        const cb = vi.fn();
        const unsub = manager.onAction('engine:toggle-menu', cb);
        unsub();
        fireKeydown('Escape');
        expect(cb).not.toHaveBeenCalled();
    });

    it('multiple subscribers for the same action all receive the event', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        manager.onAction('engine:toggle-menu', cb1);
        manager.onAction('engine:toggle-menu', cb2);
        fireKeydown('Escape');
        expect(cb1).toHaveBeenCalledOnce();
        expect(cb2).toHaveBeenCalledOnce();
    });

    it('unsubscribing one listener does not affect others for the same action', () => {
        const cb1 = vi.fn();
        const cb2 = vi.fn();
        const unsub1 = manager.onAction('engine:toggle-menu', cb1);
        manager.onAction('engine:toggle-menu', cb2);
        unsub1();
        fireKeydown('Escape');
        expect(cb1).not.toHaveBeenCalled();
        expect(cb2).toHaveBeenCalledOnce();
    });

    it('callback does not fire when a different key is pressed', () => {
        const cb = vi.fn();
        manager.onAction('engine:toggle-menu', cb);
        fireKeydown('Enter');
        expect(cb).not.toHaveBeenCalled();
    });
});

// ─── Modifier matching tests ──────────────────────────────────────────────────

describe('InputManager — modifier matching', () => {
    let manager: InputManager;

    beforeEach(() => {
        const registry = createInputActionRegistry([UNDO_ACTION, REDO_ACTION, TOGGLE_MENU_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
    });

    afterEach(() => {
        manager.stop();
    });

    it('Ctrl+Z fires engine:undo', () => {
        const cb = vi.fn();
        manager.onAction('engine:undo', cb);
        fireKeydown('KeyZ', { ctrlKey: true });
        expect(cb).toHaveBeenCalledOnce();
    });

    it('Ctrl+Shift+Z fires engine:redo', () => {
        const cb = vi.fn();
        manager.onAction('engine:redo', cb);
        fireKeydown('KeyZ', { ctrlKey: true, shiftKey: true });
        expect(cb).toHaveBeenCalledOnce();
    });

    it('plain Z does not fire engine:undo (modifier required)', () => {
        const cb = vi.fn();
        manager.onAction('engine:undo', cb);
        fireKeydown('KeyZ');
        expect(cb).not.toHaveBeenCalled();
    });

    it('Ctrl+Z does not fire engine:redo (extra modifier required)', () => {
        const cb = vi.fn();
        manager.onAction('engine:redo', cb);
        fireKeydown('KeyZ', { ctrlKey: true });
        expect(cb).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+Z does not fire engine:undo (extra modifier disqualifies)', () => {
        const cb = vi.fn();
        manager.onAction('engine:undo', cb);
        fireKeydown('KeyZ', { ctrlKey: true, shiftKey: true });
        expect(cb).not.toHaveBeenCalled();
    });

    it('modifier normalization: modifiers in any order in the binding match correctly', () => {
        // Binding with modifiers in non-canonical order — should still match
        const registry = createInputActionRegistry([
            {
                id: 'engine:undo',
                description: 'test',
                category: 'Engine',
                oneShot: true,
            },
        ]);
        const repo = makeRepo({
            'engine:undo': { primary: 'KeyZ', modifiers: ['Shift', 'Ctrl'] }, // non-canonical order
        });
        const m = createInputManager(registry, repo);
        const cb = vi.fn();
        m.onAction('engine:undo', cb);
        m.start();
        fireKeydown('KeyZ', { ctrlKey: true, shiftKey: true });
        m.stop();
        expect(cb).toHaveBeenCalledOnce();
    });
});

// ─── Repeat / oneShot tests ───────────────────────────────────────────────────

describe('InputManager — oneShot and key-repeat', () => {
    let manager: InputManager;

    beforeEach(() => {
        const registry = createInputActionRegistry([
            UNDO_ACTION, // oneShot: true
            MOVE_ACTION, // oneShot: false
        ]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
    });

    afterEach(() => {
        manager.stop();
    });

    it('oneShot action does NOT fire on key-repeat events', () => {
        const cb = vi.fn();
        manager.onAction('engine:undo', cb);
        fireKeydown('KeyZ', { ctrlKey: true }); // initial press
        fireKeydown('KeyZ', { ctrlKey: true, repeat: true }); // auto-repeat
        fireKeydown('KeyZ', { ctrlKey: true, repeat: true }); // auto-repeat
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('held (non-oneShot) action fires on key-repeat events', () => {
        const cb = vi.fn();
        manager.onAction('game:move', cb);
        fireKeydown('KeyM'); // initial press
        fireKeydown('KeyM', { repeat: true }); // auto-repeat
        expect(cb).toHaveBeenCalledTimes(2);
    });
});

// ─── isPressed tests ──────────────────────────────────────────────────────────

describe('InputManager — isPressed', () => {
    let manager: InputManager;

    beforeEach(() => {
        const registry = createInputActionRegistry([TOGGLE_MENU_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
    });

    afterEach(() => {
        manager.stop();
    });

    it('returns false before any key is pressed', () => {
        expect(manager.isPressed('engine:toggle-menu')).toBe(false);
    });

    it('returns true while the key is held down', () => {
        fireKeydown('Escape');
        expect(manager.isPressed('engine:toggle-menu')).toBe(true);
    });

    it('returns false after the key is released', () => {
        fireKeydown('Escape');
        fireKeyup('Escape');
        expect(manager.isPressed('engine:toggle-menu')).toBe(false);
    });

    it('returns false for an unknown action', () => {
        expect(manager.isPressed('engine:unknown-action')).toBe(false);
    });
});

// ─── rebind tests ─────────────────────────────────────────────────────────────

describe('InputManager — rebind', () => {
    let registry: ReturnType<typeof createInputActionRegistry>;
    let repo: KeyBindingRepository;
    let manager: InputManager;

    beforeEach(() => {
        registry = createInputActionRegistry([UNDO_ACTION, REDO_ACTION, TOGGLE_MENU_ACTION]);
        repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
    });

    afterEach(() => {
        manager.stop();
    });

    it('returns ok:true and calls repository.save() on a conflict-free rebind', async () => {
        const result = await manager.rebind('engine:toggle-menu', { primary: 'F1' });
        expect(result).toEqual({ ok: true });
        expect(repo.save).toHaveBeenCalledWith('engine:toggle-menu', { primary: 'F1' });
    });

    it('returns ok:false with reason "conflict" when primary key collides within same category', async () => {
        // engine:undo uses Ctrl+Z; rebinding engine:redo to Ctrl+Z should conflict
        const result = await manager.rebind('engine:redo', {
            primary: 'KeyZ',
            modifiers: ['Ctrl'],
        });
        expect(result).toEqual({
            ok: false,
            reason: 'conflict',
            conflictingAction: 'engine:undo',
        });
    });

    it('does NOT call repository.save() when a conflict is detected', async () => {
        await manager.rebind('engine:redo', { primary: 'KeyZ', modifiers: ['Ctrl'] });
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('allows rebinding to a key used by an action in a different category', async () => {
        // MOVE_ACTION is 'Gameplay' category; TOGGLE_MENU is 'Engine' category
        // Rebinding toggle-menu to KeyM should not conflict with game:move (different category)
        const registry2 = createInputActionRegistry([TOGGLE_MENU_ACTION, MOVE_ACTION]);
        const repo2 = makeRepo(DEFAULT_BINDINGS);
        const m2 = createInputManager(registry2, repo2);
        const result = await m2.rebind('engine:toggle-menu', { primary: 'KeyM' });
        expect(result).toEqual({ ok: true });
    });

    it('returns a typed failure when persistence fails and keeps runtime bindings unchanged', async () => {
        const failingRepo: KeyBindingRepository = {
            getAll: () => ({ ...DEFAULT_BINDINGS }),
            get: (id) => DEFAULT_BINDINGS[id],
            save: vi.fn(async () => {
                throw new Error('disk unavailable');
            }),
        };

        const managerWithFailingSave = createInputManager(registry, failingRepo);
        managerWithFailingSave.start();

        const cb = vi.fn();
        managerWithFailingSave.onAction('engine:toggle-menu', cb);

        const result = await managerWithFailingSave.rebind('engine:toggle-menu', { primary: 'F2' });
        expect(result).toEqual({ ok: false, reason: 'persist_failed' });

        // Original binding remains active because save did not succeed.
        fireKeydown('Escape');
        fireKeydown('F2');
        expect(cb).toHaveBeenCalledTimes(1);

        managerWithFailingSave.stop();
    });

    it('treats an action as not conflicting with its own current binding', async () => {
        // Rebinding engine:undo to its existing binding should be ok (no self-conflict)
        const result = await manager.rebind('engine:undo', {
            primary: 'KeyZ',
            modifiers: ['Ctrl'],
        });
        expect(result).toEqual({ ok: true });
    });

    it('returns ok:false with reason "conflict" when secondary key collides within same category', async () => {
        // engine:undo uses Ctrl+Z as primary; rebinding engine:redo so that its
        // secondary is also Ctrl+Z should be detected as a conflict.
        const result = await manager.rebind('engine:redo', {
            primary: 'KeyY',
            secondary: 'KeyZ',
            modifiers: ['Ctrl'],
        });
        expect(result).toEqual({
            ok: false,
            reason: 'conflict',
            conflictingAction: 'engine:undo',
        });
    });

    it('does NOT call repository.save() when a secondary key conflict is detected', async () => {
        await manager.rebind('engine:redo', {
            primary: 'KeyY',
            secondary: 'KeyZ',
            modifiers: ['Ctrl'],
        });
        expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws UnknownInputActionError when action id is not registered', async () => {
        const { UnknownInputActionError } = await import('./InputActionRegistry.js');
        await expect(manager.rebind('engine:unknown', { primary: 'KeyX' })).rejects.toThrow(
            UnknownInputActionError,
        );
    });

    it('the new binding fires callbacks after a successful rebind', async () => {
        manager.start();
        const cb = vi.fn();
        manager.onAction('engine:toggle-menu', cb);

        // Rebind Escape → F2
        await manager.rebind('engine:toggle-menu', { primary: 'F2' });

        fireKeydown('Escape'); // old binding — should NOT fire
        expect(cb).not.toHaveBeenCalled();

        fireKeydown('F2'); // new binding — should fire
        expect(cb).toHaveBeenCalledOnce();
    });
});

// ─── Category routing tests ──────────────────────────────────────────────────

describe('InputManager — category routing', () => {
    it('does not dispatch when combo is ambiguous and no active category is set', () => {
        const registry = createInputActionRegistry([
            {
                id: 'engine:toggle-menu',
                description: 'Toggle menu',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'game:move',
                description: 'Move unit',
                category: 'Gameplay',
                oneShot: false,
            },
        ]);
        const repo = makeRepo({
            'engine:toggle-menu': { primary: 'KeyM' },
            'game:move': { primary: 'KeyM' },
        });
        const manager = createInputManager(registry, repo);
        manager.start();

        const engineCb = vi.fn();
        const gameplayCb = vi.fn();
        manager.onAction('engine:toggle-menu', engineCb);
        manager.onAction('game:move', gameplayCb);

        fireKeydown('KeyM');

        expect(engineCb).not.toHaveBeenCalled();
        expect(gameplayCb).not.toHaveBeenCalled();

        manager.stop();
    });

    it('dispatches using active category when duplicate combos exist across categories', () => {
        const registry = createInputActionRegistry([
            {
                id: 'engine:toggle-menu',
                description: 'Toggle menu',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'game:move',
                description: 'Move unit',
                category: 'Gameplay',
                oneShot: false,
            },
        ]);
        const repo = makeRepo({
            'engine:toggle-menu': { primary: 'KeyM' },
            'game:move': { primary: 'KeyM' },
        });
        const manager = createInputManager(registry, repo);
        manager.start();

        const engineCb = vi.fn();
        const gameplayCb = vi.fn();
        manager.onAction('engine:toggle-menu', engineCb);
        manager.onAction('game:move', gameplayCb);

        manager.setActiveCategory('Engine');
        fireKeydown('KeyM');
        expect(engineCb).toHaveBeenCalledTimes(1);
        expect(gameplayCb).toHaveBeenCalledTimes(0);

        manager.setActiveCategory('Gameplay');
        fireKeydown('KeyM');
        expect(engineCb).toHaveBeenCalledTimes(1);
        expect(gameplayCb).toHaveBeenCalledTimes(1);

        manager.stop();
    });
});

// ─── Gamepad tests ────────────────────────────────────────────────────────────

describe('InputManager — gamepad', () => {
    let manager: InputManager;
    let mockGetGamepads: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        const registry = createInputActionRegistry([
            {
                id: 'engine:toggle-menu',
                description: 'Toggle menu',
                category: 'Engine',
                oneShot: true,
            },
            {
                id: 'game:move',
                description: 'Move unit',
                category: 'Gameplay',
                oneShot: false,
            },
        ]);
        const repo = makeRepo({
            'engine:toggle-menu': { primary: 'button:0' },
            'game:move': { primary: 'button:1' },
        });
        manager = createInputManager(registry, repo);

        // Stub navigator.getGamepads
        mockGetGamepads = vi.fn().mockReturnValue([]);
        vi.stubGlobal('navigator', { ...navigator, getGamepads: mockGetGamepads });
    });

    afterEach(() => {
        manager.stop();
        vi.unstubAllGlobals();
    });

    it('fires the action callback when a gamepad button matching button:<index> is pressed', () => {
        const cb = vi.fn();
        manager.onAction('engine:toggle-menu', cb);
        manager.start();

        // Simulate button 0 pressed
        mockGetGamepads.mockReturnValue([
            {
                buttons: [{ pressed: true, value: 1 }],
                axes: [],
                connected: true,
                id: 'test',
                index: 0,
                mapping: 'standard',
                timestamp: 0,
            },
        ]);

        manager.pollGamepad();
        expect(cb).toHaveBeenCalledOnce();
    });

    it('does not fire the action again if the button stays pressed (oneShot)', () => {
        const cb = vi.fn();
        manager.onAction('engine:toggle-menu', cb);
        manager.start();

        const gamepad = {
            buttons: [{ pressed: true, value: 1 }],
            axes: [],
            connected: true,
            id: 'test',
            index: 0,
            mapping: 'standard',
            timestamp: 0,
        };
        mockGetGamepads.mockReturnValue([gamepad]);

        manager.pollGamepad();
        manager.pollGamepad(); // second poll — button still pressed
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires again after button is released and re-pressed', () => {
        const cb = vi.fn<(event: InputEvent) => void>();
        manager.onAction('engine:toggle-menu', cb);
        manager.start();

        const gamepad = {
            buttons: [{ pressed: true, value: 1 }],
            axes: [],
            connected: true,
            id: 'test',
            index: 0,
            mapping: 'standard',
            timestamp: 0,
        };
        mockGetGamepads.mockReturnValue([gamepad]);
        manager.pollGamepad();

        // Release
        mockGetGamepads.mockReturnValue([{ ...gamepad, buttons: [{ pressed: false, value: 0 }] }]);
        manager.pollGamepad();

        // Re-press
        mockGetGamepads.mockReturnValue([gamepad]);
        manager.pollGamepad();

        expect(cb).toHaveBeenCalledTimes(3);
        expect(cb.mock.calls[1]![0]).toMatchObject({
            actionId: 'engine:toggle-menu',
            code: 'button:0',
            pressed: false,
            repeat: false,
        });
        expect(cb.mock.calls[2]![0]).toMatchObject({
            actionId: 'engine:toggle-menu',
            code: 'button:0',
            pressed: true,
            repeat: false,
        });
    });

    it('emits a pressed:false event when a gamepad button is released', () => {
        const cb = vi.fn<(event: InputEvent) => void>();
        manager.onAction('engine:toggle-menu', cb);
        manager.start();

        const pressedGamepad = {
            buttons: [{ pressed: true, value: 1 }],
            axes: [],
            connected: true,
            id: 'test',
            index: 0,
            mapping: 'standard',
            timestamp: 0,
        };

        mockGetGamepads.mockReturnValue([pressedGamepad]);
        manager.pollGamepad();

        const releasedGamepad = {
            ...pressedGamepad,
            buttons: [{ pressed: false, value: 0 }],
        };
        mockGetGamepads.mockReturnValue([releasedGamepad]);
        manager.pollGamepad();

        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[1]![0]).toMatchObject({
            actionId: 'engine:toggle-menu',
            code: 'button:0',
            pressed: false,
            repeat: false,
        });
    });

    it('fires repeated pressed events while held for non-oneShot gamepad actions', () => {
        const cb = vi.fn<(event: InputEvent) => void>();
        manager.onAction('game:move', cb);
        manager.start();

        const heldGamepad = {
            buttons: [
                { pressed: false, value: 0 },
                { pressed: true, value: 1 },
            ],
            axes: [],
            connected: true,
            id: 'test',
            index: 0,
            mapping: 'standard',
            timestamp: 0,
        };

        mockGetGamepads.mockReturnValue([heldGamepad]);
        manager.pollGamepad();
        manager.pollGamepad();

        expect(cb).toHaveBeenCalledTimes(2);
        expect(cb.mock.calls[0]![0].repeat).toBe(false);
        expect(cb.mock.calls[1]![0].repeat).toBe(true);
        expect(cb.mock.calls[1]![0].pressed).toBe(true);
    });
});

// ─── keyup modifier-mismatch tests ───────────────────────────────────────────

describe('InputManager — keyup modifier mismatch', () => {
    let manager: InputManager;

    beforeEach(() => {
        const registry = createInputActionRegistry([UNDO_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
    });

    afterEach(() => {
        manager.stop();
    });

    it('dispatches pressed:false when key is released without its required modifier', () => {
        const cb = vi.fn<(event: InputEvent) => void>();
        manager.onAction('engine:undo', cb);

        fireKeydown('KeyZ', { ctrlKey: true }); // Ctrl+Z → engine:undo pressed
        expect(cb).toHaveBeenCalledTimes(1);

        // Release Z without Ctrl — modifiers differ from keydown
        fireKeyup('KeyZ');
        expect(cb).toHaveBeenCalledTimes(2);
        const releaseEvent = cb.mock.calls[1]![0];
        expect(releaseEvent.pressed).toBe(false);
        expect(releaseEvent.actionId).toBe('engine:undo');
        expect(releaseEvent.code).toBe('KeyZ');
    });

    it('isPressed returns false after modifier-mismatch keyup', () => {
        fireKeydown('KeyZ', { ctrlKey: true });
        expect(manager.isPressed('engine:undo')).toBe(true);

        fireKeyup('KeyZ');
        expect(manager.isPressed('engine:undo')).toBe(false);
    });

    it('does not dispatch a spurious release event for an action that was never pressed', () => {
        const cb = vi.fn();
        manager.onAction('engine:undo', cb);

        // Keyup without a preceding keydown
        fireKeyup('KeyZ');
        expect(cb).not.toHaveBeenCalled();
    });
});

// ─── dispatchEvent exception isolation ───────────────────────────────────────

describe('InputManager — subscriber exception isolation', () => {
    let manager: InputManager;

    beforeEach(() => {
        const registry = createInputActionRegistry([TOGGLE_MENU_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
    });

    afterEach(() => {
        manager.stop();
    });

    it('a throwing subscriber does not prevent subsequent subscribers from receiving the event', () => {
        const throwing = vi.fn(() => {
            throw new Error('subscriber boom');
        });
        const safe = vi.fn();

        manager.onAction('engine:toggle-menu', throwing);
        manager.onAction('engine:toggle-menu', safe);

        // The keydown must not propagate the exception to the caller
        expect(() => fireKeydown('Escape')).not.toThrow();
        expect(throwing).toHaveBeenCalledOnce();
        expect(safe).toHaveBeenCalledOnce();
    });

    it('subscriber exception is reported via console.error and not swallowed silently', () => {
        const err = new Error('subscriber boom');
        const throwing = vi.fn(() => {
            throw err;
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        manager.onAction('engine:toggle-menu', throwing);
        fireKeydown('Escape');

        expect(errorSpy).toHaveBeenCalledOnce();
        expect(errorSpy.mock.calls[0]![1]).toBe(err);

        errorSpy.mockRestore();
    });
});
