/**
 * simulation/replay/InMemoryPerspectiveReplayRepository.ts
 *
 * In-memory PerspectiveReplayRepository implementation for unit tests and E2E
 * fixtures. Backed by a `Map`; no filesystem access (§4.28, ADR F44b,
 * invariant #41).
 *
 * Storage paths are synthetic, deterministic keys (a monotonic counter) so the
 * double needs neither `crypto.randomUUID` nor wall-clock reads — keeping
 * simulation/ free of non-deterministic globals.
 *
 * Architecture reference: §4.28 (ADR F44b)
 * Task: F44b / T3 (issue #669)
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — Passes the identical contract test suite as FilePerspectiveReplayRepository.
 */

import type { PerspectiveReplayFile } from './PerspectiveReplayFile.js';
import type { PerspectiveReplayRepository } from './PerspectiveReplayRepository.js';
import { ReplayNotFoundError } from './PerspectiveReplayRepository.js';

/**
 * In-memory test double for `PerspectiveReplayRepository`. Each `save()` assigns
 * a fresh synthetic path and never overwrites a prior entry, matching the
 * file-backed repository's UUID-per-replay behaviour.
 */
export class InMemoryPerspectiveReplayRepository implements PerspectiveReplayRepository {
    private readonly store = new Map<string, PerspectiveReplayFile>();
    private counter = 0;

    save(file: PerspectiveReplayFile): Promise<string> {
        const path = `mem://perspective-replays/${file.gameId}/${String(this.counter++)}.chimera-perspective-replay`;
        // Clone on store so a later mutation of the caller's object cannot reach
        // back into the repository, matching the file repo's serialize-to-bytes
        // copy semantics (invariant #41).
        this.store.set(path, structuredClone(file));
        return Promise.resolve(path);
    }

    load(filePath: string): Promise<PerspectiveReplayFile> {
        const file = this.store.get(filePath);
        if (file === undefined) {
            return Promise.reject(new ReplayNotFoundError(filePath));
        }
        // Clone on return so each load hands back an isolated copy, exactly as the
        // file repo's fresh deserialize does (invariant #41).
        return Promise.resolve(structuredClone(file));
    }

    list(gameId: string): Promise<string[]> {
        const matches = [...this.store.entries()].filter(([, file]) => file.gameId === gameId);

        matches.sort(([pathA, a], [pathB, b]) => {
            // Newest-first by recordedAt; stable tiebreak by path so equal
            // timestamps yield a deterministic order.
            if (a.recordedAt !== b.recordedAt) {
                return a.recordedAt < b.recordedAt ? 1 : -1;
            }
            return pathA < pathB ? 1 : -1;
        });

        return Promise.resolve(matches.map(([path]) => path));
    }

    delete(filePath: string): Promise<void> {
        if (!this.store.has(filePath)) {
            return Promise.reject(new ReplayNotFoundError(filePath));
        }
        this.store.delete(filePath);
        return Promise.resolve();
    }
}
