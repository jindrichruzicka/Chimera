import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createPreferTypeScriptSourceResolver } from './tools/vitest-resolver-plugin';

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
});
