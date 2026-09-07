/**
 * simulation/debug/index.test.ts
 *
 * Pins the differ on the public `@chimera-engine/simulation/debug` subpath.
 *
 * The differ is declared in `../foundation/snapshot-diff.ts`; this barrel is
 * the path an adopter imports it through. Deleting the three re-exports breaks
 * that import, and this file is what fails on it.
 */

import { describe, it, expect } from 'vitest';
import * as debugBarrel from './index.js';
import { diffSnapshots } from '../foundation/snapshot-diff.js';
import type { DiffEntry, SnapshotDiff } from './index.js';

describe('the simulation/debug barrel', () => {
    it('re-exports the very function the contract leaf declares', () => {
        expect(debugBarrel.diffSnapshots).toBe(diffSnapshots);
    });

    it('re-exports the diff types — asserted by tsc, which is where a dropped type export fails', () => {
        const entry: DiffEntry = {
            path: 'entities.unit-1.hp',
            kind: 'changed',
            before: 10,
            after: 7,
        };
        const diff: SnapshotDiff = {
            fromTick: 1,
            toTick: 2,
            entries: [entry],
            summary: { added: 0, removed: 0, changed: 1 },
        };
        expect(diff.entries).toEqual([entry]);
    });
});
