/**
 * renderer/input/InputBindingSchema.ts
 *
 * Key binding schema types for the Input & Keybindings system (§4.26).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only. These types must never be
 * imported by simulation/ or ai/.
 * Invariant #66: Key bindings are settings, not profile data; stored under
 * settings.controls.bindings as EngineBindings.
 */

import type { InputActionId } from './InputAction.js';

/**
 * Describes the physical key (or gamepad button) bound to an action.
 *
 * `primary` is required; `secondary` and `modifiers` are optional.
 * Key identifiers use `KeyboardEvent.code` values for keyboard
 * (e.g. `'KeyZ'`, `'Escape'`, `'F3'`) and `'button:<index>'` for gamepad.
 */
export interface KeyBinding {
    /** Primary key or gamepad button. Required. */
    readonly primary: string;
    /** Optional alternate key that also triggers the action. */
    readonly secondary?: string | undefined;
    /** Modifier keys that must be held alongside `primary`. */
    readonly modifiers?: readonly ('Ctrl' | 'Shift' | 'Alt' | 'Meta')[] | undefined;
}

/**
 * A complete binding map — every registered `InputActionId` mapped to its
 * `KeyBinding`.  Stored under `settings.controls.bindings` (Invariant #66).
 */
export type EngineBindings = Record<InputActionId, KeyBinding>;

/**
 * Type alias for game-supplied binding overrides.
 *
 * `T` can be any concrete key map of `KeyBinding` values. The conditional
 * type ensures every key is a valid `InputActionId`, while still allowing
 * game schemas to use interfaces without index signatures.
 *
 * @example
 * ```ts
 * type TacticsBindings = GameBindingSchema<{
 *     'engine:undo': KeyBinding;
 *     'game:end-turn': KeyBinding;
 * }>;
 * ```
 */
export type GameBindingSchema<T> = T extends { readonly [K in keyof T]: KeyBinding }
    ? Exclude<keyof T, InputActionId> extends never
        ? T
        : never
    : never;
