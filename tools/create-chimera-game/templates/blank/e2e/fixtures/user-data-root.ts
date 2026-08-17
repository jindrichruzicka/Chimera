/**
 * e2e/fixtures/user-data-root.ts
 *
 * Where every E2E launch's throwaway Chromium profile lives.
 *
 * One spelling, because two parties depend on it agreeing: the launch config mints a
 * fresh profile directory under this root for each launched app, and `global-setup`
 * removes the whole root once per run. Nothing removes a profile when its app closes,
 * so that per-RUN reap is the only thing standing between the suite and unbounded
 * growth — and growth is per LAUNCH, not per run: a profile is a whole Chromium user
 * directory, so left unreaped the root fills the volume the suite runs on.
 *
 * The root carries this game's id so it is this suite's alone. The reap removes the
 * WHOLE root, so two suites sharing one root under the same temp directory would pull
 * profiles out from under each other whenever both are running on one machine. Two
 * runs of THIS suite still share it — run them one at a time.
 *
 * Module boundary: must NOT import from electron/, renderer/, simulation/ or ai/.
 * Node built-ins only.
 */

import os from 'node:os';
import path from 'node:path';

/** Parent directory of every per-launch Electron `--user-data-dir`. */
export const E2E_USER_DATA_ROOT = path.join(os.tmpdir(), 'chimera-e2e-userdata-__game_kebab__');
