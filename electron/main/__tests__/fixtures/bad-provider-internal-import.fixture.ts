// electron/main/__tests__/fixtures/bad-provider-internal-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #769).
//
// Main-process orchestration (electron/main) must import @chimera/networking
// through the public barrel interfaces ONLY (MultiplayerProvider / HostTransport
// / ClientTransport); it must never reach into a provider-specific subdirectory.
// Importing the concrete local provider implementation from a non-composition
// orchestration file is a deliberate violation that the
// `chimera/no-main-provider-internals` rule must flag (Invariant #47).
//
// This file is excluded from the normal lint run via the `ignores` glob in
// eslint.config.mjs; the eslint-import-boundary smoke test lints it explicitly
// with `--no-ignore`.

import '@chimera/networking/provider/local/LocalWebSocketProvider.js';
