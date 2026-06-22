/**
 * tools/eslint-plugin-chimera/rules/no-main-provider-internals.test.ts
 *
 * Unit tests for the `chimera/no-main-provider-internals` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Main-process orchestration (electron/main) must talk to @chimera/networking
 * exclusively through the public barrel interfaces (MultiplayerProvider /
 * HostTransport / ClientTransport); it must never reach into a provider-specific
 * subdirectory (provider/local/*, provider/steam/*, or their server/client
 * internals). The composition root electron/main/index.ts is the sole exempt
 * file — it wires the concrete provider into the DI graph (Invariant #38).
 *
 * Enforces Invariant #47 across the @chimera/networking boundary (issue #769);
 * mirrors `chimera/no-main-games-import` (the games/* electron/main boundary).
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-main-provider-internals.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('chimera/no-main-provider-internals', rule, {
    // ── Valid — rule must NOT fire ───────────────────────────────────────────
    valid: [
        // The public barrel is the orchestration entry point.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `import { JoinRejectedError } from '@chimera/networking';`,
        },
        {
            filename: 'electron/main/runtime/StateBroadcaster.ts',
            code: `import { playerId } from '@chimera/networking';`,
        },
        // The interface module itself is the public contract (same types as the
        // barrel) — importing it is allowed; only concrete providers are off-limits.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `import { JoinRejectedError } from '@chimera/networking/provider/MultiplayerProvider.js';`,
        },
        // The composition root wires the concrete provider via DI (Invariant #38) — exempt.
        {
            filename: 'electron/main/index.ts',
            code: `import { LocalWebSocketProvider } from '@chimera/networking/provider/local/LocalWebSocketProvider.js';`,
        },
        // Test files legitimately import provider internals as fixtures (exempt).
        {
            filename: 'electron/main/runtime/StateBroadcaster.test.ts',
            code: `import { WsHostTransport } from '@chimera/networking/provider/local/server/WsHostTransport.js';`,
        },
        // electron/main importing other engine packages is out of scope here.
        {
            filename: 'electron/main/index.ts',
            code: `import { ActionPipeline } from '@chimera/simulation/engine/ActionPipeline.js';`,
        },
        // The rule only guards electron/main — the networking package itself may
        // wire its own internals.
        {
            filename: 'networking/provider/local/LocalWebSocketProvider.ts',
            code: `import { WsHostTransport } from './server/WsHostTransport.js';`,
        },
        // A computed dynamic specifier cannot be resolved statically — not flagged.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `const m = import(providerPath);`,
        },
        // Re-export with no source must not crash the source guard.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `const x = 1; export { x };`,
        },
    ],

    // ── Invalid — rule must fire ─────────────────────────────────────────────
    invalid: [
        // Orchestration manager reaching into the local provider implementation.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `import { LocalWebSocketProvider } from '@chimera/networking/provider/local/LocalWebSocketProvider.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // Reaching into the steam provider implementation.
        {
            filename: 'electron/main/runtime/StateBroadcaster.ts',
            code: `import { SteamNetworkProvider } from '@chimera/networking/provider/steam/SteamNetworkProvider.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // A deep server/ internal of the local provider.
        {
            filename: 'electron/main/runtime/StateBroadcaster.ts',
            code: `import { WsHostTransport } from '@chimera/networking/provider/local/server/WsHostTransport.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // The in-memory test double is a concrete provider — not for production orchestration.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `import { InMemoryMultiplayerProvider } from '@chimera/networking/provider/InMemoryMultiplayerProvider.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // Relative path navigating into a provider internal.
        {
            filename: 'electron/main/runtime/SomeRuntime.ts',
            code: `import { x } from '../../networking/provider/local/client/WsClientTransport.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // Dynamic import() of a provider internal in a non-exempt main file.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `const m = import('@chimera/networking/provider/local/LocalWebSocketProvider.js');`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // Re-export from a provider internal.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `export { LocalWebSocketProvider } from '@chimera/networking/provider/local/LocalWebSocketProvider.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
        // Export-all from a provider internal.
        {
            filename: 'electron/main/lobby/LobbyManager.ts',
            code: `export * from '@chimera/networking/provider/steam/SteamNetworkProvider.js';`,
            errors: [{ messageId: 'mainProviderInternals' }],
        },
    ],
});
