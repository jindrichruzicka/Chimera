/**
 * apps/action/e2e/fixtures/open-window.ts
 *
 * The fixture-owned launch half: turning a launched `ElectronApplication` into a
 * loaded `Page`, and saying WHY when it does not.
 *
 * `firstWindow()` and `waitForLoadState('domcontentloaded')` each report nothing
 * but `Timeout 30000ms exceeded` — a message equally true of a main process that
 * died at boot, one alive but stuck before its first `BrowserWindow`, and one
 * whose window opened but whose renderer entry never parsed. The arms below name
 * one of those each.
 *
 * The reading and the describing are SPLIT. The arms are the part worth pinning
 * and they are pure over the facts they are given; the read that feeds them can
 * fail on its own terms, inside a failure that already has an error of its own.
 *
 * This app's own copy: `apps/<game>` may not import another game's directory
 * (module boundaries §3).
 *
 * Module boundary: `@playwright/test` types only.
 */

import type { ElectronApplication, Page } from '@playwright/test';

/** Which of the two launch-half waits timed out. */
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
 * Captured main-process stderr, keyed by app. A `WeakMap` so a closed and
 * dropped app takes its buffer with it.
 */
const capturedStderr = new WeakMap<ElectronApplication, string[]>();

/** How many trailing stderr lines a diagnosis prints. A boot crash is short. */
const STDERR_TAIL_LINES = 20;

/**
 * Start recording the launched app's main-process stderr.
 *
 * Stderr is where the runner can still reach a boot death: Playwright's
 * `console` event carries only the main process's `console.*` calls, so a throw
 * out of `app.whenReady()` reaches no listener that survives the failure. Called
 * at launch, because the crash happens before any test asks for a window.
 */
export function captureMainProcessOutput(app: ElectronApplication): void {
    const lines: string[] = [];
    capturedStderr.set(app, lines);
    try {
        app.process().stderr?.on('data', (chunk: unknown) => {
            lines.push(String(chunk));
        });
    } catch {
        // An app already closed leaves the buffer empty, which the describer
        // reports as "not captured".
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
        : `main-process stderr (last ${String(STDERR_TAIL_LINES)} lines):\n${stderrTail}`;
}

/**
 * Which of the ways a launch can fail to produce a loaded window this one was.
 *
 * Pure, and takes the facts rather than reading them. `null` is the case where
 * the read itself failed, not an app without windows — the two say different
 * things and a reader has to be able to tell them apart.
 */
export function describeLaunchStall(phase: LaunchPhase, facts: LaunchStallFacts | null): string {
    if (facts === null) {
        return 'the launched app could not be inspected, so whether it died or is merely late is unknown';
    }

    const stderr = describeStderr(facts.stderrTail);
    if (facts.exitCode !== null || facts.signal !== null) {
        return (
            `the main process had already exited (code=${String(facts.exitCode)}, ` +
            `signal=${String(facts.signal)}) — no window was coming.\n${stderr}`
        );
    }

    if (phase === 'load') {
        return (
            `a window opened (${String(facts.windowCount)} open) but never reached ` +
            `domcontentloaded — the renderer entry is late or never parsed.\n${stderr}`
        );
    }

    return facts.windowCount === 0
        ? `the main process is alive and opened no window — it is stuck before its first BrowserWindow.\n${stderr}`
        : `the main process is alive and already has ${String(facts.windowCount)} window(s) — the runner's attach is late, not the app.\n${stderr}`;
}

/**
 * Attach to a launched app's first window and wait for it to load, naming which
 * half was late if either never arrives.
 */
export async function openE2eWindow(app: ElectronApplication): Promise<Page> {
    let window: Page;
    try {
        window = await app.firstWindow();
    } catch (error: unknown) {
        throw launchStallError(error, app, 'first-window');
    }

    try {
        await window.waitForLoadState('domcontentloaded');
    } catch (error: unknown) {
        throw launchStallError(error, app, 'load');
    }

    return window;
}

/** Re-throw a launch-half failure with the stall description appended. */
function launchStallError(error: unknown, app: ElectronApplication, phase: LaunchPhase): Error {
    return new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n` +
            `action e2e launch: ${describeLaunchStall(phase, readLaunchStallFacts(app))}`,
        // The message is rewritten, so the original survives only here.
        { cause: error },
    );
}
