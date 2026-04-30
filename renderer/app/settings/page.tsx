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
import { useSettingsStore } from '../../state/settingsStore';
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
    return s.activeGameId ?? '__engine__';
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
    const resolved = s.settings[s.activeGameId ?? '__engine__'];
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
        <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '640px' }}>
            <h1>Settings</h1>

            {/* ── Audio ── */}
            <section aria-labelledby="audio-heading" style={{ marginBottom: '2rem' }}>
                <h2 id="audio-heading">Audio</h2>

                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        <span>Master Volume</span>
                        <input
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

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
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

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
            <section aria-labelledby="display-heading" style={{ marginBottom: '2rem' }}>
                <h2 id="display-heading">Display</h2>

                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
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
            <section aria-labelledby="gameplay-heading" style={{ marginBottom: '2rem' }}>
                <h2 id="gameplay-heading">Gameplay</h2>

                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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

            {/* ── Controls (placeholder) ── */}
            <section aria-labelledby="controls-heading" style={{ marginBottom: '2rem' }}>
                <h2 id="controls-heading">Controls</h2>
                <p style={{ color: '#888' }}>Key bindings editor coming soon.</p>
            </section>

            {/* ── Game-specific settings ── */}
            {gameSpecificEntries.length > 0 && (
                <section aria-labelledby="game-specific-heading" style={{ marginBottom: '2rem' }}>
                    <h2 id="game-specific-heading">Game Settings</h2>
                    <dl style={{ display: 'grid', gap: '0.5rem' }}>
                        {gameSpecificEntries.map(([key, value]) => (
                            <div key={key} style={{ display: 'flex', gap: '1rem' }}>
                                <dt style={{ fontWeight: 'bold', minWidth: '12rem' }}>{key}</dt>
                                <dd>{JSON.stringify(value)}</dd>
                            </div>
                        ))}
                    </dl>
                </section>
            )}

            {/* ── Reset ── */}
            <button type="button" onClick={handleReset} style={{ marginTop: '1rem' }}>
                Reset to defaults
            </button>
        </main>
    );
}
