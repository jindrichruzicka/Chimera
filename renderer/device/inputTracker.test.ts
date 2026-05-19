// @vitest-environment jsdom

/**
 * renderer/device/inputTracker.test.ts
 *
 * Unit tests for the inputTracker module.
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #590 (F42 — Implement DeviceInfoProvider and inputTracker)
 *
 * Invariants upheld:
 *   #65 — inputTracker is renderer-only. Never imported by simulation/ or ai/.
 *   #83 — All subscriptions must be properly cleaned up (no leaks).
 *
 * Tests written first (TDD — red confirmed).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInputTracker, type InputTracker, type InputTrackerPort } from './inputTracker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePort(): InputTrackerPort & {
    listeners: Map<string, EventListenerOrEventListenerObject>;
    dispatchEvent(type: string, event: Event): void;
} {
    const listeners = new Map<string, EventListenerOrEventListenerObject>();

    return {
        listeners,

        addEventListener(type: string, handler: EventListenerOrEventListenerObject): void {
            listeners.set(type, handler);
        },

        removeEventListener(type: string, _handler: EventListenerOrEventListenerObject): void {
            listeners.delete(type);
        },

        dispatchEvent(type: string, event: Event): void {
            const handler = listeners.get(type);
            if (!handler) return;
            if (typeof handler === 'function') {
                handler(event);
            } else {
                handler.handleEvent(event);
            }
        },
    };
}

function makePointerEvent(pointerType: string): PointerEvent {
    return new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType,
    });
}

function makeKeyboardEvent(): KeyboardEvent {
    return new KeyboardEvent('keydown', { bubbles: true });
}

function makeGamepadEvent(): Event {
    return new Event('gamepadconnected');
}

// ─── createInputTracker ───────────────────────────────────────────────────────

describe('createInputTracker', () => {
    let port: ReturnType<typeof makePort>;
    let tracker: InputTracker;

    beforeEach(() => {
        port = makePort();
        tracker = createInputTracker(port);
    });

    afterEach(() => {
        tracker.stop();
        vi.restoreAllMocks();
    });

    describe('initial state', () => {
        it('starts with mouse as the primary input', () => {
            expect(tracker.getPrimaryInput()).toBe('mouse');
        });

        it('starts with mouse and keyboard as available inputs', () => {
            const inputs = tracker.getInputs();
            expect(inputs).toContain('mouse');
            expect(inputs).toContain('keyboard');
        });
    });

    describe('start() / stop() lifecycle', () => {
        it('registers event listeners on start()', () => {
            tracker.start();
            expect(port.listeners.has('pointerdown')).toBe(true);
            expect(port.listeners.has('keydown')).toBe(true);
            expect(port.listeners.has('gamepadconnected')).toBe(true);
        });

        it('start() is idempotent — only one listener per event type', () => {
            tracker.start();
            tracker.start();
            expect(port.listeners.size).toBe(3);
        });

        it('removes event listeners on stop()', () => {
            tracker.start();
            tracker.stop();
            expect(port.listeners.has('pointerdown')).toBe(false);
            expect(port.listeners.has('keydown')).toBe(false);
            expect(port.listeners.has('gamepadconnected')).toBe(false);
        });

        it('stop() before start() is safe (no error)', () => {
            expect(() => tracker.stop()).not.toThrow();
        });
    });

    describe('pointerdown events', () => {
        beforeEach(() => tracker.start());

        it('sets primaryInput to "mouse" on mouse pointerdown', () => {
            port.dispatchEvent('pointerdown', makePointerEvent('mouse'));
            expect(tracker.getPrimaryInput()).toBe('mouse');
        });

        it('sets primaryInput to "touch" on touch pointerdown', () => {
            port.dispatchEvent('pointerdown', makePointerEvent('touch'));
            expect(tracker.getPrimaryInput()).toBe('touch');
        });

        it('sets primaryInput to "pen" on pen pointerdown', () => {
            port.dispatchEvent('pointerdown', makePointerEvent('pen'));
            expect(tracker.getPrimaryInput()).toBe('pen');
        });

        it('adds "touch" to inputs on first touch pointerdown', () => {
            port.dispatchEvent('pointerdown', makePointerEvent('touch'));
            expect(tracker.getInputs()).toContain('touch');
        });

        it('adds "pen" to inputs on first pen pointerdown', () => {
            port.dispatchEvent('pointerdown', makePointerEvent('pen'));
            expect(tracker.getInputs()).toContain('pen');
        });

        it('ignores pointerdown with unrecognised pointerType', () => {
            const initial = tracker.getPrimaryInput();
            port.dispatchEvent('pointerdown', makePointerEvent('unknown-device'));
            expect(tracker.getPrimaryInput()).toBe(initial);
        });
    });

    describe('keydown events', () => {
        beforeEach(() => tracker.start());

        it('sets primaryInput to "keyboard" on keydown', () => {
            // first switch to touch
            port.dispatchEvent('pointerdown', makePointerEvent('touch'));
            port.dispatchEvent('keydown', makeKeyboardEvent());
            expect(tracker.getPrimaryInput()).toBe('keyboard');
        });

        it('adds "keyboard" to inputs on keydown', () => {
            port.dispatchEvent('keydown', makeKeyboardEvent());
            expect(tracker.getInputs()).toContain('keyboard');
        });
    });

    describe('gamepadconnected events', () => {
        beforeEach(() => tracker.start());

        it('sets primaryInput to "gamepad" on gamepadconnected', () => {
            port.dispatchEvent('gamepadconnected', makeGamepadEvent());
            expect(tracker.getPrimaryInput()).toBe('gamepad');
        });

        it('adds "gamepad" to inputs on gamepadconnected', () => {
            port.dispatchEvent('gamepadconnected', makeGamepadEvent());
            expect(tracker.getInputs()).toContain('gamepad');
        });
    });

    describe('onChange subscription', () => {
        beforeEach(() => tracker.start());

        it('calls subscriber when primaryInput changes', () => {
            const cb = vi.fn();
            tracker.onChange(cb);

            port.dispatchEvent('pointerdown', makePointerEvent('touch'));

            expect(cb).toHaveBeenCalledOnce();
            expect(cb).toHaveBeenCalledWith(expect.arrayContaining(['touch']), 'touch');
        });

        it('does not call subscriber when same primaryInput fires again', () => {
            const cb = vi.fn();
            tracker.onChange(cb);

            port.dispatchEvent('pointerdown', makePointerEvent('mouse'));
            // already 'mouse'
            expect(cb).not.toHaveBeenCalled();
        });

        it('unsubscribing prevents future notifications', () => {
            const cb = vi.fn();
            const unsubscribe = tracker.onChange(cb);
            unsubscribe();

            port.dispatchEvent('pointerdown', makePointerEvent('touch'));
            expect(cb).not.toHaveBeenCalled();
        });

        it('supports multiple subscribers independently', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            tracker.onChange(cb1);
            tracker.onChange(cb2);

            port.dispatchEvent('gamepadconnected', makeGamepadEvent());

            expect(cb1).toHaveBeenCalledOnce();
            expect(cb2).toHaveBeenCalledOnce();
        });

        it('removing one subscriber does not affect others', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            const unsub1 = tracker.onChange(cb1);
            tracker.onChange(cb2);

            unsub1();

            port.dispatchEvent('gamepadconnected', makeGamepadEvent());

            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).toHaveBeenCalledOnce();
        });
    });

    describe('stop() clears all subscribers', () => {
        it('stops notifying after stop()', () => {
            tracker.start();
            const cb = vi.fn();
            tracker.onChange(cb);

            tracker.stop();

            // Manually fire event after stop (no-op because listeners removed)
            // Simulate a direct onChange trigger attempt after stop
            port.dispatchEvent('gamepadconnected', makeGamepadEvent());
            expect(cb).not.toHaveBeenCalled();
        });
    });
});
