// @vitest-environment jsdom

/**
 * renderer/app/settingsGameContext.test.ts
 *
 * Covers the two degrade-and-continue catch paths' diagnostics (Invariant #67,
 * §4.27): a failed settings hydrate and a failed input-action registration must
 * reach the forwarded logging path with the Error's stack intact and a named
 * module — not a flattened String(err) under the 'global' catch-all.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SettingsAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import type { InputActionRegistry } from '../input/InputActionRegistry.js';
import { createRecordingLogsApi } from '../logging/__test-support__/RecordingLogsApi.js';

const { mockLoadRendererGame } = vi.hoisted(() => ({ mockLoadRendererGame: vi.fn() }));
vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGame: mockLoadRendererGame,
}));

import { hydrateActiveGameSettings, registerActiveGameInputActions } from './settingsGameContext';

afterEach(() => {
    Reflect.deleteProperty(globalThis, '__chimera');
    mockLoadRendererGame.mockReset();
});

describe('settingsGameContext — forwarded diagnostics (Invariant #67)', () => {
    it('forwards a named, stack-carrying entry when hydrating settings fails', async () => {
        const err = new Error('settings ipc down');
        const settingsApi = { get: vi.fn().mockRejectedValue(err) } as unknown as SettingsAPI;
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };

        await hydrateActiveGameSettings(settingsApi, 'tactics', () => false);

        expect(logs.emitCalls).toHaveLength(1);
        const entry = logs.emitCalls[0]!;
        expect(entry.level).toBe('error');
        expect(entry.source.module).toBe('settings-bootstrap');
        expect(entry.source.module).not.toBe('global');
        expect(entry.error?.stack).toBeDefined();
        expect(entry.message).toContain("Failed to hydrate settings for 'tactics'");
    });

    it('forwards a named, stack-carrying entry when input-action registration fails', async () => {
        const err = new Error('game load failed');
        mockLoadRendererGame.mockRejectedValue(err);
        // loadRendererGame rejects before the registry is touched, so a bare
        // non-null stand-in is enough to pass the null guard.
        const registry = {} as unknown as InputActionRegistry;
        const logs = createRecordingLogsApi();
        (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };

        await registerActiveGameInputActions(registry, 'tactics', () => false);

        expect(logs.emitCalls).toHaveLength(1);
        const entry = logs.emitCalls[0]!;
        expect(entry.level).toBe('error');
        expect(entry.source.module).toBe('settings-bootstrap');
        expect(entry.source.module).not.toBe('global');
        expect(entry.error?.stack).toBeDefined();
        expect(entry.message).toContain("Failed to register input actions for 'tactics'");
    });
});
