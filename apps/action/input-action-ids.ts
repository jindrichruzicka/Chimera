// The action app's movement input-action ids, their default key bindings and
// the arena step each one means — for BOTH local seats.
//
// It sits at the APP ROOT rather than under `renderer/` because one of its
// consumers may not reach the renderer at all: `settings-schema.ts` (default
// bindings) matches the `apps/*/settings-schema` entry in `eslint.config.mjs`'s
// ai/game zone, which forbids `@chimera-engine/renderer`. The others —
// `renderer/input-actions.ts`, which builds the typed `InputAction` table from
// these ids, the playfield, which subscribes to them for each seat it drives,
// and the shell's `/select` page, which moves its two selection rings with the
// same keys before a match exists — are free to. Declaring them here is what
// lets `input-action-ids.test.ts` hold properties no one of those sites can
// hold alone: that the ids are distinct, that no default key collides with an
// engine default or with the other seat's, and that every id has both a binding
// and a direction.
//
// TWO SEATS, one table. The second cluster exists because a quick-started match
// may open a pass-and-play seat (`QuickStartConfig.localSeats`), and a seat
// nobody can move is not a seat. They are separate ACTIONS rather than one
// action read twice because a binding is per action: this is what puts both
// clusters in Settings > Controls and lets a player rebind either.
//
// Deliberately import-free apart from one sibling TYPE, so the module is
// reachable from every zone that needs it.

import type { ActionVelocityComponent } from './simulation/action-types.js';

export const ACTION_MOVE_UP_ACTION = 'game:move-up';
export const ACTION_MOVE_DOWN_ACTION = 'game:move-down';
export const ACTION_MOVE_LEFT_ACTION = 'game:move-left';
export const ACTION_MOVE_RIGHT_ACTION = 'game:move-right';

export const ACTION_P2_MOVE_UP_ACTION = 'game:p2-move-up';
export const ACTION_P2_MOVE_DOWN_ACTION = 'game:p2-move-down';
export const ACTION_P2_MOVE_LEFT_ACTION = 'game:p2-move-left';
export const ACTION_P2_MOVE_RIGHT_ACTION = 'game:p2-move-right';

/** Seat one's movement actions, in the order the Controls panel lists them. */
export const ACTION_MOVE_ACTION_IDS = [
    ACTION_MOVE_UP_ACTION,
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
] as const;

/** The pass-and-play seat's movement actions, in the same order. */
export const ACTION_P2_MOVE_ACTION_IDS = [
    ACTION_P2_MOVE_UP_ACTION,
    ACTION_P2_MOVE_DOWN_ACTION,
    ACTION_P2_MOVE_LEFT_ACTION,
    ACTION_P2_MOVE_RIGHT_ACTION,
] as const;

/** Both clusters, seat one first. */
export const ACTION_ALL_MOVE_ACTION_IDS = [
    ...ACTION_MOVE_ACTION_IDS,
    ...ACTION_P2_MOVE_ACTION_IDS,
] as const;

export type ActionMoveActionId = (typeof ACTION_ALL_MOVE_ACTION_IDS)[number];

/** The arena step one held movement key contributes. */
export interface ActionMoveDirection {
    readonly dx: ActionVelocityComponent;
    readonly dy: ActionVelocityComponent;
}

/**
 * Screen-space, not world-space: arena +y is DOWN the screen, so "up" is
 * `dy: -1`. Under the engine's `top-down` camera preset screen-up is world -Z,
 * and the playfield maps arena y straight onto world z. Neither half is asserted
 * here: `components/topDownOrientation.test.ts` measures the first against three
 * itself, and the second is `arenaToWorld`.
 *
 * The two seats share the directions exactly — a seat's keys differ, what a
 * direction MEANS does not.
 */
export const ACTION_MOVE_DIRECTIONS: Readonly<Record<ActionMoveActionId, ActionMoveDirection>> = {
    [ACTION_MOVE_UP_ACTION]: { dx: 0, dy: -1 },
    [ACTION_MOVE_DOWN_ACTION]: { dx: 0, dy: 1 },
    [ACTION_MOVE_LEFT_ACTION]: { dx: -1, dy: 0 },
    [ACTION_MOVE_RIGHT_ACTION]: { dx: 1, dy: 0 },
    [ACTION_P2_MOVE_UP_ACTION]: { dx: 0, dy: -1 },
    [ACTION_P2_MOVE_DOWN_ACTION]: { dx: 0, dy: 1 },
    [ACTION_P2_MOVE_LEFT_ACTION]: { dx: -1, dy: 0 },
    [ACTION_P2_MOVE_RIGHT_ACTION]: { dx: 1, dy: 0 },
};

/**
 * Default key bindings, merged into the app's settings defaults. Values are
 * `KeyboardEvent.code` spellings, as the engine's own defaults are.
 *
 * Arrows for seat one, WASD for the pass-and-play seat: two clusters far enough
 * apart on the keyboard that two people can share one. Neither takes an engine
 * binding (the engine defaults are Ctrl+Z, Escape, F3, F4, F9 and Tab), so a
 * fresh install has no conflict for the rebind UI to report.
 */
export const ACTION_DEFAULT_MOVE_BINDINGS: Readonly<
    Record<ActionMoveActionId, { readonly primary: string }>
> = {
    [ACTION_MOVE_UP_ACTION]: { primary: 'ArrowUp' },
    [ACTION_MOVE_DOWN_ACTION]: { primary: 'ArrowDown' },
    [ACTION_MOVE_LEFT_ACTION]: { primary: 'ArrowLeft' },
    [ACTION_MOVE_RIGHT_ACTION]: { primary: 'ArrowRight' },
    [ACTION_P2_MOVE_UP_ACTION]: { primary: 'KeyW' },
    [ACTION_P2_MOVE_DOWN_ACTION]: { primary: 'KeyS' },
    [ACTION_P2_MOVE_LEFT_ACTION]: { primary: 'KeyA' },
    [ACTION_P2_MOVE_RIGHT_ACTION]: { primary: 'KeyD' },
};
