/**
 * electron/dev-tools/generate-icons/bin.test.ts
 *
 * Anti-rot guard for the `chimera-generate-icons` bin wiring. The shebang and
 * entry-gate rationale is `../validate-assets/bin.test.ts`'s, unchanged; the
 * canonicalisation argument is `../dev-harness/harness.ts`'s. Neither is
 * repeated here — each `it()` below names only what it reads and why that
 * particular thing can rot silently.
 *
 * The last four tests read or run the BUILT bin, and grade the artifact rather
 * than the source beside it. Two consequences, both stated because neither is
 * visible from the assertions:
 *
 *   - a MISSING build fails them, rather than skipping — a smoke test that
 *     quietly opts out of the one thing it proves is worse than none. `pnpm
 *     test` runs `build:packages` first, so the gate always has one;
 *   - a STALE build is not detected. Electron's own `test` script has no build
 *     step, so editing `index.ts` and running `pnpm --filter
 *     @chimera-engine/electron test` grades the previous build. Rebuild before
 *     trusting a green run of them. An mtime comparison was tried and
 *     removed: `tsc -b` skips the emit when content is unchanged, so any
 *     checkout or `touch` leaves `dist` "older" than a source it matches
 *     exactly, and the check reds on correct builds.
 */

import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_OUT_REL, DEFAULT_SOURCE_REL } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

/** Where electron's `tsc -p tsconfig.build.json` emits this directory. */
const BIN_TARGET = 'dist/dev-tools/generate-icons/index.js';
const builtBin = resolve(__dirname, '../..', BIN_TARGET);

/** A real square master, the one `pnpm icons:generate` reads by default. */
const masterPng = resolve(repoRoot, 'docs/assets/chimera-logo-compact.png');

const scratchDirs: string[] = [];

function scratch(prefix: string): string {
    const created = mkdtempSync(join(tmpdir(), prefix));
    scratchDirs.push(created);
    return created;
}

afterAll(() => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

interface ElectronManifest {
    bin?: Record<string, string>;
}

describe('chimera-generate-icons bin wiring (§4.32 dev-tooling, standalone-reachable)', () => {
    it('is declared as a bin of @chimera-engine/electron pointing at the emitted dist entry', () => {
        const manifest = JSON.parse(
            readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
        ) as ElectronManifest;
        expect(manifest.bin?.['chimera-generate-icons']).toBe(BIN_TARGET);
    });

    it('opens with the node shebang so the emitted bin is directly executable', () => {
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source.startsWith('#!/usr/bin/env node\n')).toBe(true);
    });

    it('takes its entry guard from the shared dev-harness module, never a local copy', () => {
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source).toMatch(
            /import \{[^}]*\bisDirectInvocation\b[^}]*\} from '\.\.\/dev-harness\/harness\.js';/u,
        );
        expect(source).not.toMatch(/\b(?:function|const|let|var|class)\s+isDirectInvocation\b/u);
    });

    it('runs the CLI on a passing guard, with import.meta.url and argv[1] in that order', () => {
        // The `\n` before `if` pins column 0 — relocating the block inside a
        // function nobody calls is the same silent no-op as breaking the guard.
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source).toMatch(
            /const invokedDirectly = isDirectInvocation\(import\.meta\.url, process\.argv\[1\]\);\n(?:[ \t]*(?:\/\/[^\n]*)?\n)*if \(invokedDirectly\) \{\n(?:[ \t]*(?:\/\/[^\n]*)?\n)*[ \t]+runGenerateIconsCli\(\)/u,
        );
    });

    it("exits with the CLI's own exit code, and non-zero when it throws", () => {
        // A `.then(() => process.exit(0))` would print the failure to stderr and
        // still report success — and the codec-absent path, the whole point of
        // the optional-peer contract, is a failure a caller must be able to
        // detect. No literal success code may appear anywhere in the file: the
        // only exit that means "clean" is the one the run itself computed.
        const source = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
        expect(source).toContain('.then((exitCode) => process.exit(exitCode))');
        expect(source).not.toMatch(/process\.exit\(\s*0\s*\)/u);
        expect(source).toContain('process.exit(1);');
    });

    it('emits the built bin with its shebang intact', () => {
        // tsc preserves a leading hashbang, but nothing in the toolchain
        // promises to — and the failure is invisible from source: the bin would
        // be published, resolve, and fail only on a shell that tried to exec it.
        expect(
            existsSync(builtBin),
            `${BIN_TARGET} is not built — run \`pnpm --filter @chimera-engine/electron build\``,
        ).toBe(true);
        expect(readFileSync(builtBin, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    });

    it('RUNS through a .bin-style symlink, the shape a bare path compare no-ops on', () => {
        // A plain `node <real dist path>` invocation cannot stand in: argv[1] and
        // the module URL match there, so a naive guard passes too and the bin
        // still writes its files. Only the symlink tells the two apart.
        const link = join(scratch('chimera-icons-bin-'), 'chimera-generate-icons');
        symlinkSync(builtBin, link);
        const outDir = scratch('chimera-icons-out-');

        // cwd is a scratch directory ON PURPOSE. Run from the repo root the
        // engine-relative DEFAULTS resolve to the committed master, so a build
        // that silently dropped the flags would still write eleven files and
        // this would pass on output it never asked for.
        execFileSync(process.execPath, [link, '--source', masterPng, '--out', outDir], {
            cwd: scratch('chimera-icons-cwd-'),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Asserting on the WRITTEN SET, not on stdout: a guard that no-ops exits
        // 0 with empty output, which reads as success to anything checking only
        // the exit code.
        expect(readdirSync(outDir).sort()).toContain('chimera.png');
        expect(readdirSync(outDir)).toHaveLength(11);
    });

    it('resolves its default paths against the CALLER cwd, not its own location', () => {
        // The property the whole cwd switch exists for, and the only test that
        // can observe it: `parseCliArgs` has taken a root parameter since the
        // relocation, so no in-process test can express where the CLI gets that
        // root from. Only a bare run of the BUILT bin — the copy that sits three
        // levels under the package root rather than under a repo root — can.
        //
        // A module-relative derivation resolves the default master under
        // `dist/dev-tools/generate-icons/`, so this run refuses and writes
        // nothing.
        const cwd = scratch('chimera-icons-root-');
        mkdirSync(join(cwd, 'docs', 'assets'), { recursive: true });
        copyFileSync(masterPng, join(cwd, DEFAULT_SOURCE_REL));

        execFileSync(process.execPath, [builtBin], {
            cwd,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        expect(readdirSync(join(cwd, DEFAULT_OUT_REL))).toHaveLength(11);
    });

    it('refuses, rather than half-running, when the default master is not there', () => {
        // The other half of the same property: a bare run in a directory that
        // has no master must exit non-zero and write nothing. Without this, a
        // default that resolved somewhere unexpected but REAL would look fine.
        const cwd = scratch('chimera-icons-bare-');

        const failure = (() => {
            try {
                execFileSync(process.execPath, [builtBin], {
                    cwd,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                return undefined;
            } catch (error: unknown) {
                return error as { status?: number; stderr?: string };
            }
        })();

        expect(failure?.status).toBe(1);
        expect(failure?.stderr).toContain(join(cwd, DEFAULT_SOURCE_REL));
        // The DELIBERATE refusal, not an ENOENT that happens to look like one:
        // `generateIcons` reads the master before the mkdir, so removing the
        // guard entirely still exits 1, still names the path (inside the ENOENT)
        // and still writes nothing. Only the advice line tells them apart.
        expect(failure?.stderr).toContain('Pass the square master PNG');
        expect(existsSync(join(cwd, DEFAULT_OUT_REL))).toBe(false);
    });
});
