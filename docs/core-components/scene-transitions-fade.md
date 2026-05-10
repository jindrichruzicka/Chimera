---
title: 'Scene Transitions & Fade'
description: 'SceneDescriptor/SceneRegistry, two-phase scene transition protocol (prepare/ready/commit), reserved EngineActions, SceneManager.requestTransition(), SceneRouter, TransitionOverlay, FadeControl context, useFade() hook, and scene/save integration.'
tags: [scenes, transitions, fade, scene-manager, synchronization, renderer]
---

# Scene Transitions & Fade

> §4.18–§4.19 of the Chimera architecture.
> Related: [Simulation Core](simulation-core-action-pipeline.md) · [Asset Reference System](asset-reference-system.md) · [Renderer State Stores](renderer-state-stores.md)

---

## 4.18 Scene Transitions

### Overview

Scenes are the coarse-grained context units of a match: `lobby → loading → match`, `match → intermission → next level`, `match → post-match → lobby`. Scene transitions are **host-authoritative and synchronized** — every client preloads required assets before play resumes.

Transitions are expressed as normal engine actions — deterministic, logged in `ActionHistory`, replayable, and undoable.

### Layering

| Layer                      | Scope                                                          | Owner                   | Example                                 |
| -------------------------- | -------------------------------------------------------------- | ----------------------- | --------------------------------------- |
| `phase`                    | Intra-match state machine (`deployment → combat → resolution`) | Game reducer            | Tactics combat round phase              |
| `sceneId`                  | Cross-match / level structure                                  | Engine + scene registry | `'lobby'`, `'level-1'`, `'post-match'`  |
| `GameScreenRegistry` entry | Active UI panel within the current scene                       | Renderer (local)        | `'tech-tree'` vs `'board'` during match |

A scene change is a simulation event broadcast to all clients. A screen change is a purely local UI navigation.

### SceneDescriptor

```typescript
// simulation/scenes/SceneDescriptor.ts

type SceneId = string; // namespaced: 'engine:lobby', 'tactics:level-1'

interface SceneDescriptor {
    readonly id: SceneId;
    readonly defaultScreen: string; // GameScreenRegistry entry to mount on enter
    readonly requiredAssets: readonly AssetRef[];
    readonly timeoutTicks?: number; // Default: 1_800 (30 s at 60 ticks/s)
    readonly onClientTimeout?: 'proceed' | 'drop'; // Default: 'proceed'

    /** Pure reducer — initializes level state; called by engine:scene_commit */
    initialize(
        prevState: Readonly<BaseGameSnapshot>,
        params: SceneEnterParams,
        ctx: ReduceContext,
    ): BaseGameSnapshot;

    /** Optional teardown — carry forward durable state (score, campaign progress) */
    teardown?(state: Readonly<BaseGameSnapshot>, ctx: ReduceContext): BaseGameSnapshot;
}

interface SceneEnterParams extends Record<string, unknown> {}
```

### BaseGameSnapshot Extension

```typescript
interface BaseGameSnapshot {
    readonly sceneId: SceneId;
    readonly sceneTransition: SceneTransitionState | null; // null between transitions
}

interface SceneTransitionState {
    readonly toSceneId: SceneId;
    readonly phase: 'preparing' | 'ready' | 'committing';
    readonly startedAtTick: number;
    readonly params: SceneEnterParams;
    readonly playersReady: readonly PlayerId[];
}
```

### Two-Phase Protocol

```
Host dispatches engine:scene_prepare { toSceneId, params }
  → sceneTransition.phase = 'preparing'
  → broadcast PlayerSnapshot to all clients

  Each client: sees phase === 'preparing'
    → SceneRouter shows TransitionOverlay + kicks off AssetPreloader
    → on assets loaded → dispatch engine:scene_ready { playerId }

Host receives engine:scene_ready from each client
  → append to playersReady
  → all ready (or timeout) → dispatch engine:scene_commit

Host dispatches engine:scene_commit
  → prevScene.teardown?(state, ctx)
  → nextScene.initialize(state, params, ctx)
  → sceneId = toSceneId; sceneTransition = null
  → broadcast new PlayerSnapshot

Clients see sceneId flip → SceneRouter swaps to defaultScreen
```

### Reserved Action Types

```typescript
type EngineReservedType =
    | 'engine:scene_prepare' // Host-only
    | 'engine:scene_ready' // Any client
    | 'engine:scene_commit'; // Host-only
```

`engine:scene_prepare` and `engine:scene_commit` are rejected by `validate()` if dispatcher is not host. `engine:scene_ready` is rejected if `sceneTransition === null` or player is already in `playersReady`.

### SceneManager (Host-Side API)

```typescript
// simulation/scenes/SceneManager.ts
interface SceneManager {
    /** Queue a transition. Dispatches prepare after current action completes. */
    requestTransition(toSceneId: SceneId, params?: SceneEnterParams): void;
    readonly current: SceneTransitionState | null;
}
```

Game reducers never dispatch from inside themselves. They set a domain event in state (e.g. `state.events`); a host-side policy observer watches for it and calls `sceneManager.requestTransition()`.

### Renderer: SceneRouter & TransitionOverlay

```typescript
// renderer/components/shell/SceneRouter.tsx
// - sceneTransition === null → render defaultScreen for sceneId
// - phase === 'preparing'   → TransitionOverlay + AssetPreloader + sendAction(SceneReady)
// - phase === 'ready'       → TransitionOverlay at 100% until commit
// - sceneId change          → unmount old tree; mount new tree
export function SceneRouter(): JSX.Element;
```

`TransitionOverlay.tsx` (engine-provided): full-screen fade + progress bar + "Waiting for N player(s)…" status. Games can override via `GameScreenRegistry.transitionOverlay` slot.

### Module Tree

```
simulation/scenes/
├── SceneDescriptor.ts
├── SceneRegistry.ts
├── SceneManager.ts
└── actions/
    ├── ScenePrepareAction.ts
    ├── SceneReadyAction.ts
    └── SceneCommitAction.ts

renderer/components/shell/
├── SceneRouter.tsx
└── TransitionOverlay.tsx
```

### Save/Load Integration

`GameSnapshot.sceneId` and `sceneTransition` serialise naturally in saves. Loading mid-transition replays the prepare action; clients re-execute the readiness barrier and host re-commits — identical to an initial transition.

### Invariants

| #   | Rule                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- |
| #49 | Scene transitions are host-authoritative. `engine:scene_prepare` and `engine:scene_commit` rejected if dispatcher is not host.          |
| #50 | `SceneDescriptor.initialize()` and `teardown()` are pure reducers. No I/O, no `Date.now()`, no `Math.random()`. Use `ctx.rng`.          |
| #51 | Clients never drive a scene change directly. A client dispatches a domain action; host policy calls `SceneManager.requestTransition()`. |
| #52 | Required assets for a scene MUST be declared in `SceneDescriptor.requiredAssets`. CI `validate-assets` tool flags on-demand assets.     |

---

## 4.19 Fade Transitions

### Overview

`TransitionOverlay` provides a full-screen fade-to-black / fade-from-black effect. **Renderer-only** — the simulation and main process have no knowledge of fade state.

### Mechanism

A fixed-position `<div>` with `pointer-events: none` at `z-index: 9999`. Opacity is animated imperatively via `requestAnimationFrame` (not CSS transitions) to allow Promise-based sequencing.

### FadeControl Context

```typescript
// renderer/components/shell/TransitionOverlay.tsx

export interface FadeControl {
    fadeOut(durationMs?: number): Promise<void>; // 0 → 1 (to black)
    fadeIn(durationMs?: number): Promise<void>; // 1 → 0 (from black)
    readonly opacity: number;
}

// createContext<T | null>(null) pattern — standard for all engine React contexts.
// createContext<T>(null!) ("null-bang") is FORBIDDEN (ESLint: no-context-null-bang).
export const FadeContext = createContext<FadeControl | null>(null);
```

### useFade Hook

```typescript
// renderer/hooks/useFadeTransition.ts
export function useFade(): FadeControl {
    const ctx = useContext(FadeContext);
    if (ctx === null) throw new Error('useFade() must be inside <TransitionOverlay> provider.');
    return ctx;
}
```

Default fade duration: **300 ms**.

### SceneRouter Integration

```typescript
// Inside SceneRouter.tsx (simplified)
const fade = useFade();

// Phase 1: fade to black, then signal readiness
useEffect(() => {
    if (phase === 'preparing') {
        let cancelled = false;
        fade.fadeOut(300).then(() => {
            if (cancelled) return;
            window.__chimera.game.sendAction(SceneReadyAction.build());
        });
        return () => {
            cancelled = true;
        };
    }
}, [phase]);

// Phase 2: new scene mounted, fade in
useEffect(() => {
    if (!phase) {
        fade.fadeIn(300);
    }
}, [sceneId, phase]);
```

`SceneReadyAction` is dispatched **after** fade-out completes — the fade is a cosmetic delay only. The host's readiness barrier is the authoritative gate.

### Standalone Use

Game screens may call `useFade()` for dramatic cuts (game-over fade, cinematic intro). No engine restriction on standalone use.

### Invariant

**#53** — `TransitionOverlay` is renderer-only. The simulation and main process have no knowledge of fade state. Fade timing must never gate an authoritative simulation event.

---

## Cross-References

- [Simulation Core](simulation-core-action-pipeline.md) — `ReduceContext`, `EngineReservedType`
- [Asset Reference System](asset-reference-system.md) — `AssetRef` in `SceneDescriptor.requiredAssets`
- [Renderer State Stores](renderer-state-stores.md) — `gameStore` provides `sceneId` + `sceneTransition`
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — #49–53
