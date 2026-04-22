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
 * (invariant #2).
 */

import path from 'path';
import { describe, expect, it } from 'vitest';
import { createContentLoader } from './ContentLoader';

// Resolve the data directory relative to the repo root so the test is
// location-independent when run from any working directory.
const TACTICS_DATA_DIR = path.resolve(__dirname, '../../games/tactics/data');

describe('ContentLoader — games/tactics/data/ round-trip (issue #103)', () => {
    it('loads damage-types from the tactics data directory', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        // Verify all three damage types are present.
        const ids = [...db.getAllIds('damage-types')].sort();
        expect(ids).toEqual(['cold', 'fire', 'physical']);
    });

    it('db.getByIdOrThrow returns the correct object for "fire"', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const fire = db.getByIdOrThrow('damage-types', 'fire');
        expect(fire).toMatchObject({ id: 'fire', name: 'Fire', bypassArmor: false });
    });

    it('db.getByIdOrThrow returns the correct object for "cold"', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const cold = db.getByIdOrThrow('damage-types', 'cold');
        expect(cold).toMatchObject({ id: 'cold', name: 'Cold', bypassArmor: false });
    });

    it('db.getByIdOrThrow returns the correct object for "physical"', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        const physical = db.getByIdOrThrow('damage-types', 'physical');
        expect(physical).toMatchObject({ id: 'physical', name: 'Physical' });
    });

    it('db.has returns true for every loaded damage type', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        expect(db.has('damage-types', 'fire')).toBe(true);
        expect(db.has('damage-types', 'cold')).toBe(true);
        expect(db.has('damage-types', 'physical')).toBe(true);
    });

    it('db.has returns false for a non-existent damage type', async () => {
        const loader = createContentLoader();
        const db = await loader.load([{ type: 'directory', path: TACTICS_DATA_DIR }]);

        expect(db.has('damage-types', 'lightning')).toBe(false);
    });
});
