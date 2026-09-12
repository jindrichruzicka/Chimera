---
'@chimera-engine/electron': patch
---

Give a save's temp file a name no second instance can take.

`FileSaveRepository` told one in-flight write from another by a module-level counter, and module
state restarts in every process. Two instances sharing one `userData` — nothing refuses a second
one, the app requests no single-instance lock — therefore both opened `<slot>.chimera.1.tmp` for
their first save of a slot: both wrote that file, the first rename moved it away, and the second
rename failed with `ENOENT` and rejected its caller's save. That is the failure the per-write name
was introduced to remove, and the autosave slot is the one with the most writes.

The temp name now carries the process id as well as the counter (`<slot>.chimera.<pid>.<n>.tmp`).
No two live processes carry one process id, so the prefix separates the two counters wherever they
come from one operating system; the counter still does the work inside a process.

`reapOrphanTempFiles()` takes the new shape alongside both superseded ones — the counter alone, and
the per-slot `<slot>.chimera.tmp` an older install can still be carrying — and `list()` shows none
of them, because it filters on the `.chimera` suffix.
