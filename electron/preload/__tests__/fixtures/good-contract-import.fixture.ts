// electron/preload/__tests__/fixtures/good-contract-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #777, F62) — the allowed control.
//
// Importing the @chimera/simulation contract surface (here the settings schema)
// from a preload module is the SANCTIONED path: @chimera/simulation is the
// preload bridge's only @chimera/* dependency (Invariant #1). Paired with
// bad-cross-boundary-import.fixture.ts, this proves the preload
// `no-restricted-imports` zone discriminates the contract surface from the
// forbidden ai/networking/renderer/game/host-internal layers rather than banning
// all cross-package imports.
//
// Excluded from the normal lint run via the `ignores` glob; the
// eslint-import-boundary smoke test lints it explicitly with `--no-ignore`.

import type { EngineSettings } from '@chimera/simulation/settings/SettingsSchema.js';

export type _PreloadContractProbe = EngineSettings;
