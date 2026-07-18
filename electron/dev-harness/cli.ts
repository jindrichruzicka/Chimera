#!/usr/bin/env node
/**
 * electron/dev-harness/cli.ts
 *
 * `chimera-dev-mp` — the dev multiplayer harness CLI (§4.32). Spawns one
 * auto-hosting Electron instance of the app in (or given via `--app`) plus
 * N-1 auto-joining clients, relaying the host's announced lobby code:
 *
 *   chimera-dev-mp 3                       # 1 host + 2 clients, default profiles
 *   chimera-dev-mp --scenario skirmish     # seats/settings from dev/scenarios/
 *   chimera-dev-mp 2 --dry-run             # print the spawn plan JSON, spawn nothing
 *
 * Published as the `chimera-dev-mp` bin of `@chimera-engine/electron`, so a
 * standalone scaffolded game runs exactly the tool the monorepo does. All
 * orchestration logic lives in `./harness.js` (unit-tested with injected IO);
 * this file only touches the real process/filesystem.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
    ANNOUNCE_TIMEOUT_MS,
    assertEntryBuilt,
    assertHarnessEnv,
    buildChildEnv,
    buildClientSpawnConfig,
    buildDryRunReport,
    buildHostSpawnConfig,
    installSignalForwarding,
    isDirectInvocation,
    parseArgs,
    resolveHarnessPlan,
    waitForAnnounceFile,
    waitForAnyChildExit,
    type HarnessIo,
    type HarnessPlan,
    type SpawnConfig,
} from './harness.js';

const fsIo: HarnessIo = {
    readFile: (path) => readFile(path, 'utf8'),
};

/**
 * Resolve the Electron executable through the APP's own dependency graph
 * first (the app declares `electron` in both the monorepo and a standalone
 * scaffold), falling back to this package's resolution.
 */
function resolveElectronBinary(appDir: string): string {
    for (const base of [join(appDir, 'package.json'), import.meta.url]) {
        try {
            const require = createRequire(base);
            const electronPath: unknown = require('electron');
            if (typeof electronPath === 'string') return electronPath;
        } catch {
            // try the next base
        }
    }
    throw new Error(
        `Could not resolve the Electron binary from ${appDir} — is the "electron" ` +
            `devDependency installed?`,
    );
}

async function resetDevUserDataDirs(plan: HarnessPlan): Promise<void> {
    await rm(plan.userDataRoot, { recursive: true, force: true });
    for (let i = 1; i <= plan.players; i++) {
        await mkdir(join(plan.userDataRoot, `p${i}`), { recursive: true });
    }
}

function spawnInstance(binary: string, entryFile: string, cfg: SpawnConfig): ChildProcess {
    const child = spawn(binary, [entryFile, ...cfg.args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildChildEnv(process.env, cfg.env),
    });
    const prefix = `[${cfg.label}] `;
    child.stdout?.on('data', (chunk: Buffer) => {
        process.stdout.write(prefixLines(prefix, chunk.toString('utf8')));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(prefixLines(prefix, chunk.toString('utf8')));
    });
    return child;
}

function prefixLines(prefix: string, text: string): string {
    return text.replace(/^(?!$)/gm, prefix);
}

export async function main(): Promise<number> {
    assertHarnessEnv(process.env);
    const opts = parseArgs(process.argv.slice(2));
    const plan = await resolveHarnessPlan(opts, fsIo, process.cwd());
    await assertEntryBuilt(plan, fsIo);

    if (opts.dryRun) {
        process.stdout.write(`${JSON.stringify(buildDryRunReport(plan), null, 2)}\n`);
        return 0;
    }

    const binary = resolveElectronBinary(plan.appDir);
    await resetDevUserDataDirs(plan);

    // Signal forwarding is installed BEFORE the first spawn (the array is
    // shared by reference, so later pushes are covered): a Ctrl+C or an
    // announce-wait timeout during startup must never orphan the host.
    const children: ChildProcess[] = [];
    const disposeSignals = installSignalForwarding(children);
    try {
        children.push(spawnInstance(binary, plan.entryFile, buildHostSpawnConfig(plan)));

        const announce = await waitForAnnounceFile(plan.announceFile, ANNOUNCE_TIMEOUT_MS, fsIo);
        for (let i = 2; i <= plan.players; i++) {
            children.push(
                spawnInstance(
                    binary,
                    plan.entryFile,
                    buildClientSpawnConfig(plan, i, announce.lobbyCode),
                ),
            );
        }

        return await waitForAnyChildExit(children, 5_000);
    } catch (err) {
        // Startup failure (announce timeout, spawn error): tear down whatever
        // already launched so the failed run leaves no orphan windows.
        for (const child of children) {
            if (!child.killed) child.kill('SIGTERM');
        }
        throw err;
    } finally {
        disposeSignals();
    }
}

// Execute when invoked as a CLI, not when imported (test runner, REPL). The
// pnpm bin shim execs node with the real cli.js path, so argv[1] matches the
// module URL for both the shim and a direct tsx run.
if (isDirectInvocation(import.meta.url, process.argv[1])) {
    main()
        .then((exitCode) => process.exit(exitCode))
        .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[chimera-dev-mp] ${message}\n`);
            process.exit(1);
        });
}
