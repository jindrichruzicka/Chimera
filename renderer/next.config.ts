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
 * SUPERSEDED AS THE GAME HOST (F65 Phase 2c): each consumer app now owns its OWN
 * Next host (`apps/<game>/renderer/`) that re-exports the engine shell from
 * `@chimera-engine/renderer/shell/*` (the package now ships the whole shell from dist) and
 * binds its own game. `apps/tactics/renderer` is the production host the Electron
 * app loads; the e2e + verify:pack build that, not this config. This config is kept
 * only as a renderer-package-local dev preview of the shell (still bound to tactics
 * via the aliases below); nothing in the build/test pipeline runs `next build
 * renderer` anymore.
 *
 * The Electron main process loads the compiled output via `loadFile` from
 * `<app>/renderer/out/index.html` (see `electron/main/index.ts` — issue #3).
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
        // Resolve the still-in-source @chimera-engine/* workspace packages onto their
        // in-tree source dir for the Next build. F57 (#752) removed the root
        // tsconfig `paths` aliases, so these webpack aliases are the bundler's
        // @chimera-engine/* resolver for the packages that have no `dist/` build yet.
        // `@chimera-engine/simulation`, `@chimera-engine/ai`, `@chimera-engine/networking`,
        // `@chimera-engine/renderer`, and `@chimera-engine/electron` are intentionally NOT
        // aliased: each is a built package (issues #759, #764, #768, #773, #777)
        // and Next resolves it through its `exports` map onto `<pkg>/dist`
        // (build-before-consume; `build:renderer` fronts `build:packages`, so the
        // dist builds exist before `next build`). In particular the chat barrel's
        // `@chimera-engine/electron/preload/api-types` type import now resolves onto
        // electron/dist. The renderer app's own internals import relatively.
        // `@chimera-engine/tactics` lives under apps/tactics (relocated in F63 #782); its
        // dist/ is built but not yet consumed, so the renderer still aliases it onto
        // source — F64 flips this onto its exports map.
        config.resolve ??= { alias: {}, extensionAlias: {} };
        config.resolve.alias = {
            ...config.resolve.alias,
            '@chimera-engine/tactics': path.join(root, 'apps/tactics'),
            // The renderer's own Next build is the single bundle where the
            // renderer source AND the mounted games are linked together. The
            // games reach shared renderer UI through the `@chimera-engine/renderer`
            // package surface, which resolves via the `exports` map onto
            // `renderer/dist`. The renderer app's own internals, however, import
            // those same modules relatively from source. Letting the two halves
            // resolve to two physical copies (dist + source) duplicates every
            // module-level singleton they carry — the EscapeStack React context
            // (provider mounted from source, consumers pulled from dist), the
            // chat/lobby/toast Zustand stores, and the `@chimera-engine/renderer/game`
            // registration registry (apps/tactics registers into it, renderer
            // pages read from it) — so context identity breaks
            // (`useEscapeLayer() must be used within <EscapeStackProvider>`),
            // game ChatPanels subscribe to a different store than the IPC bridge
            // writes to, and `registerRendererGame` would populate a registry the
            // pages never see (silent UnknownRendererGameError). Alias these
            // shared module surfaces back onto their source dirs so this bundle
            // holds exactly one instance of each. The `dist` build remains the
            // typecheck/contract surface; `*.css` subpaths stay on `dist`
            // (stylesheet duplication is inert).
            '@chimera-engine/renderer/components/ui': path.join(root, 'renderer/components/ui'),
            '@chimera-engine/renderer/components/chat': path.join(root, 'renderer/components/chat'),
            '@chimera-engine/renderer/game': path.join(root, 'renderer/game/rendererGameRegistry'),
            // `renderer/**` source must name no game (#784). The renderer pulls in
            // the active game's renderer contribution through this synthetic,
            // build-selected specifier — the renderer twin of how `package.json`
            // `main` selects `apps/tactics/electron/main.ts` for the Electron host.
            // The alias is the one knob that binds the game-agnostic renderer
            // bundle to a concrete game; `apps/tactics/renderer/register.ts`'s
            // import side effect calls `registerRendererGame(...)`. The specifier
            // is deliberately NOT a `@chimera-engine/<pkg>` / `apps/*` / `games/*` token
            // (those are forbidden in renderer source by the boundary lint).
            'chimera-game-registration': path.join(root, 'apps/tactics/renderer/register.ts'),
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
