/**
 * e2e/helpers/relaunch.ts
 *
 * Helper for relaunching an Electron process using captured launch config.
 * Encapsulates the _electron.launch call so spec files remain within the
 * allowed import perimeter (../fixtures/, ../pages/, ../helpers/ only).
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 * Related: BLOCK-3 — reconnect spec must not call electron.launch directly
 */

import { _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

/**
 * Serialisable representation of a previous Electron launch captured via
 * `app.evaluate(() => ({ args: process.argv.slice(1), env: process.env }))`.
 */
export interface RelaunchConfig {
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

/**
 * Launches a new Electron process using a previously captured launch config.
 *
 * @param config  - Args and env captured from the original process.
 * @param extraEnv - Optional env overrides merged on top of `config.env`.
 *                   Does not mutate `config.env`.
 * @returns The new `ElectronApplication` instance — caller is responsible for
 *          calling `app.close()` during teardown.
 */
export async function relaunchElectronApplication(
    config: RelaunchConfig,
    extraEnv?: Readonly<Record<string, string>>,
): Promise<ElectronApplication> {
    return electron.launch({
        args: [...config.args],
        env: extraEnv !== undefined ? { ...config.env, ...extraEnv } : { ...config.env },
    });
}
