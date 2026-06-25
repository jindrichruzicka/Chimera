import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Post-build CSS copy for the @chimera/renderer dist build (issue #773; F65 Phase 2a).
 *
 * `tsc -p tsconfig.build.json` emits the shell JS + .d.ts but copies NO CSS — the
 * compiled `dist/.../Button.js` keeps its literal `import styles from
 * './Button.module.css'`. Since the package now ships the WHOLE Next shell from dist
 * (every route + component), this walks the ENTIRE renderer source tree for
 * `*.module.css` and copies each into dist/, preserving its path relative to the
 * renderer root, so those relative imports resolve and the consumer app's Next
 * bundler processes them. It also ships `styles/tokens.css` (the `--ch-*` design
 * tokens loaded at `:root`) and `styles/globals.css` (imported by the shell layout).
 */

/** Top-level dirs never scanned for module CSS (output / deps / generated). */
const SKIP_DIRS = new Set(['dist', 'node_modules', 'out', '.next']);

/** Individual CSS files shipped verbatim (loaded by the shell layout / at `:root`). */
const EXTRA_CSS_FILES = ['styles/tokens.css', 'styles/globals.css'] as const;

export interface CopyRendererCssOptions {
    /** Absolute path to the renderer package root. */
    readonly rendererRoot: string;
    /** Output directory (absolute); defaults to `<rendererRoot>/dist`. */
    readonly outDir?: string;
}

/**
 * Copy the renderer barrel CSS into the dist output. Returns the copied paths
 * relative to the output directory.
 */
export async function copyRendererCss(options: CopyRendererCssOptions): Promise<readonly string[]> {
    const { rendererRoot } = options;
    const outDir = options.outDir ?? path.join(rendererRoot, 'dist');
    const copied: string[] = [];

    const copyFile = async (relPath: string): Promise<void> => {
        const to = path.join(outDir, relPath);
        await mkdir(path.dirname(to), { recursive: true });
        await cp(path.join(rendererRoot, relPath), to);
        copied.push(relPath);
    };

    // Recursively collect every *.module.css under the renderer root (skipping the
    // build output + deps), preserving each file's path relative to the root.
    const moduleCss: string[] = [];
    const walk = async (relDir: string): Promise<void> => {
        const entries = await readdir(path.join(rendererRoot, relDir || '.'), {
            withFileTypes: true,
        });
        for (const entry of entries) {
            const rel = relDir ? path.join(relDir, entry.name) : entry.name;
            if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name)) await walk(rel);
            } else if (entry.isFile() && entry.name.endsWith('.module.css')) {
                moduleCss.push(rel);
            }
        }
    };
    await walk('');

    for (const rel of moduleCss.sort()) {
        await copyFile(rel);
    }

    for (const relFile of EXTRA_CSS_FILES) {
        await copyFile(relFile);
    }

    return copied;
}

// CLI entry: `tsx ../tools/copy-renderer-css.ts` (run from the renderer build script).
const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
    const rendererRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../renderer');
    void copyRendererCss({ rendererRoot });
}
