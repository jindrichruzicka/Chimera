/**
 * electron/main/orphan-temp-reap.ts
 *
 * The sweep owed once a temp file name is per write (§8.4 of
 * the Electron/IPC coding standards). Nothing ever reopens a per-write temp
 * path, so a process killed between the write and the rename leaves a
 * full-size artefact that no later write truncates. `FileSaveRepository`,
 * `FileReplayRepository` and `FilePerspectiveReplayRepository` each run this
 * over their own root, and the crash reporter runs `sweepOrphanTempFilesIn()`
 * over its dump directory, once per app start, from the composition root.
 *
 * Each caller says which names are its temp files; this module decides
 * which of those are abandoned.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from './logging/logger.js';

/**
 * How old a temp artefact must be before `sweepOrphanTempFiles()` treats it as
 * abandoned.
 *
 * The sweep cannot ask whether an artefact belongs to a write in flight: the
 * app requests no single-instance lock, so a SECOND instance sharing this
 * `userData` may be writing one right now, and taking that file would leave
 * that write's rename nothing to move — it fails, and its caller's write is
 * rejected. So it decides on age.
 *
 * The window is set by what a wrong answer costs in each direction, not by
 * timing a write: reaping late costs disk the sweep gives back on the next
 * start, while reaping early costs the write in flight. Each calling
 * repository's `*.reap.test.ts` measures the property the window buys — a
 * write in flight survives a sweep that takes an aged artefact in the same
 * pass.
 *
 * It is a heuristic, not a proof. A writer suspended past the window — a
 * laptop asleep mid-write — has its artefact taken, and its rename then fails
 * the way any interrupted write's does.
 */
export const ORPHAN_TEMP_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Unlink every file under `<baseDir>/<dir>/` whose name `isTempName` accepts
 * and whose mtime is at least {@link ORPHAN_TEMP_MAX_AGE_MS} old.
 *
 * Below `baseDir` every filesystem call is best-effort: a name that is not a
 * directory (`.DS_Store` sits beside the game directories on macOS), a
 * directory that vanishes under the sweep, a file another reaper already took,
 * an unlink the OS refuses — each is skipped and left out of the count,
 * because the sweep's only job is to give back disk. A missing `baseDir` is
 * nothing to sweep.
 *
 * @returns how many artefacts were unlinked.
 */
export async function sweepOrphanTempFiles(
    baseDir: string,
    isTempName: (name: string) => boolean,
): Promise<number> {
    const gameDirs = await readdirOrNone(baseDir);

    // One cutoff for the whole sweep: a directory read late in the pass must
    // not use a later "now" than one read early, or the window would widen
    // as the sweep runs.
    const cutoff = Date.now() - ORPHAN_TEMP_MAX_AGE_MS;
    let reaped = 0;

    for (const gameDir of gameDirs) {
        const dir = path.join(baseDir, gameDir);
        // Reading a plain file as a directory throws ENOTDIR; the same catch
        // covers a directory removed between the two reads.
        const names = await fs.readdir(dir).catch((): string[] => []);
        reaped += await unlinkAgedTempFiles(dir, names, isTempName, cutoff);
    }

    return reaped;
}

/**
 * {@link sweepOrphanTempFiles} for a writer whose files sit directly in `dir`,
 * with no per-game directory between: unlink every file in `dir` whose name
 * `isTempName` accepts and whose mtime is at least
 * {@link ORPHAN_TEMP_MAX_AGE_MS} old.
 *
 * A missing `dir` is nothing to sweep, and any other failure to read it
 * rejects. Each file's stat and unlink is best-effort, as it is there.
 *
 * @returns how many artefacts were unlinked.
 */
export async function sweepOrphanTempFilesIn(
    dir: string,
    isTempName: (name: string) => boolean,
): Promise<number> {
    const names = await readdirOrNone(dir);
    return unlinkAgedTempFiles(dir, names, isTempName, Date.now() - ORPHAN_TEMP_MAX_AGE_MS);
}

/** `readdir`, reading a directory that does not exist as an empty one. */
function readdirOrNone(dir: string): Promise<string[]> {
    return fs.readdir(dir).catch((err: unknown): string[] => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    });
}

/**
 * Unlink each of `names` in `dir` that `isTempName` accepts and whose mtime is
 * at or before `cutoff`, skipping any file whose stat or unlink fails.
 */
async function unlinkAgedTempFiles(
    dir: string,
    names: readonly string[],
    isTempName: (name: string) => boolean,
    cutoff: number,
): Promise<number> {
    let reaped = 0;

    for (const name of names) {
        if (!isTempName(name)) continue;

        const filePath = path.join(dir, name);
        const stat = await fs.stat(filePath).catch(() => undefined);
        if (stat === undefined || stat.mtimeMs > cutoff) continue;

        const unlinked = await fs
            .unlink(filePath)
            .then(() => true)
            .catch(() => false);
        if (unlinked) reaped += 1;
    }

    return reaped;
}

/**
 * Log the outcome of a startup reap. The composition root starts
 * the reap and does not await it — nothing downstream depends on its result,
 * so making startup wait on the disk buys nothing — which is why this resolves
 * on a failed reap instead of rejecting: a rejection here would be an
 * unhandled one. `files` names what was reaped in the message.
 */
export async function logOrphanTempReap(
    reap: Promise<number>,
    logger: Logger,
    context: Readonly<{ module: string; files: string }>,
): Promise<void> {
    try {
        const reaped = await reap;
        if (reaped > 0) {
            logger.info(`reaped orphaned ${context.files} temp files`, {
                module: context.module,
                reaped,
            });
        }
    } catch (err: unknown) {
        logger.warn(`failed to reap orphaned ${context.files} temp files`, {
            module: context.module,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
