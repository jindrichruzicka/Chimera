---
'@chimera-engine/renderer': minor
---

Register a game's input actions at shell load, so they exist before any match.

`LoadedRendererGameShell` gains `inputActions?: readonly InputAction[]` — the same table
`LoadedRendererGame.inputActions` already carried, now also on the payload a MENU route loads. A
new `InputActionsBootstrap` (mounted in `AppShell`, beside the other bootstraps) resolves the
active shell game through `useActiveShellGameId`, loads that game's shell payload and registers
what it declares. There is no second registry and no shell-scoped registration lifetime: it writes
into the app-lifetime `InputActionRegistry` `providers.tsx` builds, and nothing unregisters, so
`GameShell`'s own registration is normally a no-op by the time a match mounts.

Both registration sites now call ONE function, `renderer/input/registerInputActions.ts`: an id
already held is left exactly as it is, and a re-registration whose metadata differs throws. That
assert is the point — a game shipping one description to the shell and another to the match would
otherwise put a row in the rebind pane that no longer describes what the match dispatches.

Two things had to change for a shell surface to actually RECEIVE such an action, and neither was
registration:

- `InputManager` dispatches off the BINDING map, and `KeyBindingRepository` resolves bindings
  through the settings store's `activeGameId` — a slot only the lobby ever claimed. So a menu route
  had no key for a `game:*` action even once it was registered. `SettingsBootstrap` now publishes
  the slot as `lobbyGameId ?? urlGameId`: the lobby's game while a session is live, the URL
  `?gameId=` shell game otherwise. It still hydrates BOTH contexts' settings when they differ, and
  still claims the slot only after the settings behind it have landed. That slot is the settings
  NAMESPACE, not only the binding one, so every store-reading consumer of `activeGameId` now
  resolves the game's own namespace on a menu route — the one the settings page wrote the player's
  choice into — instead of `__engine__`.
- The Settings > Controls pane read `inputManager.getActions()` during render, and was re-rendered
  by a settings-store write the old registration was sequenced ahead of. Registration is no longer
  sequenced with any store write, so the pane reads the registry through `useSyncExternalStore`:
  `InputActionRegistry` gains `subscribe(listener)` and a STABLE, frozen `getAll()` snapshot that a
  registration replaces.

`registerActiveGameInputActions` is gone from `settingsGameContext`; neither `SettingsBootstrap`
nor the settings page loads the full game payload FOR INPUT ACTIONS any more (the page still
loads it for the game's settings-page definition). The public
`@chimera-engine/renderer/input` barrel is unchanged — no new export (Invariant #96).

The reference game moves its table to `apps/tactics/renderer/input-actions.ts` and hands the SAME
array to both payloads (the game payload reads it back off its own shell), so the identity assert
above is trivially satisfied for it.
