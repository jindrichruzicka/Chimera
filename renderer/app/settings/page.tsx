'use client';

/**
 * renderer/app/settings/page.tsx
 *
 * Settings page — renders engine-wide settings (audio, display, gameplay,
 * controls) and game-specific settings when a gameId is active.
 *
 * Architecture reference: §4.13 — Settings System
 * Task: issue #393
 *
 * Invariant #36: Settings are never read by the simulation core — this page
 *   only reads from `settingsStore`; it never dispatches into `ActionPipeline`.
 *
 * Rules:
 *   - Reads settings from `useSettingsStore()` via narrow typed selectors only.
 *   - All writes go through `window.__chimera.settings` (update / reset).
 *   - Must NOT import from: electron/main/, simulation/, networking/.
 */

import React from 'react';
import { useShallow } from 'zustand/shallow';
import { Button } from '../../components/ui/Button';
import { useSettingsStore } from '../../state/settingsStore';
import { ENGINE_SETTINGS_GAME_ID } from '../../input/KeyBindingRepository.js';
import { useInputManager } from '../../input/InputManagerContext.js';
import type { InputAction, InputActionId } from '../../input/InputAction.js';
import type { KeyBinding } from '../../input/InputBindingSchema.js';
import type {
    ResolvedSettings,
    AudioSettings,
    DisplaySettings,
    GameplaySettings,
} from '@chimera/electron/preload/api-types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENGINE_NAMESPACE_KEYS = new Set(['audio', 'display', 'gameplay', 'controls']);

const TARGET_FPS_OPTIONS: readonly (30 | 60 | 120 | 0)[] = [30, 60, 120, 0];

// ── Selectors ─────────────────────────────────────────────────────────────────

/**
 * Selects the active gameId, or the reserved '__engine__' id when no game is active.
 *
 * Invariant #36: The reserved '__engine__' gameId is used for engine-wide
 * settings that apply regardless of which game is loaded. When activeGameId is null,
 * all settings updates are dispatched against '__engine__' to allow users to
 * configure engine behavior before loading a game.
 *
 * This id is validated end-to-end by the main process SettingsManager.
 */
function selectGameId(s: { activeGameId: string | null }): string {
    return s.activeGameId ?? ENGINE_SETTINGS_GAME_ID;
}

/**
 * Selector for game-specific settings — keys outside the engine namespaces
 * (audio / display / gameplay / controls). Using `shallow` as the equality
 * comparator means audio/display/gameplay changes do NOT trigger a re-render
 * of the game-specific section.
 */
function selectGameSpecificSettings(s: {
    activeGameId: string | null;
    settings: Record<string, ResolvedSettings>;
}): Readonly<Record<string, unknown>> | undefined {
    const resolved = s.settings[s.activeGameId ?? ENGINE_SETTINGS_GAME_ID];
    if (!resolved) return undefined;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(resolved)) {
        if (!ENGINE_NAMESPACE_KEYS.has(k)) result[k] = v;
    }
    return result;
}

/** Selector for audio settings sub-shape. */
function selectAudioSettings(s: {
    activeGameId: string | null;
    settings: Record<string, ResolvedSettings>;
}): AudioSettings | undefined {
    const settings = s.settings[s.activeGameId ?? '__engine__'];
    // @chimera-review: ResolvedSettings is Record<string,unknown>; sub-shape cast is safe because the store is only ever populated via SettingsAPI.update which returns EngineSettings
    return settings?.['audio'] as AudioSettings | undefined;
}

/** Selector for display settings sub-shape. */
function selectDisplaySettings(s: {
    activeGameId: string | null;
    settings: Record<string, ResolvedSettings>;
}): DisplaySettings | undefined {
    const settings = s.settings[s.activeGameId ?? '__engine__'];
    // @chimera-review: ResolvedSettings is Record<string,unknown>; sub-shape cast is safe because the store is only ever populated via SettingsAPI.update which returns EngineSettings
    return settings?.['display'] as DisplaySettings | undefined;
}

/** Selector for gameplay settings sub-shape. */
function selectGameplaySettings(s: {
    activeGameId: string | null;
    settings: Record<string, ResolvedSettings>;
}): GameplaySettings | undefined {
    const settings = s.settings[s.activeGameId ?? '__engine__'];
    // @chimera-review: ResolvedSettings is Record<string,unknown>; sub-shape cast is safe because the store is only ever populated via SettingsAPI.update which returns EngineSettings
    return settings?.['gameplay'] as GameplaySettings | undefined;
}

// ── SettingsPage ──────────────────────────────────────────────────────────────

export default function SettingsPage(): React.ReactElement {
    const gameId = useSettingsStore(selectGameId);
    const audio = useSettingsStore(selectAudioSettings);
    const display = useSettingsStore(selectDisplaySettings);
    const gameplay = useSettingsStore(selectGameplaySettings);
    // useShallow: only re-renders when game-specific values actually change
    const gameSpecificSettings = useSettingsStore(useShallow(selectGameSpecificSettings));

    const inputManager = useInputManager();

    // id of the action currently in capture mode, or null
    const [capturingId, setCapturingId] = React.useState<InputActionId | null>(null);
    // Captured bindings keyed per action so force-rebind resolves the correct pending conflict.
    const capturedBindingsRef = React.useRef<Partial<Record<InputActionId, KeyBinding>>>({});
    // Per-action rebind status (conflict or success)
    const [rebindStatus, setRebindStatus] = React.useState<
        Partial<Record<InputActionId, { ok: boolean; conflict?: InputActionId }>>
    >({});

    const actionsByCategory = groupActionsByCategory(inputManager.getActions());

    const handleRebind = React.useCallback(
        (id: InputActionId, binding: KeyBinding): void => {
            inputManager
                .rebind(id, binding)
                .then((result) => {
                    if (result.ok) {
                        setRebindStatus((prev) => ({ ...prev, [id]: { ok: true } }));
                    } else if (result.reason === 'conflict') {
                        setRebindStatus((prev) => ({
                            ...prev,
                            [id]: { ok: false, conflict: result.conflictingAction },
                        }));
                    } else {
                        setRebindStatus((prev) => ({ ...prev, [id]: { ok: false } }));
                    }
                })
                .catch((error) => {
                    console.error('[SettingsPage] rebind failed:', error);
                });
        },
        [inputManager],
    );

    // Capture mode: listen for the next key press when an action is being rebound
    React.useEffect(() => {
        if (capturingId === null) return;
        const actionId = capturingId;

        function handleKeyDown(e: KeyboardEvent): void {
            e.preventDefault();
            e.stopPropagation();

            // Escape cancels capture
            if (e.code === 'Escape') {
                setCapturingId(null);
                return;
            }

            const modifiers: ('Ctrl' | 'Shift' | 'Alt' | 'Meta')[] = [];
            if (e.ctrlKey) modifiers.push('Ctrl');
            if (e.shiftKey) modifiers.push('Shift');
            if (e.altKey) modifiers.push('Alt');
            if (e.metaKey) modifiers.push('Meta');

            const binding: KeyBinding = { primary: e.code, modifiers };
            capturedBindingsRef.current[actionId] = binding;
            setCapturingId(null);
            handleRebind(actionId, binding);
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [capturingId, handleRebind]);

    function handleForceRebind(id: InputActionId, conflictingId: InputActionId): void {
        const binding = capturedBindingsRef.current[id];
        if (!binding) return;
        inputManager
            .resetBinding(conflictingId)
            .then(() => inputManager.rebind(id, binding))
            .then((result) => {
                if (result.ok) {
                    setRebindStatus((prev) => ({ ...prev, [id]: { ok: true } }));
                } else {
                    setRebindStatus((prev) => ({ ...prev, [id]: { ok: false } }));
                }
            })
            .catch((error) => {
                console.error('[SettingsPage] force-rebind failed:', error);
            });
    }

    function handleResetBinding(id: InputActionId): void {
        inputManager
            .resetBinding(id)
            .then(() => {
                setRebindStatus((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                });
            })
            .catch((error) => {
                console.error('[SettingsPage] resetBinding failed:', error);
            });
    }

    function formatBinding(binding: KeyBinding | undefined): string {
        if (!binding) return '—';
        const mods = binding.modifiers?.length ? binding.modifiers.join('+') + '+' : '';
        return `${mods}${binding.primary}`;
    }

    /**
     * Memoize game-specific entries. Selector already filters engine-namespace keys;
     * useMemo provides a stable array reference for downstream renders.
     */
    const gameSpecificEntries = React.useMemo(
        () => (gameSpecificSettings ? Object.entries(gameSpecificSettings) : []),
        [gameSpecificSettings],
    );

    function handleUpdate(patch: Record<string, unknown>): void {
        useSettingsStore
            .getState()
            .updateSettings(gameId, patch)
            .catch((error) => {
                console.error('[SettingsPage] Failed to update settings:', error);
            });
    }

    function handleReset(): void {
        useSettingsStore
            .getState()
            .resetSettings(gameId)
            .catch((error) => {
                console.error('[SettingsPage] Failed to reset settings:', error);
            });
    }

    return (
        <main
            style={{
                fontFamily: 'var(--ch-font-ui)',
                padding: 'calc(var(--ch-space-md) * 2)',
                maxWidth: 'calc(var(--ch-space-xl) * 16)',
            }}
        >
            <h1>Settings</h1>

            {/* ── Audio ── */}
            <section
                aria-labelledby="audio-heading"
                style={{ marginBottom: 'calc(var(--ch-space-md) * 2)' }}
            >
                <h2 id="audio-heading">Audio</h2>

                <div
                    style={{
                        display: 'grid',
                        gap: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                    }}
                >
                    <label
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--ch-space-xs)',
                        }}
                    >
                        <span>Master Volume</span>
                        <input
                            data-testid="master-volume"
                            aria-label="Master Volume"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={audio?.masterVolume ?? 1.0}
                            onChange={(e) => {
                                handleUpdate({
                                    audio: { masterVolume: parseFloat(e.target.value) },
                                });
                            }}
                        />
                        <span>{((audio?.masterVolume ?? 1.0) * 100).toFixed(0)}%</span>
                    </label>

                    <label
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--ch-space-xs)',
                        }}
                    >
                        <span>SFX Volume</span>
                        <input
                            aria-label="SFX Volume"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={audio?.sfxVolume ?? 1.0}
                            onChange={(e) => {
                                handleUpdate({ audio: { sfxVolume: parseFloat(e.target.value) } });
                            }}
                        />
                        <span>{((audio?.sfxVolume ?? 1.0) * 100).toFixed(0)}%</span>
                    </label>

                    <label
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--ch-space-xs)',
                        }}
                    >
                        <span>Music Volume</span>
                        <input
                            aria-label="Music Volume"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={audio?.musicVolume ?? 0.8}
                            onChange={(e) => {
                                handleUpdate({
                                    audio: { musicVolume: parseFloat(e.target.value) },
                                });
                            }}
                        />
                        <span>{((audio?.musicVolume ?? 0.8) * 100).toFixed(0)}%</span>
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <input
                            aria-label="Muted"
                            type="checkbox"
                            checked={audio?.muted ?? false}
                            onChange={(e) => {
                                handleUpdate({ audio: { muted: e.target.checked } });
                            }}
                        />
                        <span>Muted</span>
                    </label>
                </div>
            </section>

            {/* ── Display ── */}
            <section
                aria-labelledby="display-heading"
                style={{ marginBottom: 'calc(var(--ch-space-md) * 2)' }}
            >
                <h2 id="display-heading">Display</h2>

                <div
                    style={{
                        display: 'grid',
                        gap: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                    }}
                >
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <input
                            aria-label="Fullscreen"
                            type="checkbox"
                            checked={display?.fullscreen ?? false}
                            onChange={(e) => {
                                handleUpdate({ display: { fullscreen: e.target.checked } });
                            }}
                        />
                        <span>Fullscreen</span>
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <input
                            aria-label="VSync"
                            type="checkbox"
                            checked={display?.vsync ?? true}
                            onChange={(e) => {
                                handleUpdate({ display: { vsync: e.target.checked } });
                            }}
                        />
                        <span>VSync</span>
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <span>Target FPS</span>
                        <select
                            aria-label="Target FPS"
                            value={display?.targetFps ?? 60}
                            onChange={(e) => {
                                handleUpdate({
                                    display: {
                                        // @chimera-review: parseInt(e.target.value, 10) as 30|60|120|0 is safe because the <select> is exclusively populated from TARGET_FPS_OPTIONS
                                        targetFps: parseInt(e.target.value, 10) as
                                            | 30
                                            | 60
                                            | 120
                                            | 0,
                                    },
                                });
                            }}
                        >
                            {TARGET_FPS_OPTIONS.map((fps) => (
                                <option key={fps} value={fps}>
                                    {fps === 0 ? 'Uncapped' : `${fps} FPS`}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 'var(--ch-space-xs)',
                        }}
                    >
                        <span>UI Scale</span>
                        <input
                            aria-label="UI Scale"
                            type="range"
                            min={0.5}
                            max={2.0}
                            step={0.05}
                            value={display?.uiScale ?? 1.0}
                            onChange={(e) => {
                                handleUpdate({ display: { uiScale: parseFloat(e.target.value) } });
                            }}
                        />
                        <span>{(display?.uiScale ?? 1.0).toFixed(2)}×</span>
                    </label>
                </div>
            </section>

            {/* ── Gameplay ── */}
            <section
                aria-labelledby="gameplay-heading"
                style={{ marginBottom: 'calc(var(--ch-space-md) * 2)' }}
            >
                <h2 id="gameplay-heading">Gameplay</h2>

                <div
                    style={{
                        display: 'grid',
                        gap: 'calc(var(--ch-space-sm) + var(--ch-space-xs))',
                    }}
                >
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <span>Language</span>
                        <input
                            aria-label="Language"
                            type="text"
                            value={gameplay?.language ?? 'en-US'}
                            onChange={(e) => {
                                handleUpdate({ gameplay: { language: e.target.value } });
                            }}
                        />
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <input
                            aria-label="Auto Save"
                            type="checkbox"
                            checked={gameplay?.autoSave ?? true}
                            onChange={(e) => {
                                handleUpdate({ gameplay: { autoSave: e.target.checked } });
                            }}
                        />
                        <span>Auto Save</span>
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <span>Auto Save Interval (turns)</span>
                        <input
                            aria-label="Auto Save Interval"
                            type="number"
                            min={1}
                            max={100}
                            value={gameplay?.autoSaveIntervalTurns ?? 5}
                            onChange={(e) => {
                                handleUpdate({
                                    gameplay: {
                                        autoSaveIntervalTurns: parseInt(e.target.value, 10),
                                    },
                                });
                            }}
                        />
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <input
                            aria-label="Show Hints"
                            type="checkbox"
                            checked={gameplay?.showHints ?? true}
                            onChange={(e) => {
                                handleUpdate({ gameplay: { showHints: e.target.checked } });
                            }}
                        />
                        <span>Show Hints</span>
                    </label>

                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--ch-space-sm)' }}
                    >
                        <input
                            aria-label="Show Performance HUD"
                            type="checkbox"
                            checked={gameplay?.showPerfHud ?? false}
                            onChange={(e) => {
                                handleUpdate({ gameplay: { showPerfHud: e.target.checked } });
                            }}
                        />
                        <span>Show Performance HUD</span>
                    </label>
                </div>
            </section>

            {/* ── Controls ── */}
            <section
                aria-labelledby="controls-heading"
                style={{ marginBottom: 'calc(var(--ch-space-md) * 2)' }}
            >
                <h2 id="controls-heading">Controls</h2>
                {Array.from(actionsByCategory.entries()).map(([category, actions]) => (
                    <section
                        key={category}
                        aria-labelledby={`category-${category}`}
                        style={{ marginBottom: 'var(--ch-space-md)' }}
                    >
                        <h3
                            id={`category-${category}`}
                            style={{ fontWeight: 'bold', marginBottom: 'var(--ch-space-sm)' }}
                        >
                            {category}
                        </h3>
                        {actions.map((action) => {
                            const binding = inputManager.getBinding(action.id);
                            const status = rebindStatus[action.id];
                            const isCapturing = capturingId === action.id;
                            return (
                                <div
                                    key={action.id}
                                    data-testid="binding-action-row"
                                    data-action-id={action.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--ch-space-md)',
                                        marginBottom: 'var(--ch-space-sm)',
                                    }}
                                >
                                    <span style={{ flex: 1 }}>{action.description}</span>
                                    <span
                                        data-testid="binding-value"
                                        style={{
                                            minWidth: 'calc(var(--ch-space-md) * 8)',
                                            color: 'var(--ch-color-text-secondary)',
                                        }}
                                    >
                                        {isCapturing ? 'Press a key…' : formatBinding(binding)}
                                    </span>
                                    {status !== undefined && !status.ok && status.conflict && (
                                        <span
                                            style={{
                                                color: 'var(--ch-color-error)',
                                                fontSize: 'var(--ch-font-size-sm)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 'var(--ch-space-sm)',
                                            }}
                                        >
                                            Conflict with{' '}
                                            {inputManager
                                                .getActions()
                                                .find((a) => a.id === status.conflict)
                                                ?.description ?? status.conflict}
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() =>
                                                    handleForceRebind(action.id, status.conflict!)
                                                }
                                            >
                                                Unbind existing &amp; rebind
                                            </Button>
                                        </span>
                                    )}
                                    {status?.ok === true && (
                                        <span style={{ color: 'var(--ch-color-success)' }}>✓</span>
                                    )}
                                    {!isCapturing && (
                                        <Button
                                            data-testid="binding-edit"
                                            size="sm"
                                            variant="secondary"
                                            onClick={() => setCapturingId(action.id)}
                                        >
                                            Edit
                                        </Button>
                                    )}
                                    <Button
                                        data-testid="binding-reset"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleResetBinding(action.id)}
                                    >
                                        Reset
                                    </Button>
                                </div>
                            );
                        })}
                    </section>
                ))}
            </section>

            {/* ── Game-specific settings ── */}
            {gameSpecificEntries.length > 0 && (
                <section
                    aria-labelledby="game-specific-heading"
                    style={{ marginBottom: 'calc(var(--ch-space-md) * 2)' }}
                >
                    <h2 id="game-specific-heading">Game Settings</h2>
                    <dl style={{ display: 'grid', gap: 'var(--ch-space-sm)' }}>
                        {gameSpecificEntries.map(([key, value]) => (
                            <div key={key} style={{ display: 'flex', gap: 'var(--ch-space-md)' }}>
                                <dt
                                    style={{
                                        fontWeight: 'bold',
                                        minWidth: 'calc(var(--ch-space-md) * 12)',
                                    }}
                                >
                                    {key}
                                </dt>
                                <dd>{JSON.stringify(value)}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}

            {/* ── Reset ── */}
            <Button
                data-testid="reset-to-defaults"
                variant="danger"
                size="sm"
                onClick={handleReset}
            >
                Reset to defaults
            </Button>
        </main>
    );
}

function groupActionsByCategory(actions: readonly InputAction[]): Map<string, InputAction[]> {
    const grouped = new Map<string, InputAction[]>();
    for (const action of actions) {
        const categoryActions = grouped.get(action.category);
        if (categoryActions !== undefined) {
            categoryActions.push(action);
        } else {
            grouped.set(action.category, [action]);
        }
    }
    return grouped;
}
