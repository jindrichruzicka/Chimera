import type { NextConfig } from 'next';

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
};

export default nextConfig;
