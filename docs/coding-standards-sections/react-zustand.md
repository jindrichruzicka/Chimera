---
title: 'Chimera Coding Standards — §5 React and Zustand'
description: 'Rules for React component purity, Zustand store subscriptions via narrow selectors, action dispatching via typed hooks, derived state, store mutation ownership, and useEffect usage.'
tags: [react, zustand, components, selectors, hooks, useEffect, coding-standards]
---

# §5 React and Zustand

> Part of [Coding Standards Index Hub](../coding-standards.md)

---

## 5.1 Component purity

- Components are **pure** with respect to game state. They never hold game logic.
- A component that does more than read state and dispatch user intent has too many responsibilities.

## 5.2 Zustand store subscriptions

```typescript
// ✅ Narrow selector — component only re-renders when tick changes
const tick = useGameStore((s) => s.snapshot?.tick);

// ❌ BLOCK — subscribes to the whole store; re-renders on every state change
const state = useGameStore();
```

## 5.3 Dispatching actions

```typescript
// ✅ Via typed hook
const sendAction = useSendAction();
sendAction({ type: 'tactics:move_unit', payload: { unitId, to } });

// ❌ BLOCK — direct call from component
window.__chimera.game.sendAction({ type: 'tactics:move_unit', payload: { ... } });
```

## 5.4 Derived state

```typescript
// ✅ Derive in selector
const canUndo = useGameStore((s) => s.snapshot?.undoMeta.canUndo ?? false);

// ❌ WARNING — useEffect for state derivation
useEffect(() => {
    setCanUndo(snapshot?.undoMeta.canUndo ?? false);
}, [snapshot]);
```

## 5.5 Store mutation ownership

- Store mutation methods marked `// ipcClient only` must never be called from a component. They are called exclusively by `ipcClient` when a new `PlayerSnapshot` arrives from main process.

## 5.6 `useEffect` usage

- `useEffect` is for **side effects** (subscriptions, focus management, analytics events) — not state derivation.
- Every `useEffect` must have a complete dependency array. Exhaustiveness is enforced by `eslint-plugin-react-hooks`.
- Cleanup functions must be provided for every subscription or timer registered in `useEffect`.
