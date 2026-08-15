/**
 * Unit coverage for the launch-half diagnosis (`fixtures/open-window.ts`).
 *
 * This is a Vitest unit test, not a Playwright E2E spec: the describer is pure
 * and the fact reader takes an `ElectronApplication`-shaped double, so both run
 * without starting Electron.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    captureMainProcessOutput,
    describeLaunchStall,
    openE2eWindow,
    readLaunchStallFacts,
    type LaunchStallFacts,
} from './fixtures/open-window';

/** Minimal `ChildProcess` stand-in: the three fields the reader consults. */
function fakeChild(
    overrides: {
        exitCode?: number | null;
        signalCode?: string | null;
        stderr?: { on: (event: string, listener: (chunk: unknown) => void) => void } | null;
    } = {},
): never {
    return {
        exitCode: overrides.exitCode ?? null,
        signalCode: overrides.signalCode ?? null,
        stderr: overrides.stderr === undefined ? null : overrides.stderr,
    } as never;
}

/** Minimal `ElectronApplication` stand-in. */
function fakeApp(options: {
    windows?: readonly unknown[];
    process?: () => never;
    firstWindow?: () => Promise<unknown>;
}): never {
    return {
        windows: () => options.windows ?? [],
        process: options.process ?? ((): never => fakeChild()),
        firstWindow: options.firstWindow ?? ((): Promise<unknown> => Promise.resolve({})),
    } as never;
}

/**
 * A live app plus the `stderr` `data` listener `captureMainProcessOutput` attached
 * to it, so a test can push chunks the way the child process would.
 */
function appWithCapturedStderr(): { app: never; emit: (chunk: unknown) => void } {
    let listener: ((chunk: unknown) => void) | undefined;
    const app = fakeApp({
        process: () =>
            fakeChild({
                stderr: {
                    on: (event, handler) => {
                        if (event === 'data') {
                            listener = handler;
                        }
                    },
                },
            }),
    });

    captureMainProcessOutput(app);
    return {
        app,
        emit: (chunk) => {
            listener?.(chunk);
        },
    };
}

const ALIVE: LaunchStallFacts = {
    windowCount: 0,
    exitCode: null,
    signal: null,
    stderrTail: '',
};

describe('describeLaunchStall', () => {
    it('says the app was uninspectable when no facts could be read', () => {
        expect(describeLaunchStall('first-window', null, 'host')).toContain(
            'could not be inspected',
        );
    });

    it('names the exit code and signal when the main process had already died', () => {
        const message = describeLaunchStall(
            'first-window',
            { ...ALIVE, exitCode: 1, signal: null, stderrTail: 'Error: boom' },
            'host',
        );

        expect(message).toContain('had already exited');
        expect(message).toContain('code=1');
        expect(message).toContain('Error: boom');
    });

    it('reports a signal-killed main process as dead even when the exit code is null', () => {
        const message = describeLaunchStall(
            'first-window',
            { ...ALIVE, exitCode: null, signal: 'SIGKILL' },
            'client',
        );

        expect(message).toContain('had already exited');
        expect(message).toContain('signal=SIGKILL');
    });

    it('separates a live main process that opened no window from one that opened some', () => {
        const noWindow = describeLaunchStall('first-window', ALIVE, 'host');
        const someWindows = describeLaunchStall(
            'first-window',
            { ...ALIVE, windowCount: 2 },
            'host',
        );

        expect(noWindow).toContain('opened no window');
        expect(someWindows).toContain('already has 2 window');
        expect(someWindows).not.toContain('opened no window');
    });

    it('says the window opened but never loaded for the load phase', () => {
        const message = describeLaunchStall('load', { ...ALIVE, windowCount: 1 }, 'client');

        expect(message).toContain('never reached domcontentloaded');
        expect(message).not.toContain('opened no window');
    });

    it('reports a process that died between the two waits as dead, not as a slow load', () => {
        // A main process can die AFTER its window opened — the case the stderr
        // capture exists for. The exit state has to outrank the phase there, or
        // the load arm names the renderer for a crash the stderr already explains.
        const message = describeLaunchStall(
            'load',
            { ...ALIVE, exitCode: 1, stderrTail: 'Error: boom' },
            'host',
        );

        expect(message).toContain('had already exited');
        expect(message).not.toContain('never reached domcontentloaded');
    });

    it('keeps the load phase over the window count when the window has since closed', () => {
        // The window count is 0 in BOTH the "never opened one" and the "opened
        // one that has since gone" case, so the phase has to decide, not the count.
        const message = describeLaunchStall('load', { ...ALIVE, windowCount: 0 }, 'client');

        expect(message).toContain('never reached domcontentloaded');
        expect(message).not.toContain('opened no window');
    });

    it('names the window as unlabelled-by-stderr when nothing was captured', () => {
        expect(describeLaunchStall('first-window', ALIVE, 'host')).toContain(
            'no main-process stderr was captured',
        );
    });
});

describe('readLaunchStallFacts', () => {
    it('reads the window count and the process exit state', () => {
        const app = fakeApp({
            windows: [{}, {}],
            process: () => fakeChild({ exitCode: 3, signalCode: 'SIGTERM' }),
        });

        expect(readLaunchStallFacts(app)).toEqual({
            windowCount: 2,
            exitCode: 3,
            signal: 'SIGTERM',
            stderrTail: '',
        });
    });

    it('returns null rather than throwing when the app cannot be inspected', () => {
        const app = fakeApp({
            process: () => {
                throw new Error('closed');
            },
        });

        expect(readLaunchStallFacts(app)).toBeNull();
    });

    it('returns the stderr captured for that app', () => {
        const { app, emit } = appWithCapturedStderr();

        emit(Buffer.from('boot failed\n'));

        expect(readLaunchStallFacts(app)?.stderrTail).toContain('boot failed');
    });

    it('keeps only the last 20 stderr lines', () => {
        const { app, emit } = appWithCapturedStderr();

        for (let line = 1; line <= 25; line += 1) {
            emit(`line-${String(line).padStart(2, '0')}\n`);
        }

        const tail = readLaunchStallFacts(app)?.stderrTail ?? '';
        expect(tail.split('\n')).toHaveLength(20);
        expect(tail).toContain('line-25');
        expect(tail).not.toContain('line-05');
    });

    it('spends none of those 20 lines on the trailing newline', () => {
        // Exactly STDERR_TAIL_LINES newline-terminated lines is the boundary the
        // trim-before-split exists for: split first and the residual empty entry
        // takes a slot, pushing the OLDEST real line out of a tail that is
        // already exactly full.
        const { app, emit } = appWithCapturedStderr();

        for (let line = 1; line <= 20; line += 1) {
            emit(`line-${String(line).padStart(2, '0')}\n`);
        }

        const lines = (readLaunchStallFacts(app)?.stderrTail ?? '').split('\n');
        expect(lines).toHaveLength(20);
        expect(lines[0]).toBe('line-01');
        expect(lines).not.toContain('');
    });
});

describe('openE2eWindow', () => {
    it('rethrows a first-window timeout with the stall description appended', async () => {
        const app = fakeApp({
            firstWindow: () => Promise.reject(new Error('Timeout 30000ms exceeded')),
        });

        await expect(openE2eWindow(app, 'host')).rejects.toThrow(/opened no window/);
        await expect(openE2eWindow(app, 'host')).rejects.toThrow(/Timeout 30000ms exceeded/);
    });

    it('rethrows a load timeout with the load-phase description appended', async () => {
        const window = { waitForLoadState: vi.fn(() => Promise.reject(new Error('nav timeout'))) };
        const app = fakeApp({
            windows: [window],
            firstWindow: () => Promise.resolve(window),
        });

        await expect(openE2eWindow(app, 'client')).rejects.toThrow(
            /never reached domcontentloaded/,
        );
    });

    it('returns the loaded window when both phases settle', async () => {
        const window = { waitForLoadState: vi.fn(() => Promise.resolve()) };
        const app = fakeApp({ firstWindow: () => Promise.resolve(window) });

        await expect(openE2eWindow(app, 'host')).resolves.toBe(window);
        expect(window.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');
    });
});
