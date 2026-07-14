/**
 * In-memory ReplayRepository implementation for unit tests and E2E fixtures.
 * Backed by a `Map`; no filesystem access (§4.28, Invariant #41).
 *
 * Storage paths are synthetic, deterministic keys (a monotonic counter) so the
 * double needs neither `crypto.randomUUID` nor wall-clock reads — keeping
 * simulation/ free of non-deterministic globals.
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — Passes the identical contract test suite as FileReplayRepository.
 */

import type { ReplayFile } from './ReplayFile.js';
import type { ReplayListingEntry, ReplayRepository } from './ReplayRepository.js';
import { ReplayNotFoundError } from './ReplayRepository.js';

/**
 * In-memory test double for `ReplayRepository`. Each `save()` assigns a fresh
 * synthetic path and never overwrites a prior entry, matching the file-backed
 * repository's UUID-per-replay behaviour.
 */
export class InMemoryReplayRepository implements ReplayRepository {
    private readonly store = new Map<string, ReplayFile>();
    private counter = 0;

    save(file: ReplayFile): Promise<string> {
        const path = `mem://replays/${file.gameId}/${String(this.counter++)}.chimera-replay`;
        this.store.set(path, file);
        return Promise.resolve(path);
    }

    load(filePath: string): Promise<ReplayFile> {
        const file = this.store.get(filePath);
        if (file === undefined) {
            return Promise.reject(new ReplayNotFoundError(filePath));
        }
        return Promise.resolve(file);
    }

    list(gameId: string): Promise<string[]> {
        return Promise.resolve(this.sortedMatches(gameId).map(([path]) => path));
    }

    listItems(gameId: string): Promise<ReplayListingEntry[]> {
        const items = this.sortedMatches(gameId).map(([path, file]) => ({
            path,
            engineVersion: file.engineVersion,
            gameId: file.gameId,
            gameVersion: file.gameVersion,
            recordedAt: file.metadata.recordedAt,
            durationTicks: file.metadata.durationTicks,
            playerIds: file.metadata.players.map((p) => p.playerId),
            // Project the user-entered name only when present, so an unnamed
            // replay yields no `name` key rather than `name: undefined`.
            ...(file.metadata.name !== undefined ? { name: file.metadata.name } : {}),
        }));
        return Promise.resolve(items);
    }

    /**
     * The stored `[path, file]` entries for `gameId`, newest-first by
     * `recordedAt` with a stable path tiebreak. Shared by `list` and
     * `listItems` so both surface identical ordering.
     */
    private sortedMatches(gameId: string): [string, ReplayFile][] {
        const matches = [...this.store.entries()].filter(([, file]) => file.gameId === gameId);

        matches.sort(([pathA, a], [pathB, b]) => {
            // Newest-first by recordedAt; stable tiebreak by path so equal
            // timestamps yield a deterministic order.
            if (a.metadata.recordedAt !== b.metadata.recordedAt) {
                return a.metadata.recordedAt < b.metadata.recordedAt ? 1 : -1;
            }
            return pathA < pathB ? 1 : -1;
        });

        return matches;
    }

    delete(filePath: string): Promise<void> {
        if (!this.store.has(filePath)) {
            return Promise.reject(new ReplayNotFoundError(filePath));
        }
        this.store.delete(filePath);
        return Promise.resolve();
    }
}
