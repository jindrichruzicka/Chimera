/**
 * renderer/device/inputTracker.ts
 *
 * Listens for pointer, keyboard, and gamepad events and tracks the currently
 * active input modalities (§4.17).
 *
 * Architecture reference: §4.17 — Device Info
 * Issue: #590 (F42 — Implement DeviceInfoProvider and inputTracker)
 *
 * Invariant #65: renderer-only. Must NOT import from electron/main,
 *                simulation/, or ai/.
 *
 * Design notes:
 *  - DOM access is injected via `InputTrackerPort` so the module is testable
 *    without mounting a real DOM or mocking globals.
 *  - `inputs` is the union of all modalities ever detected in this session.
 *    `primaryInput` is the most recently used one.
 *  - start() / stop() are idempotent.
 */

import type { InputModality } from './DeviceInfo.js';

// ─── Port ─────────────────────────────────────────────────────────────────────

/**
 * Narrow DOM event-target port injected into `createInputTracker`.
 * Allows unit tests to supply a plain stub instead of the real `window`.
 */
export interface InputTrackerPort {
    addEventListener(type: string, handler: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, handler: EventListenerOrEventListenerObject): void;
}

// ─── Unsubscribe ──────────────────────────────────────────────────────────────

/** Call to remove an onChange listener. */
export type Unsubscribe = () => void;

// ─── Public interface ─────────────────────────────────────────────────────────

export interface InputTracker {
    /** Attach DOM event listeners. Idempotent. */
    start(): void;
    /** Detach DOM event listeners and clear subscribers. Idempotent. */
    stop(): void;
    /** The most recently used input modality. */
    getPrimaryInput(): InputModality;
    /** All input modalities detected at least once since start(). */
    getInputs(): readonly InputModality[];
    /**
     * Subscribe to changes in `inputs` or `primaryInput`.
     * Returns an unsubscribe function.
     */
    onChange(cb: (inputs: readonly InputModality[], primary: InputModality) => void): Unsubscribe;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Maps a `PointerEvent.pointerType` string to an `InputModality`, or `null`
 * if the pointer type is not a recognised modality.
 */
function pointerTypeToModality(type: string): InputModality | null {
    switch (type) {
        case 'mouse':
            return 'mouse';
        case 'touch':
            return 'touch';
        case 'pen':
            return 'pen';
        default:
            return null;
    }
}

/**
 * Creates an `InputTracker` backed by the supplied event-target port.
 *
 * In production pass `window`; in tests pass an in-memory stub.
 *
 * @param port - Event-target port (usually `window`).
 */
export function createInputTracker(port: InputTrackerPort): InputTracker {
    let started = false;
    const inputs = new Set<InputModality>(['mouse', 'keyboard']);
    let primaryInput: InputModality = 'mouse';
    const subscribers = new Set<
        (inputs: readonly InputModality[], primary: InputModality) => void
    >();

    function notify(): void {
        const snapshot = Array.from(inputs) as readonly InputModality[];
        for (const cb of subscribers) {
            cb(snapshot, primaryInput);
        }
    }

    function update(modality: InputModality): void {
        const changed = modality !== primaryInput;
        inputs.add(modality);
        primaryInput = modality;
        if (changed) {
            notify();
        }
    }

    const handlePointerDown = (e: Event): void => {
        const modality = pointerTypeToModality((e as PointerEvent).pointerType);
        if (modality !== null) {
            update(modality);
        }
    };

    const handleKeyDown = (): void => {
        update('keyboard');
    };

    const handleGamepadConnected = (): void => {
        update('gamepad');
    };

    return {
        start(): void {
            if (started) return;
            started = true;
            port.addEventListener('pointerdown', handlePointerDown);
            port.addEventListener('keydown', handleKeyDown);
            port.addEventListener('gamepadconnected', handleGamepadConnected);
        },

        stop(): void {
            if (!started) return;
            started = false;
            port.removeEventListener('pointerdown', handlePointerDown);
            port.removeEventListener('keydown', handleKeyDown);
            port.removeEventListener('gamepadconnected', handleGamepadConnected);
            subscribers.clear();
        },

        getPrimaryInput(): InputModality {
            return primaryInput;
        },

        getInputs(): readonly InputModality[] {
            return Array.from(inputs);
        },

        onChange(
            cb: (inputs: readonly InputModality[], primary: InputModality) => void,
        ): Unsubscribe {
            subscribers.add(cb);
            return () => {
                subscribers.delete(cb);
            };
        },
    };
}
