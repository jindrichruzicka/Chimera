/**
 * tools/eslint-plugin-chimera/rules/no-main-provider-internals.ts
 *
 * ESLint rule: chimera/no-main-provider-internals
 *
 * Forbids `electron/main` orchestration modules from importing a
 * provider-specific subdirectory of `@chimera-engine/networking`. Orchestration must
 * talk to networking exclusively through the public barrel interfaces
 * (`MultiplayerProvider` / `HostTransport` / `ClientTransport`); the concrete
 * providers (`provider/local/*`, `provider/steam/*`, and their `server/`/
 * `client/` internals, plus the `InMemoryMultiplayerProvider` test double) stay
 * package-internal. This enforces Invariant #47 across the `@chimera-engine/networking`
 * boundary (issue #769) and reaffirms #38 (`LobbyManager` is constructed with an
 * injected `MultiplayerProvider`; no orchestration module names a concrete
 * provider) and #39 (`StateBroadcaster`/`MessageRouter` go through the transport
 * interfaces, never provider-internal `server/`/`client/` directories).
 *
 * The single exempt file is the composition root:
 *
 *   - electron/main/index.ts   (wires the concrete provider into the DI graph)
 *
 * Test files are exempt — they legitimately import provider internals as
 * fixtures (e.g. WsHostTransport.test.ts).
 *
 * Mirrors `chimera/no-main-games-import` (the games/* electron/main boundary).
 * Glob-based `no-restricted-imports` is unreliable for deep `provider/*` paths
 * and cannot express the composition-root allowlist, so this rule classifies the
 * import source directly. It covers every static and dynamic form that can pull
 * in a module: `import`, `export … from`, `export * from`, and dynamic
 * `import('…')` with a string-literal specifier — so the boundary cannot be
 * bypassed by a lazy load.
 */

import type { Rule } from 'eslint';

function normalize(path: string): string {
    return path.replace(/\\/gu, '/');
}

/** Composition root permitted to import a concrete provider (the sole DI-wiring point). */
const ALLOWLISTED_SUFFIXES = ['electron/main/index.ts'];

/**
 * True for an `electron/main` source file that must stay provider-agnostic —
 * i.e. not a test file and not the allowlisted composition root.
 */
function isGuardedMainFile(filename: string): boolean {
    const n = normalize(filename);
    if (!n.includes('electron/main/')) {
        return false;
    }
    if (/\.test\.tsx?$/u.test(n)) {
        return false;
    }
    return !ALLOWLISTED_SUFFIXES.some((suffix) => n.endsWith(suffix));
}

/**
 * True if `source` reaches into a `@chimera-engine/networking` provider internal rather
 * than the public surface. The public surface is the barrel (`@chimera-engine/networking`,
 * no `provider/` segment) and the interface module (`provider/MultiplayerProvider`);
 * everything else under `provider/` — `local/`, `steam/`, their `server/`/`client/`
 * internals, and the `InMemoryMultiplayerProvider` test double — is internal.
 *
 * Matches both the package specifier (`@chimera-engine/networking/provider/…`) and any
 * relative/bare path navigating into `networking/provider/…`.
 */
function isProviderInternalImport(source: string): boolean {
    const n = normalize(source);
    const match = /(?:^|\/)networking\/provider\/(.+)$/u.exec(n);
    if (match === null) {
        return false;
    }
    const rest = match[1];
    if (rest === undefined) {
        return false;
    }
    // The interface module is the public contract — allow it; flag every other
    // first segment under provider/ (concrete providers and their internals).
    const firstSegment = rest.split('/')[0]?.replace(/\.(ts|tsx|js)$/u, '');
    return firstSegment !== 'MultiplayerProvider';
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid electron/main orchestration modules from importing @chimera-engine/networking provider internals (provider/local/*, provider/steam/*, server/client). Orchestration uses the public barrel interfaces only.',
        },
        messages: {
            mainProviderInternals:
                'electron/main must not import a @chimera-engine/networking provider internal (provider/local/*, provider/steam/*, or their server/client). Use the public barrel @chimera-engine/networking (MultiplayerProvider/HostTransport/ClientTransport); the concrete provider is wired only in the composition root electron/main/index.ts (Invariant #38/#47).',
        },
        schema: [],
    },

    create(context) {
        if (!isGuardedMainFile(context.filename)) {
            return {};
        }

        function check(node: Rule.Node, source: unknown): void {
            if (typeof source === 'string' && isProviderInternalImport(source)) {
                context.report({ node, messageId: 'mainProviderInternals' });
            }
        }

        // `import …`, `export … from`, and `export * from` all carry a string
        // `source` (null for re-export-less `export { x }`, hence the guard).
        function checkStaticSource(node: Rule.Node): void {
            const n = node as Rule.Node & { source: { value: unknown } | null };
            if (n.source !== null) {
                check(node, n.source.value);
            }
        }

        return {
            ImportDeclaration: checkStaticSource,
            ExportNamedDeclaration: checkStaticSource,
            ExportAllDeclaration: checkStaticSource,
            // Dynamic `import('…')` — flag only string-literal specifiers; a
            // computed specifier cannot be statically resolved to a provider path.
            ImportExpression(node: Rule.Node) {
                const n = node as Rule.Node & { source: { type: string; value?: unknown } };
                if (n.source.type === 'Literal') {
                    check(node, n.source.value);
                }
            },
        };
    },
};

export default rule;
