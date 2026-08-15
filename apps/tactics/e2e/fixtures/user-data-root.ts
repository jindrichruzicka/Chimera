/**
 * e2e/fixtures/user-data-root.ts
 *
 * Where every E2E launch's throwaway Chromium profile lives.
 *
 * One spelling, because two parties depend on it agreeing: the launch config
 * mints a fresh profile directory under this root for each launched app, and
 * `global-setup` removes the whole root once per run. Nothing removes a profile
 * when its app closes — a relaunch spec re-uses the closed app's `--user-data-dir`
 * to prove settings survived a restart, so per-app deletion would delete the very
 * state those specs assert — which makes the per-RUN reap the only thing standing
 * between the suite and unbounded growth.
 *
 * Growth is per LAUNCH, not per run, and a profile is a whole Chromium user
 * directory — left unreaped it fills the volume the suite runs on.
 *
 * Architecture: §13.5 — Fixtures
 *
 * Module boundary: must NOT import from electron/main/, renderer/, simulation/
 * or networking/. Node built-ins only.
 */

import os from 'node:os';
import path from 'node:path';

/** Parent directory of every per-launch Electron `--user-data-dir`. */
export const E2E_USER_DATA_ROOT = path.join(os.tmpdir(), 'chimera-e2e-userdata');
