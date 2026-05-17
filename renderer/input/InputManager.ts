/**
 * renderer/input/InputManager.ts
 *
 * Central input dispatcher for keyboard and gamepad input (§4.26).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only. Never imported by
 *                simulation/ or ai/.
 * Invariant #66: Key bindings are settings, not profile data; stored under
 *                settings.controls.bindings as EngineBindings.
 */

import type { InputActionId, InputAction, InputEvent, RebindResult } from './InputAction.js';
import type { KeyBinding } from './InputBindingSchema.js';
import type { InputActionRegistry } from './InputActionRegistry.js';
import type { KeyBindingRepository } from './KeyBindingRepository.js';

// ─── Public interface ─────────────────────────────────────────────────────────

export interface InputManager {
    /** Attach window event listeners and start gamepad polling. Idempotent. */
    start(): void;
    /** Detach listeners, stop gamepad polling, clear pressed state. Idempotent. */
    stop(): void;
    /** Returns true while the given action's key is held down. */
    isPressed(id: InputActionId): boolean;
    /**
     * Subscribe to action events. Returns an unsubscribe function.
     * Callbacks registered before `start()` will fire once `start()` is called.
     */
    onAction(id: InputActionId, callback: (event: InputEvent) => void): () => void;
    /** Restrict dispatch to one category. `null` means all categories. */
    setActiveCategory(category: string | null): void;
    /**
     * Rebind an action to a new KeyBinding at runtime.
     *
     * Throws `UnknownInputActionError` when `id` is not registered.
     * Returns `{ ok: false, reason: 'conflict' }` when the binding collides
     * with another action in the same category.
     * Returns `{ ok: false, reason: 'persist_failed' }` when save fails.
     * On success, persists via `KeyBindingRepository.save()` and returns
     * `{ ok: true }`.
     */
    rebind(id: InputActionId, binding: KeyBinding): Promise<RebindResult>;
    /**
     * Execute one gamepad poll cycle. Called automatically inside the
     * requestAnimationFrame loop when running in the browser, but also exposed
     * for deterministic testing.
     */
    pollGamepad(): void;
    /** Returns all registered input actions in registration order. */
    getActions(): readonly InputAction[];
    /** Returns the current effective binding for the given action id, or undefined if unbound. */
    getBinding(id: InputActionId): KeyBinding | undefined;
    /**
     * Resets the binding for the given action to the engine default via the repository.
     * Clears any runtime override so the next read reflects the persisted default.
     */
    resetBinding(id: InputActionId): Promise<void>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Canonical modifier order for normalisation. */
const MODIFIER_ORDER = ['Ctrl', 'Shift', 'Alt', 'Meta'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a modifier array to canonical order. */
function normalizeModifiers(mods: readonly string[] | undefined): readonly Modifier[] {
    if (!mods || mods.length === 0) return [];
    return MODIFIER_ORDER.filter((m) => mods.includes(m));
}

/** Extract active modifier keys from a KeyboardEvent. */
function eventModifiers(e: KeyboardEvent): readonly Modifier[] {
    const result: Modifier[] = [];
    if (e.ctrlKey) result.push('Ctrl');
    if (e.shiftKey) result.push('Shift');
    if (e.altKey) result.push('Alt');
    if (e.metaKey) result.push('Meta');
    return result;
}

/** Produce a stable string key for a (code, modifiers) combo. */
function makeCombo(code: string, modifiers?: readonly string[]): string {
    const mods = normalizeModifiers(modifiers);
    return mods.length > 0 ? `${code}+${mods.join('+')}` : code;
}

/**
 * Returns the InputActionId whose binding (primary or secondary) matches the
 * given (code, modifiers) combo, searching within the provided binding map.
 * Skips `skipId` (used to exclude self during conflict check).
 */
function findConflict(
    newCombo: string,
    allBindings: Record<string, KeyBinding>,
    skipId: InputActionId,
    registry: InputActionRegistry,
    targetCategory: string,
): InputActionId | undefined {
    for (const [rawId, binding] of Object.entries(allBindings)) {
        const id = rawId as InputActionId;
        if (id === skipId) continue;

        // Only check within the same category
        if (!registry.has(id)) continue;
        const action = registry.get(id);
        if (action.category !== targetCategory) continue;

        const primaryCombo = makeCombo(binding.primary, binding.modifiers);
        if (primaryCombo === newCombo) return id;

        if (binding.secondary !== undefined) {
            const secondaryCombo = makeCombo(binding.secondary, binding.modifiers);
            if (secondaryCombo === newCombo) return id;
        }
    }
    return undefined;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an `InputManager` backed by the given registry and repository.
 *
 * @param registry - All registered `InputAction` definitions.
 * @param bindings - Persistence adapter for key bindings.
 */
export function createInputManager(
    registry: InputActionRegistry,
    bindings: KeyBindingRepository,
): InputManager {
    // Current in-memory binding overrides (updated on rebind)
    let runtimeBindings: Record<InputActionId, KeyBinding> | null = null;

    /** Returns the effective bindings: runtime overrides merged over the stored ones. */
    function getBindings(): Record<InputActionId, KeyBinding> {
        if (runtimeBindings !== null) return runtimeBindings;
        return bindings.getAll();
    }

    const subscribers = new Map<InputActionId, Set<(event: InputEvent) => void>>();
    const pressedActions = new Set<InputActionId>();

    let started = false;
    let rafId: number | null = null;
    let activeCategory: string | null = null;

    // Track gamepad button states from the previous poll frame
    // Key: `${gamepadIndex}:${buttonIndex}` → was pressed
    const prevGamepadButtons = new Map<string, boolean>();

    // ─── Event handlers ───────────────────────────────────────────────────────

    function findActionsForCode(code: string, mods: readonly Modifier[]): readonly InputActionId[] {
        const currentBindings = getBindings();
        const matches: InputActionId[] = [];

        for (const [rawId, binding] of Object.entries(currentBindings)) {
            const id = rawId as InputActionId;

            if (activeCategory !== null) {
                if (!registry.has(id)) continue;
                if (registry.get(id).category !== activeCategory) continue;
            }

            const bindingMods = normalizeModifiers(binding.modifiers);
            if (mods.length !== bindingMods.length) continue;
            if (!mods.every((m, i) => m === bindingMods[i])) continue;

            if (binding.primary === code) {
                matches.push(id);
                continue;
            }

            if (binding.secondary !== undefined && binding.secondary === code) {
                matches.push(id);
            }
        }

        return matches;
    }

    function findActionForCode(code: string, mods: readonly Modifier[]): InputActionId | undefined {
        const matches = findActionsForCode(code, mods);
        if (matches.length === 1) return matches[0];
        if (matches.length > 1) {
            console.warn(
                `[InputManager] ambiguous input combo '${makeCombo(code, mods)}' matched ${matches.length} actions; set an active category to disambiguate.`,
            );
        }
        return undefined;
    }

    function dispatchEvent(event: InputEvent): void {
        const cbs = subscribers.get(event.actionId);
        if (!cbs || cbs.size === 0) return;
        for (const cb of cbs) {
            try {
                cb(event);
            } catch (err) {
                console.error(
                    `[InputManager] subscriber for '${event.actionId}' threw an error`,
                    err instanceof Error ? err : new Error(String(err)),
                );
            }
        }
    }

    const handleKeydown = (e: KeyboardEvent): void => {
        const mods = eventModifiers(e);
        const id = findActionForCode(e.code, mods);
        if (id === undefined) return;

        const action = registry.has(id) ? registry.get(id) : undefined;

        // oneShot: skip key-repeat events
        if (action?.oneShot === true && e.repeat) return;

        pressedActions.add(id);
        dispatchEvent({
            actionId: id,
            code: e.code,
            modifiers: mods,
            repeat: e.repeat,
            pressed: true,
            timestamp: performance.now(),
        });
    };

    const handleKeyup = (e: KeyboardEvent): void => {
        const mods = eventModifiers(e);
        const id = findActionForCode(e.code, mods);
        if (id === undefined) {
            // Key released; modifiers may differ from keydown — match by code only.
            const currentBindings = getBindings();
            for (const [rawId, binding] of Object.entries(currentBindings)) {
                const aid = rawId as InputActionId;
                if (binding.primary === e.code || binding.secondary === e.code) {
                    if (pressedActions.has(aid)) {
                        pressedActions.delete(aid);
                        dispatchEvent({
                            actionId: aid,
                            code: e.code,
                            modifiers: mods,
                            repeat: false,
                            pressed: false,
                            timestamp: performance.now(),
                        });
                    }
                }
            }
            return;
        }
        pressedActions.delete(id);
        dispatchEvent({
            actionId: id,
            code: e.code,
            modifiers: mods,
            repeat: false,
            pressed: false,
            timestamp: performance.now(),
        });
    };

    // ─── Gamepad polling ──────────────────────────────────────────────────────

    function pollGamepad(): void {
        const gamepads = navigator.getGamepads();
        if (!gamepads) return;

        for (let gi = 0; gi < gamepads.length; gi++) {
            const gp = gamepads[gi];
            if (!gp?.connected) continue;

            for (let bi = 0; bi < gp.buttons.length; bi++) {
                const key = `${gi}:${bi}`;
                const button = gp.buttons[bi];
                if (button === undefined) continue;
                const isNowPressed = button.pressed;
                const wasPressed = prevGamepadButtons.get(key) ?? false;
                const buttonId = `button:${bi}`;
                const matchedActionId = findActionForCode(buttonId, []);
                const matchedAction =
                    matchedActionId !== undefined && registry.has(matchedActionId)
                        ? registry.get(matchedActionId)
                        : undefined;

                if (isNowPressed && !wasPressed) {
                    // Button just pressed
                    if (matchedActionId !== undefined) {
                        pressedActions.add(matchedActionId);
                        dispatchEvent({
                            actionId: matchedActionId,
                            code: buttonId,
                            modifiers: [],
                            repeat: false,
                            pressed: true,
                            timestamp: performance.now(),
                        });
                    }
                } else if (isNowPressed && wasPressed) {
                    // Held button: repeat only for non-oneShot actions.
                    if (matchedActionId !== undefined && matchedAction?.oneShot === false) {
                        pressedActions.add(matchedActionId);
                        dispatchEvent({
                            actionId: matchedActionId,
                            code: buttonId,
                            modifiers: [],
                            repeat: true,
                            pressed: true,
                            timestamp: performance.now(),
                        });
                    }
                } else if (!isNowPressed && wasPressed) {
                    // Button just released
                    const currentBindings = getBindings();
                    for (const [rawId, binding] of Object.entries(currentBindings)) {
                        const id = rawId as InputActionId;
                        if (binding.primary === buttonId || binding.secondary === buttonId) {
                            if (pressedActions.has(id)) {
                                pressedActions.delete(id);
                                dispatchEvent({
                                    actionId: id,
                                    code: buttonId,
                                    modifiers: [],
                                    repeat: false,
                                    pressed: false,
                                    timestamp: performance.now(),
                                });
                            }
                        }
                    }
                }

                prevGamepadButtons.set(key, isNowPressed);
            }
        }
    }

    function scheduleGamepadPoll(): void {
        rafId = requestAnimationFrame(() => {
            pollGamepad();
            if (started) scheduleGamepadPoll();
        });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    return {
        start(): void {
            if (started) return;
            started = true;
            window.addEventListener('keydown', handleKeydown);
            window.addEventListener('keyup', handleKeyup);
            if (typeof requestAnimationFrame !== 'undefined') {
                scheduleGamepadPoll();
            }
        },

        stop(): void {
            if (!started) return;
            started = false;
            window.removeEventListener('keydown', handleKeydown);
            window.removeEventListener('keyup', handleKeyup);
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            pressedActions.clear();
            prevGamepadButtons.clear();
        },

        isPressed(id: InputActionId): boolean {
            return pressedActions.has(id);
        },

        onAction(id: InputActionId, callback: (event: InputEvent) => void): () => void {
            let cbs = subscribers.get(id);
            if (cbs === undefined) {
                cbs = new Set();
                subscribers.set(id, cbs);
            }
            cbs.add(callback);
            return () => {
                cbs.delete(callback);
            };
        },

        setActiveCategory(category: string | null): void {
            activeCategory = category;
        },

        async rebind(id: InputActionId, binding: KeyBinding): Promise<RebindResult> {
            // Throws UnknownInputActionError if not registered
            const action = registry.get(id);

            const currentBindings = getBindings();
            const newPrimaryCombo = makeCombo(binding.primary, binding.modifiers);

            // Check primary combo for conflict within same category
            const primaryConflict = findConflict(
                newPrimaryCombo,
                currentBindings,
                id,
                registry,
                action.category,
            );
            if (primaryConflict !== undefined) {
                return { ok: false, reason: 'conflict', conflictingAction: primaryConflict };
            }

            // Check secondary combo for conflict within same category (if provided)
            if (binding.secondary !== undefined) {
                const newSecondaryCombo = makeCombo(binding.secondary, binding.modifiers);
                const secondaryConflict = findConflict(
                    newSecondaryCombo,
                    currentBindings,
                    id,
                    registry,
                    action.category,
                );
                if (secondaryConflict !== undefined) {
                    return {
                        ok: false,
                        reason: 'conflict',
                        conflictingAction: secondaryConflict,
                    };
                }
            }

            // Commit runtime changes only after persistence succeeds.
            try {
                await bindings.save(id, binding);
            } catch {
                return { ok: false, reason: 'persist_failed' };
            }

            runtimeBindings = { ...currentBindings, [id]: binding };
            return { ok: true };
        },

        pollGamepad,

        getActions(): readonly InputAction[] {
            return registry.getAll();
        },

        getBinding(id: InputActionId): KeyBinding | undefined {
            return getBindings()[id];
        },

        async resetBinding(id: InputActionId): Promise<void> {
            await bindings.reset(id);
            // Clear the runtime override so next getBinding() reads from the store
            runtimeBindings = null;
        },
    };
}
