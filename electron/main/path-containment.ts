import * as path from 'node:path';

/**
 * Report whether `candidate` resolves to `baseDir` itself or a path nested
 * inside it. Both arguments are resolved to absolute paths first, so relative
 * inputs and `..` segments are normalised before comparison.
 *
 * The separator guard (`base + path.sep`) is load-bearing: without it a sibling
 * such as `<base>-evil` would pass the `startsWith` test even though it lives
 * outside `base`.
 *
 * Single source of truth for the replay path-traversal guard (OWASP A01). Both
 * the IPC layer (`registerReplayHandlers`, guarding `open-in-player`/`delete`)
 * and the persistence layer (`FileReplayRepository.assertInsideBase`, guarding
 * `load`/`delete`) call this so the two defence-in-depth checks cannot drift.
 */
export function isInsidePath(baseDir: string, candidate: string): boolean {
    const base = path.resolve(baseDir);
    const resolved = path.resolve(candidate);
    return resolved === base || resolved.startsWith(base + path.sep);
}
