/**
 * electron/main/replay/deterministicReplayPort.ts
 *
 * Builds the deterministic recording port for a hosted session — or `undefined`,
 * which disables deterministic recording AT THE SOURCE.
 *
 * A deterministic replay (`ReplayFile`) reconstructs the full global state from
 * seed + actions — every seat's hidden info (e.g. an opponent's whole deck in a
 * CCG). A packaged production build must therefore never record one: with no port
 * the host pipeline's `recordAction` is skipped and nothing is ever assembled, so
 * there is no file to leak (privacy — Invariants #71/#98). The second gate is
 * {@link DeterministicReplayGates.replayDeclared}.
 *
 * Extracted from the composition root as a pure function so each gate is
 * unit-testable in BOTH directions without driving the whole Electron entry.
 */

import type { ReplayManager } from './replay-manager.js';
import type { ReplayPort } from '../runtime/HostSessionPipeline.js';

/** The `ReplayManager` slice a deterministic `ReplayPort` delegates to. */
export type DeterministicRecorder = Pick<ReplayManager, 'startRecording' | 'recordAction'>;

/** The two independent reasons a hosted session records no deterministic replay. */
export interface DeterministicReplayGates {
    /** `app.isPackaged` — the sole trusted build signal for the privacy gate. */
    readonly isPackaged: boolean;
    /**
     * The hosted game's resolved `matchHistory.replay`. `false` ⇒ the game asked
     * for no match recording at all, in any build.
     */
    readonly replayDeclared: boolean;
}

/**
 * @param gates the two reasons to decline; either one closes the port.
 * @param recorder the deterministic `ReplayManager` to drive.
 * @returns a `ReplayPort` delegating to `recorder` when both gates are open, or
 *   `undefined` otherwise (deterministic recording disabled).
 */
export function createDeterministicReplayPort(
    gates: DeterministicReplayGates,
    recorder: DeterministicRecorder,
): ReplayPort | undefined {
    if (gates.isPackaged || !gates.replayDeclared) {
        return undefined;
    }
    return {
        startRecording: (header) => recorder.startRecording(header),
        recordAction: (entry) => recorder.recordAction(entry),
    };
}
