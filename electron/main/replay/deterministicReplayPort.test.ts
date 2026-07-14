/**
 * electron/main/replay/deterministicReplayPort.test.ts
 *
 * Tests written first (RED before implementation). Pins the deterministic-replay
 * privacy gate in BOTH directions: a packaged build gets NO port (never recorded
 * — the privacy-critical direction, Invariants #71/#98); a dev/e2e build gets a
 * port that delegates to the recorder (the positive direction the whole
 * index.test.ts suite cannot cover because it hard-codes app.isPackaged === true).
 */

import { describe, expect, it, vi } from 'vitest';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import type { RecordedAction, ReplayHeader } from '@chimera-engine/simulation/replay/index.js';
import { createDeterministicReplayPort } from './deterministicReplayPort.js';

const HEADER: ReplayHeader = {
    engineVersion: '0.1.0',
    gameId: 'tactics',
    gameVersion: '0.1.0',
    gameConfig: {},
    seed: 1,
    recordedAt: '2026-07-14T00:00:00.000Z',
    players: [],
};

const ENTRY: RecordedAction = {
    tick: 0,
    playerId: toPlayerId('p1'),
    action: { type: 'engine:end_turn', playerId: toPlayerId('p1'), tick: 0, payload: {} },
};

describe('createDeterministicReplayPort', () => {
    it('returns undefined in a packaged build (deterministic recording disabled at the source)', () => {
        const recorder = { startRecording: vi.fn(), recordAction: vi.fn() };

        expect(createDeterministicReplayPort(true, recorder)).toBeUndefined();
        // With no port the recorder is never wired, so it cannot be driven.
        expect(recorder.startRecording).not.toHaveBeenCalled();
    });

    it('returns a port delegating to the recorder in a non-packaged (dev/e2e) build', () => {
        const recorder = { startRecording: vi.fn(), recordAction: vi.fn() };

        const port = createDeterministicReplayPort(false, recorder);

        expect(port).toBeDefined();
        port?.startRecording(HEADER);
        port?.recordAction(ENTRY);
        expect(recorder.startRecording).toHaveBeenCalledWith(HEADER);
        expect(recorder.recordAction).toHaveBeenCalledWith(ENTRY);
    });
});
