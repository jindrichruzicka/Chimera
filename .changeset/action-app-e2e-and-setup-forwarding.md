---
'@chimera-engine/electron': patch
'@chimera-engine/action': patch
---

Prove the action app end to end, and fix the defect that proof found: the host never handed a
game's own lobby `setup` to its `buildInitialEntities` hook.

`GameDefinition.buildInitialEntities` takes `(playerIds, setup?)`, and its contract in
`simulation/engine/ActionRegistry.ts` says the second argument is there so a game can seed starting
entities from the host-authored configuration. Nothing passed it. `resolveInitialEntitiesForGame` dropped the parameter, so every
game reading it fell back to seat order — and the fallback is invisible from the outside, because
the picks still ride `snapshot.setup` and every projection afterwards looks correct. The players are
simply on the wrong pieces. The composition root now builds the setup before the entities and hands
it over; the restored-host test harness, which mirrors that call, does the same.

The suite that caught it is `apps/action/e2e/` — the action app's own Playwright project, with its
own build root (`.e2e-build-action/`), its own throwaway-profile root and its own CI job. Two suites
sharing either would delete each other's artefacts mid-run, so nothing is shared; the fixtures the
tactics suite has an equivalent of are this app's own copies, because a game directory may not
import another's. Its fixture offers no `CHIMERA_E2E` auto-start seam at all: every match here is
opened by clicking Start, so `chimera:lobby:quick-start` is exercised on its only production path.

Eight specs: the fresh-profile menu over the live background, held-key movement on the realtime
heartbeat, autosave-on-leave and Continue restoring the arena as it was left, the Start overwrite
confirm and both its answers, background persistence across `menu → select → settings`, in-scene
picking plus a click-through sweep of the shell controls those surfaces carry, each clicked with the
interactive plate mounted under it, a rebind that reaches the pre-match picker with no match ever
run, and the pass-and-play seat picking,
playing and moving on its own keys. The two seats end up on shapes seat order would not have chosen,
which is what makes the last one the killer for the fix above.

`ACTION_SHELL_YAW_ATTRIBUTE` / `ACTION_SHELL_DOLLY_ATTRIBUTE` move from `ActionShellCameraRig.tsx`
to `actionShellCamera.ts`, beside the two describers whose answers they carry — a reader outside the
renderer needs the attribute name and the phase vocabulary together, and only the plain `.ts` half
of that pair is reachable from a Playwright runner.
