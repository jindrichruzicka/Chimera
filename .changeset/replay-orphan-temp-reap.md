---
'@chimera-engine/electron': patch
---

Reap replay temp files a crashed write left behind.

`FileReplayRepository` and `FilePerspectiveReplayRepository` name every replay with a fresh UUID, so
their temp paths are per write and no later write reopens one: a process killed between a replay's
write and its rename left a full-size `.tmp` that nothing removed and the replay list never showed.
Both repositories now carry `reapOrphanTempFiles()`, and the composition root runs it once per app
start over `userData/replays` and `userData/perspective-replays`, as it already did for saves.

The sweep itself moved out of `FileSaveRepository` into `electron/main/orphan-temp-reap.ts`
(`sweepOrphanTempFiles()`, with `ORPHAN_TEMP_MAX_AGE_MS` beside it), and all three repositories
call it with the names they write. It takes only temp artefacts at least an hour old.
