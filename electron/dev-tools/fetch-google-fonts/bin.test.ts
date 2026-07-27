/**
 * electron/dev-tools/fetch-google-fonts/bin.test.ts
 *
 * Anti-rot guard for the `chimera-fetch-fonts` bin wiring (chimera-dev-mp
 * precedent, §4.32): the published bin must point at the tsc-emitted dist
 * artifact of this directory's index.ts, and the source must open with the
 * `#!/usr/bin/env node` shebang so the emitted JS runs under plain node in a
 * standalone consumer (tsc preserves shebangs; tsx strips them for the
 * monorepo `fetch:fonts` script).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ElectronManifest {
    bin?: Record<string, string>;
}

describe('chimera-fetch-fonts bin wiring (Invariant #97 tooling, standalone-reachable)', () => {
    it('is declared as a bin of @chimera-engine/electron pointing at the emitted dist entry', () => {
        const manifest = JSON.parse(
            readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
        ) as ElectronManifest;
        expect(manifest.bin?.['chimera-fetch-fonts']).toBe(
            'dist/dev-tools/fetch-google-fonts/index.js',
        );
    });

    it('opens with the node shebang so the emitted bin is directly executable', () => {
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    });

    it('names the bin and the monorepo form in the usage error', async () => {
        const { parseFetchGoogleFontsArgs } = await import('./index.js');
        expect(() => parseFetchGoogleFontsArgs([])).toThrow(/chimera-fetch-fonts/u);
        expect(() => parseFetchGoogleFontsArgs([])).toThrow(/pnpm fetch:fonts/u);
    });
});
