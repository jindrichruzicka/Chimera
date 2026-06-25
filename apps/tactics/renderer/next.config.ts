import type { NextConfig } from 'next';
import path from 'path';

// The tactics app's OWN Next host (F65 Phase 2c). The app owns its renderer GUI:
// every route under app/** is a thin re-export of the engine shell from
// `@chimera/renderer/shell/*` (compiled by `transpilePackages`), and the single
// `chimera-game-registration` alias binds the game-agnostic shell to THIS game's
// renderer composition root. There are NO source-twin aliases: the app's route
// re-exports AND the game's screens both resolve `@chimera/renderer/*` to the one
// package dist, so EscapeStack / the Zustand stores / the game registry are
// single-instance via uniform resolution (proven by the Phase-2 spike).
const appRendererDir = __dirname; // apps/tactics/renderer

interface WebpackResolve {
    alias: Record<string, string>;
    extensionAlias: Record<string, string[]>;
}
interface WebpackConfig {
    resolve: WebpackResolve;
}

const nextConfig: NextConfig = {
    output: 'export',
    distDir: 'out',
    assetPrefix: './',
    reactStrictMode: true,
    trailingSlash: true,
    images: { unoptimized: true },
    transpilePackages: ['@chimera/renderer'],
    webpack(rawConfig): WebpackConfig {
        const config = rawConfig as WebpackConfig;
        config.resolve ??= { alias: {}, extensionAlias: {} };
        config.resolve.alias = {
            ...config.resolve.alias,
            // The one knob binding the game-agnostic engine shell to THIS game.
            'chimera-game-registration': path.join(appRendererDir, 'register.ts'),
        };
        config.resolve.extensionAlias = {
            ...config.resolve.extensionAlias,
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
        };
        return config;
    },
};

export default nextConfig;
