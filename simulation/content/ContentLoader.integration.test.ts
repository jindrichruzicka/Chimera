/**
 * simulation/content/ContentLoader.integration.test.ts
 *
 * End-to-end round-trip test for ContentLoader + ContentDatabase against the
 * real games/tactics/data/ directory (issue #103, §12 M1 checklist).
 *
 * Invariants upheld:
 *   #14 — content is loaded and validated before the tick loop starts.
 *   #15 — content files are pure JSON; no JS/TS in the data directory.
 *
 * IMPORTANT: this file must NOT import from games/tactics/ — the loader is
 * driven purely by a path string, keeping simulation/ free of games/* deps
 * (invariant #2). It therefore also does not apply the tactics colour schema;
 * it only asserts the generic load round-trips the on-disk JSON.
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { createContentLoader } from './ContentLoader';

// Resolve the data directory relative to the repo root so the test is
// location-independent when run from any working directory.
const TACTICS_DATA_DIR = path.resolve(__dirname, '../../games/tactics/data');

describe('ContentLoader — games/tactics/data/ round-trip (issue #103)', () => {
    it('loads player-colors from the tactics data directory', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const ids = [...db.getAllIds('player-colors')].sort();
        expect(ids).toEqual(['amber', 'blue', 'green', 'red']);
    });

    it('loads board-colors from the tactics data directory', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const ids = [...db.getAllIds('board-colors')].sort();
        expect(ids).toEqual(['navy', 'slate', 'stone']);
    });

    it('db.getByIdOrThrow returns the correct object for player-colour "blue"', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const blue = db.getByIdOrThrow('player-colors', 'blue');
        expect(blue).toMatchObject({ id: 'blue', name: 'Blue', hex: '#2563eb' });
    });

    it('db.getByIdOrThrow returns the correct object for board-colour "slate"', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const slate = db.getByIdOrThrow('board-colors', 'slate');
        expect(slate).toMatchObject({ id: 'slate', name: 'Slate', hex: '#3f3f46' });
    });

    it('db.has returns true for every loaded colour', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        expect(db.has('player-colors', 'blue')).toBe(true);
        expect(db.has('player-colors', 'amber')).toBe(true);
        expect(db.has('board-colors', 'navy')).toBe(true);
    });

    it('db.has returns false for a non-existent colour', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        expect(db.has('player-colors', 'teal')).toBe(false);
        expect(db.has('board-colors', 'crimson')).toBe(false);
    });
});
