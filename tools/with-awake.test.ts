/**
 * tools/with-awake.test.ts
 *
 * `tools/with-awake.sh` holds a macOS sleep assertion (`caffeinate -dims`) around
 * a long local command and is transparent on a host without `caffeinate`.
 * Pinned against a fake `caffeinate` on `PATH` that records its argv, and against
 * a `PATH` holding none — the real tool would say nothing about the wrapper.
 *
 * Children are spawned asynchronously: a `spawnSync` here would hold the vitest
 * worker's event loop, which is the first of the two readings of
 * `[vitest-worker]: Timeout calling` that `vitest.config.mts` records.
 */

import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const workspaceRoot = path.resolve(import.meta.dirname, '..');
const wrapper = path.join(workspaceRoot, 'tools', 'with-awake.sh');

interface Run {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

/** Runs `file` with `args`, resolving the exit code instead of rejecting on it. */
async function run(
    file: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
    cwd?: string,
): Promise<Run> {
    try {
        const { stdout, stderr } = await execFileAsync(file, args, { env, cwd });
        return { code: 0, stdout, stderr };
    } catch (error) {
        const failure = error as { code?: number | string; stdout?: string; stderr?: string };
        if (typeof failure.code !== 'number') {
            throw error;
        }
        return { code: failure.code, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
    }
}

const runWrapper = (args: readonly string[], env: NodeJS.ProcessEnv): Promise<Run> =>
    run('/bin/sh', [wrapper, ...args], env);

/**
 * Records every argument on its own line, drops the two the wrapper owns
 * (`-dims --`), and runs the command so its exit code and output are observable.
 */
const FAKE_CAFFEINATE =
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CHIMERA_FAKE_CAFFEINATE_LOG"\nshift 2\nexec "$@"\n';

describe('tools/with-awake.sh', () => {
    let sandbox: string;
    /** Holds the fake `caffeinate`, and nothing else, so `PATH=<fakeDir>` reaches only it. */
    let fakeDir: string;
    /** Empty, so `PATH=<emptyDir>` is a host with no `caffeinate` at all. */
    let emptyDir: string;
    let argvLog: string;

    beforeEach(async () => {
        sandbox = await mkdtemp(path.join(tmpdir(), 'chimera-with-awake-'));
        fakeDir = path.join(sandbox, 'fake');
        emptyDir = path.join(sandbox, 'empty');
        argvLog = path.join(sandbox, 'caffeinate-argv.txt');
        await mkdir(fakeDir);
        await mkdir(emptyDir);
        await writeFile(path.join(fakeDir, 'caffeinate'), FAKE_CAFFEINATE);
        await chmod(path.join(fakeDir, 'caffeinate'), 0o755);
    });

    afterEach(async () => {
        await rm(sandbox, { recursive: true, force: true });
    });

    it('holds the assertion with `caffeinate -dims -- <command>` when one is on PATH, and runs the command once', async () => {
        const result = await runWrapper(['/bin/sh', '-c', 'echo RAN; exit 3'], {
            PATH: fakeDir,
            CHIMERA_FAKE_CAFFEINATE_LOG: argvLog,
        });

        expect((await readFile(argvLog, 'utf8')).split('\n').filter(Boolean)).toEqual([
            '-dims',
            '--',
            '/bin/sh',
            '-c',
            'echo RAN; exit 3',
        ]);
        // Exactly one line: a wrapper that ran caffeinate without `exec` would
        // fall through and run the command a second time, unheld.
        expect(result.stdout).toBe('RAN\n');
    });

    it("propagates the wrapped command's exit code through caffeinate", async () => {
        const failing = await runWrapper(['/bin/sh', '-c', 'exit 3'], {
            PATH: fakeDir,
            CHIMERA_FAKE_CAFFEINATE_LOG: argvLog,
        });
        const passing = await runWrapper(['/bin/sh', '-c', 'exit 0'], {
            PATH: fakeDir,
            CHIMERA_FAKE_CAFFEINATE_LOG: argvLog,
        });

        expect(failing.code).toBe(3);
        expect(passing.code).toBe(0);
    });

    it('runs the command directly, once and exit code intact, on a host with no caffeinate', async () => {
        const result = await runWrapper(['/bin/sh', '-c', 'echo RAN2; exit 4'], {
            PATH: emptyDir,
            CHIMERA_FAKE_CAFFEINATE_LOG: argvLog,
        });

        expect(result.code).toBe(4);
        expect(result.stdout).toBe('RAN2\n');
        await expect(readFile(argvLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('refuses a call with no command instead of holding an assertion with nothing to wait for', async () => {
        const result = await runWrapper([], {
            PATH: fakeDir,
            CHIMERA_FAKE_CAFFEINATE_LOG: argvLog,
        });

        expect(result.code).toBe(64);
        expect(result.stderr).toContain('usage:');
        await expect(readFile(argvLog, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

describe('the root scripts that run under it', () => {
    const wrapped = ['test', 'test:e2e', 'test:e2e:action'] as const;

    it.each(wrapped)(
        '%s runs its whole chain under the wrapper and forwards pnpm-appended arguments',
        async (name) => {
            const pkg = JSON.parse(
                await readFile(path.join(workspaceRoot, 'package.json'), 'utf8'),
            ) as {
                readonly scripts: Readonly<Record<string, string>>;
            };
            const script = pkg.scripts[name] ?? '';

            // One `sh -c` around the WHOLE `&&` chain — wrapping a single segment
            // would drop the assertion between `pnpm build:packages` and the suite.
            expect(script.startsWith("sh tools/with-awake.sh sh -c 'pnpm build:packages && ")).toBe(
                true,
            );
            // The `"$@"` … `sh` tail is what carries `pnpm run <script> -- <args>`
            // into the chain's last command; without it pnpm appends the
            // arguments after the closing quote, where nothing reads them.
            expect(script.endsWith(' "$@"\' sh')).toBe(true);
        },
    );

    it('that shape forwards `pnpm run <script> -- <args>` to the last command of the chain', async () => {
        const sandbox = await mkdtemp(path.join(tmpdir(), 'chimera-with-awake-shape-'));
        try {
            // The fake keeps the real `caffeinate` out of a test that only asks
            // where pnpm's appended arguments land.
            const fakeDir = path.join(sandbox, 'fake');
            await mkdir(fakeDir);
            await writeFile(path.join(fakeDir, 'caffeinate'), FAKE_CAFFEINATE);
            await chmod(path.join(fakeDir, 'caffeinate'), 0o755);
            await writeFile(
                path.join(sandbox, 'package.json'),
                JSON.stringify({
                    name: 'chimera-with-awake-shape',
                    private: true,
                    scripts: { probe: `sh ${wrapper} sh -c 'echo INNER "$@"' sh` },
                }),
            );

            const result = await run(
                'pnpm',
                ['run', 'probe', '--', '--grep', 'foo'],
                {
                    ...process.env,
                    PATH: `${fakeDir}:${process.env['PATH'] ?? ''}`,
                    CHIMERA_FAKE_CAFFEINATE_LOG: path.join(sandbox, 'argv.txt'),
                },
                sandbox,
            );

            expect(result.code).toBe(0);
            // Everything pnpm appended reaches the chain's last command, in order.
            // Whether the `--` itself is among it is pnpm's call, so only the tail
            // is pinned.
            expect(result.stdout).toMatch(/^INNER.* --grep foo$/m);
        } finally {
            await rm(sandbox, { recursive: true, force: true });
        }
    });
});
