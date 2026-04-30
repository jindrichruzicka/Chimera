'use client';

/**
 * renderer/app/SettingsBootstrap.tsx
 *
 * Thin client component that wires the chimera:settings:change push channel
 * into the settingsStore on mount. Renders nothing.
 *
 * Architecture reference: §F07 hardening #157 (BLOCK-2, WARN-4)
 */

import { useEffect } from 'react';
import { bootstrapSettingsStore } from '../state/settingsStoreBootstrap';
import type { SettingsAPI } from '@chimera/electron/preload/api-types.js';

export function SettingsBootstrap(): null {
    useEffect(() => {
        const chimera = (globalThis as { __chimera?: { settings: SettingsAPI } }).__chimera;
        if (!chimera?.settings) return;
        const unsubscribe = bootstrapSettingsStore(chimera.settings);
        return unsubscribe;
    }, []);

    return null;
}
