/**
 * tools/watch-packages.ts
 *
 * Live package-development watch loop for the `@chimera-engine/*` hierarchy.
 *
 * Drives the fluent dev loop that pairs with the first-class `pnpm build`:
 *
 *   - a single `tsc -b --watch tsconfig.build.json` watches the whole solution
 *     graph and re-emits each changed package's `dist/` in dependency order — the
 *     same incremental, acyclic-DAG build the root `build` runs, kept live; and
 *   - a chokidar watcher re-runs the renderer CSS copy whenever a barrel
 *     `*.module.css` or `styles/tokens.css` changes, because `tsc --watch` emits
 *     JS + `.d.ts` only and never copies CSS.
 *
 * Because `apps/tactics` consumes the `@chimera-engine/*` packages through pnpm
 * `workspace:*` symlinks, re-emitting a package's `dist/` is picked up by the
 * consumer app with no manual relink.
 *
 * Invariants upheld:
 *   #1 — `tsc -b` derives its rebuild order from the existing acyclic, inward
 *        reference graph ([`tsconfig.build.json`](../tsconfig.build.json)); this
 *        tool adds no reference edge, so the simulation-purity DAG is preserved.
 *   #2 — Lives in `tools/`; imports only the sibling CSS-copy helper and node
 *        builtins — never `renderer/`, `simulation/`, `ai/`, or an app module.
 *
 * Usage (not invoked directly in unit tests; run via `pnpm build:watch` / `pnpm dev`):
 *   tsx tools/watch-packages.ts
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRendererCss } from './copy-renderer-css.js';
// Reuse the cross-platform watcher / spawn dependency-injection shapes proven by
// the hot-reload dev harness, so both watch tools share one tested abstraction.
import type { FileWatcherLike, WatchFn, SpawnFn } from './dev-server.js';

export type { FileWatcherLike, WatchFn, SpawnFn };

// ── Solution-graph TypeScript watch ───────────────────────────────────────────

/**
 * Args for the solution-graph TypeScript watch process. Mirrors the root
 * `build:packages` driver (`tsc -b tsconfig.build.json`) with `--watch`, so the
 * watch loop rebuilds exactly the same projects in the same dependency order.
 */
export const TSC_WATCH_ARGS = ['exec', 'tsc', '-b', '--watch', 'tsconfig.build.json'] as const;

/**
 * Spawn `tsc -b --watch tsconfig.build.json` as a child process.
 *
 * `stdio: 'inherit'` streams the live compiler diagnostics to the terminal;
 * `shell: false` avoids an intermediate shell. The injected `SpawnFn` keeps this
 * unit-testable without launching a real `tsc`.
 */
export function spawnTscWatch(spawnFn: SpawnFn): ReturnType<SpawnFn> {
    return spawnFn('pnpm', [...TSC_WATCH_ARGS], { stdio: 'inherit', shell: false });
}

// ── Renderer CSS re-copy watcher ──────────────────────────────────────────────

/**
 * Renderer source locations whose changes require a `dist/` CSS re-copy: the two
 * public component barrels (their `*.module.css`) plus the design-token and
 * overlay-animation sheets. Mirrors the inputs of
 * [`copy-renderer-css.ts`](./copy-renderer-css.ts).
 */
export const RENDERER_CSS_WATCH_PATHS = [
    'renderer/components/ui',
    'renderer/components/chat',
    'renderer/styles/tokens.css',
    'renderer/styles/animations.css',
] as const;

/**
 * Wire a cross-platform file watcher so renderer CSS changes re-copy into
 * `dist/`. Both `change` and `add` are forwarded so a newly created
 * `*.module.css` is shipped too. The injected `WatchFn` lets unit tests supply a
 * synchronous fake in place of a real chokidar instance.
 */
export function watchRendererCss(
    paths: readonly string[],
    copyCss: () => Promise<readonly string[]>,
    watch: WatchFn,
): FileWatcherLike {
    const watcher = watch(paths);
    const recopy = (): void => {
        void copyCss();
    };
    watcher.on('change', recopy);
    watcher.on('add', recopy);
    return watcher;
}

// ── Combined watch loop ───────────────────────────────────────────────────────

export interface StartWatchDeps {
    /** Spawns the solution `tsc -b --watch` child process. */
    readonly spawnFn: SpawnFn;
    /** Creates the renderer CSS source watcher. */
    readonly watch: WatchFn;
    /** Re-copies the renderer barrel CSS into `dist/`. */
    readonly copyCss: () => Promise<readonly string[]>;
}

export interface WatchHandles {
    readonly tsc: ReturnType<SpawnFn>;
    readonly cssWatcher: FileWatcherLike;
}

/**
 * Start the full watch loop: an initial renderer CSS copy (since `tsc --watch`
 * never emits CSS), the solution-graph `tsc -b --watch`, and the renderer CSS
 * re-copy watcher.
 */
export function startWatch(deps: StartWatchDeps): WatchHandles {
    const { spawnFn, watch, copyCss } = deps;
    const tsc = spawnTscWatch(spawnFn);
    // Seed dist/ with the current CSS so a fresh watch session ships it without
    // waiting for the first edit.
    void copyCss();
    const cssWatcher = watchRendererCss([...RENDERER_CSS_WATCH_PATHS], copyCss, watch);
    return { tsc, cssWatcher };
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when executed directly via `tsx tools/watch-packages.ts` (the
// `build:watch` / `dev` scripts). The `VITEST` guard keeps the real chokidar /
// child-process I/O out of the unit-test surface, matching tools/dev-server.ts.
//
// The body is an async IIFE rather than top-level `await`: tsx transforms
// `tools/*.ts` as CommonJS (the root package.json has no `"type": "module"`),
// and esbuild rejects top-level await in CJS output. The IIFE keeps the
// chokidar import lazy (loaded only when actually watching) without that.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const chokidar = await import('chokidar');
        const childProcess = await import('node:child_process');
        const rendererRoot = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../renderer',
        );

        const { tsc } = startWatch({
            spawnFn: childProcess.spawn,
            watch: (paths) => chokidar.watch([...paths], { ignoreInitial: true }),
            copyCss: () => copyRendererCss({ rendererRoot }),
        });

        const shutdown = (): void => {
            tsc.kill('SIGTERM');
            process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log(
            '[watch-packages] watching @chimera-engine/* — tsc -b --watch tsconfig.build.json + renderer CSS copy…',
        );
    })();
}
