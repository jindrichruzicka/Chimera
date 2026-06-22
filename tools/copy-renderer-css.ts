import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Post-build CSS copy for the @chimera/renderer dist build (issue #773).
 *
 * `tsc -p tsconfig.build.json` emits the barrel JS + .d.ts but copies NO CSS — the
 * compiled `dist/.../Button.js` keeps its literal `import styles from
 * './Button.module.css'`. This script copies every barrel `*.module.css` into dist/,
 * preserving each file's path relative to the renderer root, so those relative
 * imports resolve and the CONSUMER's own bundler (Next / Vite / webpack all support
 * CSS Modules) processes them. It also ships `styles/tokens.css` so consumers can
 * load the `--ch-*` design tokens the components reference at `:root`.
 */

/** Renderer component dirs whose `*.module.css` belong to the built barrels. */
const MODULE_CSS_DIRS = ['components/ui', 'components/chat'] as const;

/** Individual CSS files shipped verbatim (design tokens loaded at `:root`). */
const EXTRA_CSS_FILES = ['styles/tokens.css'] as const;

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

    for (const relDir of MODULE_CSS_DIRS) {
        const entries = await readdir(path.join(rendererRoot, relDir), { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.module.css')) {
                await copyFile(path.join(relDir, entry.name));
            }
        }
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
