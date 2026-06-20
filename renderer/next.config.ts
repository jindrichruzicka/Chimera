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
    // Electron loads renderer/out/index.html with file://, so absolute /_next
    // URLs resolve to the filesystem root and fail. Keep exported asset URLs
    // relative to the entry HTML file.
    assetPrefix: './',
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
        // Resolve the still-in-source @chimera/* workspace packages onto their
        // in-tree source dir for the Next build. F57 (#752) removed the root
        // tsconfig `paths` aliases, so these webpack aliases are the bundler's
        // @chimera/* resolver for the packages that have no `dist/` build yet.
        // `@chimera/simulation` and `@chimera/ai` are intentionally NOT aliased:
        // each is a built package (issues #759, #764) and Next resolves it through
        // its `exports` map onto `<pkg>/dist` (build-before-consume).
        // `@chimera/tactics` lives under games/.
        config.resolve ??= { alias: {}, extensionAlias: {} };
        config.resolve.alias = {
            ...config.resolve.alias,
            '@chimera/electron': path.join(root, 'electron'),
            '@chimera/networking': path.join(root, 'networking'),
            '@chimera/renderer': path.join(root, 'renderer'),
            '@chimera/tactics': path.join(root, 'games/tactics'),
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
