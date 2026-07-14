/**
 * electron/main/replay/deterministicReplayPort.ts
 *
 * Builds the deterministic recording port for a hosted session — or `undefined`
 * in a packaged build, which disables deterministic recording AT THE SOURCE.
 *
 * A deterministic replay (`ReplayFile`) reconstructs the full global state from
 * seed + actions — every seat's hidden info (e.g. an opponent's whole deck in a
 * CCG). A packaged production build must therefore never record one: with no port
 * the host pipeline's `recordAction` is skipped and nothing is ever assembled, so
 * there is no file to leak (privacy — Invariants #71/#98). Dev/e2e builds record
 * the deterministic replay as a debug artifact (co-saved alongside the player's
 * own perspective — see `exportMatchReplays.ts`).
 *
 * Extracted from the composition root as a pure function so the privacy gate is
 * unit-testable in BOTH directions without driving the whole Electron entry.
 */

import type { ReplayManager } from './replay-manager.js';
import type { ReplayPort } from '../runtime/HostSessionPipeline.js';

/** The `ReplayManager` slice a deterministic `ReplayPort` delegates to. */
export type DeterministicRecorder = Pick<ReplayManager, 'startRecording' | 'recordAction'>;

/**
 * @param isPackaged `app.isPackaged` — the sole trusted build signal for the gate.
 * @param recorder the deterministic `ReplayManager` to drive.
 * @returns a `ReplayPort` delegating to `recorder` in a non-packaged (dev/e2e)
 *   build, or `undefined` in a packaged build (deterministic recording disabled).
 */
export function createDeterministicReplayPort(
    isPackaged: boolean,
    recorder: DeterministicRecorder,
): ReplayPort | undefined {
    if (isPackaged) {
        return undefined;
    }
    return {
        startRecording: (header) => recorder.startRecording(header),
        recordAction: (entry) => recorder.recordAction(entry),
    };
}
