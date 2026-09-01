---
'@chimera-engine/electron': patch
---

Put a level threshold in front of the durable log file, and demote the per-beat log sites to
`trace`.

The root logger deliberately owns no threshold — it fans out to sinks with different appetites, so
one threshold on the logger would starve whichever leg wants more. The threshold therefore belongs
on a sink, and `createMinLevelSink` has existed for exactly that. It had one production call site:
the dev-stderr mirror, which is `null` when `app.isPackaged`. The file leg was passed raw, so every
`debug` a shipped build emitted reached the daily log file — a file with rotation but no size cap.

That is only a defect once something logs per beat, which is what a realtime host does.
`StateBroadcaster` logged once per viewer per beat on both the full-snapshot path and the
clock-only path, and once per spectator per wave on the spectator fan-out; `PerspectiveReplayManager`
logged once per recorded frame. `main()` now wires the file leg as
`createMinLevelSink(resolveFileLogLevel(process.env['CHIMERA_LOG_LEVEL']), pinoSink)`, defaulting to
`info`, and those four sites moved to `trace`.

Both halves are load-bearing and neither works alone. `trace` ranks BELOW `debug`, so demoting the
call sites against an unfiltered sink changes nothing; and the threshold alone would leave the
sites at a level a bug report is likely to ask for, so `CHIMERA_LOG_LEVEL=debug` would put the
per-beat lines straight back. `trace` is what an operator asks for when they actually want the beat.

`CHIMERA_LOG_LEVEL` accepts any `LogLevel`, trimmed and case-insensitive; an unrecognised value
resolves to `info` rather than failing the boot, because a mistyped variable must not cost a shipped
build its log file. It is read once, at wire-up.

The threshold wraps the fan-out LEG, not `pinoSink` itself, so `startPeriodicFlush` and
`refuseToStart` keep draining the real SonicBoom buffer. The memory ring buffer that backs
`chimera:logs:readRecent` is unfiltered, and so is the `dev:mp` harness stdout stream: one is
capacity-bounded, the other is a live developer stream, and neither is a file that grows for the
length of a match. The crash dump is upstream of all of this — it drains the
`LogRingBufferSink` the root logger is constructed with, above the fan-out — so no threshold on a
leg can reach it.

`main()` no longer builds the fan-out inline. `createMainLoggerSink({ file, memory, harnessStdout,
devStderr, fileMinLevel })` composes it, because WHICH leg carries the threshold is the load-bearing
decision and it is not observable from a test of the threshold helper alone. What `main()` in turn
passes for `fileMinLevel` is not observable from a test of `createMainLoggerSink` either, so that is
pinned by driving the real `main()` and pushing one entry per level through the `chimera:logs:emit`
handler — whose sink is the root ring buffer, the same chain every main-process log call takes to
the fan-out — then reading what the Pino destination received.
