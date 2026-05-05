import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '..');
const rootVitestConfigTestPattern = /^vitest\.config(?:\..*)?\.test\.tsx?$/u;

describe('Vitest config filenames', () => {
    it('keeps root-level Vitest config candidates from importing Vitest test APIs', () => {
        // @chimera-review: intentional filesystem access — structural guard test; mocking defeats the purpose
        const configLikeTestFiles = readdirSync(workspaceRoot)
            .filter((fileName) => rootVitestConfigTestPattern.test(fileName))
            .sort();

        expect(configLikeTestFiles).toEqual([]);
    });
});
