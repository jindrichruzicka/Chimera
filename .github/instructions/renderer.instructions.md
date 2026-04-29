---
applyTo: 'renderer/**'
---

# Renderer Layer — Rules

Hard constraints. **BLOCK** unless marked WARNING.

## Module Boundaries

May import: `simulation/content` (**types only** — `AssetRef<T>`, `DataRef<T>`); `shared/`; other `renderer/` files.

NEVER import: `electron/main/`; `ai/engine/` (except IPC types via `shared/`/preload); `games/*/data`; `simulation/` (except types from `simulation/content`).

## Zustand Selectors (BLOCK)

Always narrow + typed:

```typescript
const tick = useGameStore((s) => s.snapshot?.tick); // ✅
const state = useGameStore(); // ❌ BLOCK
```

## Dispatch Actions (WARNING)

```typescript
const sendAction = useSendAction();                   // ✅
sendAction({ type: 'tactics:move_unit', payload: { unitId, to } });

window.__chimera.game.sendAction(...);                // ❌ WARNING
```

## R3F Component Props (WARNING)

Pass only the fields rendered:

```typescript
function UnitMarker({ position, health }: { position: Vec3; health: number }) {} // ✅
function UnitMarker({ snapshot }: { snapshot: PlayerSnapshot }) {} // ❌
```

## `useEffect` for Derivation (WARNING)

Derive in selector or `useMemo`:

```typescript
const isMyTurn = useGameStore((s) => s.snapshot?.activePlayer === myPlayerId); // ✅
useEffect(() => setIsMyTurn(...), [snapshot]);                                  // ❌
```

## `useAsset` Contract

Returns `{ asset: ResolvedAsset<T> | null; loading: boolean }`. Check `loading` first; never `instanceof` a fallback.

```typescript
const { asset, loading } = useAsset(ref);
if (loading) return <LoadingPlaceholder />;
// asset guaranteed non-null
```

`AssetRef` passed to `useAsset()` must be a stable reference (module-scope const or `useMemo`) — not a fresh object literal per render.

## IPC Store Mutation

Methods marked "ipcClient only" must never be called from components — only by `ipcClient` when IPC state arrives.

## Asset References (Inv #36)

Content data drives `AssetRef` strings; renderer resolves. Never hard-code asset URLs — use `AssetRef<T>` from game content + `useAsset`.
