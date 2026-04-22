---
applyTo: 'renderer/**'
---

# Renderer Layer — Rules

These rules apply to every file under `renderer/`. They are hard constraints; violations are **BLOCK** findings at review.

## Module Boundaries

`renderer/` may import from:

- `simulation/content` — **types only** (e.g. `AssetRef<T>`, `DataRef<T>`) — never runtime simulation logic
- `shared/`
- Other files within `renderer/` itself

`renderer/` must **NEVER** import from:

- `electron/main/` — no direct main-process code in the renderer
- `ai/engine/` — except IPC type definitions shared through `shared/` or the preload contract
- `games/*/data` — game content data must not be directly accessed by the renderer
- `simulation/` (except `simulation/content` for types only)

## Zustand Store Subscriptions (BLOCK if violated)

Always subscribe to a **narrow typed selector** — never subscribe to the whole store:

```typescript
// ✅ Narrow selector — re-renders only when tick changes
const tick = useGameStore((s) => s.snapshot?.tick);

// ❌ BLOCK — subscribes to the whole store, re-renders on every state change
const state = useGameStore();
```

## Dispatching Actions (WARNING if violated)

Never call `window.__chimera.game.sendAction()` directly from a component. Always use the typed hook:

```typescript
// ✅ Via typed hook
const sendAction = useSendAction();
sendAction({ type: "tactics:move_unit", payload: { unitId, to } });

// ❌ WARNING — direct call bypasses type safety
window.__chimera.game.sendAction({ type: "tactics:move_unit", payload: { ... } });
```

## Component Data Props — R3F Components (WARNING if violated)

R3F components must receive only the fields they render. Never pass a full `PlayerSnapshot` to a component that only needs two or three fields:

```typescript
// ✅ Narrow props
function UnitMarker({ position, health }: { position: Vec3; health: number }) { ... }

// ❌ WARNING — receives full snapshot when only position and health are used
function UnitMarker({ snapshot }: { snapshot: PlayerSnapshot }) { ... }
```

## `useEffect` for State Derivation (WARNING if violated)

Do not use `useEffect` to derive state from other state. Derive in the selector or with `useMemo`:

```typescript
// ✅ Derived in selector
const isMyTurn = useGameStore((s) => s.snapshot?.activePlayer === myPlayerId);

// ❌ WARNING — useEffect for state derivation
useEffect(() => {
    setIsMyTurn(snapshot?.activePlayer === myPlayerId);
}, [snapshot]);
```

## `useAsset` Contract

`useAsset<T>(ref)` returns `{ asset: ResolvedAsset<T> | null; loading: boolean }`.

- Check `loading` first, then use `asset`.
- **NEVER** check which kind of asset you have by examining a fallback value (e.g. `if (asset instanceof THREE.Texture)`).

```typescript
// ✅ Correct
const { asset, loading } = useAsset(ref);
if (loading) return <LoadingPlaceholder />;
// asset is guaranteed non-null here

// ❌ WARNING — checking via instanceof instead of loading flag
if (asset instanceof THREE.Texture) { ... }
```

## IPC Store Mutation Methods

Methods on Zustand stores that are marked "ipcClient only" must **never** be called from components. They are called exclusively by `ipcClient` when IPC state arrives from the main process.

The `AssetRef` passed to `useAsset()` must be a stable reference (module-scope constant or `useMemo` result) — not an object literal constructed inline on every render, as that breaks referential equality and causes redundant re-fetches.

## Asset References (Invariant #36)

Content data drives `AssetRef` strings; the renderer resolves them. Never hard-code asset URLs in components. Use `AssetRef<T>` values from the game content data and resolve them with `useAsset`.
