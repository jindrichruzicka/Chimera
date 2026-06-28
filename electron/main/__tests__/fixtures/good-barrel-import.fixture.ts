// electron/main/__tests__/fixtures/good-barrel-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #769) — the allowed control.
//
// Importing the @chimera-engine/networking public barrel (the provider/transport
// interfaces) from electron/main orchestration is the SANCTIONED path and must
// NOT be flagged by `chimera/no-main-provider-internals`. Paired with
// bad-provider-internal-import.fixture.ts, this proves the rule discriminates the
// public surface from provider internals rather than banning networking outright.
//
// Excluded from the normal lint run via the `ignores` glob; the
// eslint-import-boundary smoke test lints it explicitly with `--no-ignore`.

import '@chimera-engine/networking';
