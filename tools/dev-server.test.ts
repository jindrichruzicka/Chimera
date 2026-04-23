// tools/dev-server.test.ts
//
// Unit tests for the hot-reload dev harness (tools/dev-server.ts).
// Tests the pure watcher callback logic and restart orchestration,
// without actually spawning Electron or touching the filesystem.

import { describe, it, expect, vi } from 'vitest';
import { createRestartController, type RestartController } from './dev-server.js';

describe('createRestartController', () => {
    it('calls the restart callback when a change is reported', () => {
        vi.useFakeTimers();
        const onRestart = vi.fn<() => void>();
        const controller: RestartController = createRestartController({ onRestart, debounceMs: 0 });
        controller.reportChange('renderer/app/page.tsx');
        vi.runAllTimers();
        expect(onRestart).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('passes the changed path to the restart callback', () => {
        vi.useFakeTimers();
        const onRestart = vi.fn<(path: string) => void>();
        const controller: RestartController = createRestartController({ onRestart, debounceMs: 0 });
        controller.reportChange('electron/main/index.ts');
        vi.runAllTimers();
        expect(onRestart).toHaveBeenCalledWith('electron/main/index.ts');
        vi.useRealTimers();
    });

    it('debounces multiple rapid changes into a single restart callback', () => {
        vi.useFakeTimers();
        const onRestart = vi.fn<() => void>();
        const controller: RestartController = createRestartController({
            onRestart,
            debounceMs: 100,
        });

        controller.reportChange('renderer/app/page.tsx');
        controller.reportChange('renderer/app/layout.tsx');
        controller.reportChange('electron/main/index.ts');

        // No restart yet — debounce window still open
        expect(onRestart).toHaveBeenCalledTimes(0);

        vi.advanceTimersByTime(101);

        // Single restart after debounce window closes
        expect(onRestart).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('does not fire the restart callback when no change is reported', () => {
        const onRestart = vi.fn<() => void>();
        createRestartController({ onRestart, debounceMs: 0 });
        expect(onRestart).not.toHaveBeenCalled();
    });
});
