'use client';

/**
 * renderer/components/shell/debug/DebugInspectorToggle.tsx
 *
 * Headless component wiring the F9 `engine:toggle-debug-inspector` InputAction
 * to the Debug Inspector window. Renders nothing.
 *
 * Architecture reference: §4.12 — Runtime Debug Layer; §4.26 — Input & Keybindings
 * Issue: #696 — F47 T7
 *
 * Rules:
 *  - 'use client' — renderer component.
 *  - Named export only (§coding-standards §8.3).
 *  - No imports from simulation/debug, electron/main/, ai/, or games/* (module
 *    boundary §3, Invariant #65); main is reached only via window.__chimera.system.
 *  - Silent no-op when the preload bridge is unavailable (web preview) — in
 *    production the bridge exists and the IPC send itself is the no-op.
 */

import { useCallback } from 'react';

import type { InputEvent } from '@chimera/renderer/input/InputAction.js';
import { useInputAction } from '@chimera/renderer/input/useInputAction.js';
import { getSystemBridge } from '@chimera/renderer/bridge/system-bridge.js';

// ── Component ─────────────────────────────────────────────────────────────────

export function DebugInspectorToggle(): null {
    const handleToggle = useCallback((event: InputEvent) => {
        if (!event.pressed) {
            return;
        }

        const system = getSystemBridge();
        if (typeof system?.toggleDebugInspector !== 'function') {
            return;
        }

        void system.toggleDebugInspector();
    }, []);

    useInputAction('engine:toggle-debug-inspector', handleToggle);

    return null;
}
