---
title: 'Curves, Tweening & Pointer Interactions'
description: 'EasingFn types (linear/easeIn/easeOut/easeInOut), useTween hook, useTweenCallback, useGameInteraction hook, InteractionBlocker context, and hover state rules for R3F game entities.'
tags: [animation, tweening, curves, interaction, r3f, renderer]
---

# Curves, Tweening & Pointer Interactions

> §4.21 + §4.23 of the Chimera architecture.
> Related: [Camera System](camera-system.md) · [Scene Transitions & Fade](scene-transitions-fade.md) · [Simulation Core](simulation-core-action-pipeline.md)

## How a game imports all of this

The public surface of this page is reached through one specifier — `InteractionContext`, documented below at §4.23, is the exception and stays internal:

```typescript
import {
    useTween,
    useTweenCallback,
    useGameInteraction,
    InteractionBlocker,
    useInteractionContext,
    lerp,
    linear,
    easeIn,
    easeOut,
    easeInOut,
    type EasingFn,
    type TweenState,
    type TweenCallbackHandlers,
    type InteractionHandlers,
} from '@chimera-engine/renderer/components/r3f';
```

The source paths named in the code blocks below say where each module **lives**, never how to import it. `renderer/hooks/` and `renderer/utils/` are internal directories — `@chimera-engine/renderer/hooks/useTween.js` is an Invariant #96 violation, and the barrel above is the only route.

Why the r3f barrel rather than a barrel of their own: Invariant #96 names `renderer/hooks/` as an internal **and** states the escape in the same sentence — whatever a barrel re-exports is legal through that barrel — so a `./hooks` or `./utils` subpath would contradict a named clause of the invariant, while re-exporting through `components/r3f` is the mechanism it blesses. The hooks are also useless away from a canvas (`useTween`/`useTweenCallback` drive off `useFrame`, `useCamera` reads `useThree`, `useGameInteraction` returns `ThreeEvent` handlers), so the r3f barrel is where a caller is already looking. The curve primitives are the exception and are not Canvas-bound at all — `renderer/utils/curves.ts` imports nothing and calls no React hook, which `r3f-barrel-side-effects.test.ts` measures. They ship here because they are what a caller **passes** to those hooks, not because of what they are.

The raw `InteractionContext` is deliberately **not** exported: like the `assets` and `input` barrels, this one publishes a provider plus its `useX()` accessor and never the context object.

---

## 4.21 Curves and Tweening

### Overview

Pure math utilities for smooth renderer-side animations: interpolating positions, fading opacity, scaling objects, smoothing camera movements. **Strictly renderer-only — zero simulation involvement.**

### Curve Primitives

```typescript
// renderer/utils/curves.ts

export type EasingFn = (t: number) => number;

export function lerp(from: number, to: number, t: number): number;
export function linear(t: number): number;
export function easeIn(t: number): number; // quadratic: starts slow, accelerates
export function easeOut(t: number): number; // decelerates to a smooth stop
export function easeInOut(t: number): number; // slow at both ends
```

### useTween Hook

```typescript
// renderer/hooks/useTween.ts

export interface TweenState {
    readonly value: number; // Current eased value in [0, 1]
    readonly isRunning: boolean;
    start(): void; // Begin animating 0 → 1
    stop(): void; // Stop and reset to 0
}

/**
 * Frame-rate-driven tween via R3F useFrame().
 * NOT connected to simulation tick — purely visual, client-local.
 */
export function useTween(durationMs: number, easingFn?: EasingFn): TweenState;
```

Internally accumulates `delta` from `useFrame((_state, delta) => ...)`, derives `t = elapsed / (durationMs / 1000)`, clamps to [0, 1], applies easing, exposes as `value`.

**Usage:**

```typescript
// Smooth position move over 300 ms:
const { value, start } = useTween(300, easeOut);
useEffect(() => {
    start();
}, []);
useFrame(() => {
    meshRef.current.position.x = lerp(startX, targetX, value);
});
```

### Callback Variant

```typescript
export interface TweenCallbackHandlers {
    readonly onTick: (value: number) => void;
    readonly onComplete: () => void;
    readonly onCancel: () => void;
}

export function useTweenCallback(
    durationMs: number,
    easingFn: EasingFn,
    callbacks: TweenCallbackHandlers,
): Pick<TweenState, 'start' | 'stop' | 'isRunning'>;
```

`onComplete` fires exactly once after natural completion. `onCancel` fires exactly once when `stop()` cancels an active tween. These lifecycle callbacks are mutually exclusive for a single animation lifecycle.

### Invariant

**#56** — `curves.ts`, `useTween`, and `useTweenCallback` are renderer-only. They must never be imported by anything under `simulation/`. Visual smoothing is a client-local concern; authoritative state does not move smoothly.

---

## 4.23 Pointer and Click Interactions

### Overview

React Three Fiber performs raycasting automatically at pointer coordinates and fires events on intersected meshes via JSX props — zero external library required.

### R3F Event System

```typescript
<mesh
    onClick={        (e) => { e.stopPropagation(); handleClick(e); }}
    onPointerDown={  (e) => { ... }}
    onPointerEnter={ (_e) => setHovered(true) }
    onPointerLeave={ (_e) => setHovered(false) }
    onContextMenu={  (e) => { ... } /* right-click */ }
>
    <boxGeometry />
    <meshStandardMaterial color={hovered ? 'hotpink' : 'orange'} />
</mesh>
```

### useGameInteraction Hook

```typescript
// renderer/hooks/useGameInteraction.ts

export interface InteractionHandlers {
    onClick: (e: ThreeEvent<MouseEvent>) => void;
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => void;
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => void;
    isInteractive: boolean; // false when InteractionBlocker is active
    isHovered: boolean; // local state — never touches simulation
}

/**
 * Returns R3F event handlers for an interactive entity.
 * Reads InteractionBlocker context; no-ops when interactions are blocked.
 */
export function useGameInteraction(
    entityId: EntityId,
    actionBuilder: () => EngineAction,
): InteractionHandlers;
```

**Usage:**

```typescript
const { onClick, onPointerEnter, onPointerLeave, isHovered, isInteractive } =
    useGameInteraction(card.id, () => PlayCard.build({ cardId: card.id }));

return (
    <mesh
        onClick={isInteractive ? onClick : undefined}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
    >
        <meshStandardMaterial color={isHovered ? highlight : base} />
    </mesh>
);
```

### InteractionBlocker Context

```typescript
// The context and its accessor live in renderer/components/r3f/interactionContext.ts
// — a plain .ts file, so non-JSX renderer modules can import them without the
// jsx tsconfig flag. InteractionBlocker.tsx re-exports both.

export const InteractionContext = createContext<{ isBlocked: boolean } | null>(null);

// Throws when called with no provider above it (Invariant #83). The refusal text
// is not transcribed here — read it at the source, which is where it changes.
export function useInteractionContext(): { isBlocked: boolean };

// renderer/components/r3f/InteractionBlocker.tsx

export function InteractionBlocker({ children }: { children: ReactNode }) {
    const sceneTransition = useGameStore(s => s.snapshot?.sceneTransition);
    return (
        <InteractionContext.Provider value={{ isBlocked: sceneTransition != null }}>
            {children}
        </InteractionContext.Provider>
    );
}
```

Also blocked during: network reconnection/resync, opponent's turn (optional per-game configuration).

When `isBlocked`, `onClick` is a no-op but hover state continues updating (prevents highlight artifacts during transitions).

#### Who mounts the provider

**`GameCanvas` does**, on every `role`, wrapping its children from inside its `<Canvas>` (§4.22). A game therefore calls `useGameInteraction` on any canvas child without mounting anything — which is the point: `useInteractionContext` has a null default and throws rather than guessing (Invariant #83), so before the engine provided one, the hook threw for every caller.

Inside the `<Canvas>` rather than around it, because the children that call the hook are r3f children — providing the context there needs no assumption about whether React context crosses the r3f reconciler boundary.

`InteractionBlocker` is exported from the r3f barrel anyway. Nesting a second provider is the supported way to **narrow** blocking over a subtree; the raw `InteractionContext` is not exported, so a nested provider still gets its value from a component rather than hand-built.

### Hover State Rule

`isHovered` is **local React state** inside `useGameInteraction`. It never enters `GameSnapshot`, `PlayerSnapshot`, or any Zustand store.

### Physics Note

No physics engine is included in Chimera 1.0.0. Collision detection, rigid bodies, and physics simulation are **out of scope**. Games requiring physics add a provider as an optional peer dependency.

### Invariant

**#58** — `isHovered` in `useGameInteraction` is local component state. It must never be written to any Zustand store, IPC message, or simulation state.

---

## Cross-References

- [Camera System](camera-system.md) — `useCamera.animateTo()` uses `useTween` internally
- [Scene Transitions & Fade](scene-transitions-fade.md) — `InteractionBlocker` reads `sceneTransition`
- [Simulation Core](simulation-core-action-pipeline.md) — `EngineAction` dispatched by `useGameInteraction`
