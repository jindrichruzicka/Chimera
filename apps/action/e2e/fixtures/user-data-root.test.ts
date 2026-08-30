import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { E2E_USER_DATA_ROOT } from './user-data-root';

describe('action E2E_USER_DATA_ROOT', () => {
    it('lives under the OS temp dir', () => {
        expect(path.dirname(E2E_USER_DATA_ROOT)).toBe(os.tmpdir());
    });

    it('carries this game’s id, so the per-run reap cannot reach another suite’s profiles', () => {
        // `global-setup` removes this root WHOLESALE once per run. The tactics
        // suite reaps `chimera-e2e-userdata`; a root shared with it would have
        // each suite pulling profiles out from under the other's live apps
        // whenever both run on one machine.
        expect(path.basename(E2E_USER_DATA_ROOT)).toBe('chimera-e2e-userdata-action');
        expect(path.basename(E2E_USER_DATA_ROOT)).not.toBe('chimera-e2e-userdata');
    });
});
