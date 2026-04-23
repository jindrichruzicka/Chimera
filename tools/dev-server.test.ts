// tools/dev-server.test.ts
//
// Unit tests for the hot-reload dev harness (tools/dev-server.ts).
// Tests the pure watcher callback logic and restart orchestration,
// without actually spawning Electron or touching the filesystem.

import { describe, it, expect, vi } from 'vitest';
import {
    createRestartController,
    startWatching,
    type RestartController,
    type FileWatcherLike,
    type WatchFn,
} from './dev-server.js';

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

// ── Helper: build a minimal fake watcher ──────────────────────────────────────

function makeFakeWatcher(): {
    watcher: FileWatcherLike;
    emit(event: 'change' | 'add', filePath: string): void;
} {
    const handlers = new Map<string, ((path: string) => void)[]>();
    const watcher: FileWatcherLike = {
        on(event, cb) {
            const list = handlers.get(event) ?? [];
            list.push(cb);
            handlers.set(event, list);
        },
    };
    return {
        watcher,
        emit(event, filePath) {
            for (const cb of handlers.get(event) ?? []) cb(filePath);
        },
    };
}

describe('startWatching', () => {
    it('calls controller.reportChange when a change event fires', () => {
        vi.useFakeTimers();
        const onRestart = vi.fn<(path: string) => void>();
        const controller: RestartController = createRestartController({ onRestart, debounceMs: 0 });
        const { watcher, emit } = makeFakeWatcher();
        const watchFn: WatchFn = () => watcher;

        startWatching(['renderer', 'electron'], controller, watchFn);
        emit('change', 'renderer/app/page.tsx');
        vi.runAllTimers();

        expect(onRestart).toHaveBeenCalledWith('renderer/app/page.tsx');
        vi.useRealTimers();
    });

    it('calls controller.reportChange when an add event fires', () => {
        vi.useFakeTimers();
        const onRestart = vi.fn<(path: string) => void>();
        const controller: RestartController = createRestartController({ onRestart, debounceMs: 0 });
        const { watcher, emit } = makeFakeWatcher();
        const watchFn: WatchFn = () => watcher;

        startWatching(['renderer', 'electron'], controller, watchFn);
        emit('add', 'electron/main/newFile.ts');
        vi.runAllTimers();

        expect(onRestart).toHaveBeenCalledWith('electron/main/newFile.ts');
        vi.useRealTimers();
    });

    it('passes all dirs to the watcher factory', () => {
        let capturedPaths: readonly string[] = [];
        const { watcher } = makeFakeWatcher();
        const watchFn: WatchFn = (paths) => {
            capturedPaths = paths;
            return watcher;
        };
        const controller: RestartController = createRestartController({
            onRestart: vi.fn(),
            debounceMs: 0,
        });

        startWatching(['renderer', 'electron'], controller, watchFn);

        expect(capturedPaths).toEqual(['renderer', 'electron']);
    });

    it('debounces rapid change events from the watcher into a single restart', () => {
        vi.useFakeTimers();
        const onRestart = vi.fn<(path: string) => void>();
        const controller: RestartController = createRestartController({
            onRestart,
            debounceMs: 100,
        });
        const { watcher, emit } = makeFakeWatcher();
        const watchFn: WatchFn = () => watcher;

        startWatching(['renderer', 'electron'], controller, watchFn);
        emit('change', 'renderer/app/page.tsx');
        emit('change', 'renderer/app/layout.tsx');
        emit('change', 'electron/main/index.ts');

        expect(onRestart).toHaveBeenCalledTimes(0);
        vi.advanceTimersByTime(101);
        expect(onRestart).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});
