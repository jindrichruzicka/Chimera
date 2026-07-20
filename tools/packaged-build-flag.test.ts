// tools/packaged-build-flag.test.ts
//
// Drift ratchet for the packaged-build marker (Invariant #27, §4.12).
//
// `build:app` is the SAME script an everyday dev launch and a distributable
// build both run, so "this is a packaged build" cannot be inferred — every
// packaging script must DECLARE it with `CHIMERA_PACKAGED_BUILD=1`, which makes
// build-main bake the production define so the shipped bundle carries the
// literal `IS_DEBUG_MODE = false` and the debug bridge sits behind a
// permanently-dead gate.
//
// This does NOT tree-shake the debug module graph — that code still ships (the
// constant crosses a module boundary, so esbuild cannot drop the branch); see
// `computePackagedDefine` in the app's build-main.ts.
//
// A forgotten flag is invisible: the bundle keeps a LIVE debug gate, and only
// the startup guard stands between a shipped binary and the Inspector. These
// tests make that omission fail loudly instead.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { buildStandaloneRootManifest } from './create-chimera-game/standalone.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The marker, duplicated as a LITERAL rather than imported from
 * `apps/tactics/electron/build-main.ts` — matching the convention its sibling
 * `VERIFY_PACK_NODE_MODULES_ENV` documents ("duplicated as a literal (not
 * imported) to keep the app off the `tools/` import boundary; both sides assert
 * it in tests").
 *
 * The distinction is IMPORT boundary, not file access: this suite still READS
 * both build-main copies below to assert parity, which creates no module-graph
 * edge from `tools/` into an app. The parity block asserts both copies declare
 * exactly this value, so the duplication cannot drift.
 */
const PACKAGED_BUILD_ENV = 'CHIMERA_PACKAGED_BUILD';

const APP_BUILD_MAIN = path.join(ROOT, 'apps/tactics/electron/build-main.ts');
const TEMPLATE_BUILD_MAIN = path.join(
    ROOT,
    'tools/create-chimera-game/templates/blank/electron/build-main.ts',
);

const read = (file: string): string => readFileSync(file, 'utf8');

function rootScripts(): Record<string, string> {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json'))) as {
        scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
}

/** Scripts that bundle the Electron app (the only ones the marker is about). */
function scriptsRunningBuildApp(scripts: Record<string, string>): [string, string][] {
    return Object.entries(scripts).filter(([, command]) => command.includes('build:app'));
}

/**
 * True when the marker rides on the `build:app` SEGMENT specifically.
 *
 * Asserting on the whole script string is not enough: `cross-env` scopes an env
 * var to the ONE command it wraps, so a marker parked on the `next build`
 * segment (where `NEXT_PUBLIC_CHIMERA_PACKAGED` legitimately lives) never
 * reaches the app bundler — the script reads as flagged while the emitted
 * bundle keeps a live debug gate. Match the pairing, not the presence.
 *
 * The separator class covers every shell command separator, not just `&&`/`||`:
 * `;` and a newline end a command too, so omitting them would let
 * `cross-env FLAG=1 next build ; pnpm … build:app` pass.
 */
const setsFlag = (command: string): boolean =>
    new RegExp(`cross-env[^&|;\\n]*\\b${PACKAGED_BUILD_ENV}=1\\b[^&|;\\n]*\\bbuild:app\\b`).test(
        command,
    );

/** Marker present anywhere in the script, regardless of which segment. */
const mentionsFlag = (command: string): boolean => command.includes(`${PACKAGED_BUILD_ENV}=1`);

describe('packaged-build marker — monorepo root scripts', () => {
    it('has packaging scripts that bundle the app (guards the filter itself)', () => {
        // If this ever goes empty the assertions below become vacuous.
        const packaging = scriptsRunningBuildApp(rootScripts()).filter(([name]) =>
            name.startsWith('package:'),
        );
        expect(packaging.length).toBeGreaterThan(0);
    });

    it('every package:* script carries the marker ON the build:app segment', () => {
        const missing = scriptsRunningBuildApp(rootScripts())
            .filter(([name]) => name.startsWith('package:'))
            .filter(([, command]) => !setsFlag(command))
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('non-packaging scripts that bundle the app do NOT mention it (dev builds stay debug-capable)', () => {
        // dev:mp and friends share build:app; baking production there would kill
        // the F9 Inspector with no error message. Checked as a bare MENTION, not
        // a segment match — the marker has no business anywhere in a dev script.
        const leaked = scriptsRunningBuildApp(rootScripts())
            .filter(([name]) => !name.startsWith('package:'))
            .filter(([, command]) => mentionsFlag(command))
            .map(([name]) => name);

        expect(leaked).toEqual([]);
    });

    it('the segment matcher rejects a marker parked on the wrong command', () => {
        // Guards the guard: proves setsFlag is not satisfied by mere presence.
        const misplaced =
            'cross-env CHIMERA_PACKAGED_BUILD=1 NEXT_PUBLIC_CHIMERA_PACKAGED=1 next build apps/x/renderer && pnpm --filter @chimera-engine/x build:app';
        expect(mentionsFlag(misplaced)).toBe(true);
        expect(setsFlag(misplaced)).toBe(false);

        // `;` and newline end a command just as `&&` does.
        const semicolonSeparated =
            'cross-env CHIMERA_PACKAGED_BUILD=1 next build apps/x/renderer ; pnpm --filter @chimera-engine/x build:app';
        expect(setsFlag(semicolonSeparated)).toBe(false);
        const newlineSeparated =
            'cross-env CHIMERA_PACKAGED_BUILD=1 next build apps/x/renderer\npnpm --filter @chimera-engine/x build:app';
        expect(setsFlag(newlineSeparated)).toBe(false);

        const correct =
            'cross-env NEXT_PUBLIC_CHIMERA_PACKAGED=1 next build apps/x/renderer && cross-env CHIMERA_PACKAGED_BUILD=1 pnpm --filter @chimera-engine/x build:app';
        expect(setsFlag(correct)).toBe(true);
    });
});

describe('packaged-build marker — scaffolded standalone scripts', () => {
    const manifest = buildStandaloneRootManifest({
        name: 'my-game',
        toolchainDeps: { 'cross-env': '^7.0.3' },
        packageManager: 'pnpm@10.33.0',
        engines: { node: '>=20' },
    });
    const scripts = manifest.scripts;

    it('emits packaging scripts that bundle the app (guards the filter itself)', () => {
        const packaging = scriptsRunningBuildApp(scripts).filter(
            ([name]) => name === 'package' || name.startsWith('package:'),
        );
        expect(packaging.length).toBeGreaterThan(0);
    });

    it('every emitted packaging script declares the packaged-build marker', () => {
        const missing = scriptsRunningBuildApp(scripts)
            .filter(([name]) => name === 'package' || name.startsWith('package:'))
            .filter(([, command]) => !setsFlag(command))
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('the emitted dev:mp harness script does NOT mention it', () => {
        // Bare MENTION, symmetric with the root-scripts leak test: the marker has
        // no business anywhere in a dev script, including on a `next build`
        // segment that the segment matcher would happily ignore.
        const devMp = scripts['dev:mp'];
        expect(devMp).toBeDefined();
        expect(mentionsFlag(devMp ?? '')).toBe(false);
    });
});

describe('renderer packaged flag — both bundlers must be declared', () => {
    // A distributable has TWO bundlers and each reads its own flag, because
    // `cross-env` scopes a var to the one command it wraps:
    //   NEXT_PUBLIC_CHIMERA_PACKAGED → Next renderer build (gates dev-only routes)
    //   CHIMERA_PACKAGED_BUILD       → Electron app bundle (folds IS_DEBUG_MODE)
    // Declaring only one ships a half-production artifact, which is silent.
    const RENDERER_FLAG = 'NEXT_PUBLIC_CHIMERA_PACKAGED=1';

    it('root package:* scripts declare the renderer flag on the next build segment', () => {
        const missing = scriptsRunningBuildApp(rootScripts())
            .filter(([name]) => name.startsWith('package:'))
            .filter(
                ([, command]) => !new RegExp(`cross-env[^&|;\\n]*${RENDERER_FLAG}`).test(command),
            )
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('the scaffolded standalone packaging chain declares it too', () => {
        const manifest = buildStandaloneRootManifest({
            name: 'my-game',
            toolchainDeps: { 'cross-env': '^7.0.3' },
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20' },
        });
        const missing = scriptsRunningBuildApp(manifest.scripts)
            .filter(([name]) => name === 'package' || name.startsWith('package:'))
            .filter(([, command]) => !command.includes(RENDERER_FLAG))
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('the scaffolded WORKSPACE emitter declares it too', () => {
        const source = read(path.join(ROOT, 'tools/create-chimera-game/index.ts'));
        expect(source).toContain(`cross-env ${RENDERER_FLAG} next build apps/\${kebab}/renderer`);
    });
});

describe('packaged-build marker — scaffolded WORKSPACE script', () => {
    // The workspace-mode emitter (`wireRootPackageJson` in create-chimera-game)
    // is a private function that mutates a real root package.json, so it is
    // exercised end-to-end in create-chimera-game/index.test.ts. Ratchet the
    // marker on its SOURCE here so removing it cannot pass silently — without
    // this the workspace half of the emitter had no marker assertion at all.
    it('the CLI source emits the marker on the build:app segment', () => {
        const source = read(path.join(ROOT, 'tools/create-chimera-game/index.ts'));
        expect(source).toContain(
            `cross-env ${PACKAGED_BUILD_ENV}=1 pnpm --filter @chimera-engine/\${kebab} build:app`,
        );
    });
});

describe('build-main.ts app/template parity', () => {
    // The app's bundler is copied near-verbatim into the scaffolding template.
    // They differ ONLY in comments (the template names no game), so the CODE
    // must stay identical — a divergence would silently disarm the define for
    // every scaffolded game while this repo's own suite stayed green.
    const stripComments = (source: string): string =>
        source
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .map((line) => line.replace(/\s+$/, ''))
            .filter((line) => line.length > 0)
            .join('\n');

    it('both copies declare the same marker literal', () => {
        for (const file of [APP_BUILD_MAIN, TEMPLATE_BUILD_MAIN]) {
            expect(read(file)).toContain(`PACKAGED_BUILD_ENV = '${PACKAGED_BUILD_ENV}'`);
        }
    });

    it('both copies define BOTH IS_DEBUG_MODE reads', () => {
        // Defining only NODE_ENV leaves `process.env.CHIMERA_DEBUG === '1' && false`,
        // which esbuild cannot fold to a literal — so the gate would stay LIVE.
        for (const file of [APP_BUILD_MAIN, TEMPLATE_BUILD_MAIN]) {
            const source = read(file);
            expect(source).toContain(`'process.env.NODE_ENV': '"production"'`);
            expect(source).toContain(`'process.env.CHIMERA_DEBUG': '""'`);
        }
    });

    it('the two files are code-identical once comments are stripped', () => {
        expect(stripComments(read(TEMPLATE_BUILD_MAIN))).toBe(stripComments(read(APP_BUILD_MAIN)));
    });
});
