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
        // `@chimera/simulation`, `@chimera/ai`, `@chimera/networking`, and
        // `@chimera/renderer` are intentionally NOT aliased: each is a built
        // package (issues #759, #764, #768, #773) and Next resolves it through its
        // `exports` map onto `<pkg>/dist` (build-before-consume; `build:renderer`
        // fronts `build:packages`, so `renderer/dist` exists before `next build`).
        // The renderer app's own internals import relatively. `@chimera/tactics`
        // lives under games/.
        config.resolve ??= { alias: {}, extensionAlias: {} };
        config.resolve.alias = {
            ...config.resolve.alias,
            '@chimera/electron': path.join(root, 'electron'),
            '@chimera/tactics': path.join(root, 'games/tactics'),
            // The renderer's own Next build is the single bundle where the
            // renderer source AND the mounted games are linked together. The
            // games reach shared renderer UI through the `@chimera/renderer`
            // package surface, which resolves via the `exports` map onto
            // `renderer/dist`. The renderer app's own internals, however, import
            // those same modules relatively from source. Letting the two halves
            // resolve to two physical copies (dist + source) duplicates every
            // module-level singleton they carry — the EscapeStack React context
            // (provider mounted from source, consumers pulled from dist) and the
            // chat/lobby/toast Zustand stores — so context identity breaks
            // (`useEscapeLayer() must be used within <EscapeStackProvider>`) and
            // game ChatPanels subscribe to a different store than the IPC bridge
            // writes to. Alias the public barrels back onto their source dirs so
            // this bundle holds exactly one instance of each shared module. The
            // `dist` build remains the typecheck/contract surface; `*.css`
            // subpaths stay on `dist` (stylesheet duplication is inert).
            '@chimera/renderer/components/ui': path.join(root, 'renderer/components/ui'),
            '@chimera/renderer/components/chat': path.join(root, 'renderer/components/chat'),
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
