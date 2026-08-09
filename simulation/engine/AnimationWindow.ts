/**
 * simulation/engine/AnimationWindow.ts
 *
 * Host-only vocabulary for beat-owned gameplay windows — the simulation half of
 * an animation. A game authors a clip passage twice: once as clip-relative
 * positions the renderer plays, and once as the beat span the simulation opens
 * (`simulation/content/animationWindows.ts` verifies the two agree at content
 * load). This module declares what the opened span looks like while it lives on
 * `BaseGameSnapshot.animationWindows`.
 *
 * The registry is HOST-ONLY: `StateProjector.project()` uses an explicit field
 * allowlist and does not project it, so it never crosses a boundary
 * (Invariants #1/#3).
 *
 * This module is PURE TYPE DECLARATIONS only — zero runtime code. Nothing here
 * opens, decrements or closes a window.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 */

import type { EntityId } from '../foundation/engine-contract.js';
import type { FixedPoint } from './FixedPoint.js';

/**
 * Opaque identifier for one OPEN window instance.
 *
 * Distinct from the authoring-time `AnimationWindowName` in
 * `simulation/foundation/animation-clip-sheet.js`: several entities may hold
 * their own open instance of the same authored window at the same beat, so the
 * runtime id has to separate them. Must be deterministic — nothing in a
 * snapshot may come from a clock or an RNG the replay cannot reproduce.
 */
export type AnimationWindowId = string & { readonly __brand: 'AnimationWindowId' };

/**
 * Snapshot-resident payload a window carries for the beat sweep that reads it.
 *
 * Values are INTEGERS or {@link FixedPoint} only (Invariants #44/#75): this
 * object lives inside `GameSnapshot`, is serialised into saves and is replayed,
 * so a float would make two machines disagree. Renderer-side quantities —
 * seconds, phase, playback rate — belong to the clip, never here.
 */
export type AnimationWindowPayload = Readonly<Record<string, number | FixedPoint>>;

/** One open beat-owned gameplay window stored in `GameSnapshot.animationWindows`. */
export interface AnimationWindowRecord {
    readonly id: AnimationWindowId;
    /** The entity the window belongs to. */
    readonly ownerId: EntityId;
    /** Beats the window still has left. Always an integer (Invariants #42/#44). */
    readonly remainingBeats: number;
    /** Integer/`FixedPoint` state carried alongside the window while it is open. */
    readonly payload: AnimationWindowPayload;
}

/** All windows open at the current beat, keyed by window instance id. */
export type AnimationWindowRegistry = Record<AnimationWindowId, AnimationWindowRecord>;

/**
 * Why a window stopped being open.
 *
 * - `expired`     — the beat countdown reached its end; the ordinary close.
 * - `owner-gone`  — `ownerId` is no longer an entity in the snapshot.
 * - `replaced`    — the owner opened the same window id again.
 * - `interrupted` — game logic closed it early (a stagger, a cancel, a death).
 */
export type WindowCloseReason = 'expired' | 'owner-gone' | 'replaced' | 'interrupted';

/**
 * The report of one window that closed: what it was, and why.
 *
 * Carries no `remainingBeats` — a closed window has none left to report.
 */
export interface ClosedAnimationWindow {
    readonly id: AnimationWindowId;
    readonly ownerId: EntityId;
    readonly payload: AnimationWindowPayload;
    readonly reason: WindowCloseReason;
}
