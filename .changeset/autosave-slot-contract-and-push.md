---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': minor
'@chimera-engine/renderer': minor
---

Make the autosave slot a contract, and push a slot update after every autosave.

The reserved autosave slot used to be a naming convention three modules kept by hand:
`SaveManager.autoSave` rewrote the header to the inline literal `'autosave'`,
`SessionRuntime.captureSaveFile` defaulted to the same literal, and the crash path built
`` `${gameId}/autosave` `` under a comment asking whoever changed one to remember the others.
`simulation/foundation/save-slots.ts` now owns both spellings — `AUTOSAVE_SLOT_NAME` (the bare
name a `SaveFile` header carries) and `autosaveSlotId(gameId)` (the qualified id the repository,
`SaveSlotMeta.slotId` and the renderer all key on) — and `tools/autosave-slot-spelling.test.ts`
fails on any other production spelling. It parses rather than greps, because the tree is full of
prose about the slot: the census reads string values only, and only where the name occupies a
whole `/`-delimited segment, so comments and log messages such as "autosave failed after
engine:end_turn" are invisible to it.

`SaveManager` takes an optional third constructor argument, `onSlotsChanged(gameId)`, fired after
`save()` and after `autoSave()`. The composition root wires it to re-list the game's slots and
send `chimera:saves:slot-update` to every live window. Before this, only the manual save and
delete IPC round-trips pushed, so an autosave — after an accepted `engine:end_turn` or from the
crash reporter — changed the slot list with nothing telling the renderer. A reactive "does an
autosave exist" consumer went permanently stale after either.

One push per save, no coalescing and no debounce: the notification count is a fact about writes.
The saves IPC handler's **save** arm no longer broadcasts — the write already pushed through the
manager, and doing both would send the same list twice and pay for a second re-list. Its
**delete** arm still does, because delete is reached only through that round-trip and its
qualified `slotId` carries no gameId the manager may parse. A listener that throws is reported
and swallowed, and the composition root's push swallows a rejected re-list: the file is already
durable by then, and on the crash path a failed refresh must not raise a second failure on top of
the one being reported. That push skips destroyed windows and destroyed `webContents`, which the
crash path is the reason for.

Renderer: `selectHasAutosave(gameId)` and its hook `useHasAutosave(gameId)` on `saveStore`. Both
match the qualified id, so another game's autosave and a slot merely ending in the name read as
absent, and both fall back to `false` when the autosave is deleted rather than latching.

The save file format, the repository and the restore funnel are untouched (Invariants #24, #59,
#108).
