/**
 * renderer/input/index.ts
 *
 * Public input barrel (`@chimera-engine/renderer/input`).
 *
 * The reachability half of the rebindable-action seam (§4.26). A game could
 * already declare an action end to end — a default binding in its settings
 * schema, `InputAction` metadata on `LoadedRendererGameShell.inputActions`,
 * engine-side registration, display and rebind and persistence in
 * Settings > Controls, dispatch by `InputManager` — and then had nowhere to
 * receive the event, because a game surface reaches the shared renderer library
 * only through a public barrel (Invariant #96) and there was none for input.
 * The player rebound the key and
 * nothing happened. This barrel is that subpath.
 *
 * What it exports is the subscribing surface and nothing else: `useInputAction`
 * to run a callback when an action fires, `useInputManager` for the manager
 * itself, the provider those hooks read from, and the action/event types the
 * calls take. `InputManagerProvider` is here because a hook a game may call is only
 * half of what the game needs: its component tests have to mount something that
 * satisfies the hook, and without a provider the game would be forced back onto
 * the internal context object. The app root mounts the one live provider; a game
 * mounts its own only over a double.
 *
 * **The manager is consumed, never built or driven.** `createInputManager`, the
 * action registry, the key-binding repository and the binding/rebind types stay
 * internal, by rule rather than by list — what is not re-exported below is not
 * reachable. Exporting `useInputManager` does hand a game the manager object,
 * so every member of the `InputManager` interface is reachable and nothing
 * mechanical stops a game calling one. Which members a game is meant to touch
 * is prose, exactly as Invariant #64 is for `AudioManager.dispose()`; §4.26
 * "Reachability From a Game" is where that prose lives.
 *
 * **Dispatch fires on key DOWN and key UP.** A handler that should run once per
 * press must guard on the event: `if (!event.pressed) return;`.
 *
 * **A release also arrives on focus loss.** When the window blurs or the
 * document is hidden, every held action is dispatched with `pressed: false` and
 * the pressed set is emptied — the key-up for a key let go while the app was in
 * the background never reaches it. A game that turns a held key into a standing
 * order therefore stops on alt-tab rather than running on with nobody watching.
 *
 * **Held keys are polled, not subscribed.** `InputManager.isPressed(id)` is a
 * membership test that publishes no event, so there is no held-key hook here.
 * The supported recipe for a continuous action is to hold the manager and poll
 * it from the game's own frame loop:
 *
 *   const manager = useInputManager();
 *   useFrame(() => { if (manager.isPressed('game:move-left')) { ... } });
 *
 * (`useFrame` comes from `@react-three/fiber`, a renderer peer dependency, and
 * requires the calling component to be inside the game's `<GameCanvas>`.)
 *
 * Re-export only: importing this barrel mounts nothing, attaches no listener,
 * and — like `assets`, unlike `audio` — constructs no store.
 * `__tests__/input-barrel-side-effects.test.ts` pins the exact module graph and
 * the exported symbol set.
 */

export { useInputAction } from './useInputAction.js';
export { useInputManager } from './InputManagerContext.js';
export { InputManagerProvider, type InputManagerProviderProps } from './InputManagerProvider.js';

export type { InputAction, InputActionId, InputEvent } from './InputAction.js';
export type { InputManager } from './InputManager.js';
