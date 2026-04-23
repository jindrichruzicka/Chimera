/**
 * tools/dev-server.ts
 *
 * Hot-reload dev harness: watches `renderer/` and `electron/` for changes
 * and restarts the Electron child process via a debounced callback.
 *
 * Architecture reference: §4.32 — Development Multiplayer Harness
 * Issue: #170
 *
 * Invariants upheld:
 *   #2  — Lives in `tools/`; does NOT import from `renderer/`, `simulation/`,
 *          `ai/`, or any `games/` module.
 *   #77 — Harness flag guard is enforced by electron/main/index.ts at startup.
 *
 * Usage (not invoked directly; imported by the watch script or tested):
 *   const ctrl = createRestartController({ onRestart: (p) => console.log(p) });
 *   fs.watch('renderer', { recursive: true }, (_, f) => ctrl.reportChange(f ?? ''));
 */

import type { ChildProcess } from 'node:child_process';

// ── Public types ──────────────────────────────────────────────────────────────

export interface RestartControllerOptions {
    /** Called with the triggering file path once per debounce window. */
    readonly onRestart: (changedPath: string) => void;
    /**
     * Milliseconds to wait after the last `reportChange` call before firing
     * `onRestart`. Defaults to 300 ms.
     */
    readonly debounceMs?: number;
}

export interface RestartController {
    /**
     * Report a file-system change. The controller debounces rapid changes and
     * calls `onRestart` at most once per debounce window.
     */
    reportChange(changedPath: string): void;
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Create a `RestartController` that debounces file-change events.
 *
 * Pure orchestration — no I/O, no spawning. Callers provide the `onRestart`
 * hook so the controller is fully unit-testable with fake timers.
 */
export function createRestartController(options: RestartControllerOptions): RestartController {
    const { onRestart, debounceMs = 300 } = options;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPath = '';

    return {
        reportChange(changedPath: string): void {
            lastPath = changedPath;
            if (timer !== undefined) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = undefined;
                onRestart(lastPath);
            }, debounceMs);
        },
    };
}

// ── File-watcher wiring (not exercised by unit tests) ─────────────────────────
//
// The block below runs only when this file is executed directly (e.g. via
// `tsx tools/dev-server.ts`). It is excluded from the unit-test surface by
// the `VITEST` guard, keeping the module boundary clean.

if (process.env['VITEST'] === undefined) {
    const { watch } = await import('node:fs');
    const childProcess = await import('node:child_process');

    let child: ChildProcess | undefined;

    const startElectron = (): void => {
        if (child !== undefined) {
            child.kill();
        }
        child = childProcess.spawn('pnpm', ['electron', '.'], {
            stdio: 'inherit',
            env: { ...process.env, CHIMERA_DEV_HARNESS: '1', NODE_ENV: 'development' },
            shell: true,
        });
    };

    const controller = createRestartController({
        onRestart: (p) => {
            console.log(`[dev-server] change detected: ${p} — restarting Electron…`);
            startElectron();
        },
        debounceMs: 300,
    });

    for (const dir of ['renderer', 'electron']) {
        watch(dir, { recursive: true }, (_event, filename) => {
            controller.reportChange(`${dir}/${filename ?? ''}`);
        });
    }

    console.log('[dev-server] watching renderer/ and electron/ — starting Electron…');
    startElectron();
}
