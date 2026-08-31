---
title: 'Input & Keybindings'
description: 'InputActionId (engine:/game: namespaces), InputAction interface, KeyBinding, GameBindingSchema<T>, InputManager (start/stop/onAction/rebind), RebindResult, useInputAction hook, conflict detection, and settings integration.'
tags: [input, keybindings, keyboard, gamepad, renderer, settings]
---

# Input & Keybindings

> §4.26 of the Chimera architecture.
> Related: [Settings System](settings-system.md) · [Simulation Core](simulation-core-action-pipeline.md)

---

## Overview

Centralise keyboard and gamepad input behind named `InputAction`s. Decouple response code from physical keys. Let players rebind **game** action keys through the settings UI; engine-reserved actions (`engine:*`) are hidden from the rebind UI and configurable only by the game creator through the settings defaults/config layers. Mirrors the Command pattern from §4.7 but for client-local input rather than authoritative game actions.

---

## Core Types

```typescript
// renderer/input/InputAction.ts

/** 'engine:undo' | 'engine:redo' | 'engine:toggle-menu' | 'game:end-turn' | ... */
export type InputActionId = `engine:${string}` | `game:${string}`;

export interface InputAction {
    readonly id: InputActionId;
    readonly description: string; // Shown in rebind UI (game actions only; engine:* hidden)
    readonly category: string; // Groups related actions ("Movement", "UI", …)
    readonly oneShot: boolean; // true = fire on press; false = held
}
```

---

## KeyBinding

````typescript
// renderer/input/InputBindingSchema.ts

export interface KeyBinding {
    readonly primary: string; // KeyboardEvent.code or gamepad button id
    readonly secondary?: string;
    readonly modifiers?: ReadonlyArray<'Ctrl' | 'Shift' | 'Alt' | 'Meta'>;
}

export type EngineBindings = Record<InputActionId, KeyBinding>;

/**
 * Type-safe game binding schema constraint. Accepts a record of KeyBindings
 * keyed by InputActionIds and ensures all keys conform to InputActionId.
 * Evaluates to `never` if the record contains any key outside the InputActionId union.
 *
 * @example
 * ```ts
 * type GameBindings = GameBindingSchema<{
 *     'engine:undo': KeyBinding;
 *     'game:end-turn': KeyBinding;
 * }>;
 * ```
 */
export type GameBindingSchema<T> = T extends { readonly [K in keyof T]: KeyBinding }
    ? Exclude<keyof T, InputActionId> extends never
        ? T
        : never
    : never;
````

### Engine Default Bindings

| Action                          | Default key  |
| ------------------------------- | ------------ |
| `engine:undo`                   | Ctrl+Z       |
| `engine:redo`                   | Ctrl+Shift+Z |
| `engine:toggle-menu`            | Escape       |
| `engine:toggle-perf-hud`        | F3           |
| `engine:toggle-debug-inspector` | F9           |

`engine:toggle-debug-inspector` toggles the Debug Inspector window (§4.12 — Runtime Debug Layer); in production builds the underlying IPC send is a no-op.

---

## InputManager

```typescript
// renderer/input/InputManager.ts

export interface InputManager {
    start(): void; // Attaches window/document listeners (called once on app mount)
    stop(): void;

    onAction(id: InputActionId, cb: (event: InputEvent) => void): Unsubscribe;
    setActiveCategory(category: string | null): void; // null = all categories
    isPressed(id: InputActionId): boolean; // For continuous held-key detection

    /** Rebind at runtime. Persists via KeyBindingRepository.save(). */
    rebind(id: InputActionId, binding: KeyBinding): Promise<RebindResult>;

    /**
     * Execute one gamepad poll cycle. Called automatically via requestAnimationFrame
     * when running in the browser; exposed for deterministic testing.
     */
    pollGamepad(): void;
}

export function createInputManager(
    registry: InputActionRegistry,
    bindings: KeyBindingRepository,
): InputManager;

export type RebindResult =
    | { ok: true }
    | { ok: false; reason: 'conflict'; conflictingAction: InputActionId }
    | { ok: false; reason: 'persist_failed' };
```

---

## Settings Integration

Key bindings are stored in `settings.controls.bindings: GameBindingSchema<EngineBindings>`. The rebind UI reads from and writes to `settingsStore`. `KeyBindingRepository` is implemented as a dedicated thin wrapper module over the `settings.controls` namespace. The Controls panel filters out `engine:*` actions before rendering, so players only see and edit game actions; engine bindings still load, dispatch, and persist through the same settings layers. Category captions render only when the visible actions span more than one category.

---

## Conflict Detection

`InputManager.rebind()` rejects bindings that collide with an existing one in the same category (same key + modifier + category scope). Cross-category duplicates are allowed, but dispatch uses explicit category routing: call `setActiveCategory(...)` to resolve which category receives a combo when duplicates exist. When no active category is set and a combo matches multiple categories, no action is dispatched because the combo is ambiguous. The UI offers "unbind existing action" as a resolution. Engine-reserved bindings (`engine:*`) are not exposed in the rebind UI; they remain configurable through the settings defaults/config layers and may be rebound programmatically but not removed.

---

## Lifecycle Ownership

`InputManager` is instantiated by `renderer/app/providers.tsx` on app mount and exposed via context. `providers.tsx` calls `start()` once in a `useEffect` with no dependencies, and `stop()` in the cleanup. No other component calls `start()`/`stop()`.

---

## Action Registration

`providers.tsx` seeds the `InputActionRegistry` with the engine's own actions when it builds it. A game's actions enter through its renderer-registry payloads, and they enter **at app boot**: `renderer/app/InputActionsBootstrap.tsx` resolves the active shell game through `useActiveShellGameId`, loads that game's **shell** payload, and registers `LoadedRendererGameShell.inputActions`. `GameShell` then re-registers the same table from `LoadedRendererGame.inputActions` when a match mounts.

Three consequences, and they are the point of registering this early:

- A shell surface — a live background, a game-owned page — can subscribe with `useInputAction` on a route that resolves a game context and be dispatched to before any match has run.
- Settings > Controls lists the game's actions with no match ever started (`renderer/app/settings/page.test.tsx`, "lists a game action registered after the pane already rendered").
- `GameShell`'s registration is normally a no-op, because every id is already present.

Both sites go through one function, `renderer/input/registerInputActions.ts`, and it is idempotent in a specific way: an id already registered is left exactly as it is, and a re-registration whose `description`, `category` or `oneShot` **differs** throws. Last-write-win is what that rules out — a game shipping one table to the shell and another to the match would otherwise put a description in the rebind pane that no longer describes what the match dispatches.

The table rides the **shell** payload rather than being read off the game payload because the shell payload is what a menu route already loads; resolving it through `loadRendererGame` would pull the game's screens and asset manifest into the main menu's bundle. A game hands the same array to both payloads (`apps/tactics/renderer/loaders.ts` reads `LoadedRendererGame.inputActions` back off its own shell), so the identity assert above is trivially satisfied.

Registration is **app-lifetime and has no teardown**: an action registered on the menu is the same action in the match. There is deliberately no shell-scoped registration lifetime and no second registry — two registration paths with independent lifetimes drift, and the drift is invisible until a player's rebound key stops working.

**A registered action still needs a binding to fire.** `KeyBindingRepository` resolves bindings through the settings store's `activeGameId` (Invariant #66), falling back to `__engine__` when no game holds it — and a `game:*` default binding lives in the _game's_ settings schema, never the engine's. `renderer/app/SettingsBootstrap.tsx` is what publishes that slot: the lobby's game while a session is live, the URL `?gameId=` shell game otherwise. Registration without the slot leaves the action listed but unbound. The slot is the settings NAMESPACE rather than a binding-only switch, so which game holds it decides more than the key — see `renderer/app/SettingsBootstrap.tsx`.

---

## Reachability From a Game (`@chimera-engine/renderer/input`)

A game surface reaches the shared renderer library only through its public barrels
(Invariant #96). The one for this section is `@chimera-engine/renderer/input`, and it
re-exports:

| Symbol                      | Kind  | Why a game needs it                                                                                                   |
| --------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| `useInputAction`            | value | run a callback when a declared action fires                                                                           |
| `useInputManager`           | value | hold the manager, for the held-key recipe below                                                                       |
| `InputManagerProvider`      | value | what a game's own component tests mount to satisfy the hooks                                                          |
| `InputManagerProviderProps` | type  | the provider's props                                                                                                  |
| `InputAction`               | type  | annotate the action table a game puts on `LoadedRendererGameShell.inputActions` and `LoadedRendererGame.inputActions` |
| `InputActionId`             | type  | name an id outside an inline literal                                                                                  |
| `InputEvent`                | type  | the callback payload, needed by any handler extracted out of JSX                                                      |
| `InputManager`              | type  | the return type of `useInputManager`                                                                                  |

**What stays internal, and why.** The eight names above are the whole re-export list —
`renderer/input/__tests__/input-barrel-side-effects.test.ts` pins it as a closed set — so
`createInputManager`, `createInputActionRegistry`, `createKeyBindingRepository`, the
registry and repository interfaces, the context objects, `KeyBinding`, `EngineBindings`,
`RebindResult` and the input error classes stay behind it. The reasons: the manager is an
app-lifetime singleton (see Lifecycle Ownership
above), and a second one attaches a second set of listeners and double-dispatches every
action. Registration is engine-side and already complete — see
Action Registration above. Bindings are settings (Invariant #66),
and rebinding stays with the engine settings page.

That last point is prose, not a mechanism. Exporting `useInputManager` hands a game the
manager object, so **every** member on the `InputManager` interface is reachable —
lifecycle (`start`, `stop`), dispatch scoping (`setActiveCategory`, `pollGamepad`) and
binding writes (`rebind`, `resetBinding`) alike — and nothing prevents a game from calling
any of them. A game calls none: it subscribes with `useInputAction` and reads
`isPressed`. This is the same prose-only arrangement Invariant #64 uses for
`AudioManager.dispose()`.

**Dispatch fires on key DOWN and key UP.** A handler that should run once per press has
to guard on the event:

```typescript
useInputAction('game:jump', (event) => {
    if (!event.pressed) return;
    // …
});
```

**A release also arrives on focus loss.** `start()` listens for the window's `blur` and
for the document's `visibilitychange`. On either — a blur, or a change whose new
`visibilityState` is `hidden` — every action currently held is dispatched with
`pressed: false`, in press order, and the pressed set is emptied before the first callback
runs. The reset is idempotent: the real key-up, if one ever arrives, dispatches nothing a
second time. Without it the key-up for a key let go while the app was in the background
would never reach the app at all, leaving the action down forever — invisible in a
turn-based game, a control that cannot be stopped in a realtime one, where a held key is a
standing order.

The release REACHES a held gamepad action; it does not OUTLAST one. `getGamepads()` goes
on reporting a button that is physically down, so the next `pollGamepad()` takes the
held-button arm and re-arms a non-`oneShot` action. `InputManager.test.ts` pins that.
Closing it is a change to the gamepad path rather than to this one.

**Held keys are polled, not subscribed.** `InputManager.isPressed(id)` is a membership
test that publishes no event and notifies nothing when the pressed set changes, so there
is no held-key hook. Hold the manager and poll it from the game's own frame loop:

```typescript
const manager = useInputManager();
useFrame(() => {
    if (manager.isPressed('game:move-left')) {
        // …
    }
});
```

`useFrame` comes from `@react-three/fiber` (a renderer peer dependency, not a renderer
barrel) and requires the calling component to be inside the game's `<GameCanvas>`.

**Dispatching back needs nothing from this barrel** — a screen already receives
`sendAction` on `GameScreenProps`. The barrel is subscribe-only.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #65 | `InputManager` is renderer-only. The simulation has no knowledge of keyboard or gamepad state. Input translates into `EngineAction`s via `sendAction()` at the renderer boundary — never directly into reducers.              |
| #66 | Key bindings are settings, not profile data. They follow the settings layered-merge contract and are stored under `settings.controls.bindings`. They are not transmitted over the network and never appear in `GameSnapshot`. |

---

## Cross-References

- [Settings System](settings-system.md) — `EngineSettings.controls.bindings`
- [Simulation Core](simulation-core-action-pipeline.md) — `EngineAction` dispatched on key press
