/**
 * renderer/state/snapshotPacing.test.ts
 *
 * The module the IPC client's scheduler asks whenever it requests a frame.
 *
 * Architecture reference: §4.4 — Renderer State Stores
 */

import { afterEach, describe, expect, it } from 'vitest';
import { setSnapshotPacingEnabled, snapshotPacingEnabled } from './snapshotPacing.js';

afterEach(() => {
    setSnapshotPacingEnabled(false);
});

describe('snapshotPacing', () => {
    it('reads false before anything declares otherwise', () => {
        // Outside a match there is no game whose declaration could apply, and
        // false is application on arrival — what every game got before the
        // pacing existed.
        expect(snapshotPacingEnabled()).toBe(false);
    });

    it('reports what was last published', () => {
        setSnapshotPacingEnabled(true);

        expect(snapshotPacingEnabled()).toBe(true);
    });

    it('goes back to false when the publisher clears it', () => {
        // `/game` clears on unmount. A value left standing would pace the next
        // match against a declaration the game leaving made.
        setSnapshotPacingEnabled(true);

        setSnapshotPacingEnabled(false);

        expect(snapshotPacingEnabled()).toBe(false);
    });
});
