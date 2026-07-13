'use client';

/**
 * Headless component wiring the F4 `engine:toggle-i18n-token-mode` InputAction
 * to the main process's debug bridge. Renders nothing.
 *
 * Mounted app-level (AppShell), not in GameShell, so token mode can be flipped
 * on every shell route — main menu, settings, lobby — as well as in-game. The
 * flipped value flows back over `chimera:system:i18n-token-mode` into
 * `DebugI18nBootstrap` → `debugI18nStore` → `TokenModeI18nProvider`.
 *
 * Architecture reference: §4.12 — Runtime Debug Layer; §4.26 — Input &
 * Keybindings; §4.39 — Localisation
 *
 * Rules:
 *  - 'use client' — renderer component.
 *  - Named export only (§coding-standards §8.3).
 *  - No imports from simulation/debug, electron/main/, ai/, or games/* (module
 *    boundary §3, Invariant #65); main is reached only via window.__chimera.system.
 *  - Silent no-op when the preload bridge is unavailable (web preview) — in
 *    production the bridge exists and the IPC send itself is the no-op
 *    (Invariant #27: the debug bridge never listens).
 */

import { useCallback } from 'react';

import type { InputEvent } from '../../../input/InputAction.js';
import { useInputAction } from '../../../input/useInputAction.js';
import { getSystemBridge } from '../../../bridge/system-bridge.js';

// ── Component ─────────────────────────────────────────────────────────────────

export function I18nTokenModeToggle(): null {
    const handleToggle = useCallback((event: InputEvent) => {
        if (!event.pressed) {
            return;
        }

        const system = getSystemBridge();
        if (typeof system?.toggleI18nTokenMode !== 'function') {
            return;
        }

        void system.toggleI18nTokenMode();
    }, []);

    useInputAction('engine:toggle-i18n-token-mode', handleToggle);

    return null;
}
