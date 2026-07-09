// tools/watch-packages.test.ts
//
// Unit tests for the live package-development watch loop (tools/watch-packages.ts).
// Exercises the pure wiring — the tsc-watch spawn, the renderer CSS re-copy
// watcher, and the combined startWatch orchestration — with injected fakes, so
// no real `tsc`, chokidar, or filesystem is touched.

import { describe, it, expect, vi } from 'vitest';
import {
    spawnTscWatch,
    watchRendererCss,
    startWatch,
    TSC_WATCH_ARGS,
    RENDERER_CSS_WATCH_PATHS,
    type FileWatcherLike,
    type SpawnFn,
    type WatchFn,
} from './watch-packages.js';

// ── Fakes ─────────────────────────────────────────────────────────────────────

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

function makeFakeSpawn(): ReturnType<typeof vi.fn<SpawnFn>> {
    const fakeChild = { pid: 4242, kill: vi.fn() };
    return vi.fn<SpawnFn>(() => fakeChild as unknown as ReturnType<SpawnFn>);
}

// ── spawnTscWatch ───────────────────────────────────────────────────────────

describe('spawnTscWatch', () => {
    it('spawns the solution-graph tsc -b --watch over tsconfig.build.json', () => {
        const spawnFn = makeFakeSpawn();

        spawnTscWatch(spawnFn);

        expect(spawnFn).toHaveBeenCalledOnce();
        const call = spawnFn.mock.calls[0];
        if (call === undefined) throw new Error('Expected spawnFn to have been called');
        const [cmd, args] = call;
        expect(cmd).toBe('pnpm');
        expect(args).toEqual(['exec', 'tsc', '-b', '--watch', 'tsconfig.build.json']);
    });

    it('exposes the watch args constant and inherits stdio without a shell', () => {
        const spawnFn = makeFakeSpawn();

        spawnTscWatch(spawnFn);

        expect(TSC_WATCH_ARGS).toEqual(['exec', 'tsc', '-b', '--watch', 'tsconfig.build.json']);
        const call = spawnFn.mock.calls[0];
        if (call === undefined) throw new Error('Expected spawnFn to have been called');
        expect(call[2]).toMatchObject({ stdio: 'inherit', shell: false });
    });
});

// ── watchRendererCss ────────────────────────────────────────────────────────

describe('watchRendererCss', () => {
    it('re-copies renderer CSS when a change event fires', () => {
        const copyCss = vi.fn(() => Promise.resolve<readonly string[]>([]));
        const { watcher, emit } = makeFakeWatcher();
        const watchFn: WatchFn = () => watcher;

        watchRendererCss(['renderer/components/ui'], copyCss, watchFn);
        emit('change', 'renderer/components/ui/Button.module.css');

        expect(copyCss).toHaveBeenCalledTimes(1);
    });

    it('re-copies renderer CSS when an add event fires (new *.module.css)', () => {
        const copyCss = vi.fn(() => Promise.resolve<readonly string[]>([]));
        const { watcher, emit } = makeFakeWatcher();
        const watchFn: WatchFn = () => watcher;

        watchRendererCss(['renderer/components/ui'], copyCss, watchFn);
        emit('add', 'renderer/components/ui/NewWidget.module.css');

        expect(copyCss).toHaveBeenCalledTimes(1);
    });

    it('passes the given CSS source paths to the watcher factory', () => {
        let capturedPaths: readonly string[] = [];
        const { watcher } = makeFakeWatcher();
        const watchFn: WatchFn = (paths) => {
            capturedPaths = paths;
            return watcher;
        };

        watchRendererCss(
            ['a', 'b', 'c'],
            vi.fn(() => Promise.resolve([])),
            watchFn,
        );

        expect(capturedPaths).toEqual(['a', 'b', 'c']);
    });

    it('defaults its watched paths to the renderer ui/chat dirs + shipped stylesheets', () => {
        expect(RENDERER_CSS_WATCH_PATHS).toEqual([
            'renderer/components/ui',
            'renderer/components/chat',
            'renderer/styles/tokens.css',
            'renderer/styles/animations.css',
        ]);
    });
});

// ── startWatch ──────────────────────────────────────────────────────────────

describe('startWatch', () => {
    it('seeds dist/ with an initial CSS copy on startup (tsc --watch emits none)', () => {
        const copyCss = vi.fn(() => Promise.resolve<readonly string[]>([]));
        const { watcher } = makeFakeWatcher();

        startWatch({ spawnFn: makeFakeSpawn(), watch: () => watcher, copyCss });

        expect(copyCss).toHaveBeenCalledTimes(1);
    });

    it('spawns the solution tsc -b --watch process', () => {
        const spawnFn = makeFakeSpawn();
        const { watcher } = makeFakeWatcher();

        startWatch({ spawnFn, watch: () => watcher, copyCss: vi.fn(() => Promise.resolve([])) });

        const call = spawnFn.mock.calls[0];
        if (call === undefined) throw new Error('Expected spawnFn to have been called');
        expect(call[1]).toEqual(['exec', 'tsc', '-b', '--watch', 'tsconfig.build.json']);
    });

    it('wires a CSS watcher that re-copies on a later change (initial + change = 2)', () => {
        const copyCss = vi.fn(() => Promise.resolve<readonly string[]>([]));
        const { watcher, emit } = makeFakeWatcher();

        startWatch({ spawnFn: makeFakeSpawn(), watch: () => watcher, copyCss });
        emit('change', 'renderer/styles/tokens.css');

        expect(copyCss).toHaveBeenCalledTimes(2);
    });
});
