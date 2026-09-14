---
'@chimera-engine/electron': patch
---

Reap crash dump temp files an interrupted dump write left behind.

A process killed between a crash dump's write and its rename left a `crash-<iso>.json.tmp` in
`userData/crashes/` that no sweep removed. The composition root now runs
`reapOrphanCrashDumpTempFiles()` once per app start over that directory, taking only dump temp files
at least an hour old.

Crash dumps sit directly in `userData/crashes/`, one level above where `sweepOrphanTempFiles()`
looks, so `electron/main/orphan-temp-reap.ts` gains `sweepOrphanTempFilesIn()`, the same sweep over
the files of one directory.
