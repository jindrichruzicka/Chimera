/**
 * renderer/state/snapshotPacing.ts
 *
 * Whether authoritative snapshots are applied on the frame clock or on arrival.
 *
 * Deliberately NOT a Zustand store: nothing subscribes to this. Its only reader
 * is `bootstrapGameStore`'s scheduler, which asks imperatively whenever it requests a frame,
 * and no component renders anything from it — so a store would ship a selector
 * hook that only its own test could call.
 *
 * A module rather than a parameter because the two ends do not meet: the IPC
 * client is built once at app start, before any game is known, while the
 * declaration that decides this — `LoadedRendererGame.realtime` — arrives when
 * `/game` loads the active game.
 *
 * Architecture reference: §4.4 — Renderer State Stores
 */

let pacingEnabled = false;

/**
 * `/game` only. Publishes the active game's declaration on mount and clears it
 * on unmount — outside a match no game's declaration still applies.
 */
export function setSnapshotPacingEnabled(enabled: boolean): void {
    pacingEnabled = enabled;
}

/**
 * True while the active game declared `realtime`. False outside a match and for
 * a turn-based game, which is application on arrival — what every game got
 * before the pacing existed.
 */
export function snapshotPacingEnabled(): boolean {
    return pacingEnabled;
}
