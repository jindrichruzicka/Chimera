/**
 * renderer/input/KeyBindingRepository.ts
 *
 * Thin adapter over settings.controls.bindings (§4.26, Invariant #66).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: KeyBindingRepository is renderer-only; never imported by
 * simulation/ or ai/.
 * Invariant #66: Key bindings are settings, not profile data; stored under
 * settings.controls.bindings.
 */

import { useSettingsStore, type SettingsStoreState } from '../state/settingsStore.js';
import type { InputActionId } from './InputAction.js';
import type { KeyBinding, EngineBindings } from './InputBindingSchema.js';

/** Minimal store slice required by `KeyBindingRepository`. */
interface SettingsStoreReader {
    getState(): SettingsStoreState;
}

/**
 * Reserved game ID for engine-wide settings that apply when no specific game
 * is active. Used by KeyBindingRepository, settings pages, and bootstrap logic
 * to access game-independent settings (e.g. engine key bindings, volume).
 *
 * Invariant #35 enforces that game schemas never shadow this reserved namespace key.
 */
export const ENGINE_SETTINGS_GAME_ID = '__engine__';

// ── Public interface ──────────────────────────────────────────────────────────

export interface KeyBindingRepository {
    /** Returns all current bindings for the active game context. */
    getAll(): EngineBindings;
    /** Returns the binding for a specific action, or undefined if not configured. */
    get(id: InputActionId): KeyBinding | undefined;
    /**
     * Persists a new binding for the given action through the settings store.
     * Preserves all existing sibling bindings.
     */
    save(id: InputActionId, binding: KeyBinding): Promise<void>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a `KeyBindingRepository` backed by the given Zustand settings store.
 * Pass a custom store (created with `createSettingsStore`) in tests to avoid
 * relying on the production singleton.
 *
 * Falls back to the `__engine__` game ID when `activeGameId` is null or when
 * the active game has no settings entry.
 *
 * @param store - The settings store to read from and write to.
 *                Defaults to the production singleton `useSettingsStore`.
 */
export function createKeyBindingRepository(
    store: SettingsStoreReader = useSettingsStore,
): KeyBindingRepository {
    function resolveBindings(state: SettingsStoreState): EngineBindings {
        const activeId = state.activeGameId;
        const resolved =
            (activeId !== null ? state.settings[activeId] : undefined) ??
            state.settings[ENGINE_SETTINGS_GAME_ID];

        if (resolved === undefined) {
            return {};
        }

        const controls = resolved['controls'];
        if (!isRecord(controls)) {
            return {};
        }

        const bindings = controls['bindings'];
        if (!isRecord(bindings)) {
            return {};
        }

        return bindings as EngineBindings;
    }

    function resolveGameId(state: SettingsStoreState): string {
        return state.activeGameId ?? ENGINE_SETTINGS_GAME_ID;
    }

    return {
        getAll(): EngineBindings {
            return resolveBindings(store.getState());
        },

        get(id: InputActionId): KeyBinding | undefined {
            return resolveBindings(store.getState())[id];
        },

        async save(id: InputActionId, binding: KeyBinding): Promise<void> {
            const state = store.getState();
            const gameId = resolveGameId(state);
            const current = resolveBindings(state);
            await state.updateSettings(gameId, {
                controls: {
                    bindings: { ...current, [id]: binding },
                },
            });
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
