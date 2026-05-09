---
applyTo: 'renderer/**'
---

# Renderer Layer — Rules

Source of truth:

- [React/Zustand standards](../../docs/coding-standards-sections/react-zustand.md)
- [React Three Fiber standards](../../docs/coding-standards-sections/react-three-fiber.md)
- [Renderer state stores](../../docs/core-components/renderer-state-stores.md)
- [MatchShell UI design system](../../docs/core-components/matchshell-ui-design-system.md)
- [Renderer shell pages UI contract](../../docs/core-components/renderer-shell-pages-ui-contract.md)
- [Module boundaries](../../docs/executive-architecture/module-boundaries-file-tree.md)
- [Architecture invariants](../../docs/executive-architecture/architecture-invariants.md)

Use this file only as the fast BLOCK/WARNING checklist:

- Renderer imports stay inside `renderer/`, `shared/`, and type-only `simulation/content`; never import `electron/main`, game data, provider internals, or broad simulation runtime modules.
- Use narrow typed Zustand selectors; components do not call whole-store hooks or mutate IPC-only store methods.
- Dispatch authoritative actions through `useSendAction()` and keep renderer state local or derived.
- Derive UI state in selectors or `useMemo`; reserve `useEffect` for real side effects.
- Pass R3F components only the fields they render, not whole snapshots or stores.
- Treat `AssetRef<T>` as content-driven and stable; check `useAsset()` loading before reading the asset.
- Shell UI follows token, `<Button>`, `GameScreenRegistry`, `React.lazy`, and `Suspense` invariants.
