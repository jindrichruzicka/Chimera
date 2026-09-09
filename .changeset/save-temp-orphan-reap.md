---
'@chimera-engine/electron': patch
---

Reap the `.tmp` artefacts a crashed save leaves behind.

Naming the save temp file per WRITE removed a race between two writers of one slot, and took the
old scheme's self-healing with it: `<slot>.chimera.tmp` was reopened and truncated by the next write
to that slot, while `<slot>.chimera.<n>.tmp` is never reopened by anything. A process killed between
the write and the rename therefore left a full-size file that `list()` could not show — it filters
on the `.chimera` suffix — and `delete(slotId)` could not remove, one save file of disk per crash
for the life of the install.

`FileSaveRepository.reapOrphanTempFiles()` sweeps `userData/saves/*/` and unlinks them, in the
per-write shape and the pre-existing per-slot one alike. `electron/main/index.ts` runs it once at app
start, on the same repository instance the `SaveManager` is built on, without awaiting it — nothing
downstream reads the result, so startup does not wait on the disk.

The sweep decides on AGE rather than ownership. It cannot ask whether an artefact belongs to a write
in flight: the app requests no single-instance lock, so a second instance sharing the same `userData`
may be writing one right now, and taking that file would restore the same `ENOENT`-on-rename the
per-write name was introduced to remove. `ORPHAN_TEMP_MAX_AGE_MS` is one hour, chosen by what a wrong
answer costs in each direction rather than by timing a write: reaping late costs disk the next start
gives back, reaping early costs a save. It is a heuristic, not a proof — a writer suspended past the
window has its artefact taken, and its rename then fails the way any interrupted save's does.

A name that merely CONTAINS the temp shape is left alone, not only one that lacks it: the sweep
unlinks what it matches, so `autosave.chimera.1.tmp.bak` has to survive it.
