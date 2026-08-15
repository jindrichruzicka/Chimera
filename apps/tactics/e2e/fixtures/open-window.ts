/**
 * e2e/fixtures/open-window.ts
 *
 * The fixture-owned launch half: turning a launched `ElectronApplication` into a
 * loaded `Page`, and saying WHY when it does not.
 *
 * `firstWindow()` and `waitForLoadState('domcontentloaded')` each carry a 30 s
 * default, and each reports nothing but `Timeout 30000ms exceeded` — a message
 * equally true of a main process that died at boot, one that is alive and stuck
 * before its first `BrowserWindow`, and one whose window opened but whose
 * renderer entry never parsed. The arms below name one of those each, so a
 * launch timeout points at a suspect the way `describeSceneBarrierStall` does
 * for a scene hop.
 *
 * The 30 s budgets are deliberately left as they are. A launch measured under
 * heavy CPU contention, with several apps running at once, still finished each
 * phase in well under a second — so a 30 s timeout is not something a merely-slow
 * host walks into. What it needs is a diagnosis, not a bigger number.
 *
 * Used by the launch sites the FIXTURES own. Launches a spec makes for itself,
 * including a spec that declares its own Playwright fixture, call `firstWindow()`
 * directly and get no diagnosis.
 *
 * Architecture: §13.5 — Fixtures
 *
 * Module boundary: must NOT import from electron/main/, renderer/, simulation/
 * or networking/. `@playwright/test` is the only import.
 */

import type { ElectronApplication, Page } from '@playwright/test';

/** Which of the two launch-half waits was the one that timed out. */
export type LaunchPhase = 'first-window' | 'load';

/** What the runner can still learn about an app whose window never arrived. */
export interface LaunchStallFacts {
    /** Windows the app has open right now — 0 means none was ever created. */
    readonly windowCount: number;
    /** Main-process exit code, or `null` while it is still running. */
    readonly exitCode: number | null;
    /** Signal that killed the main process, or `null` if none did. */
    readonly signal: string | null;
    /** Tail of the main process's stderr; empty when nothing was captured. */
    readonly stderrTail: string;
}

/**
 * Captured main-process stderr, keyed by app. A `WeakMap` so an app that is
 * closed and dropped takes its buffer with it — a `Map` would retain every app a
 * worker ever launched for that worker's life.
 */
const capturedStderr = new WeakMap<ElectronApplication, string[]>();

/** How many trailing stderr lines a diagnosis prints. A boot crash is short. */
const STDERR_TAIL_LINES = 20;

/**
 * Start recording the launched app's main-process stderr.
 *
 * Stderr is where the runner can still reach a boot death: Playwright's `console`
 * event carries only the main process's `console.*` calls, so a throw out of
 * `app.whenReady()` reaches no listener that survives the failure. Called at
 * launch because the crash happens before any test asks for a window.
 */
export function captureMainProcessOutput(app: ElectronApplication): void {
    const lines: string[] = [];
    capturedStderr.set(app, lines);
    try {
        app.process().stderr?.on('data', (chunk: unknown) => {
            lines.push(String(chunk));
        });
    } catch {
        // An app already closed (or a double so thin it has no process) leaves
        // the buffer empty, which the describer reports as "not captured".
    }
}

/**
 * Everything {@link describeLaunchStall} reads, or `null` when the app cannot be
 * inspected at all. Never throws: it runs inside a failure that already has its
 * own error, and a second one thrown here would replace it.
 */
export function readLaunchStallFacts(app: ElectronApplication): LaunchStallFacts | null {
    try {
        const child = app.process();
        return {
            windowCount: app.windows().length,
            exitCode: child.exitCode,
            signal: child.signalCode,
            // Trimmed BEFORE the split: a trailing newline would otherwise spend
            // one of the tail's lines on an empty string.
            stderrTail: (capturedStderr.get(app) ?? [])
                .join('')
                .trim()
                .split('\n')
                .slice(-STDERR_TAIL_LINES)
                .join('\n'),
        };
    } catch {
        return null;
    }
}

/** The stderr half of a diagnosis, or a statement that there is none. */
function describeStderr(stderrTail: string): string {
    return stderrTail === ''
        ? 'no main-process stderr was captured'
        : `main-process stderr (last ${STDERR_TAIL_LINES} lines):\n${stderrTail}`;
}

/**
 * Which of the ways a launch can fail to produce a loaded window this one was.
 *
 * Pure, and takes the facts rather than reading them: the arms are the part
 * worth pinning, and the read that feeds them can fail on its own terms —
 * `null` is that case, not an app without windows.
 */
export function describeLaunchStall(
    phase: LaunchPhase,
    facts: LaunchStallFacts | null,
    label: string,
): string {
    if (facts === null) {
        return `${label}: the launched app could not be inspected, so whether it died or is merely late is unknown`;
    }

    const stderr = describeStderr(facts.stderrTail);
    if (facts.exitCode !== null || facts.signal !== null) {
        return (
            `${label}: the main process had already exited (code=${String(facts.exitCode)}, ` +
            `signal=${String(facts.signal)}) — no window was coming.\n${stderr}`
        );
    }

    if (phase === 'load') {
        return (
            `${label}: a window opened (${facts.windowCount} open) but never reached ` +
            `domcontentloaded — the renderer entry is late or never parsed.\n${stderr}`
        );
    }

    return facts.windowCount === 0
        ? `${label}: the main process is alive and opened no window — it is stuck before its ` +
              `first BrowserWindow.\n${stderr}`
        : `${label}: the main process is alive and already has ${facts.windowCount} window(s) — ` +
              `the runner's attach is late, not the app.\n${stderr}`;
}

/** Re-throw a launch-half failure with the stall description appended. */
function launchStallError(
    error: unknown,
    app: ElectronApplication,
    phase: LaunchPhase,
    label: string,
): Error {
    return new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n` +
            `${describeLaunchStall(phase, readLaunchStallFacts(app), label)}`,
        // The message is rewritten, so the original error survives only here —
        // everything reading the failure programmatically needs it.
        { cause: error },
    );
}

/**
 * Attach to a launched app's first window and wait for it to load, naming which
 * half was late if either never arrives.
 *
 * `label` names the process in a multi-process fixture (`host`, `client`), so a
 * pair's failure says which of the two never came up.
 */
export async function openE2eWindow(app: ElectronApplication, label: string): Promise<Page> {
    let window: Page;
    try {
        window = await app.firstWindow();
    } catch (error: unknown) {
        throw launchStallError(error, app, 'first-window', label);
    }

    try {
        await window.waitForLoadState('domcontentloaded');
    } catch (error: unknown) {
        throw launchStallError(error, app, 'load', label);
    }

    return window;
}
