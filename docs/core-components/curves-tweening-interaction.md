---
title: 'Curves, Tweening & Pointer Interactions'
description: 'EasingFn types (linear/easeIn/easeOut/easeInOut), useTween hook, useTweenCallback, useGameInteraction hook, InteractionBlocker context, and hover state rules for R3F game entities.'
tags: [animation, tweening, curves, interaction, r3f, renderer]
---

# Curves, Tweening & Pointer Interactions

> §4.21 + §4.23 of the Chimera architecture.
> Related: [Camera System](camera-system.md) · [Scene Transitions & Fade](scene-transitions-fade.md) · [Simulation Core](simulation-core-action-pipeline.md)

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
export function useTweenCallback(
    durationMs: number,
    easingFn: EasingFn,
    callbacks: { onTick: (value: number) => void; onComplete: () => void },
): Pick<TweenState, 'start' | 'stop' | 'isRunning'>;
```

### Invariant

**#56** — `curves.ts` and `useTween` are renderer-only. They must never be imported by anything under `simulation/`. Visual smoothing is a client-local concern; authoritative state does not move smoothly.

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
// renderer/components/r3f/InteractionBlocker.tsx

export const InteractionContext = createContext<{ isBlocked: boolean }>({ isBlocked: false });

export function InteractionBlocker({ children }: { children: ReactNode }) {
    const sceneTransition = useGameStore(s => s.sceneTransition);
    return (
        <InteractionContext.Provider value={{ isBlocked: sceneTransition !== null }}>
            {children}
        </InteractionContext.Provider>
    );
}
```

Also blocked during: network reconnection/resync, opponent's turn (optional per-game configuration).

When `isBlocked`, `onClick` is a no-op but hover state continues updating (prevents highlight artifacts during transitions).

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
