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

Scenes are the coarse-grained context units of a match: `lobby → loading → match`, `match → intermission → next level`, `match → post-game → lobby`. Scene transitions are **host-authoritative and synchronized**: before acknowledging, every client ATTEMPTS the entering scene's declared preload, bounded by `SCENE_PRELOAD_BUDGET_MS` and fail-open on timeout or failure. The ack is never withheld on the outcome — see the barrier section below for why a withheld ack would freeze the match rather than degrade it.

Transitions are expressed as normal engine actions — deterministic, logged in `ActionHistory`, replayable, and undoable.

### Layering

| Layer                      | Scope                                                          | Owner                   | Example                                     |
| -------------------------- | -------------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| `phase`                    | Intra-match state machine (`deployment → combat → resolution`) | Game reducer            | A game's combat round phase                 |
| `sceneId`                  | Cross-match / level structure                                  | Engine + scene registry | `'lobby'`, `'level-1'`, `'post-game'`       |
| `GameScreenRegistry` entry | Active UI panel within the current scene                       | Renderer (local)        | `'tech-tree'` vs `'playfield'` during match |

A scene change is a simulation event broadcast to all clients. A screen change is a purely local UI navigation.

### SceneDescriptor

```typescript
// simulation/scenes/SceneDescriptor.ts

type SceneId = string; // namespaced: 'engine:lobby', '<game>:level-1'

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
    /** The entering scene's declaration, copied off its host-side descriptor. */
    readonly requiredAssets?: readonly AssetRef[];
    /** The entering scene's `defaultScreen`, copied off the same descriptor, so a
     *  client can resolve its loading cover before the scene commits. */
    readonly defaultScreen?: string;
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
// renderer/components/scene/SceneRouter.tsx
// - sceneTransition === null → render defaultScreen for sceneId
// - phase === 'preparing'   → TransitionOverlay + scene preload + sendAction(SceneReady)
// - phase === 'ready'       → TransitionOverlay at 100% until commit
// - sceneId change          → unmount old tree; mount new tree
export function SceneRouter(): JSX.Element;
```

`TransitionOverlay.tsx` (engine-provided): a full-screen fade. Games can override it via the `GameScreenRegistry.transitionOverlay` slot. It draws no progress bar and no "Waiting for N player(s)…" status. It does receive the measured fraction and expose it as `data-preload-progress`, handed through raw so an UNMEASURED wait omits the attribute entirely rather than printing `null` or drawing an empty bar as a claim nobody measured; see the component for what it does render.

#### The barrier's ack waits for the entering scene's assets

`useFadeTransition` acks only after BOTH the fade-out and the entering scene's preload have settled: it awaits `fadeOut()`, then starts `startScenePreload` over `sceneTransition.requiredAssets` (§4.10) and awaits its run before dispatching `engine:scene_ready`.

The ack fires on **all four** preload outcomes — `loaded`, `failed`, `timeout`, `skipped`. Withholding it on a bad disk would freeze the match rather than degrade it: the host waits for every player, evaluates `timeoutTicks` only when an action is applied, and a turn-based game has no ticker to apply one.

A run is abandoned by **cancellation, never disposal** (Invariant #21 — the manager is borrowed). Cancelling is not the transition effect's cleanup: that effect depends on the parsed `sceneTransition` object and re-runs on every state frame, so a remote player's ack alone would kill the local run. The two cancel sites are an unmount-only effect and an explicit transition-identity check.

Progress is a plain `useState` in `SceneRouter`, fed by the hook's `onPreloadProgress` and handed to `TransitionOverlay`, to a game-supplied overlay, and to the transition's loading cover — the third cover site (§4.36), rendered as a SIBLING of the overlay branch. It is not in `uiStore` (a module singleton two mounted routers would cross-talk through) and not on `FadeControl` (also mounted app-level, where no scene preload exists).

A run that waits on nothing — no manager, no manifest, or no declared refs — reports **no** fraction, and `SceneRouter` then withholds the prop entirely rather than passing `null`, so the overlay a game already sees is unchanged. Forwarding what such a run does report would author "100% preloaded" over a wait nobody counted, for every transition in every game shipping no manifest; the hook asks `scenePreloadMeasuresProgress` rather than restating the condition, and the pairing is pinned in `renderer/components/scene/scenePreload.test.ts`. A measured run reports `0` the moment it starts, then one fraction per settled ref.

The committed-scene half of the same declaration is separate: `BaseGameSnapshot.sceneRequiredAssets` gates a ROUTE ENTRY through `useCriticalAssetPreloadGate` — see [Where the critical preload runs](asset-reference-system.md#where-the-critical-preload-runs).

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

| #   | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #49 | Scene transitions are host-authoritative. `engine:scene_prepare` and `engine:scene_commit` rejected if dispatcher is not host.                                                                                                                                                                                                                                                                                                                                                                                                        |
| #50 | `SceneDescriptor.initialize()` and `teardown()` are pure reducers. No I/O, no `Date.now()`, no `Math.random()`. Use `ctx.rng`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| #51 | Clients never drive a scene change directly. A client dispatches a domain action; host policy calls `SceneManager.requestTransition()`.                                                                                                                                                                                                                                                                                                                                                                                               |
| #52 | Required assets for a scene MUST be declared in `SceneDescriptor.requiredAssets` (else visual pop-in). `validate-assets` checks declared refs resolve on disk (and `requiredAssets`/content refs are manifest-listed), and statically scans on-demand load call sites (`useAsset`/`useModelInstance`/receiver `.load`/`.get`) across scene/screen paths and the `apps/<name>/{components,shell,renderer}` surfaces — flagging an undeclared, statically-resolvable on-demand load as a CI error; dynamic refs are warned, not failed. |

---

## 4.19 Fade Transitions

### Overview

`TransitionOverlay` provides a full-screen fade-to-black / fade-from-black effect. **Renderer-only** — the simulation and main process have no knowledge of fade state.

### Mechanism

A fixed-position `<div>` with `pointer-events: none` at `z-index: 9999`. Opacity is animated imperatively via `requestAnimationFrame` (not CSS transitions) to allow Promise-based sequencing.

### FadeControl Context

```typescript
// renderer/components/shell/FadeContext.ts

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
