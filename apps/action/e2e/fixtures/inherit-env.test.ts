import { describe, it, expect } from 'vitest';
import { inheritEnv } from './inherit-env';

/**
 * Both stripped keys get their own case.
 *
 * A fixture that tripped both at once would leave the drop-either-one mutant
 * alive, and the two failures look nothing alike: an inherited
 * `ELECTRON_RUN_AS_NODE` makes the Electron binary boot as plain Node and reject
 * Playwright's Chromium flags — every launch in the suite dies at `bad option`,
 * and only on a machine that exports it — while an inherited `CHIMERA_DEBUG`
 * launches a perfectly working app into the runtime debug layer.
 */
describe('inheritEnv', () => {
    it('strips ELECTRON_RUN_AS_NODE, so the launched Electron is not forced into Node mode', () => {
        expect(inheritEnv({ ELECTRON_RUN_AS_NODE: '1', KEEP: 'me' })).toEqual({ KEEP: 'me' });
    });

    it('strips CHIMERA_DEBUG, so an e2e launch never enters the runtime debug layer', () => {
        expect(inheritEnv({ CHIMERA_DEBUG: '1', KEEP: 'me' })).toEqual({ KEEP: 'me' });
    });

    it('drops a key whose value is undefined, rather than carrying it through', () => {
        // Asserted over the KEY SET. `toEqual` reads an own property holding
        // `undefined` and an absent one as the same object, so comparing the
        // result to `{ PRESENT: 'yes' }` passes whether the key was dropped or
        // not — and the drop is the whole of what this case is about.
        expect(Object.keys(inheritEnv({ PRESENT: 'yes', ABSENT: undefined }))).toEqual(['PRESENT']);
    });

    it('passes everything else through unchanged', () => {
        const source = { PATH: '/usr/bin', HOME: '/home/dev', CHIMERA_PORT: '7810' };

        expect(inheritEnv(source)).toEqual(source);
    });
});
