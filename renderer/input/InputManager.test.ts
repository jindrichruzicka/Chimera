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
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeRepo(bindings: EngineBindings): KeyBindingRepository {
    const store: EngineBindings = { ...bindings };
    return {
        getAll: () => ({ ...store }),
        get: (id) => store[id],
        save: vi.fn(async (id: InputActionId, binding: KeyBinding) => {
            store[id] = binding;
        }),
        reset: vi.fn(async (_id: InputActionId) => {
            // no-op default — individual tests override as needed
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
            reset: vi.fn(async () => {}),
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

    it('pollGamepad is a no-op when navigator.getGamepads is unavailable', () => {
        vi.unstubAllGlobals();
        const descriptor = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
        Object.defineProperty(navigator, 'getGamepads', {
            configurable: true,
            value: undefined,
        });

        try {
            expect(() => manager.pollGamepad()).not.toThrow();
        } finally {
            if (descriptor !== undefined) {
                Object.defineProperty(navigator, 'getGamepads', descriptor);
            } else {
                Reflect.deleteProperty(navigator, 'getGamepads');
            }
        }
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

    it('subscriber exception is forwarded as a named, stack-carrying entry, not swallowed silently', () => {
        const err = new Error('subscriber boom');
        const throwing = vi.fn(() => {
            throw err;
        });
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };

        try {
            manager.onAction('engine:toggle-menu', throwing);
            fireKeydown('Escape');

            // Invariant #67: the thrown Error reaches the log file with its stack
            // and a named module — not a String(err) under the 'global' catch-all.
            expect(logs.emitCalls).toHaveLength(1);
            const entry = logs.emitCalls[0]!;
            expect(entry.level).toBe('error');
            expect(entry.source.module).toBe('input-manager');
            expect(entry.source.module).not.toBe('global');
            expect(entry.error?.stack).toBeDefined();
            expect(entry.error?.message).toBe('subscriber boom');
        } finally {
            Reflect.deleteProperty(globalThis, '__chimera');
        }
    });
});

// ─── getActions / getBinding / resetBinding ───────────────────────────────────

describe('InputManager — getActions()', () => {
    it('returns all registered actions from the registry', () => {
        const registry = createInputActionRegistry([UNDO_ACTION, REDO_ACTION, TOGGLE_MENU_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        const manager = createInputManager(registry, repo);
        const actions = manager.getActions();
        expect(actions.map((a) => a.id)).toContain('engine:undo');
        expect(actions.map((a) => a.id)).toContain('engine:redo');
        expect(actions.map((a) => a.id)).toContain('engine:toggle-menu');
    });

    it('returns an empty array when no actions are registered', () => {
        const registry = createInputActionRegistry([]);
        const repo = makeRepo({});
        const manager = createInputManager(registry, repo);
        expect(manager.getActions()).toEqual([]);
    });
});

describe('InputManager — getBinding()', () => {
    it('returns the current binding for a registered action', () => {
        const registry = createInputActionRegistry([UNDO_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        const manager = createInputManager(registry, repo);
        expect(manager.getBinding('engine:undo')).toEqual({ primary: 'KeyZ', modifiers: ['Ctrl'] });
    });

    it('returns undefined for an action with no binding', () => {
        const registry = createInputActionRegistry([UNDO_ACTION]);
        const repo = makeRepo({});
        const manager = createInputManager(registry, repo);
        expect(manager.getBinding('engine:undo')).toBeUndefined();
    });
});

describe('InputManager — resetBinding()', () => {
    it('calls repo.reset() for the given action id', async () => {
        const registry = createInputActionRegistry([UNDO_ACTION]);
        const repo: KeyBindingRepository & { reset: ReturnType<typeof vi.fn> } = {
            ...makeRepo(DEFAULT_BINDINGS),
            reset: vi.fn().mockResolvedValue(undefined),
        };
        const manager = createInputManager(registry, repo);
        await manager.resetBinding('engine:undo');
        expect(repo.reset).toHaveBeenCalledWith('engine:undo');
    });

    it('clears the runtime binding override so next getBindings reads from repo', async () => {
        const registry = createInputActionRegistry([UNDO_ACTION, TOGGLE_MENU_ACTION]);
        const storeBindings: EngineBindings = { ...DEFAULT_BINDINGS };
        const repo: KeyBindingRepository & { reset: ReturnType<typeof vi.fn> } = {
            getAll: () => ({ ...storeBindings }),
            get: (id) => storeBindings[id],
            save: vi.fn(async (id: InputActionId, b: KeyBinding) => {
                storeBindings[id] = b;
            }),
            reset: vi.fn(async (id: InputActionId) => {
                // Simulate repo.reset restoring default by reverting to original DEFAULT_BINDINGS
                storeBindings[id] = DEFAULT_BINDINGS[id]!;
            }),
        };
        const manager = createInputManager(registry, repo);
        // Rebind to override runtime
        await manager.rebind('engine:undo', { primary: 'KeyX' });
        // Now reset
        await manager.resetBinding('engine:undo');
        // After reset, getBinding should show what repo has (the original KeyZ+Ctrl)
        expect(manager.getBinding('engine:undo')).toEqual({ primary: 'KeyZ', modifiers: ['Ctrl'] });
    });
});

// ─── Focus loss ──────────────────────────────────────────────────────────────

/** Fire a window `blur`, the way alt-tabbing away from the app does. */
function fireBlur(): void {
    window.dispatchEvent(new Event('blur'));
}

/**
 * Fire a `visibilitychange` with `document.visibilityState` reading as `state`
 * for the duration of the dispatch.
 *
 * jsdom's `visibilityState` is a getter on the Document prototype with no
 * setter, so the value has to be redefined on the instance and taken back off
 * again — leaving it defined would make every later test in this file run
 * against a document that claims to be hidden.
 */
function fireVisibilityChange(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => state,
    });
    try {
        document.dispatchEvent(new Event('visibilitychange'));
    } finally {
        Reflect.deleteProperty(document, 'visibilityState');
    }
}

describe('InputManager — focus loss releases held actions', () => {
    let manager: InputManager;
    let events: InputEvent[];

    /** One recorder across both actions, so the ORDER of the releases is visible. */
    function recordReleases(m: InputManager): void {
        for (const id of ['engine:toggle-menu', 'game:move'] as const) {
            m.onAction(id, (event) => {
                events.push(event);
            });
        }
    }

    beforeEach(() => {
        events = [];
        const registry = createInputActionRegistry([UNDO_ACTION, TOGGLE_MENU_ACTION, MOVE_ACTION]);
        const repo = makeRepo(DEFAULT_BINDINGS);
        manager = createInputManager(registry, repo);
        manager.start();
        recordReleases(manager);
    });

    afterEach(() => {
        manager.stop();
    });

    it('attaches the focus-loss listeners on start() and detaches THOSE on stop()', () => {
        // The removal is pinned by HANDLER IDENTITY rather than by behaviour,
        // because `stop()` also empties the pressed set: a leaked blur listener
        // would find nothing held and dispatch nothing, so no key sequence can
        // tell a detached listener from an attached one. The leak is the defect,
        // and the identity is what proves it does not happen.
        const spies = {
            windowAdd: vi.spyOn(window, 'addEventListener'),
            windowRemove: vi.spyOn(window, 'removeEventListener'),
            documentAdd: vi.spyOn(document, 'addEventListener'),
            documentRemove: vi.spyOn(document, 'removeEventListener'),
        };
        const second = createInputManager(
            createInputActionRegistry([TOGGLE_MENU_ACTION]),
            makeRepo(DEFAULT_BINDINGS),
        );
        second.start();
        second.stop();

        const blurHandler = spies.windowAdd.mock.calls.find((c) => c[0] === 'blur')?.[1];
        const visibilityHandler = spies.documentAdd.mock.calls.find(
            (c) => c[0] === 'visibilitychange',
        )?.[1];
        expect(blurHandler).toBeDefined();
        expect(visibilityHandler).toBeDefined();
        expect(
            spies.windowRemove.mock.calls.some((c) => c[0] === 'blur' && c[1] === blurHandler),
        ).toBe(true);
        expect(
            spies.documentRemove.mock.calls.some(
                (c) => c[0] === 'visibilitychange' && c[1] === visibilityHandler,
            ),
        ).toBe(true);
    });

    it('dispatches exactly one release per held action on blur', () => {
        fireKeydown('Escape');
        fireKeydown('KeyM');
        events.length = 0;

        fireBlur();

        expect(events.map((e) => e.actionId)).toEqual(['engine:toggle-menu', 'game:move']);
        expect(events.every((e) => e.pressed === false)).toBe(true);
    });

    it('releases in PRESS order — the reverse press order releases in reverse', () => {
        fireKeydown('KeyM');
        fireKeydown('Escape');
        events.length = 0;

        fireBlur();

        expect(events.map((e) => e.actionId)).toEqual(['game:move', 'engine:toggle-menu']);
    });

    it('reports the code that PRESSED the action, with no modifiers and no repeat', () => {
        fireKeydown('KeyZ', { ctrlKey: true }); // Ctrl+Z → engine:undo
        const undoReleases: InputEvent[] = [];
        manager.onAction('engine:undo', (event) => {
            undoReleases.push(event);
        });

        fireBlur();

        expect(undoReleases).toHaveLength(1);
        const release = undoReleases[0]!;
        expect(release.code).toBe('KeyZ');
        expect(release.modifiers).toEqual([]);
        expect(release.repeat).toBe(false);
        expect(release.pressed).toBe(false);
        expect(typeof release.timestamp).toBe('number');
    });

    it('reports the SECONDARY code when the action was pressed through it', () => {
        // The binding is two keys; the press is one of them. Reading the code
        // off the binding rather than off the press would answer with the
        // primary here — a key the player never touched, on a release they did
        // not make.
        const twoKeyManager = createInputManager(
            createInputActionRegistry([MOVE_ACTION]),
            makeRepo({ 'game:move': { primary: 'KeyM', secondary: 'KeyN' } }),
        );
        const moveEvents: InputEvent[] = [];
        twoKeyManager.onAction('game:move', (event) => {
            moveEvents.push(event);
        });

        try {
            twoKeyManager.start();
            fireKeydown('KeyN');
            expect(twoKeyManager.isPressed('game:move')).toBe(true);
            moveEvents.length = 0;

            fireBlur();

            expect(moveEvents.map((e) => e.code)).toEqual(['KeyN']);
        } finally {
            twoKeyManager.stop();
        }
    });

    it('reports the code that was PRESSED even after the action is rebound mid-hold', async () => {
        // Not a binding lookup: the binding can have moved since the press, and
        // a release naming a key the player never touched is a lie the mid-hold
        // rebind is the cheapest way to produce.
        const moveEvents: InputEvent[] = [];
        manager.onAction('game:move', (event) => {
            moveEvents.push(event);
        });
        fireKeydown('KeyM');
        await manager.rebind('game:move', { primary: 'KeyN' });
        moveEvents.length = 0;

        fireBlur();

        expect(moveEvents.map((e) => e.code)).toEqual(['KeyM']);
    });

    it('empties the pressed set — isPressed answers false for every held id', () => {
        fireKeydown('Escape');
        fireKeydown('KeyM');

        fireBlur();

        expect(manager.isPressed('engine:toggle-menu')).toBe(false);
        expect(manager.isPressed('game:move')).toBe(false);
    });

    it('has already emptied the pressed set by the time a release callback runs', () => {
        // The re-entrant read: a subscriber told "your action came up" must not
        // find that same action still down when it asks.
        const seen: boolean[] = [];
        manager.onAction('game:move', () => {
            seen.push(manager.isPressed('game:move'));
        });
        fireKeydown('KeyM');
        seen.length = 0;

        fireBlur();

        expect(seen).toEqual([false]);
    });

    it('a subscriber added after the reset sees no phantom held state', () => {
        fireKeydown('Escape');
        fireBlur();

        const late = vi.fn();
        manager.onAction('engine:toggle-menu', late);
        fireBlur();

        expect(late).not.toHaveBeenCalled();
        expect(manager.isPressed('engine:toggle-menu')).toBe(false);
    });

    it('is idempotent — a real key-up after the reset dispatches nothing', () => {
        fireKeydown('Escape');
        fireBlur();
        events.length = 0;

        fireKeyup('Escape');

        expect(events).toEqual([]);
    });

    it('is idempotent for a key-up whose modifiers no longer match', () => {
        const undoReleases: InputEvent[] = [];
        manager.onAction('engine:undo', (event) => {
            undoReleases.push(event);
        });
        fireKeydown('KeyZ', { ctrlKey: true });
        fireBlur();
        undoReleases.length = 0;

        fireKeyup('KeyZ'); // Ctrl already up — takes the code-only fallback

        expect(undoReleases).toEqual([]);
    });

    it('ignores a blur that came from an element rather than the window', () => {
        // `blur` does not bubble, and the listener is registered in the BUBBLE
        // phase — which is the whole reason moving focus between two fields on
        // a settings page does not drop every key the player is holding. A
        // capture-phase registration would catch all of them.
        const field = document.createElement('input');
        document.body.appendChild(field);
        try {
            fireKeydown('KeyM');
            events.length = 0;

            field.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

            expect(events).toEqual([]);
            expect(manager.isPressed('game:move')).toBe(true);
        } finally {
            field.remove();
        }
    });

    it('dispatches nothing when the window blurs with no key held', () => {
        fireBlur();
        expect(events).toEqual([]);
    });

    it('releases held actions when the document becomes hidden', () => {
        fireKeydown('KeyM');
        events.length = 0;

        fireVisibilityChange('hidden');

        expect(events.map((e) => e.actionId)).toEqual(['game:move']);
        expect(manager.isPressed('game:move')).toBe(false);
    });

    it('does NOT release when the document becomes VISIBLE', () => {
        fireKeydown('KeyM');
        events.length = 0;

        fireVisibilityChange('visible');

        expect(events).toEqual([]);
        expect(manager.isPressed('game:move')).toBe(true);
    });

    it('re-arms a still-held GAMEPAD button on the next poll — the release does not outlast the hold', () => {
        // The LIMIT of the reset, pinned rather than left to be discovered. The
        // release reaches a held gamepad action but does not outlast one: a
        // button the player is still holding is reported as held by the next
        // poll, which has no way to tell it from a fresh hold. Closing that is a
        // change to the gamepad path, which the focus-loss reset does not touch.
        const padManager = createInputManager(
            createInputActionRegistry([MOVE_ACTION]),
            makeRepo({ 'game:move': { primary: 'button:1' } }),
        );
        const padEvents: InputEvent[] = [];
        padManager.onAction('game:move', (event) => {
            padEvents.push(event);
        });
        const getGamepads = vi
            .fn()
            .mockReturnValue([
                { connected: true, buttons: [{ pressed: false }, { pressed: true }] },
            ]);
        vi.stubGlobal('navigator', { ...navigator, getGamepads });

        try {
            padManager.start();
            padManager.pollGamepad();
            expect(padManager.isPressed('game:move')).toBe(true);

            window.dispatchEvent(new Event('blur'));
            expect(padManager.isPressed('game:move')).toBe(false);
            // The release names the BUTTON, and does so by reading the pressed
            // map — the press dispatch's own `code` is a separate expression, so
            // asserting only that one would leave the map write unmeasured.
            expect(padEvents.map((e) => ({ pressed: e.pressed, code: e.code }))).toEqual([
                { pressed: true, code: 'button:1' },
                { pressed: false, code: 'button:1' },
            ]);

            padManager.pollGamepad();
            expect(padManager.isPressed('game:move')).toBe(true);
            expect(padEvents.map((e) => e.pressed)).toEqual([true, false, true]);
        } finally {
            padManager.stop();
            vi.unstubAllGlobals();
        }
    });

    it('a key released normally is not released a second time by a later blur', () => {
        fireKeydown('KeyM');
        fireKeyup('KeyM');
        expect(events.map((e) => e.pressed)).toEqual([true, false]);
        events.length = 0;

        fireBlur();

        expect(events).toEqual([]);
    });
});
