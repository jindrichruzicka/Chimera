import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createPreferTypeScriptSourceResolver } from './vitest-resolver-plugin';

describe('createPreferTypeScriptSourceResolver plugin', () => {
    it('should cache positive entries (file exists) and re-validate on subsequent requests', () => {
        const existsSyncMock = vi.fn().mockReturnValue(true);
        const workspaceRoot = '/workspace';
        const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, existsSyncMock);

        const importer = path.join(workspaceRoot, 'src/index.js');
        const source = './existing.js';

        // First call: file exists
        let result = plugin.resolveId(source, importer);
        expect(result).toBeTruthy();
        expect(result?.endsWith('.ts')).toBe(true);
        expect(existsSyncMock).toHaveBeenCalledTimes(1);

        // Second call: file still exists, should re-validate
        result = plugin.resolveId(source, importer);
        expect(result).toBeTruthy();
        expect(existsSyncMock).toHaveBeenCalledTimes(2); // Re-validated, not just from cache
    });

    it('should invalidate positive cache entries when file is deleted (watch mode)', () => {
        const existsSyncMock = vi.fn();
        const workspaceRoot = '/workspace';
        const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, existsSyncMock);

        const importer = path.join(workspaceRoot, 'src/index.js');
        const source = './deleted.js';

        // First call: file exists (positive cache)
        existsSyncMock.mockReturnValueOnce(true);
        let result = plugin.resolveId(source, importer);
        expect(result).toBeTruthy();
        expect(existsSyncMock).toHaveBeenCalledTimes(1);

        // Simulate file deletion during watch mode
        existsSyncMock.mockReturnValueOnce(false);

        // Second call: file was deleted, should invalidate cache and return null
        result = plugin.resolveId(source, importer);
        expect(result).toBeNull();
        expect(existsSyncMock).toHaveBeenCalledTimes(2); // Re-checked
    });

    it('should invalidate negative cache entries when file is created (watch mode)', () => {
        const existsSyncMock = vi.fn();
        const workspaceRoot = '/workspace';
        const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, existsSyncMock);

        const importer = path.join(workspaceRoot, 'src/index.js');
        const source = './created.js';

        // First call: file doesn't exist (negative cache)
        existsSyncMock.mockReturnValueOnce(false);
        let result = plugin.resolveId(source, importer);
        expect(result).toBeNull();
        expect(existsSyncMock).toHaveBeenCalledTimes(1);

        // Simulate file creation during watch mode
        existsSyncMock.mockReturnValueOnce(true);

        // Second call: file now exists, should invalidate cache and return the path
        result = plugin.resolveId(source, importer);
        expect(result).toBeTruthy();
        expect(result?.endsWith('.ts')).toBe(true);
        expect(existsSyncMock).toHaveBeenCalledTimes(2); // Re-checked (this PASSES now!)
    });

    // ── @chimera/* workspace-package resolution ──────────────────────────────
    // After F57 removes the tsconfig `paths` aliases, this plugin (not
    // vite-tsconfig-paths) maps bare `@chimera/<pkg>` specifiers onto their
    // TypeScript source dir, preferring `.ts`/`.tsx` over the imported `.js`.
    describe('@chimera/* package specifiers', () => {
        const workspaceRoot = '/workspace';

        it('maps a @chimera/<engine-pkg>/sub.js import to the .ts source', () => {
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, () => true);
            const result = plugin.resolveId(
                '@chimera/ai/engine/AgentManager.js',
                path.join(workspaceRoot, 'networking/provider/x.ts'),
            );
            expect(result).toBe(path.join(workspaceRoot, 'ai/engine/AgentManager.ts'));
        });

        it('returns null for @chimera/simulation — a built package resolved via its exports map, not this plugin', () => {
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, () => true);
            expect(
                plugin.resolveId(
                    '@chimera/simulation/engine/types.js',
                    path.join(workspaceRoot, 'ai/policy.ts'),
                ),
            ).toBeNull();
        });

        it('maps the @chimera/tactics game package onto games/tactics/', () => {
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, () => true);
            const result = plugin.resolveId(
                '@chimera/tactics/screens/index.js',
                path.join(workspaceRoot, 'renderer/app/game/page.tsx'),
            );
            expect(result).toBe(path.join(workspaceRoot, 'games/tactics/screens/index.ts'));
        });

        it('falls back to .tsx when no .ts source exists', () => {
            const existsSyncMock = vi.fn((p: string) => p.endsWith('.tsx'));
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, existsSyncMock);
            const result = plugin.resolveId(
                '@chimera/tactics/screens/TacticsGameHud.js',
                path.join(workspaceRoot, 'electron/main/index.ts'),
            );
            expect(result).toBe(
                path.join(workspaceRoot, 'games/tactics/screens/TacticsGameHud.tsx'),
            );
        });

        it('resolves an extensionless subpath via its index file', () => {
            const existsSyncMock = vi.fn((p: string) => p.endsWith(path.join('ui', 'index.ts')));
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, existsSyncMock);
            const result = plugin.resolveId(
                '@chimera/renderer/components/ui',
                path.join(workspaceRoot, 'games/tactics/screens/Foo.tsx'),
            );
            expect(result).toBe(path.join(workspaceRoot, 'renderer/components/ui/index.ts'));
        });

        it('resolves a non-TS asset (.css) to the literal mapped path', () => {
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, () => true);
            const result = plugin.resolveId(
                '@chimera/tactics/styles/tokens-override.css',
                path.join(workspaceRoot, 'renderer/game/rendererGameRegistry.ts'),
            );
            expect(result).toBe(
                path.join(workspaceRoot, 'games/tactics/styles/tokens-override.css'),
            );
        });

        it('returns null for an unknown @chimera/* package', () => {
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, () => true);
            expect(
                plugin.resolveId('@chimera/nonexistent/x.js', path.join(workspaceRoot, 'a.ts')),
            ).toBeNull();
        });

        it('returns null when no source candidate exists on disk', () => {
            const plugin = createPreferTypeScriptSourceResolver(workspaceRoot, () => false);
            expect(
                plugin.resolveId('@chimera/ai/engine/types.js', path.join(workspaceRoot, 'a.ts')),
            ).toBeNull();
        });
    });
});
