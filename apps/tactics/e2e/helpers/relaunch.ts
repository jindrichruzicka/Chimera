/**
 * e2e/helpers/relaunch.ts
 *
 * Helper for relaunching an Electron process using captured launch config.
 * Encapsulates the _electron.launch call so spec files remain within the
 * allowed import perimeter (../fixtures/, ../pages/, ../helpers/ only).
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
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
 * Capture a relaunch-safe launch config from a live ElectronApplication.
 *
 * Only forwards env keys required for relaunch: CHIMERA_E2E, CHIMERA_PORT,
 * CHIMERA_E2E_*, DISPLAY, NODE_ENV, and PATH. DISPLAY is needed by
 * headless Linux CI runs that launch Electron through X11. This avoids
 * forwarding unrelated process secrets from the host environment into the
 * relaunched instance.
 */
export async function captureRelaunchConfig(app: ElectronApplication): Promise<RelaunchConfig> {
    return app.evaluate(() => ({
        args: process.argv.slice(1),
        env: Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => {
                const [key, value] = entry;
                return (
                    value !== undefined &&
                    (key === 'CHIMERA_E2E' ||
                        key === 'CHIMERA_PORT' ||
                        key === 'DISPLAY' ||
                        key === 'NODE_ENV' ||
                        key === 'PATH' ||
                        key.startsWith('CHIMERA_E2E_'))
                );
            }),
        ),
    }));
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
