import type { NextConfig } from 'next';
import path from 'path';

// `next build renderer` runs from the workspace root; __dirname is renderer/.
const root = path.resolve(__dirname, '..');

/**
 * Minimal shape of the webpack config fields touched in the hook below.
 * `NextConfig.webpack` is typed as `any` by Next.js, so we narrow it here
 * instead of proliferating unsafe-any lint errors throughout the function.
 */
interface WebpackResolve {
    alias: Record<string, string>;
    extensionAlias: Record<string, string[]>;
}
interface WebpackConfig {
    resolve: WebpackResolve;
}

/**
 * Next.js configuration for the Chimera renderer.
 *
 * The Electron main process loads the compiled output via `loadFile` from
 * `renderer/out/index.html` (see `electron/main/index.ts` — issue #3).
 * Static export mode is mandatory: there is no Next.js server at runtime.
 */
const nextConfig: NextConfig = {
    output: 'export',
    distDir: 'out',
    reactStrictMode: true,
    // Static export cannot rewrite paths at runtime; emit a trailing slash so
    // that `file://` loads of nested routes resolve to `<route>/index.html`.
    trailingSlash: true,
    images: {
        // Next.js' image optimisation loader requires a server; disable it so
        // `next export` does not fail, and so that renderer asset resolution
        // goes exclusively through `AssetManager` (architecture §4.10).
        unoptimized: true,
    },
    webpack(rawConfig): WebpackConfig {
        const config = rawConfig as WebpackConfig;
        // Map workspace-level @chimera/* path aliases that are defined in the
        // root tsconfig.json but are NOT automatically inherited by the webpack
        // resolver when Next.js reads only renderer/tsconfig.json.
        config.resolve ??= { alias: {}, extensionAlias: {} };
        config.resolve.alias = {
            ...config.resolve.alias,
            '@chimera/electron': path.join(root, 'electron'),
            '@chimera/shared': path.join(root, 'shared'),
            '@chimera/simulation': path.join(root, 'simulation'),
            '@chimera/ai': path.join(root, 'ai'),
            '@chimera/networking': path.join(root, 'networking'),
            '@chimera/games': path.join(root, 'games'),
        };
        // Allow TypeScript-style `.js` extension imports (e.g. `./foo.js`)
        // to resolve to `.ts`/`.tsx` source files at build time.
        config.resolve.extensionAlias = {
            ...config.resolve.extensionAlias,
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
        };
        return config;
    },
};

export default nextConfig;
