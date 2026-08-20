// electron/dev-tools/__test-support__/tempDir.test.ts

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTempDir } from './tempDir.js';

/** Captured by the first case so the second can read it after teardown. */
let probeDir = '';

describe('createTempDir', () => {
    it('creates a directory that exists during the test', async () => {
        probeDir = await createTempDir('chimera-temp-dir-probe');

        expect(existsSync(probeDir)).toBe(true);
    });

    it('removes the directory the previous test made', () => {
        // The removal runs in `onTestFinished`, so it cannot be observed inside
        // the test that registered it — this case reads the PREVIOUS one's
        // directory, which the teardown has already run for.
        // Without the split, a hook that did nothing would leave both green.
        //
        // The guard on `probeDir` is what keeps this case from passing when it
        // is run alone, where the empty initialiser would make `existsSync`
        // answer false for a directory nobody created.
        expect(probeDir).not.toBe('');
        expect(existsSync(probeDir)).toBe(false);
    });
});
