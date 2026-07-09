import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyRendererCss } from './copy-renderer-css';

/**
 * `tsc` does not copy or transform CSS, so the @chimera-engine/renderer dist build (issue
 * #773) relies on this script to place every barrel `*.module.css` — plus the
 * design-token stylesheet — next to the compiled JS in dist/, preserving each
 * file's path relative to the renderer root. The tests drive a fixture renderer
 * tree (no real build) so they are fast and decoupled from the live component set.
 */
describe('copyRendererCss', () => {
    let rendererRoot: string;
    let outDir: string;

    beforeEach(async () => {
        rendererRoot = await mkdtemp(path.join(tmpdir(), 'chimera-renderer-css-'));
        outDir = path.join(rendererRoot, 'dist');
        await mkdir(path.join(rendererRoot, 'components', 'ui'), { recursive: true });
        await mkdir(path.join(rendererRoot, 'components', 'chat'), { recursive: true });
        await mkdir(path.join(rendererRoot, 'app', 'lobby'), { recursive: true });
        await mkdir(path.join(rendererRoot, 'styles'), { recursive: true });
        await mkdir(path.join(rendererRoot, 'dist'), { recursive: true });
        await writeFile(path.join(rendererRoot, 'components', 'ui', 'Button.module.css'), '.b{}');
        await writeFile(path.join(rendererRoot, 'components', 'ui', 'Button.tsx'), 'export {};');
        await writeFile(
            path.join(rendererRoot, 'components', 'chat', 'ChatPanel.module.css'),
            '.c{}',
        );
        // An app-route module.css proves the copy walks the WHOLE shell, not a fixed
        // dir list — the full Next shell ships from dist (F65 Phase 2a).
        await writeFile(path.join(rendererRoot, 'app', 'lobby', 'page.module.css'), '.l{}');
        // A pre-existing dist module.css must NOT be re-copied onto itself.
        await writeFile(path.join(rendererRoot, 'dist', 'stale.module.css'), '.stale{}');
        await writeFile(path.join(rendererRoot, 'styles', 'tokens.css'), ':root{}');
        await writeFile(path.join(rendererRoot, 'styles', 'globals.css'), 'body{}');
        await writeFile(path.join(rendererRoot, 'styles', 'animations.css'), '@keyframes k{}');
    });

    afterEach(async () => {
        await rm(rendererRoot, { recursive: true, force: true });
    });

    const exists = async (relativeToDist: string): Promise<boolean> => {
        try {
            await access(path.join(outDir, relativeToDist));
            return true;
        } catch {
            return false;
        }
    };

    it('copies every *.module.css across the whole shell, preserving its relative path', async () => {
        await copyRendererCss({ rendererRoot });
        expect(await exists(path.join('components', 'ui', 'Button.module.css'))).toBe(true);
        expect(await exists(path.join('components', 'chat', 'ChatPanel.module.css'))).toBe(true);
        expect(await exists(path.join('app', 'lobby', 'page.module.css'))).toBe(true);
    });

    it('ships the design-token AND global stylesheets the shell layout imports', async () => {
        await copyRendererCss({ rendererRoot });
        expect(await exists(path.join('styles', 'tokens.css'))).toBe(true);
        expect(await exists(path.join('styles', 'globals.css'))).toBe(true);
        expect(await exists(path.join('styles', 'animations.css'))).toBe(true);
    });

    it('does not copy non-css sources or re-scan the dist output dir', async () => {
        const copied = await copyRendererCss({ rendererRoot });
        expect(await exists(path.join('components', 'ui', 'Button.tsx'))).toBe(false);
        // dist/ is the OUTPUT — its own module.css must not be discovered + recopied.
        expect(copied).not.toContain('stale.module.css');
        expect(copied).not.toContain(path.join('dist', 'stale.module.css'));
    });

    it('returns the copied files relative to the output dir', async () => {
        const copied = await copyRendererCss({ rendererRoot });
        expect([...copied].sort()).toEqual(
            [
                path.join('app', 'lobby', 'page.module.css'),
                path.join('components', 'chat', 'ChatPanel.module.css'),
                path.join('components', 'ui', 'Button.module.css'),
                path.join('styles', 'animations.css'),
                path.join('styles', 'globals.css'),
                path.join('styles', 'tokens.css'),
            ].sort(),
        );
    });

    it('honours a custom output directory', async () => {
        const customOut = path.join(rendererRoot, 'custom-dist');
        await copyRendererCss({ rendererRoot, outDir: customOut });
        await expect(access(path.join(customOut, 'styles', 'tokens.css'))).resolves.toBeUndefined();
    });
});
