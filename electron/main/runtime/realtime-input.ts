/**
 * electron/main/runtime/realtime-input.ts
 *
 * The envelope a host applies for a player action it received.
 *
 * `ActionPipeline.process()` refuses an envelope whose `tick` is not the
 * snapshot's (`StaleActionError`). On a turn-based host that refusal is right:
 * the clock moves only when someone acts, so a stale stamp means the sender
 * acted on a state that no longer exists. On a heartbeat-driven host the clock
 * moves on its own — the `RealtimeTicker` dispatches `engine:tick` at the
 * manifest's rate whether or not anyone acts — so the tick a renderer stamped
 * is behind by the time its envelope crosses IPC whenever that hop spans a
 * beat, and the same refusal drops the input. On a runner an order slower than
 * a developer machine the hop spans the beat, which is how the action app's
 * held-key e2e specs could pass locally and fail on CI.
 *
 * So a heartbeat-driven host applies a player action AT THE BEAT IT ARRIVES ON:
 * the envelope is re-stamped with the snapshot's own tick before `applyAction`.
 * Invariant #42 is untouched — the counter still advances by exactly one per
 * applied action — and the recorded envelope carries the tick it was applied
 * at, which is the one a replay reproduces.
 *
 * Pure: no clock, no I/O. Which kind of host this is comes from the caller,
 * read off the ticker the composition root built.
 *
 * Architecture reference: §4.2.1 — Rule 1 (Action-Driven Clock)
 */

import type { ActionEnvelope } from '@chimera-engine/simulation/engine/index.js';

export interface HostInputTimebase {
    /** Whether a `RealtimeTicker` is advancing this host's clock on its own. */
    readonly heartbeatDriven: boolean;
    /** `snapshot.tick` at the moment the envelope is applied. */
    readonly hostTick: number;
}

/**
 * The envelope to hand `applyAction` for `action`.
 *
 * On a heartbeat-driven host a stamp that is not `hostTick` — behind it or
 * ahead of it — is replaced with `hostTick`; every other field is the sender's,
 * verbatim, and the input is never mutated. On a turn-based host, and for a
 * stamp already at `hostTick`, the input reference is returned as is.
 */
export function restampForHeartbeatHost(
    action: ActionEnvelope,
    timebase: HostInputTimebase,
): ActionEnvelope {
    if (!timebase.heartbeatDriven || action.tick === timebase.hostTick) {
        return action;
    }
    return { ...action, tick: timebase.hostTick };
}
