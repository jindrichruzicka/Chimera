// __Game Title__'s rebindable input actions — the table the engine's Controls
// settings pane lists and a player rebinds.
//
// It lives beside `loaders.ts`, the module that puts it on both payloads,
// rather than in `screens/index.tsx`. The placement is the feature: the SHELL
// payload is what carries it, so the engine registers these at app boot — before
// a lobby, before a match — and the rebind pane lists them from the first launch
// instead of after a match has run. Read off the screen registry, the table
// would drag that module and its whole lazy-screen graph into the menu bundle.
//
// Plain data, and it has to stay that way: `loaders.ts` imports this file
// statically, and everything it imports statically is loaded on every screen the
// shell mounts.
//
// The same array reaches the match payload, so the engine's second registration
// inside the game shell is a no-op. Registering one id twice with a different
// description, category or `oneShot` throws rather than last-write-winning,
// which is why the two payloads share one value instead of restating it.
//
// `oneShot` governs key REPEAT, not which edge fires: both press and release are
// dispatched either way. Set it for an action a held key should not re-trigger
// several times a second.

import type { InputAction } from '@chimera-engine/renderer/input';

export const __GamePascal__INPUT_ACTIONS: readonly InputAction[] = [];
