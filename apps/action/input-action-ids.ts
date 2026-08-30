// The action app's movement input-action ids, their default arrow-key bindings
// and the arena step each one means.
//
// It sits at the APP ROOT rather than under `renderer/` because one of its three
// consumers may not reach the renderer at all: `settings-schema.ts` (default
// bindings) matches the `apps/*/settings-schema` entry in `eslint.config.mjs`'s
// ai/game zone, which forbids `@chimera-engine/renderer`. The other two —
// `renderer/input-actions.ts`, which builds the typed `InputAction` table from
// these ids, and the playfield, which subscribes to them — are free to. Declaring them here is what lets `input-action-ids.test.ts`
// hold properties no one of those three sites can hold alone — that the four
// ids are distinct, that no arrow key collides with an engine default, and that
// every id has both a binding and a direction.
//
// Deliberately import-free apart from one sibling TYPE, so the module is
// reachable from every zone that needs it.

import type { ActionVelocityComponent } from './simulation/action-types.js';

export const ACTION_MOVE_UP_ACTION = 'game:move-up';
export const ACTION_MOVE_DOWN_ACTION = 'game:move-down';
export const ACTION_MOVE_LEFT_ACTION = 'game:move-left';
export const ACTION_MOVE_RIGHT_ACTION = 'game:move-right';

/** Every movement action, in the order the Controls panel lists them. */
export const ACTION_MOVE_ACTION_IDS = [
    ACTION_MOVE_UP_ACTION,
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
] as const;

export type ActionMoveActionId = (typeof ACTION_MOVE_ACTION_IDS)[number];

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
 */
export const ACTION_MOVE_DIRECTIONS: Readonly<Record<ActionMoveActionId, ActionMoveDirection>> = {
    [ACTION_MOVE_UP_ACTION]: { dx: 0, dy: -1 },
    [ACTION_MOVE_DOWN_ACTION]: { dx: 0, dy: 1 },
    [ACTION_MOVE_LEFT_ACTION]: { dx: -1, dy: 0 },
    [ACTION_MOVE_RIGHT_ACTION]: { dx: 1, dy: 0 },
};

/**
 * Default key bindings, merged into the app's settings defaults. Arrow keys
 * take no engine binding (the engine defaults are Ctrl+Z, Escape, F3, F4, F9
 * and Tab), so a fresh install has no conflict for the rebind UI to report.
 */
export const ACTION_DEFAULT_MOVE_BINDINGS: Readonly<
    Record<ActionMoveActionId, { readonly primary: string }>
> = {
    [ACTION_MOVE_UP_ACTION]: { primary: 'ArrowUp' },
    [ACTION_MOVE_DOWN_ACTION]: { primary: 'ArrowDown' },
    [ACTION_MOVE_LEFT_ACTION]: { primary: 'ArrowLeft' },
    [ACTION_MOVE_RIGHT_ACTION]: { primary: 'ArrowRight' },
};
