/**
 * tools/verify-shared.ts
 *
 * Side-effect-free building blocks shared by the true-artifact verification gates
 * (`tools/verify-pack.ts`, `tools/verify-scaffold.ts`): the injected I/O surfaces,
 * the engine-package list + renderer peer set, and the two pure helpers that parse
 * `pnpm pack` output and read renderer peer ranges from the root `package.json`.
 *
 * This module has NO CLI entry and imports only node builtins (`node:path`,
 * `node:module`), so a gate can `import` it freely without triggering another gate's
 * run-on-import side effect (the gates' CLI entries fire on any non-VITEST import).
 * `verify-pack.ts` re-exports these so its existing test surface is unchanged.
 *
 * Invariant #2: lives in `tools/`; imports only node builtins — never a package/app.
 */

import path from 'node:path';
import { isBuiltin } from 'node:module';

// ── Injected I/O surfaces (kept narrow so unit tests need no real process / disk) ──

export interface RunResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface RunOptions {
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** Capture stdout (for parsing `pnpm pack` output) instead of inheriting the TTY. */
    readonly capture?: boolean;
}

/** Synchronous command runner (spawnSync-shaped); injected so tests spawn nothing. */
export type RunFn = (cmd: string, args: readonly string[], opts?: RunOptions) => RunResult;

/** Minimal async filesystem surface; injected so tests touch no real disk. */
export interface FsLike {
    mkdtemp(prefix: string): Promise<string>;
    mkdir(dir: string): Promise<void>;
    rm(dir: string): Promise<void>;
    writeFile(file: string, data: string): Promise<void>;
    readFile(file: string): Promise<string>;
    exists(p: string): Promise<boolean>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * The five engine packages, in inward dependency order (`simulation` is the
 * zero-dep leaf). A consumer/app exercises them, never a packed artifact, so a
 * consumer is deliberately absent.
 */
export const CHIMERA_PACKAGES = [
    { name: '@chimera/simulation', dir: 'simulation' },
    { name: '@chimera/ai', dir: 'ai' },
    { name: '@chimera/networking', dir: 'networking' },
    { name: '@chimera/renderer', dir: 'renderer' },
    { name: '@chimera/electron', dir: 'electron' },
] as const;

/**
 * Renderer `peerDependencies` a throwaway consumer must install so the packed
 * renderer surface resolves like a real consumer's (and the package manager does
 * not auto-pick mismatched majors). Versions come from the root package.json at
 * runtime.
 */
export const RENDERER_PEERS = [
    'next',
    'react',
    'react-dom',
    'three',
    '@react-three/fiber',
] as const;

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the tarball path from `pnpm pack` stdout. With `--pack-destination`,
 * pnpm prints the created tarball path; we take the last `.tgz` line (ignoring
 * any notices) and resolve a bare filename against the destination dir.
 */
export function parsePackTarballPath(stdout: string, destDir: string): string {
    const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const tgzLine = [...lines].reverse().find((line) => line.endsWith('.tgz'));
    if (tgzLine === undefined) {
        throw new Error('pack: could not find a *.tgz path in `pnpm pack` output');
    }
    return path.isAbsolute(tgzLine) ? tgzLine : path.join(destDir, tgzLine);
}

/**
 * Normalize a module specifier to its installable package name — strip any subpath,
 * preserve the scope for scoped packages:
 *   '@react-three/fiber'            -> '@react-three/fiber'
 *   '@chimera/simulation/engine/x'  -> '@chimera/simulation'
 *   'three/examples/jsm/x.js'       -> 'three'
 *   'next/image'                    -> 'next'
 *   'zod'                           -> 'zod'
 */
export function specifierToPackageName(specifier: string): string {
    if (specifier.startsWith('@')) {
        const parts = specifier.split('/');
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
    }
    return specifier.split('/')[0] ?? specifier;
}

/**
 * True for Node core builtins in every form a dist `.js` may reference them:
 * bare (`fs`), `node:`-prefixed (`node:fs`), and subpath (`fs/promises`).
 */
export function isNodeBuiltin(specifier: string): boolean {
    return isBuiltin(specifier);
}

/** Read the renderer peer ranges from the root package.json (devDeps + deps merged). */
export function readPeerVersions(rootPkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}): Record<string, string> {
    const merged: Record<string, string> = {
        ...(rootPkg.devDependencies ?? {}),
        ...(rootPkg.dependencies ?? {}),
    };
    const versions: Record<string, string> = {};
    for (const peer of RENDERER_PEERS) {
        const range = merged[peer];
        if (range !== undefined) versions[peer] = range;
    }
    return versions;
}
