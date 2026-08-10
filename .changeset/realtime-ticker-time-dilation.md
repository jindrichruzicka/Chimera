---
'@chimera-engine/electron': minor
---

Re-pace `RealtimeTicker` by the host snapshot's `timeScalePermille` (F82).

`RealtimeTickerOptions` gains an optional `getRateScalePermille?: () => number`, an optional
`logger` and an optional `now` clock. `hz` stays `readonly` and stays the BASE rate — there is
no `setHz`, no rename and no alias — and a new `effectiveHz` getter reports the product.

With the getter absent, `start()` schedules through `setInterval` at `1000 / hz` and never calls
`setTimeout`. With it present, a self-scheduling `setTimeout` chain runs at
`dilatedBeatPeriodMs(1000 / hz, permille)` from
`@chimera-engine/simulation/foundation/time-scale.js`, re-read before every re-arm so a scale
change lands from the next beat on. The chain targets an absolute next-fire time
(`nextAt = max(nextAt + period, now)`), so a beat's own dispatch cost is not added to the next
delay and a long stall resynchronises instead of firing its backlog — no catch-up or missed-beat
recovery exists. A getter that throws is caught, reported once through the injected logger, and
treated as real time.

The re-arm sits in a `finally`, not after the dispatch, so a beat whose `ActionPipeline`
rejection or game-reducer throw escapes `dispatch` behaves as it does under `setInterval`: the
next beat is still armed. A `stop()` called from inside a dispatch still wins and leaves no
pending callback.

The main process wires the getter unconditionally to the host snapshot's `timeScalePermille`, so
every `realtime` game now runs the `setTimeout` chain rather than the fixed interval. At real
time the chain's period is `dilatedBeatPeriodMs(1000 / hz, 1000)`, which is exactly the interval
it replaces.
