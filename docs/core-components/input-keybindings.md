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

Centralise keyboard and gamepad input behind named `InputAction`s. Decouple response code from physical keys. Let players rebind keys through the settings UI. Mirrors the Command pattern from §4.7 but for client-local input rather than authoritative game actions.

---

## Core Types

```typescript
// renderer/input/InputAction.ts

/** 'engine:undo' | 'engine:redo' | 'engine:toggle-menu' | 'game:end-turn' | ... */
export type InputActionId = `engine:${string}` | `game:${string}`;

export interface InputAction {
    readonly id: InputActionId;
    readonly description: string; // Shown in rebind UI
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
 * type TacticsBindings = GameBindingSchema<{
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

| Action                   | Default key  |
| ------------------------ | ------------ |
| `engine:undo`            | Ctrl+Z       |
| `engine:redo`            | Ctrl+Shift+Z |
| `engine:toggle-menu`     | Escape       |
| `engine:toggle-perf-hud` | F3           |

---

## InputManager

```typescript
// renderer/input/InputManager.ts

export class InputManager {
    constructor(
        private readonly registry: InputActionRegistry,
        private readonly bindings: KeyBindingRepository,
    ) {}

    start(): void; // Attaches window listeners (called once on app mount)
    stop(): void;

    onAction(id: InputActionId, cb: (event: InputEvent) => void): Unsubscribe;
    isPressed(id: InputActionId): boolean; // For continuous held-key detection

    /** Rebind at runtime. Persists via KeyBindingRepository.save(). */
    rebind(id: InputActionId, binding: KeyBinding): Promise<RebindResult>;
}

export type RebindResult =
    | { ok: true }
    | { ok: false; reason: 'conflict'; conflictingAction: InputActionId };
```

---

## useInputAction Hook

```typescript
// renderer/input/useInputAction.ts
export function useInputAction(id: InputActionId, callback: (event: InputEvent) => void): void;
```

Components subscribe declaratively:

```typescript
useInputAction('engine:undo', () => sendAction(UndoAction.build()));
useInputAction('game:end-turn', () => sendAction(EndTurnAction.build()));
useInputAction('game:cycle-unit', cycleNextUnit);
```

---

## Settings Integration

Key bindings are stored in `settings.controls.bindings: GameBindingSchema<EngineBindings>`. The rebind UI reads from and writes to `settingsStore`. `KeyBindingRepository` is a thin wrapper around the `settings.controls` namespace — no separate repository file needed.

---

## Conflict Detection

`InputManager.rebind()` rejects bindings that collide with an existing one (same key + modifier + category scope). The UI offers "unbind existing action" as a resolution. Engine-reserved bindings (`engine:*`) may be rebound but not removed.

---

## Lifecycle Ownership

`InputManager` is instantiated by `renderer/app/providers.tsx` on app mount and exposed via context. `providers.tsx` calls `start()` once in a `useEffect` with no dependencies, and `stop()` in the cleanup. No other component calls `start()`/`stop()`.

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
