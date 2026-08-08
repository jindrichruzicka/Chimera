---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
---

Add `@chimera-engine/renderer/input`, an eighth public barrel, so a game can subscribe to
the rebindable input actions it already declares. A game could declare an action end to
end — a default binding in its settings schema, `InputAction` metadata on
`LoadedRendererGame.inputActions`, registration by `GameShell`, display and rebind and
persistence in Settings > Controls, dispatch by `InputManager` — and then had nowhere to
receive the event: `useInputAction` was a renderer internal with no entry in the `exports`
map, and Invariant #96 allows a game surface only a public barrel. A player rebound the
key and nothing happened.

The barrel ships the two hooks (`useInputAction`, `useInputManager`), a new
`InputManagerProvider` a game's own component tests can mount with its
`InputManagerProviderProps`, and the
`InputAction`/`InputActionId`/`InputEvent`/`InputManager` types those calls take.
`renderer/app/providers.tsx` now mounts the provider instead of the raw context, with no
behaviour change. `@chimera-engine/tactics` annotates its action table with the barrel's
`InputAction` type, which is the adopter proving the subpath reaches a game surface.

Additive throughout — nothing removed or renamed — and curated rather than open: the
manager factory, the action registry, the key-binding repository and the binding/rebind
types stay internal, so a game consumes the app-lifetime manager and never builds one.
Invariant #96 states that and `chimera/no-game-renderer-internals` enforces it.
