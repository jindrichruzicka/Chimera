/**
 * renderer/input/InputAction.ts
 *
 * Core input type definitions for the Input & Keybindings system (§4.26).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only. These types must never be
 * imported by simulation/ or ai/.
 */

/**
 * Identifies a named input action.
 *
 * The `engine:` namespace is reserved for built-in engine actions
 * (undo, redo, toggle-menu, toggle-perf-hud).
 * The `game:` namespace is used by game-specific actions (end-turn,
 * cycle-unit, etc.).
 */
export type InputActionId = `engine:${string}` | `game:${string}`;

/**
 * Describes a named input action registered in the InputActionRegistry.
 * Shown in the rebind UI.
 */
export interface InputAction {
    /** Unique identifier for this action. */
    readonly id: InputActionId;
    /** Human-readable description shown in the keybinding settings UI. */
    readonly description: string;
    /** Groups related actions together in the rebind UI ("Movement", "UI", …). */
    readonly category: string;
    /**
     * When true the action fires once on key press.
     * When false the action fires continuously while the key is held.
     */
    readonly oneShot: boolean;
}

/**
 * Result of an `InputManager.rebind()` call.
 *
 * Discriminated on `ok`:
 *  - `{ ok: true }` — the rebind succeeded.
 *  - `{ ok: false; reason: 'conflict'; conflictingAction: InputActionId }` —
 *    the binding collides with an existing one.
 */
export type RebindResult =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly reason: 'conflict';
          readonly conflictingAction: InputActionId;
      };

/**
 * Describes an input event passed to `onAction` callbacks and `useInputAction`
 * subscribers.
 *
 * Intentionally renderer-local — this type must not cross the IPC boundary or
 * appear in GameSnapshot, PlayerSnapshot, or EngineAction payloads.
 */
export interface InputEvent {
    /** The action that was triggered. */
    readonly actionId: InputActionId;
    /**
     * Physical key or gamepad button identifier.
     * For keyboard: `KeyboardEvent.code` (e.g. `'KeyZ'`, `'Enter'`).
     * For gamepad: a button id string (e.g. `'button:0'`).
     */
    readonly code: string;
    /** Modifier keys active at the time of the event. */
    readonly modifiers: readonly ('Ctrl' | 'Shift' | 'Alt' | 'Meta')[];
    /** True when the event is a key-repeat (held key). */
    readonly repeat: boolean;
    /** True on key-down / button-press; false on key-up / button-release. */
    readonly pressed: boolean;
    /** `performance.now()` timestamp at the time the raw event was received. */
    readonly timestamp: number;
}
