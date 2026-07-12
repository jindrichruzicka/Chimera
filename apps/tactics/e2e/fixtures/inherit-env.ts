/**
 * Builds the environment passed to `electron.launch` from the parent process
 * environment.
 *
 * Strips ELECTRON_RUN_AS_NODE: when that variable is set in the parent
 * environment (some shells, CI runners, and agent sandboxes export it
 * globally), the Electron binary boots as plain Node.js and rejects the
 * Chromium flags Playwright injects to drive the app — most visibly
 * `--remote-debugging-port=0`, which Node reports as `bad option`. A GUI
 * Electron launch must never inherit it, so it is removed unconditionally.
 *
 * Strips CHIMERA_DEBUG: the §4.12 environment matrix (Invariant #27) requires
 * E2E runs to never enter the runtime debug layer, so a debug flag exported by
 * the developer's shell must not leak into the launched app.
 */

const STRIPPED_ENV_KEYS: ReadonlySet<string> = new Set(['ELECTRON_RUN_AS_NODE', 'CHIMERA_DEBUG']);

/** Filter out undefined and Node-mode-forcing entries from the source env. */
export function inheritEnv(
    source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(source).filter(
            (entry): entry is [string, string] =>
                entry[1] !== undefined && !STRIPPED_ENV_KEYS.has(entry[0]),
        ),
    );
}
