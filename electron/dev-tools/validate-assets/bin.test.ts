/**
 * electron/dev-tools/validate-assets/bin.test.ts
 *
 * Anti-rot guard for the `chimera-validate-assets` bin wiring (chimera-dev-mp
 * precedent, §4.32): the published bin must point at the tsc-emitted dist
 * artifact of this directory's index.ts, and the source must open with the
 * `#!/usr/bin/env node` shebang so the emitted JS runs under plain node in a
 * standalone consumer. A leading hashbang is legal module syntax, so tsc emits
 * it unchanged, tsx and esbuild pass it through, and node ignores it under
 * every loader — the monorepo `validate:assets` script keeps working.
 *
 * `../dev-harness/harness.ts` documents why the guard has to canonicalise both
 * paths; that reasoning is not repeated here. Each `it()` below names what it
 * reads.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ElectronManifest {
    bin?: Record<string, string>;
}

describe('chimera-validate-assets bin wiring (Invariant #22/#52 gate, standalone-reachable)', () => {
    it('is declared as a bin of @chimera-engine/electron pointing at the emitted dist entry', () => {
        const manifest = JSON.parse(
            readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
        ) as ElectronManifest;
        expect(manifest.bin?.['chimera-validate-assets']).toBe(
            'dist/dev-tools/validate-assets/index.js',
        );
    });

    it('opens with the node shebang so the emitted bin is directly executable', () => {
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    });

    it('takes its entry guard from the shared dev-harness module, never a local copy', () => {
        // A local re-implementation compares the two paths raw; only the
        // shared one realpaths both sides, which is what a pnpm bin shim needs
        // (it execs node THROUGH the node_modules symlink while node reports
        // the realpathed module). The declaration scan covers every form a
        // re-implementation could take, not just `function`.
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source).toMatch(
            /import \{[^}]*\bisDirectInvocation\b[^}]*\} from '\.\.\/dev-harness\/harness\.js';/u,
        );
        expect(source).not.toMatch(/\b(?:function|const|let|var|class)\s+isDirectInvocation\b/u);
    });

    it('runs the CLI on a passing guard, with import.meta.url and argv[1] in that order', () => {
        // Both halves are load-bearing and both fail silently rather than
        // loudly. Swapping the arguments type-checks and lints clean, and
        // makes the guard false on EVERY invocation (argv[1] is not a
        // `file://` URL). Inverting the branch is the same no-op with the
        // sense flipped. Either way the bin exits 0 having written nothing.
        // The `\n` before `if` pins column 0: relocating the block inside a
        // function nobody calls is the same no-op again.
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source).toMatch(
            /const invokedDirectly = isDirectInvocation\(import\.meta\.url, process\.argv\[1\]\);\n(?:[ \t]*(?:\/\/[^\n]*)?\n)*if \(invokedDirectly\) \{\n(?:[ \t]*(?:\/\/[^\n]*)?\n)*[ \t]+runValidateAssetsCli\(\)/u,
        );
    });

    it("exits with the validator's own exit code, and non-zero when it throws", () => {
        // The one break in this entry that is NOT silent-but-harmless: CI runs
        // `pnpm validate:assets` as a gate step and reads nothing but the exit
        // code, so a `.then(() => process.exit(0))` still prints the failure
        // report to stderr while turning the build green on a broken tree —
        // the Invariant #22/#52 gate becomes decorative. No literal success
        // code may appear anywhere in the file: the only exit that means
        // "clean" is the one the report itself computed.
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source).toContain('.then((exitCode) => process.exit(exitCode))');
        expect(source).not.toMatch(/process\.exit\(\s*0\s*\)/u);
        expect(source).toContain('process.exit(1);');
    });
});
