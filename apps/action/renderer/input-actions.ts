// The action app's rebindable input actions (§4.26).
//
// It lives beside `loaders.ts` — the module that puts it on both payloads —
// because the SHELL payload is what carries it: the engine registers these at
// app boot, so Settings > Controls lists the arrow keys before any match has
// run and a rebind sticks. The match payload carries the SAME array, so the
// engine's second registration inside `GameShell` is an identity no-op.
//
// The IMPORT is the point: this file is the action app's adopter of the public
// `@chimera-engine/renderer/input` barrel (§4.26). The ids and their default
// keys are NOT authored here — they come from the app-root
// `input-action-ids.ts`, which `settings-schema.ts` also reads, so the table
// below and the default bindings cannot disagree about what an id is.
//
// `oneShot: true` on all four, and it is not the obvious choice. `oneShot` does
// NOT mean "fires only on press": both edges dispatch either way (`InputEvent`
// carries `pressed`, and the playfield reads it). What it governs is key
// REPEAT — with `false`, the OS auto-repeat while a key is held would deliver a
// press event several times a second and the playfield would re-derive the same
// velocity on each. One press, one release, is exactly what the held-set model
// wants.

import type { InputAction } from '@chimera-engine/renderer/input';

import {
    ACTION_MOVE_DOWN_ACTION,
    ACTION_MOVE_LEFT_ACTION,
    ACTION_MOVE_RIGHT_ACTION,
    ACTION_MOVE_UP_ACTION,
} from '../input-action-ids.js';

const MOVEMENT_CATEGORY = 'Movement';

export const ACTION_INPUT_ACTIONS: readonly InputAction[] = [
    {
        id: ACTION_MOVE_UP_ACTION,
        description: 'Move up',
        category: MOVEMENT_CATEGORY,
        oneShot: true,
    },
    {
        id: ACTION_MOVE_DOWN_ACTION,
        description: 'Move down',
        category: MOVEMENT_CATEGORY,
        oneShot: true,
    },
    {
        id: ACTION_MOVE_LEFT_ACTION,
        description: 'Move left',
        category: MOVEMENT_CATEGORY,
        oneShot: true,
    },
    {
        id: ACTION_MOVE_RIGHT_ACTION,
        description: 'Move right',
        category: MOVEMENT_CATEGORY,
        oneShot: true,
    },
];
