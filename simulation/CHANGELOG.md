# @chimera-engine/simulation

## 1.0.0-rc.13

### Minor Changes

- 1f2ef60: Resolve `FixedPoint`'s persistence gap: it is arithmetic, not storage.

    A `FixedPoint` is a `bigint`, and every persistence boundary in the engine is bare
    `JSON.stringify`, which throws on a `bigint` rather than degrading; no reviver on the way back
    produces one. Invariant #75 no longer names `FixedPoint` as the stored form of a fractional gameplay
    quantity: that form is a scaled integer `number` in a declared unit (milli-cells, basis points),
    which Invariant #44 already blesses, JSON-native and allocation-free on a realtime beat path.
    `FixedPoint` stays the arithmetic that produces such a value, converted with `toInt()` before it
    reaches a `GameSnapshot` field or an `EngineAction.payload`, and its doc comment now says so.

    `AnimationWindowPayload` narrows from `number | FixedPoint` to `number`, and
    `AnimationWindowManager.open` refuses any payload value that
    is not an integer `number` (a float, a `bigint`, or a non-number that arrived through a cast) with
    the same `RangeError` it already raised for a float. A window opened with a `FixedPoint` value used
    to be accepted and then made the match unsavable at the first autosave.

    The alternative — a paired `bigint` replacer/reviver at every boundary, a save `schemaVersion`
    bump with a migrator step, and a checksum that still verifies a save written before it — was
    weighed and not taken: it keeps a per-operation `bigint` allocation on every hot path and touches
    four boundaries to preserve a representation with no production call site.

- 5fdddf4: Add `GameManifest.matchHistory` and `resolveMatchHistorySupport` — a per-game declaration of what
  match history the host should keep.

    A game had no way to tell the host it needs no undo, no replay recording, or a tighter action-history
    bound. The mechanical knobs already existed — `InMemoryActionHistory({ maxEntries })` and
    `UndoPolicy.allowUndo` — with no contract to drive them from. This adds the declaration and its
    resolver.

    `GameMatchHistorySupport` carries `undo`, `replay` and an optional `retainActions`.
    `resolveMatchHistorySupport(manifest)` returns all three, defaulting absent fields off
    `manifest.realtime`: a real-time game gets
    `{ undo: false, replay: true, retainActions: DEFAULT_REALTIME_RETAIN_ACTIONS }`, everything else
    `{ undo: true, replay: true, retainActions: MAX_ACTION_HISTORY_ENTRIES }` — the bound
    `InMemoryActionHistory` has always applied, so a manifest with no declaration resolves to the
    pre-existing behaviour.

    The resolver never throws. `resolveTickerHz` throws on a bad `tickRateMs`, but that is the wrong
    precedent for an optional capability: malformed input is dropped the way `resolveGameLanguages` drops
    it, per field, so a bad manifest degrades instead of bricking the boot. A `retainActions` that is not
    an integer in `[1, MAX_ACTION_HISTORY_ENTRIES]` falls back to the mode's default; a non-boolean
    `undo` or `replay` falls back to its own default without disturbing the other. `realtime` is read for
    truthiness, the same reading `resolveTickerHz` uses, so the two cannot disagree about which games are
    real-time.

    `MAX_ACTION_HISTORY_ENTRIES` moves to
    `simulation/foundation/game-manifest-contract.ts`, because the resolver in the contract leaf clamps
    against it and `foundation/` imports nothing from `engine/`. `simulation/engine/UndoManager.ts`
    re-exports it under the same name, so every existing import path and the
    `@chimera-engine/simulation/engine` barrel are unchanged, and its value is unchanged.

- 397708b: Apply snapshot deltas in the renderer bridge, and measure what the delta path saves.

    `GameAPI` gains `onSnapshotDelta` and the `chimera:game:snapshot-delta` channel. On a beat the
    broadcaster decided is a delta, main sends the changed paths instead of the whole projection — that
    IPC leg cost a structured clone of a whole projection per beat, and the changed paths are what it
    costs instead. Main still keeps the projection for what needs it in-process: `getCurrentSnapshot`
    answers with it and the perspective recorder appends it, both pinned.

    `ipcClient` holds the last snapshot it RECEIVED, separate from the store's, which is the last one
    PAINTED — the host measures the next delta against the former. Deltas are applied on arrival and only
    the store WRITE is paced: newest-wins is right for a whole snapshot, which is measured against
    nothing, and wrong for a delta, which is measured against what the one before it produced. So a frame
    carries one write with everything that accumulated in it and no delta is dropped. An inapplicable
    delta is refused rather than partly applied, and `engine:sync_request` is sent once per broken chain.

    `RendererSnapshotRecipient.sendSnapshot` now takes the delta alongside the projection — `null` on a
    keyframe. Breaking for anyone who registered a recipient directly.

    The measurement F101 asked for is now in `OutboundPerBeatPerf.bench.test.ts` and recorded in §7.5, at
    both ends of the axis the delta path lives on. At a realtime beat's motion — 25 of 500 entities, 100 of
    2000 — the payload is about a twentieth of the projection at both grids. With nearly the whole arena
    moving the delta is LARGER than the snapshot it would replace, about 105% of its bytes, which is the
    case `StateBroadcaster`'s size fallback exists for. Each run reports the count `measureDeltaWave` counted, and
    neither delta row is gated: a ratio asserted there would gate the runner
    rather than the code.

- 9d4fa92: Send the changed paths instead of the whole projection, with periodic keyframes.

    `SNAPSHOT_DELTA` is a new `ServerMessage`. It carries a `SnapshotDelta`, a `version` (a client built for
    another version REFUSES the frame at `ServerMessageSchema.safeParse` rather than applying it as if it
    were this shape), and a CRC32 over the `delta` — the bytes the frame actually carries.
    `ServerConnection` validates that checksum against the pre-Zod bytes exactly as it does a `SNAPSHOT`,
    because a corrupt delta is the worse of the two: a snapshot REPLACES the client's state, so the next
    one repairs it, while a delta is APPLIED to state the client keeps.

    `StateBroadcaster` now keeps the last projection it sent each recipient and sends a delta against it.
    Where it sends a whole snapshot instead is `StateBroadcaster.sendProjection`'s to say; the
    size-fallback case also leaves a `trace` line and bumps a counter on `deltaMetrics()`.

    `BroadcastContext.broadcast` gains a third argument, `{ forceFull }`, which Stage 7 sets for
    `engine:sync_request`. The callback cannot infer it: a re-sync arriving after a run of clock-only beats
    has a projection that genuinely DID change, so an empty diff is not the signal — and the viewer that
    asked to be re-synced is precisely the one whose baseline the host cannot vouch for. Without it
    `multiplayer-soak.spec.ts` fails: its `requestFullSnapshotSync` produced a delta rather than the
    keyframe its name promises. Point-sends stay whole
    snapshots: every caller of one is asking for the whole thing by definition. The baseline is keyed by RECIPIENT rather than by seat, so a spectator is diffed against
    what that spectator received, and the broadcaster subscribes to `onPlayerLeft` itself to drop a
    departed recipient's entry — the composition root's own handler returns early down several branches,
    and a baseline left behind on any of them is the unbounded map this work exists to remove.

    `HostTransport` gains `sendSnapshotDelta`. `ClientTransport` is unchanged: `WsClientTransport` and the
    in-memory provider both rebuild the whole projection from the delta and publish THAT, so
    `onSnapshotReceived` still hands subscribers a whole snapshot and nothing above the transport learns a
    delta was on the wire. A delta the client cannot apply is dropped — never partially applied — and the
    next whole snapshot re-establishes the chain. `WsClientTransport` also asks for one, sending
    `engine:sync_request` once per broken chain, since that request makes the host broadcast to every viewer
    rather than only to the asker.

    The checksum `onSnapshotReceived` carries is now documented as the one the host stamped on the frame,
    over that frame's own body, and the delta path passes it through rather than measuring the rebuild.
    Measuring cannot give the host's number: `ServerMessageSchema` rebuilds a parsed snapshot in the
    SCHEMA's key order rather than the host projector's, and `crc32Json` is order-sensitive, so two deeply
    equal objects check differently. Comparing a host checksum with a client one is therefore meaningful
    only across a whole-snapshot frame.

    Breaking for anyone implementing `HostTransport` outside this repo: `sendSnapshotDelta` is required.

- a15bfbd: Generalise the structural snapshot differ, and add the after-only form of a diff.

    `diffSnapshots` moves from `simulation/debug/SnapshotDiff.ts` to the contract leaf at
    `simulation/foundation/snapshot-diff.ts`, with its constraint relaxed from
    `TState extends BaseGameSnapshot` to `TState extends { tick: number }`. A projected
    `PlayerSnapshot` carries no `seed` and no `timers` by design (Invariant #3), so the old constraint admitted one only through a
    cast — and the cast erased exactly the distinction the invariant rests on. Nothing about the diff's
    behaviour changed, and `@chimera-engine/simulation/debug` re-exports `diffSnapshots`, `DiffEntry`
    and `SnapshotDiff` from the new location, so that public subpath still carries them — see
    `simulation/debug/index.test.ts`.

    `simulation/foundation/snapshot-delta.ts` is new. `toSnapshotDelta` projects a diff onto its
    after-only form: a `DiffEntry` carries `before` as well as `after`, which is right for an inspector
    showing both sides and wrong for anything that has to fit in a frame, where repeating the old value
    can make the delta larger than the snapshot it replaces. `applySnapshotDelta` is the other half — it
    reproduces the new snapshot from the old one, copying only the containers along a changed path and
    sharing the rest by reference. Where it refuses, it answers `null` rather than writing partially.
    What it refuses, and why each refusal matters, is the `rejects a delta it cannot apply` block of
    `simulation/foundation/snapshot-delta.test.ts`.

    `@chimera-engine/electron` takes a comment-only change: the packaged-bundle marker file names the
    differ's path in its rationale for excluding `diffSnapshots` from the marker set.

### Patch Changes

- 370ed0c: Latch the `action-history:overflow` report so a saturated history reports once per episode, not once
  per append.

    `InMemoryActionHistory.append()` warned inside its eviction branch, and that branch is taken on
    every append once the history is full. For a turn-based game that is nearly free: `pruneTo` runs on
    `engine:end_turn` and keeps the history far below its cap, so the warn fires only when pruning is
    genuinely broken — which is what it was written for.

    A game that dispatches no `engine:end_turn` never runs that prune, so the cap is the bound it
    operates against: the history fills, and every append after that evicts.

    Saturation is a state transition — retention has just become lossy — not a per-append event. A
    private latch is raised on the first eviction — not on reaching the cap, since a full history that
    has dropped nothing is still lossless — and re-armed by a `pruneTo` that drops the live size back
    below capacity, so a turn-based game that saturates, prunes and saturates again still
    reports each episode. Only a prune that actually FREES space re-arms it: `pruneTo` with a cutoff
    that evicts nothing leaves the history saturated, so nothing transitioned and the next append must
    not re-report the same episode.

    Eviction itself is untouched — every overflowing append still drops its oldest entry, and the
    `sinceLastMemento()`, head-cursor and compaction bookkeeping are unchanged. Only the reporting
    cadence moves. The log key `action-history:overflow` and its `capacity` field are unchanged too.

    Invariant #45 is amended to state the cadence rather than implying one warn per eviction, and
    `electron/main/__tests__/logger-wiring.integration.test.ts` now drives the real host pipeline 200
    appends past the cap and pins exactly one warn — a pipeline that never prunes is the condition that
    made the cadence matter, and no unit test constructs it.

- b7fe1b3: Assert the one-tick-per-action rule at the pipeline seam.

    Invariant #42 says `GameSnapshot.tick` advances by exactly 1 per action applied by
    `ActionPipeline.process()`. Three consumers depended on it and none could enforce it:
    `ReplayPlayer.step()` throws a `DeterminismError` long after the fact, naming only the tick it
    stopped at, and `replay-playback-manager` derives both `totalTicks` and its `step()` fast path from
    the same rule. Stage 5 took `def.reduce`'s output verbatim, so a reducer that changed the snapshot
    without touching the clock produced a match that played fine and a recording that could not.

    `ActionPipeline` now checks it immediately after Stage 5 and throws a named `TickContractError`
    whose message identifies the reducer at fault. The check is development-only — `NODE_ENV` is the
    signal, which the packaging `define` bakes to `"production"` in a packaged bundle — so a violation
    discovered after release cannot brick a shipped game. It still surfaces at replay time, where it
    always did.

    The rule is measured against `reduce`'s own output, and only for a reduce that ran alone. Four
    cases are exempt, each with its own test: a reducer that returns its INPUT REFERENCE changed
    nothing, so there is no action for the clock to count (`engine:save`, `engine:load`,
    `engine:sync_request` and `engine:end_turn` with no `turnClock` all take this arm); `engine:undo`
    and `engine:redo` are exempt by name, because a recorded undo reconstructs a prior state rather
    than advancing; the check does not run on a nested dispatch; and a reduce that
    dispatched children returns their cumulative advance rather than its own, which is what `engine:tick`
    does when a timer fires.

- b1ff2e4: Skip the per-beat animation-window sweep, and the entity key set it builds, when the registry is
  empty.

    `engine:tick` built `new Set(Object.keys(nextState.entities))` and spread the snapshot on every beat
    whenever `animationWindows` was merely present. The field is sticky — the close paths leave `{}`
    behind rather than deleting the key — so a game that had ever opened one window paid an O(entities)
    walk on every later beat, and `AnimationWindowManager.advance` discovered the registry was empty
    only after the caller had paid it. `apps/action` never touches the field; this was armed for the
    next realtime game.

    `AnimationWindowManager.isEmpty(registry)` probes the registry without allocating (a guarded
    `for...in`, so a polluted `Object.prototype` cannot make an empty registry look occupied), the beat
    pass checks it before building the key set, and `advance` uses the same probe for its own fast
    path. A beat with an empty registry now leaves `animationWindows` as the same reference by never
    writing it, which keeps the pipeline's clock-only broadcast engaged, as before.

- b8552d6: Answer `UndoManager.canUndo` from an O(1) history size query instead of a copy of the entry list.

    `canUndo` only asks whether the effective undo segment is non-empty, but it read that segment through
    `getEffectiveEntries()` → `ActionHistory.sinceLastMemento()`, which slices the live history into a
    fresh array. It sits on the per-viewer broadcast projection path — `ActionPipeline` Stage 7 projects
    once per seated player, and `StateBroadcaster.fanOutToSpectators` projects again for each spectator's
    followed seat — and in a game that dispatches no `engine:end_turn` the segment is never re-based by a
    memento boundary, so its length grows to the history's cap.

    `ActionHistory` gains `sizeSinceLastMemento(): number`. This is a required member, so any
    implementer of the interface must add it. It and `sinceLastMemento()` now both derive their start
    index from one private accessor, so the count describes exactly the array the slice would produce.

    `canUndo` reads the per-player virtual history's length when an undo has already diverged it from the
    shared history, and the size query otherwise. What it answers for a given state is pinned by the
    `canUndo` and `canUndo — history access` describe blocks in `simulation/engine/UndoManager.test.ts`.
    `undo()` still calls `sinceLastMemento()`: it genuinely replays the entries.

- b20e420: Wire the compressed replay serializer, and stop pretty-printing replay files.

    `CompressedReplaySerializer` gzips a `ReplayFile` and its own docblock said to inject it for
    space-efficient storage — but `main()` wired the uncompressed `JsonReplaySerializer` into the
    deterministic `FileReplayRepository`. Separately, `serializeReplay` called
    `JSON.stringify(file, null, 2)`; the indentation is pure size for a file no human reads, and
    `deserializeReplay` is indifferent to whitespace, so removing it changes nothing a consumer sees.

    Both halves are dev/e2e-scoped: `createDeterministicReplayPort` returns `undefined` when
    `app.isPackaged`, so a shipped build writes no deterministic replay at all.

    The read path had to change with the write path. Both encodings share the `.chimera-replay`
    extension, so nothing in the path distinguishes them, and `FileReplayRepository`
    deserializes every matching file with no per-file tolerance — one unreadable replay would
    take the whole listing, not just its own row. `deserializeReplayCompressed` therefore dispatches on
    the gzip magic (`1f 8b`, RFC 1952) and falls through to plain JSON when it is absent, so a replay
    already on disk still loads and a mixed directory still lists.

    Dispatching on the magic rather than on a failed `gunzip` is the load-bearing half of that: a
    truncated or corrupt gzip stream keeps its own error instead of falling through to be reported as
    bad JSON. Both routes throw `ReplayParseError`, so the tests assert on the message — a check on the
    error type alone cannot tell the two apart, and passes against the wrong implementation.

    `durationTicks`, the file extension, the listing sort, `parseReplayFile`'s validation and the
    `safeReviver` prototype-pollution guard are untouched.

- 3b29c86: Report host heap and recorded-action count in the Performance HUD.

    `PerfSample`'s `heapMb` is the RENDERER's `performance.memory`, so a host-side buffer could grow to
    any size with the HUD unchanged. Two new fields carry the host's own numbers: `hostHeapMb` from
    `process.memoryUsage().heapUsed`, and `recordedActionCount` from a new
    `ReplayManager.recordedActionCount()` over the live deterministic recording.

    They arrive on a new `chimera:game:host-metrics` push driven by main's own 1 Hz timer
    (`startHostMetricsPush`), never per beat — at a beat rate the push would be the cost it measures.
    Only scalars cross, and the payload is schema-validated at the preload boundary,
    where an absent key is refused rather than read as `null`.

    Both fields are `number | null` where `null` means UNAVAILABLE — no push yet, or no recording
    running — and the HUD renders it as `—`. A started recording holding no actions reads `0`. `PerfStats.totalActionCount` remains what it was: the debug bridge's own array
    length, capped and constant once saturated, and absent from a shipped game.

    §13.5 now records what actually executes where. The timing gates run on CI, because the bench files
    sit under `apps/*/__tests__/` and `pnpm -r test` collects them. The main-process heap case runs and
    logs there too, but its assertion sits behind an `if (gc !== undefined)` guard, and `globalThis.gc`
    exists only under `--expose-gc`, which `npm run test:perf` passes and CI does not.

- e170cf4: Thread a game's declared match-history capability into the hosted session's undo policy, action-history
  bound and start-of-match memento.

    `buildHostSessionPipeline` hard-wired both collaborators: `new InMemoryActionHistory({ logger })` and
    `new InMemoryUndoManager(history, DEFAULT_UNDO_POLICY, replay)`. `HostSessionPipelineOptions` gains
    `undoPolicy` and `retainActions`; both are optional and both default to what was hard-wired, so a
    caller that passes neither builds exactly the pipeline it built before.

    `undoPolicyForMatchHistory` maps a resolved `GameMatchHistorySupport` onto an `UndoPolicy`, reading
    only `undo`. A game that keeps undo gets `DEFAULT_UNDO_POLICY` itself; one that declares none gets the
    same policy with `allowUndo` false. The manager stays in `PipelineContext` either way, so `engine:undo`
    still enters through the Stage 3 intercept and is refused there with `policy_disallows` (Invariant #7).

    The composition root resolves the capability once from the hosted game's manifest, so no consumer of
    it can disagree with another. The turn handover keeps seeding the next player's memento from inside `ActionPipeline`'s
    `engine:end_turn` branch, which this change does not touch; what a declining game loses is the
    start-of-match baseline, which is refreshed only by that same handover.

    `apps/tactics` declares no `matchHistory`, so it resolves to undo on, replay on and the
    `MAX_ACTION_HISTORY_ENTRIES` bound — the values the host already used, unchanged.

    `apps/action` is `realtime: true`, so it resolves to undo off, replay on and a 1,000-entry history
    where the host previously gave it `DEFAULT_UNDO_POLICY`, a start-of-match memento and 10,000 entries. Its Ctrl+Z binding is the engine default spread into the app's settings
    schema; it survives, and the seat's projected `undoMeta.canUndo` is now `false`, which is what the
    renderer's own key handler returns on.

    Prose the change falsified is repaired rather than left standing: `InMemoryActionHistory`'s
    `maxEntries` option is documented as a host knob rather than a test-only override, and Invariant #45,
    the `ActionHistory` listing in the action-pipeline doc and three pending changesets no longer name
    `MAX_ACTION_HISTORY_ENTRIES` as the bound every hosted session runs against.

- 51fec31: Document the declared match-history contract, and amend Invariant #45 so its two numbers read
  correctly after it.

    Only one of Invariant #45's two numbers moved across this arc.
    `TURN_MEMENTO_RETENTION = 4` is unchanged and the row now says so: it is turn-scoped, reached only
    from `ActionPipeline`'s `engine:end_turn` branch, and no manifest declaration touches it. The entry
    cap is what became per-game — a hosted session's history is constructed with the game's resolved
    `matchHistory.retainActions`, for which `MAX_ACTION_HISTORY_ENTRIES = 10_000` is the turn-based
    default and the ceiling a declaration may not exceed, and `DEFAULT_REALTIME_RETAIN_ACTIONS` is the
    real-time default.

    §4.5/§7 gains the contract: the interface, the `realtime`-keyed default table, the never-throws
    rule, and what the host and the renderer each read from the resolved capability. §4.28 gains the
    declining path, including that the save and preview refusals are the ones a never-recorded match
    already gets. The Turn Boundary Rules table gains the declared-no-undo row. §4.26 gains
    `useInputAction`'s `enabled` option, and its "what stays internal" paragraph no longer enumerates
    names it cannot keep complete.

    The blank scaffold template documents `matchHistory` on its manifest with a commented-out example,
    and its `renderer/loaders.ts` forwards the resolved capability. Without that forward a scaffolded
    game that declares no undo would still bind its undo key — the renderer half of the declaration
    exists only because a game forwards it.

    The traceability matrix names F96 on the §4.5, §4.28 and §4.37 rows and in the feature-to-milestone
    index.

- eb6a674: Report `action-history:overflow` at `info` rather than `warn` when no undo replays the history.

    The warn was written for a retention failure — a capability the player has, quietly reduced. A game
    that declares no undo has no such capability: the entries the cap drops are read back through the undo
    manager alone, since `HistoryContext.history` narrows the type to `append` and `pruneTo` for every
    other consumer. The action app is the case that made this matter: it declares no undo, dispatches no
    `engine:end_turn` and so never reaches `pruneTo`, and `ActionPipeline` appends every depth-0 dispatch
    including `engine:tick`. At its resolved bound of 1_000 entries and a 100 ms beat that history
    saturates about 100 seconds in and stays saturated, so a `warn` there names steady-state behaviour as
    a fault and an operator who reads one learns nothing.

    `InMemoryActionHistory` takes an `undoable` option, defaulting to `true` so an existing caller is
    unchanged, and `buildHostSessionPipeline` supplies the resolved `UndoPolicy.allowUndo`. Only the level
    moves: the message, the `capacity` context and the saturation latch are the same. `info` rather than
    `debug` is where `resolveFileLogLevel` defaults the durable file sink's threshold (§4.27). Invariant
    #45 and §4.5 state which level follows which resolved capability.

- b4ee634: Walk the projector's entity and player records by `Object.keys` instead of `Object.entries`.

    `DefaultStateProjector` ran `Object.entries(fullState.entities)` and `Object.entries(fullState.players)`
    once per recipient per beat, materialising one `[key, value]` pair array per entry each time — the
    O(entities × viewers) allocation on the broadcast path. `Object.keys` with an indexed lookup
    enumerates the same own keys in the same order (integer-like keys ascending, then strings in
    insertion order), so the projected records are deep-equal and serialise to the same bytes, which
    keeps every downstream checksum unchanged.

    `for...in` was measured as well and rejected: over the plain-object source record it also
    enumerates any enumerable key added to `Object.prototype`, which `Object.entries` and
    `Object.keys` never do, and it was no faster. A test pollutes the prototype for the duration of
    one projection and asserts the polluted key is absent from both records. Measured on the
    development machine (Node v25.9.0, 1000 entities, median of 5 runs of 2000 calls): a masking
    projection pass took 0.126 ms with `Object.entries`, 0.061 ms with `for...in`, 0.054 ms with
    `Object.keys`; the bare loop without masking took 0.092 ms, 0.026 ms and 0.021 ms respectively.

- fe82ccc: Derive the `ActionPipeline` tick budget from the game's declared tick rate.

    `TICK_BUDGET_MS = 16` was documented as "≤ 16 ms at 20 Hz" but was parameterised by nothing, while
    `resolveTickerHz` accepts any finite positive `tickRateMs` (100 Hz is pinned as correct in
    `game-manifest-contract.test.ts`). A game declaring a 10 ms period was therefore gated against a
    budget larger than its entire beat — a gate that could not fail.

    `tickBudgetMsFor(tickRateMs)` now returns `TICK_BUDGET_DUTY` (0.32) of the declared period, and
    `TICK_BUDGET_MS` is derived from `DEFAULT_TICK_RATE_MS`: it is still 16, so no existing gate's
    number moved. The duty is locked by a test the way the heap budgets are, so changing the engine's
    headroom policy is a deliberate act. `tickBudgetMsFor` throws a `RangeError` on a non-finite or
    non-positive period, mirroring `resolveTickerHz`'s refusal of the same inputs, and accepts a
    fractional one, as `resolveTickerHz` also does.

- 7635670: Refuse undo when eviction has dropped entries recorded since the turn memento.

    `InMemoryUndoManager.undo()` replays `sinceLastMemento()` on top of `memento.snapshotAtTurnStart`.
    `InMemoryActionHistory` evicts by advancing a head cursor, and `#clampMementoBoundary()` drags the
    memento boundary up with it — so once eviction passes the boundary, the tail `sinceLastMemento()`
    returns begins later than the baseline it is relative to. The entries in between are gone, and
    `undo()` replayed the remainder onto the stale baseline and returned a snapshot that is neither the
    pre-undo state nor any state the match had been in, with no error.

    Two evictors reach that clamp: the overflow cap in `append()`, and `pruneTo()` walking past the
    boundary. A realtime game is where the cap bites — it dispatches no `engine:end_turn`, so it neither
    prunes nor re-takes a memento.

    `ActionHistory` gains `hasEvictedSinceMemento(): boolean`. It is a required member, so every
    implementer must add it. `InMemoryActionHistory` raises the flag where `#clampMementoBoundary()`
    actually moves the boundary, and clears it on the next `markMementoBoundary()` — a fresh baseline is
    anchored to the live tail, so an earlier gap is no longer in front of the segment.

    `canUndo()` returns `false` while the flag holds and the player is reading the shared history, so the
    projected `undoMeta` stops advertising undo, and `undo()` throws `UndoNotAllowedError`. Its `reason`
    is the existing `not_enough_history` rather than a new code: the entries between the baseline and the
    surviving tail are exactly the history the undo needs and no longer has. Re-anchoring the memento is
    deliberately not attempted — that would need a snapshot the manager does not hold, and refusing is
    the honest answer.

    A player who has already undone reads their own virtual history, which the manager owns and which
    was captured while the segment was whole, so their undo is unaffected. Eviction that has only reached
    entries recorded _before_ the memento is unaffected too — the segment undo replays is still intact.

- 94c0cb1: Remove the client-prediction surface, which was implemented and tested but reachable from nothing.

    There was no client prediction: every action waited a full host round trip. What existed was a chain
    where each link's only consumer was the next one, and the last led nowhere — `ActionDefinition.predictable`,
    the `chimera:game:predictable-action-types` channel and its `GameAPI.getPredictableActionTypes()`
    method, the `isPredictable` predicate the IPC client was built with, `gameStore.addPrediction` /
    `confirmPrediction`, and the `predictedActions` array, which no component, hook or reducer anywhere
    in the repo read. Beside it sat `ClientPredictor` and `ReconcileBuffer`, exported from the engine
    barrel and unit-tested, constructed only in their own tests, and typed on `BaseGameSnapshot` — the
    state Invariant #3 keeps inside the main process — so a client could not have used them as written.

    All of it is gone, together with the comment in `ipcClient.ts` that forbade importing the two
    classes: a prohibition outlives its subject as a puzzle, not a rule. `PredictionStore` is now
    `MatchStatusStore`, carrying the three fields that survive — `latencyMs`, `canUndo`, `canRedo`. What `latencyMs` is written by, and
    what reads it, is §6.3's.

    §6 says what it costs to add prediction properly instead of describing what was there: the renderer
    holds a `PlayerSnapshot`, so the reducers it would replay have to be renderer-safe and registered as
    such, and the optimistic state may never become an authoritative write.

    Breaking for adopters who set `predictable: true` on an action definition, or who call
    `getPredictableActionTypes()`: both are removed. Neither did anything.

- ddca27d: Give `snapshot.events` a retention rule and enforce it: it is a per-ACTION outbox, drained by
  `ActionPipeline.process()` before every outer action's reduce.

    Nothing cleared `events` before this. The field is in `BASE_SNAPSHOT_KEYS`, so `baseSnapshotOnly()`
    carried it across both match boundaries and it accumulated for the life of a SESSION — riding into
    every projected `PlayerSnapshot`, every broadcast and every save checkpoint the body checksum
    covers.

    The rule is enforced per action rather than per beat, which is what the issue proposed. Measured:
    `resolveTickerHz` returns `null` for a `realtime: false` manifest, so outside the `CHIMERA_E2E`
    forced-interval seam the host builds no `RealtimeTicker` for such a game — and
    `apps/tactics/simulation/actions.ts`, which appends events, sits under exactly such a manifest.
    Clearing inside the `engine:tick` reduce would therefore have left a shipped session of it
    accumulating while the docs claimed a bound. Per action also makes the documented contract literally
    true: `tick` is "+1 per applied action", so "all events this tick" and "one action's events" are the
    same sentence.

    The drain is gated on `#depth === 0`, so a fired timer's nested dispatch adds to the outer action's
    outbox rather than replacing it. Every later comparison in the frame reads the DRAINED value, which
    is what keeps `#isClockOnlyTick` seeing an idle beat as idle — including the first beat after an
    eventful one — so the tick-only broadcast branch stays engaged. The drained array is one shared
    frozen constant: an in-place append, already forbidden by Invariant #43, throws at the offending
    line instead of contaminating every later drain.

    `EventAudioPlayer` tracked a played COUNT, which only works while the array grows; under a drained
    outbox that silently drops any batch no longer than the one before it. It now plays each batch whole
    and keys its ref on the array's IDENTITY, so a re-render carrying a new `binding` object plays
    nothing.

    `GameEvent`'s shape is unchanged, and `StateProjector` filters per viewer exactly as before.

- 5a3584a: Add a sustained-match retention gate that fails when a retained structure grows without bound.

    Every growth defect this arc found shares one shape: a structure that grows with elapsed beats and
    nothing that notices. The new `electron/main/__tests__/sustained-match-retention.integration.test.ts`
    drives a REAL hosted session with the action history, the deterministic recorder and the perspective
    recorder armed, through a harness under `electron/main/__test-support__/`. The §13.4 heap gate
    builds a bare `ActionPipeline`, so none of those three is wired there.

    It probes the defect class rather than an instance: retained sizes are sampled at N beats and again
    at 2N and compared, so the assertion is about growth rate and not about a byte number that drifts.
    Two scales, because the capped buffers must be sampled past a 10,000 cap while the per-beat working
    state must be sampled small — `TimerManager.advance` walks the timer registry once per beat, so a
    fired timer that survives its beat makes the run quadratic, and a synchronous beat loop cannot be
    cut short by a test timeout.

    Two small observability seams make it possible. `InMemoryActionHistory.size()` reports the live
    entry count — what `maxEntries` bounds, whole rather than the undoable tail `sizeSinceLastMemento()`
    reports once a turn memento has re-based it. `HostSessionPipelineResult.retainedActionCount()`
    surfaces it for a session whose history is constructed inside `buildHostSessionPipeline`.

- 16e3f97: Remove a fired one-shot timer from `snapshot.timers` instead of rewriting it as an
  `{ active: false }` tombstone.

    `TimerManager.advance()` had no delete path: once a one-shot fired, its entry stayed in the registry
    inactive for the rest of the session. The registry is snapshot-resident, so every tombstone sat in
    every later save checkpoint the body checksum covers and under every later beat's walk of the
    registry — one dead entry per fire, for a game that schedules per-entity timers. (It never crossed
    to a client: `StateProjector.project()` carries no `timers` field — Invariant #8.)

    The removal happens inside `advance()`'s own pure pass (Invariant #55): the fired entry is simply
    not carried into the returned registry. Everything else is as it was — a repeating timer resets and
    stays, a timer still counting down keeps its slot, and an entry that was ALREADY inactive (a
    cancelled timer, or a tombstone written by an engine that still left them behind) is passed through
    untouched, so a save carrying tombstones loads with no migration and the tombstone is skipped on
    the next beat exactly as before. When nothing in the registry is active, `advance()` still returns
    its input reference, so `engine:tick` keeps `snapshot.timers` by reference and the pipeline's
    clock-only broadcast stays reachable; with the fired entry gone, the beat after a one-shot fires is
    that fast path rather than a walk over a dead entry.

    `GameTimer.active` and `TimerManager.cancel()` are unchanged. A sweep of production code under
    `simulation/`, `ai/`, `networking/`, `renderer/`, `electron/`, `apps/` and the scaffold templates
    for readers of a timer's `active` field, and for callers of `TimerManager.create` / `cancel`,
    found none outside `GameTimer.ts` itself.

## 1.0.0-rc.12

### Minor Changes

- 11a218b: Rename the host-authored lobby-configuration family from `matchSettings` to `gameParams`. This is a
  **clean break** — there is no back-compat shim and no dual-read tolerance window.

    "Match" presumed a bounded, competitive session with an outcome. An arcade or action game built on
    Chimera has a lobby, host-authored configuration, seats and a snapshot, but no match — nothing to
    win, no scoreboard, no opponent, and yet it was forced to write `matchSettings` in its
    `GameLobbySetup` and answer an IPC channel called `set-match-setting`. `gameParams` follows the
    `AIParams` convention the repo already establishes for a flat, primitive-only bag of game-defined
    knobs. `gameSettings` was rejected: it collides with the §4.13 settings system, which owns
    `EngineSettings` / `GameSettingsSchema` and means per-game persisted user preferences — a different
    concept that Invariant #36 exists to keep apart.

    **What renamed.** `GameSetupConfig.matchSettings` → `gameParams`; `LobbyState.matchSettings` →
    `gameParams`; `QuickStartConfig.matchSettings` → `gameParams`;
    `GameLobbySetup.matchSettingsDefaults` / `matchSettingsOptions` →
    `gameParamDefaults` / `gameParamOptions` (singular noun, mirroring the sibling
    `playerAttributeOptions`); `resolveMatchSettingsDefaults` → `resolveGameParamDefaults`;
    `setMatchSetting` → `setGameParam` on `GameLobbyScreenProps`, `LobbyAPI` and `LobbyManager`;
    `SetMatchSettingPayloadSchema` → `SetGameParamPayloadSchema`;
    `LOBBY_SET_MATCH_SETTING_CHANNEL` → `LOBBY_SET_GAME_PARAM_CHANNEL`;
    `ALLOW_SPECTATORS_SETTING` / `SESSION_MODE_SETTING` / `TACTICS_TURN_MODE_SETTING` →
    `ALLOW_SPECTATORS_PARAM` / `SESSION_MODE_PARAM` / `TACTICS_TURN_MODE_PARAM`; and the i18n key
    `engine.lobby.matchSettingFailed` → `engine.lobby.gameParamFailed`. The three reserved key VALUES —
    `engine.allowSpectators`, `engine.sessionMode` and tactics' `turnMode` — do not move.

    **Three persisted or transmitted surfaces change with it.**
    - **The wire key.** `GameSetupConfig.gameParams` is required inside `PlayerSnapshot.setup`, which
      rides the strict `SnapshotMessage`. There is no protocol version and no handshake check, so
      mismatched peers cannot be refused at join time: the client receive boundary discards the whole
      malformed frame rather than the field, and from `engine:start_game` onward the mismatched peer
      receives zero snapshots — no board, no ticks, no game-over, no user-visible error. The snapshot
      CRC gate runs on the pre-schema bytes and passes, so it neither catches nor explains it.
      `LobbyState.gameParams` is optional on a non-strict object, so across the same skew the joined
      client's lobby silently renders with defaults. Run both peers on the same engine version.
    - **The IPC channel.** `chimera:lobby:set-match-setting` → `chimera:lobby:set-game-param`. Two of
      the three Zod boundaries it crosses are strict, so a preload/main skew rejects rather than strips.
    - **The dev-scenario JSON key.** `DevScenarioSchema` is strict, so every adopter with
      `dev/scenarios/*.json` must rename `matchSettings` to `gameParams` there; a stale key fails loudly
      at the CLI. The scaffold's own starter fixture declares none and needs no edit.

    **Saves migrate at schema v7.** `CURRENT_SCHEMA_VERSION` moves 6 → 7 with a registered v6→v7
    migration renaming `checkpoint.setup.matchSettings`. Without it a restored commitment-mode match
    would resume as sequential — silent determinism divergence, since the turn mode gates stamina, the
    turn gate and commit refusal. Because the migration rewrites a checksummed field,
    `FileSaveRepository.load()` now verifies the stored digest against the body **as stored** rather than
    against the object the migration chain returns; tampering is still caught, and the error precedence
    of `SaveSchemaTooNewError` is unchanged.

    **Replays from an older app version are already refused** — `ReplayMigrator.isCompatible` requires
    exact `engineVersion` equality and registers no migrations, so any mismatch throws a typed
    `ReplayVersionError`. One hole remains: an adopter who ships the renamed engine WITHOUT bumping
    their own app version passes that gate and reaches the parser with no `gameParams` key, which throws
    a bare `TypeError` rather than a `ReplayParseError` — so `instanceof` handling misses it and it
    surfaces as an unhandled crash. Bump your app version with the engine.

## 1.0.0-rc.11

### Minor Changes

- c37293d: Make the autosave slot a contract, and push a slot update after every autosave.

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

- 4eb8781: Add the `chimera:lobby:close-session` verb and fork the in-game Leave on the session-mode stamp — the
  exit a lobby-less, quick-started session needs, since it has no lobby to go back to.

    `closeSession({ autosave })` is atomic by contract: one call captures the game's autosave (when
    asked) and then tears the session down. A game-side "save, then leave" pair would race — a leave that
    landed first leaves the capture with no session to read — so the pair is not offered. The composition
    root's port composes exactly the two steps the crash path already composes,
    `SessionRuntime.captureSaveFile` → `SaveManager.autoSave`, and then the public `closeLobby()`; there
    is no second save reader or writer and no `engine:save` dispatch, so the capture stays an out-of-band
    host call and the `chimera:saves:slot-update` push still fires from the single `SaveManager`
    `onSlotsChanged` seam. A "Continue" offered right after the exit therefore finds the fresh autosave.
    `activeSession !== null` is the host gate: the reference is set only inside `onSessionHosted`, so a
    joined client is refused and leaves through `chimera:lobby:leave` as before.

    `useLeaveGame`'s host path now picks its exit by reading `engine.sessionMode` off the live snapshot's
    `setup`: `'quick'` closes the session and raises the leaving-to-main-menu intent (routing owns the
    fade, the snapshot reset and the navigation); anything else — including every save written before the
    stamp existed — keeps today's `returnToLobby()` → `/lobby` path byte for byte. Reading the stamp off
    the snapshot rather than off renderer-held state is what makes the answer survive a window reload and
    a save restore.

    `InGameMenuProps.leaveGame` widens to `(options?: LeaveGameOptions) => void`, and the renderer's
    `LeaveGame` type with it. `autosave` defaults to `true`, so an Escape-exit keeps the match and a menu
    that offers "abandon" must ask to discard. It is deliberately NOT the `gameplay.autoSave` user
    setting: that toggle governs turn-interval autosaves during play, so reading it here would silently
    lose the match for a player who turned it off. The option is ignored wherever the session survives
    the leave.

    New on the bridge contract: `CloseSessionParams` and `LobbyAPI.closeSession(params): Promise<void>`,
    reached from the renderer as `window.__chimera.lobby.closeSession`. `RegisterLobbyHandlersOptions`
    gains a required `closeSession` port, mirroring `quickStart` — a composition root that forgot to wire
    it cannot register a lobby namespace with the verb silently missing.

    Two things outside the fork also change. The renderer's lobby-bridge resolver now
    also requires `closeSession`, so a bridge double in a game's own tests needs the third verb. And the
    replay player now answers the leave-to-main-menu intent itself, which fixes a client's Leave from a
    post-game replay: it raised that intent, and on that route nothing consumed it, so the leave
    disconnected and then went nowhere. It now lands on the main menu.

- 26cab08: Extend the declarative main-menu contract with the two engine-implemented verbs and a confirmation
  primitive, so a game can express Continue and a lobby-skipping Start as pure menu data.

    `GameMainMenuAction` gains `{ type: 'start-game'; config?: QuickStartConfig }` and
    `{ type: 'continue' }`. Neither navigates: `start-game` invokes `chimera:lobby:quick-start` and
    `continue` loads `autosaveSlotId(gameId)` through the ordinary `saves.load` restore funnel — the
    same call the saves browser issues, so no restore machinery is added. Both verbs address one
    concrete game, so rendering either with no `gameId` in context throws at render time, the way an
    unregistered `command.commandId` already does.

    Routing is not part of that change: neither verb navigates, each issues its IPC call and returns.
    The hop into the match belongs to the renderer's snapshot→`/game` effect.

    Availability is engine-computed and **reactive**, an honest change to §4.37.5's resolve-once model:
    `RenderMainMenuDefinition` subscribes to `saveStore` and `lobbyStore`. A `continue` button enables
    the moment a `chimera:saves:slot-update` push carries an autosave in and disables again when one is
    deleted; both verbs stay disabled while a lobby session is live — host or joined alike — because
    the menu is not the surface for acting on a session already in progress. The engine gates are resolved before a
    game's own `disabled` and win over it, so a declaration cannot offer a Continue with nothing to
    continue.

    `GameMainMenuButton` gains `id?` (a testid slug the renderer renders as `main-menu-<id>`, for
    entries the built-in derivation cannot name) and `confirm?: GameMenuConfirm`
    (`when: 'always' | 'autosave-exists'`, plus title, body and control labels that resolve through
    `t()` on the same terms as `label`). The existing hardcoded target map is retained, so an existing
    game's page objects keep resolving; the two verbs add `main-menu-start` and `main-menu-continue`.

    Confirmation is one primitive with two disclosure levels. `ConfirmDialogHost` is mounted once by
    `AppShell` beside `ToastHost`, backed by a promise-resolving queue store, and `useConfirmDialog()`
    — new on the `components/ui` barrel — returns `(options) => Promise<boolean>` that resolves `false`
    on Cancel or Escape. The declarative `confirm` field resolves through that same store, and the host
    shows only the head of its queue, so a question asked while one is open waits its turn rather than
    stealing the surface. `when: 'autosave-exists'` holds its button disabled until the save slot list
    has hydrated: until then "is there a save to overwrite?" has no answer, and a first-run player must
    never be told they are about to overwrite a save that does not exist.

    `ConfirmDialog` is also exported as a primitive for a surface that owns its own dialog state. Note
    that the `components/ui` barrel now reaches one `renderer/state/` module — the confirm store — where
    it previously reached none, so Invariant #96 and the §4.35 tier list drop the "stateless" qualifier
    from the barrel's description. The store is created lazily, so importing
    the barrel still constructs nothing, and the barrel guard now asserts that exact single-module set
    rather than a blanket absence.

    New engine tokens `engine.menu.continue` and `engine.menu.start` are the engine-supplied labels for
    the two verbs, for a game menu definition to name as raw token strings. The confirm dialog's default
    control labels reuse the existing `engine.common.confirm` / `engine.common.cancel` tokens, which had
    no consumer until now.

- 50290b4: Add the `chimera:lobby:quick-start` verb and the `QuickStartCoordinator` behind it — the one-click
  path from a shell screen into a playable match, skipping the lobby UI.

    It is orchestration sugar, never a second session constructor. `QuickStartCoordinator`
    (`electron/main/runtime/QuickStartCoordinator.ts`, beside `SessionRestoreCoordinator`) is
    ports-injected and holds no session objects; the lobby half of its ports is a structural slice of the
    public `LobbyManager`, pinned assignable at compile time by its own test, so a port cannot grow into
    a bespoke session door. The sequence: guards (active session, active restore, quick start already in
    flight) → merge the game's `GameLobbySetup.quickStart` defaults UNDER the request →
    `maxPlayers = 1 + localSeats.length + aiSeats.length`, a roster exactly full by design →
    `hostLobby({ gameId, maxPlayers, agentSlots })` with the AI roster pre-seeded atomically through the
    existing `agentSlots` seam (never an `addAi()` loop against a roster still being filled) → stamp
    `engine.sessionMode` → apply the merged match settings, the host's attributes and each pass-and-play
    seat's → ready → start.
    Any throw after the lobby exists tears it down with `closeLobby()`, so a failed start never leaves a
    session behind; a failure of the teardown itself is logged and the caller still sees the failure that
    broke the start.

    New reserved match-setting key `SESSION_MODE_SETTING` (`'engine.sessionMode'`) and its one value
    `SESSION_MODE_QUICK` (`'quick'`) in `foundation/game-lobby-contract`, joining
    `ALLOW_SPECTATORS_SETTING` under the engine's `engine.` namespace. Unlike that one it is not
    host-settable: `SetMatchSettingPayloadSchema` refuses the key and `QuickStartParamsSchema` refuses it
    inside a requested `matchSettings` map, so neither a custom lobby screen nor a game's own quick-start
    defaults can flip it. It rides `matchSettings` into `snapshot.setup`, so it survives a window reload
    and a restore; its absence means the session was born in the lobby.

    New on the bridge contract: `QuickStartParams` (a `QuickStartConfig` addressed at one `gameId`) and
    `LobbyAPI.quickStart(params): Promise<LobbyInfo>`, reached from the renderer as
    `window.__chimera.lobby.quickStart`.

    `AddLocalSeatOptions` gains `attributes`, merged per key OVER whatever the seat already carries — the
    descriptor's seat defaults for a fresh seat, the seat's own picks on a re-add. This is how a
    pass-and-play seat's picks are authored: such a seat has no connection, so the own-seat
    `setPlayerAttribute` channel cannot reach it, and on a shared machine the host connection owns it.
    Host-time seeding only; there is still no runtime attribute channel for a local seat.

    Behaviour-neutral for every existing flow: `buildSetupFromLobbyState` and `matchId` minting are
    untouched, no shipped flow ever authored `engine.sessionMode` on the newly-refusing
    `chimera:lobby:set-match-setting` boundary, and a game that declares no `quickStart` block simply
    has no quick-start defaults to merge.

- e0bc9a7: Widen the seat contracts so every seat kind can carry picks, and stop the preload schema from
  stripping the fields that depend on it.

    `LobbyAgentSlot` gains `attributes?: Readonly<Record<string, string>>` — the agent-slot twin of
    `LobbyPlayerEntry.attributes`. An AI seat is never a `players` entry: it lives in `agentSlots` and
    is seated at match start under the synthetic `ai-<slotIndex>` id, so before this it had no carrier
    at all and a game could not say what its AI was playing.

    `buildSetupFromLobbyState()` now walks BOTH rosters into one `playerAttributes` map: every `players`
    entry (host, joined remote, pass-and-play local seat) under its own `playerId`, and every
    `kind: 'ai'` agent slot under `createSyntheticAIPlayerId(slotIndex)` — the same id
    `collectGameStartAiPlayerSlots` seats the agent with, so `setup` never describes a seat that does
    not exist. A reducer asks "what is seat N playing?" once, against one map, whatever kind of seat N
    is. A `players` entry wins over an agent slot claiming the same id (`??=`, players walked first). A
    human-kind agent slot contributes nothing — it is a placeholder for a joining human whose own entry
    carries its attributes, and no synthetic seat is ever created for it. Invariant #101 widens by the
    new carrier; the verbatim-projection guarantee is unchanged, and an integration test runs the real
    road — lobby state → setup builder → `engine:start_game` validate + reduce → `StateProjector` — and
    asserts every viewer's `setup` is the same object, AI seat included.

    `createSyntheticAIPlayerId` moves to its own `electron/main/runtime/syntheticAgentId.ts` leaf
    (re-exported from `HostedSessionAgents.ts`, so every existing import path is unchanged) so the
    lobby-setup registry can share the one spelling of an AI seat's id without pulling the AI engine
    into its module graph.

    The preload `LobbyStateSchema` no longer strips. It is a plain `z.object`, so an undeclared key is
    parsed away with `success: true` and the `satisfies z.ZodType<LobbyState>` guard still passes — an
    absent optional is assignable. `chimera:lobby:get-current-state` therefore dropped `matchSettings`
    and every per-player `attributes` map, and the live `lobby.onUpdate` push (unvalidated) was the only
    reason it went unnoticed. All three are now declared, and `schemas.test.ts` round-trips a
    `Required<LobbyState>` fixture: adding an optional field to the wire contract fails to compile there
    until the schema carries it, so the strip cannot silently return.

    Wire caps: an agent slot's attributes are bounded by the same `WIRE_MAX_PLAYER_ATTRIBUTE_*` caps a
    human's own-seat write frame uses. There is no attribute-setter channel for an agent slot, so the
    caps ride the state frame as well as the `.strict()` `HostLobbyParamsSchema`, whose transform now
    carries the field through. `matchSettings` and a
    player's `attributes` stay uncapped on the state frame, exactly as before: capping them at the
    preload boundary would reject a state the host legitimately broadcast.

    New: `simulation/foundation/quick-start-contract.ts`, a zero-import foundation leaf declaring
    `QuickStartConfig` / `QuickStartSeat` / `QuickStartAiSeat`, plus the optional
    `GameLobbySetup.quickStart` defaults block. Every seat kind carries its own `attributes` (an AI seat
    adds `omniscient?`) — a bare seat count can say how many seats to open but not what any of them is
    playing. It sits on the lobby setup rather than the manifest because a seat's attributes are drawn
    from the same vocabulary as `playerAttributeOptions`, and the lobby setup is built from the game's
    `GameContent`. This is the type both ends compile against.

    Additive throughout — every new field is optional and backward-compatible.

## 1.0.0-rc.10

## 1.0.0-rc.9

### Minor Changes

- 3af9e43: `TransitionOverlayProps.preloadProgress` narrows from `number | null | undefined` to
  `number | undefined`. The `| null` arm documented a third state — "running, but the wait is not
  measured" — that no game overlay could ever be handed: `useFadeTransition` reports a number only
  for a run that measures something and publishes `null` purely to release its own channel at the
  commit, and `SceneRouter` withholds the prop on that `null` rather than passing it on. An adopter
  branching on `null`, which is exactly what the removed sentence invited, wrote a branch that never
  ran and silently took the absent-prop path instead.

    An unmeasured wait is now stated one way only, the way the engine's own overlay already relied on:
    the prop is absent, so `data-preload-progress` is omitted rather than printing a word or drawing an
    empty bar as a claim nobody measured. Two states, and a game reads them as "a fraction" or "no
    measured fraction".

    A game overlay that declared `preloadProgress?: number | null` still fits the slot — the slot reads
    its props type contravariantly. What the narrowing rejects is an ASSIGNMENT of `null` to the field;
    a `=== null` comparison still compiles, so an overlay that already wrote the dead branch is not told
    about it. Nothing about what is rendered moves.

    The sibling cover contract is deliberately untouched: `GameLoadingScreenProps.progress` stays
    `number | null` and required, because `null` really does arrive there — a code-split `import()`
    exposes no progress channel, and `SceneRouter` passes `progress={null}` for the `'code'` reason.

## 1.0.0-rc.8

## 1.0.0-rc.7

### Minor Changes

- 46eba2f: Add F84 — spatial audio: an explicit listener pose, an authored distance falloff, and
  moving sources. `PlayOptions.position` becomes `PlayOptions.spatial` (a
  `SpatialOptions` carrying the position plus `fullVolumeDistance` / `falloffDistance` /
  `falloff` / `rolloffFactor`), mapping onto the voice's own `PannerNode` vocabulary
  with no engine arithmetic. The engine default falloff is `'linear'` — deliberately
  diverging from the platform's `'inverse'`, since only the linear model reaches zero at
  `maxDistance` — and `panningModel` is pinned to `'equalpower'` and is not authorable.
  Distances join the static validation tier: an inverted band, a negative or non-finite
  distance or `rolloffFactor`, or a non-finite position component rejects synchronously
  inside `play()` with an invalid handle and one warning, before any voice is reserved;
  an equal pair is an authored hard cutoff realised as the narrowest expressible band
  through a named power-of-two epsilon.

    `AudioManager.setListener(pose, opts?)` writes the app's ONE listener — game-supplied,
    never derived from a camera — over a feature-detected `AudioParam` path with a
    `setPosition`/`setOrientation` fallback; the panner position writes share the same
    feature-detected tier with their own `setPosition` fallback. Updates ramp over an
    anti-zipper window unless `{ immediate: true }`. `AudioManager.setVoicePosition` moves a live spatial
    voice (ramped or immediate), parks a move on a loading
    voice's record for `t0` with last-write-wins, warns once and no-ops on a non-spatial
    voice, and stays silent on a released handle. `useSpatialAudio()` exposes both verbs
    from the existing `@chimera-engine/renderer/audio` barrel — no new subpath — together
    with the spatial option types.

    Event-driven SFX gain a per-occurrence seam: `GameEventAudioBinding` entries accept
    `options?: (event) => EventAudioOverrides`, a sim-side primitives-only overrides type
    merged over the static fields, contained per event when it throws. It cannot produce a
    position; positioned event SFX use explicit call sites, and Tactics is the reference
    adopter — positioned board SFX with the listener anchored at the board focus, never the
    camera. No spatial code path writes any gain stage
    (Invariant #116 re-verified; the spatial rules are new Invariant #134).

## 1.0.0-rc.6

### Minor Changes

- 0243537: Add the animation clip-sheet authoring vocabulary, the shared time-scale arithmetic and the
  content-load window verifier — the first of the animation layer (F82), and the half that lives
  in the zero-dependency simulation leaf.

    `@chimera-engine/simulation/content` gains `modelAnimationEntry`, `spriteAnimationEntry`,
    `compileAnimationWindows`, `beatsForRealSeconds` and `AnimationWindowMismatchError`, plus the
    sheet types below. The two builders are twins of the existing `audioClipEntry`:
    each builds a `'gltf-model'` / `'sprite-sheet'` manifest entry and stores an optional clip
    sheet in the `AssetManifestEntry.metadata` slot verbatim, by reference, never inspecting it —
    and omits the `metadata` key entirely when none is passed, so an entry from the builder
    deep-equals a hand-authored one. `AssetManifestEntry.metadata` stays typed `unknown`; the sheet
    is structurally opaque to `simulation/` and `ai/`, and the playback parser is the renderer's.

    The sheet types themselves — `AnimationClipName`, `AnimationMarkName`, `AnimationWindowName`,
    `AnimationLoopMode`, `ClipPosition`, `AnimationNotify`, `AnimationPassage`,
    `AnimationTrackSheet`, `ModelAnimationMetadata`, `SpriteClipDeclaration` and
    `SpriteAnimationMetadata` — are declared in `simulation/foundation/animation-clip-sheet.ts`,
    mirroring `audio-cue-sheet.ts`: pure type declarations with zero runtime, asserted by an esbuild
    pin that the module bundles to the empty string. A `ClipPosition` is a normalized phase, an
    absolute `{ seconds }`, or a `{ frame }` index. `AnimationLoopMode` is `'once' | 'loop'` and
    deliberately has no ping-pong member — nothing downstream models a reversing playhead, so it is
    refused at the type level rather than clamped later.

    `compileAnimationWindows(sheet, clipName, tickRateMs)` is the reason the visual span and the
    mechanical one are authored twice. A passage carries clip-relative `from`/`to` positions and,
    optionally, the `[startBeat, endBeat]` integers the simulation will open a gameplay window on.
    The verifier recomputes the second from the first under outward rounding —
    `startBeat = floor(from)`, `endBeat = max(startBeat + 1, ceil(to))`, in beats — and throws
    `AnimationWindowMismatchError` (carrying the clip, the passage and both tuples) when the two
    disagree, returning the **authored** tuple by reference when they agree. It verifies rather than
    derives on purpose: deriving would make the length of every hit window in a game a function of
    the host pacing knob `tickRateMs`, so raising the tick rate would silently retune combat. The
    `max(startBeat + 1, …)` term is the structural one-beat floor — at the default 20 Hz beat the
    finest expressible mechanical window is one beat, and a narrower authored span is floored at one
    rather than collapsing to the empty window `[n, n]`. Beat quotients are snapped by a 1e-9 epsilon
    before rounding, because resolving a frame or a phase multiplies two floats and lands a hair off
    a beat in either direction. An authored bound that is not a non-negative integer, a
    `tickRateMs` that is not a finite positive number, and a position the clip cannot resolve are
    each a `RangeError`. `beatsForRealSeconds(realSeconds, tickRateMs, scalePermille)` is the same
    arithmetic the other way round, counting the beats of the dilated period a wall-clock span
    occupies; it divides by `dilatedBeatPeriodMs` rather than re-deriving the division.

    `simulation/foundation/time-scale.ts` holds the time-dilation arithmetic:
    `NORMAL_TIME_SCALE_PERMILLE` (1000), `MIN_TIME_SCALE_PERMILLE` (50), `MAX_TIME_SCALE_PERMILLE`
    (4000), `clampTimeScalePermille`, and the pair `timeScaleMultiplier` (the renderer's clip
    playback multiplier) and `dilatedBeatPeriodMs` (the host's declared beat period). Both divide by
    the same clamp result, so the two halves of a dilated hit cannot drift apart independently.
    `clampTimeScalePermille` applies two distinct rules in order: anything that is not a finite
    integer — `undefined`, `NaN`, `±Infinity`, or a fractional permille such as `2.5` — falls back to
    real time, and only then is a finite integer clamped into `[50, 4000]`. A fraction is refused
    rather than rounded, because silently turning `2.5` into the 5%-speed floor reads as a
    slow-motion bug rather than as the typo it is.

    That module carries runtime values, so it is exported from no barrel: the package root and
    `@chimera-engine/simulation/contracts` are both asserted to bundle to the empty string, and
    re-exporting it from either would break that. It is reached through its own
    `@chimera-engine/simulation/foundation/time-scale.js` subpath, resolved by the `./*.js` wildcard
    already in the exports map — the same route `foundation/crc32.js` and
    `foundation/asset-ref-parse.js` already take. No exports-map entry was added.

    Additive throughout; nothing is removed, renamed or narrowed, and no snapshot type changes.
    The build-time half — `validate-assets`' `invalidAnimationSheets` gate over the sheets these
    builders write — lands in `@chimera-engine/electron`.

- b53c262: A clip change can now blend, and a finished clip stays on its last frame.

    `useClipPlayer` takes a `blendSeconds` option: the seconds to blend out of whatever was
    playing and into the newly declared clip. A clip may also declare the length once, in its
    manifest sheet, as `blendInSeconds`. Omitting the option falls back to that authored
    length, and to no blend when the sheet declares none — so a game that declares neither
    keeps the cut it has today. A `blendSeconds` at the call site overrides an authored one,
    including with a `0`, which asks for a cut. Both are wall-clock seconds and neither
    scales with the dilation multiplier, so a transition takes as long in a slowed-down scene
    as it does at full speed.

    `AnimatedSprite` and `useSpriteClipPlayer` deliberately do NOT take `blendSeconds`: a
    sprite playback rewrites quad UVs and has no weight to interpolate. A sprite clip's sheet
    may still author `blendInSeconds` — the sheet is shared vocabulary — and no sprite
    backend honours it.

    Behaviour an adopter sees without asking for anything:
    - A clip change now closes the outgoing clip's open passages with reason
      `'clip-changed'` instead of `'stopped'`, whether or not a blend was asked for. A
      `loop` change and a `sheet` change do the same. `'stopped'` now means what a caller
      asking for a stop gets — `stop(name)`, `stopAll()`, or declaring `clip: null` — and
      `'released'` still means the player was disposed. A game switching on
      `PassageEndEvent.reason` should read the new value.
    - A `'once'` clip that reaches its end now HOLDS its last frame instead of restoring the
      model's original state on the same tick its `clip-end` handler runs. The pose comes
      down when something asks the player for a change — including declaring another clip,
      which blends out of the held frame when it declares a blend and cuts it when it does
      not.

    An authored `blendInSeconds` that is not a finite number of at least zero now fails
    `validate-assets` at build time, naming the clip, and is dropped with a warning by the
    runtime sheet parser if it reaches one.

- f59644e: `ContentDatabase` items are now frozen **recursively**, `ContentLoader.load()` validates `DataRef`
  integrity **by default**, and item ids are constrained to a grammar that makes that validation sound
  — the two halves of Invariants #13 and #14 that the code declared but did not deliver.

    **Deep freeze (#13).** `createContentDatabase` called `Object.freeze(item)`, which is shallow: every
    nested object and array inside a loaded content item stayed mutable after `load()` returned, so
    "immutable after load" held exactly one level deep. Nothing mutated in practice only because every
    shipping content item is flat (`{ id, name, hex, order }`) — the guarantee would have lapsed
    silently on the first game to author a `stats: {...}` or `attacks: [...]` field. Items are now frozen
    through a recursive walk at the single freeze site every construction path funnels through, so
    `ContentLoader.load()` and direct `createContentDatabase()` calls are covered alike. The walk's
    visited marker is a `WeakSet`, deliberately not `Object.isFrozen`: an item the caller already
    shallow-froze must still have its nested values frozen, and a self-referential item must terminate.
    Cost is one pass per item at load time, never per access.

    Two adopter-facing consequences. Freezing is transitive, so an object a caller **shares** into an
    inline item (a module-level constant reused across items) is frozen along with it — shallow freezing
    never reached past the item itself. And because the query methods return `T` rather than a deep
    `Readonly<T>`, code that shallow-copies a nested content value and writes through the copy
    (`const s = {...item}; s.stats.hp -= 5`) still type-checks but now throws `TypeError` where it
    previously succeeded. Both were already Invariant #2/#13 violations; nothing first-party does either.
    The walk's domain is JSON (Invariant #15): a value JSON cannot produce — a `Map` or `Date` from a
    programmatic caller — is frozen but not walked, since freezing does not make those immutable anyway.
    An array-buffer view is skipped outright, neither frozen nor walked: `Object.freeze` throws on a
    non-empty typed array, and one rule for every view beats two.

    **Ref validation (#14).** `ContentLoadOptions.validateRefs` defaulted to `false` and the engine's
    only production call site (`loadAllGameContent`) passed just `{ schemas }`, so the ref half of
    Invariant #14 never ran outside tests: a game shipping a dangling `DataRef` booted fine and failed
    later as an `UnknownDataRefError` thrown from inside a reducer, mid-match, instead of fatally at
    startup. The default is now `true`. This is a **behavioural change to a published default**: a
    `load()` that previously tolerated a dangling ref now rejects. `validateRefs: false` remains as a
    narrow opt-out for a deliberately partial load whose refs resolve against a database that call does
    not build (staged base/expansion loads); no production startup path may use it.

    Refs are now recognised in object **keys** as well as values, at any depth. A map keyed by ref
    (`resistances: { 'damage-types:fire': 50 }`) is a first-class way to author per-ref data, and
    walking values alone exempted every ref written that way — a dangling one loaded clean and surfaced
    from `resolveRef()` mid-match instead. Ordinary field names contain no colon and exit the check
    immediately; the cost is that the false-positive class above now applies to keys too.

    The default was flipped rather than opted into at the electron call site so the guarantee has a
    single home — every current and future loader call site (scaffolded games, expansions, a second host
    path) is covered without remembering to ask. The startup path is pinned by its own test against a
    temp assets root, so the guard survives both a default flip-back and a call-site opt-out.

    **Item ids now have an enforced grammar** (`ITEM_ID_SHAPE`, `/^\S+$/` — non-empty, no whitespace).
    Non-ASCII, dotted, slashed and colon-bearing ids stay legal; `parseRef` splits a ref on its first
    colon, so `units:tier:elite` resolves id `tier:elite`. `ContentLoader` rejects a violating id as a
    `ContentSchemaError`, enforced at `createContentDatabase` — the single factory every construction
    path funnels through, the same siting as the deep freeze. `ContentLoader` repeats the check at merge
    time for one narrow reason: it runs before the duplicate check, so two id-less items are reported as
    malformed rather than as a `ContentConflictError` over a `Map` keyed on `undefined`. This is what
    makes ref detection sound
    rather than a guess. Detection needs to tell `"units:warrior"` from prose like `"units: 3 required"`,
    and can only do that by testing the id half — but that test is safe only if no _legal_ id can look
    like prose. Without the grammar an item ided `"Fire Mage"` would be legal and unreferenceable: both a
    correct and a dangling `"units:Fire Mage"` would be skipped, silently exempting that item from the
    integrity check. With it, a string the rule rejects cannot name any item, so skipping one can never
    skip a resolvable ref.

    **Two upgrade breaks follow from that, both intended.** First, the grammar is a new rejection: an
    item ided `"Fire Mage"` loaded before and now fails with a `ContentSchemaError`. It was legal but
    unreferenceable, which is precisely the state the grammar exists to make impossible — rename the id
    (and any ref to it). Second, with refs checked by default, any **non-ref** string of the form
    `<knownCollection>:<no-whitespace>` is now a fatal load error: an i18next-style `"units:warrior_name"`
    in a game that also has a `units` collection will stop the load. Nothing in untyped JSON distinguishes
    that from a real ref. A game hits it only by naming a collection after another of its namespaces;
    rename the collection, or pass `validateRefs: false`.

    The limits of the guarantee, stated on Invariant #14 rather than left implied. Not diagnosed at load,
    each reaching `resolveRef()` at call time instead: an id half that is empty or contains whitespace
    (`units:`, `units:Fire Mage`), which cannot name a legal item; a mistyped collection prefix
    (`unit:warrior`), which is not recognised as a ref at all; and a ref into a collection the loader
    never saw. The falsifiable form of what _is_ guaranteed: every string reachable from a loaded item
    through object entries and array elements — keys as well as values, at any depth — whose prefix names
    a known collection and whose id half matches `ITEM_ID_SHAPE` must resolve, or the load fails. Those
    two traversals are exactly what JSON can express; strings outside them (a symbol-keyed property, a
    non-index property on an array, a `Map`/`Set`'s contents) live in shapes only a programmatic `inline`
    source can build, and are not examined.

    `ContentSchemaError`'s message now reads `Content validation failed for '<collection>:<id>'` rather
    than `Schema validation failed…`: it also covers the id-grammar rejection, which fires for
    collections that have no registered schema at all. The specific reason stays in `cause`.

    `ITEM_ID_SHAPE` is exported from `@chimera-engine/simulation/content` so a game can reuse it in its
    own Zod id schema.

    **A failed content load now terminates the app.** `main()` logged the failure and rethrew, but the
    composition root launches it as `void main(...)`, so the throw was only an unhandled rejection —
    Electron printed a warning and kept the process alive with no window. Invariant #14 says the game
    does not start; it now calls `app.exit(1)`, matching the Invariant #27 startup guard (and, for the
    same reason, deliberately no modal `showErrorBox`, which would hang a non-interactive launch). The
    reason is reported through the injected `logger` and the pino sink is drained with a guarded
    `flushSync()` first — the sink buffers (`minLength: 4096`) and `app.exit()` emits no `before-quit`,
    so without that flush the refusal would leave no record at all. The
    per-game load is also wrapped so a failure names the game and its data directory, keeping the loader
    error as `cause` — the loader is game-agnostic and its errors carry only a ref string.

    No shipping content changes behaviour: the reference game's content is flat, its ids are slugs, and
    it carries no colon-bearing values.

- a2f7d10: Close the animation system (F82): author the two remaining invariants, and amend the prose the
  code falsified.

    **Invariant #129** (the last reserved slot, now authored) states that beat-owned gameplay windows
    are host-only — `StateProjector.project()`'s field allowlist omits the registry, so no window
    record ever crosses a boundary — that records are integer or `FixedPoint` throughout because the
    registry is saved and replayed, that `AnimationWindowManager`'s three verbs are pure, and that
    within a match a window leaves through one of the manager's FOUR paths, each reported with a
    distinguishing reason: `'expired'`, `'owner-gone'` (checked first, so it stays the truthful reason
    on the beat the countdown would also have run out), `'replaced'` and `'interrupted'`. The MATCH
    BOUNDARY is deliberately named as not being one of them — `animationWindows` is match-scoped, so
    `engine:start_game` and `engine:return_to_lobby` drop the whole registry with no per-window event,
    in the same reduce that drops a game's own extension fields.

    **Invariant #132** states as a numbered rule that no animation event may gate an
    `EngineAction`. A clip's marks report where a playhead is, and a gameplay consequence derived
    from one would be derived from the frame clock, which no two machines share. The rule is held by
    ABSENT PARAMETERS — `ClipMarkerHandlers` and every event it carries name no dispatcher, no
    `SendAction`, no `PlayerId` and no tick — so a handler has nothing to dispatch with. Stated as an
    invariant rather than left to be inferred from one hook's signature, because a future animation
    surface adding a parameter would be adding it to a shape no rule had claimed.

    The prose sweep is the other half, and it is about one word. `GameSnapshot.tick` counts ACTIONS,
    not beats: an `engine:tick` that fires a timer dispatches children through the same
    `ActionPipeline.process()`, and each one advances the counter. Every doc line that treated the
    two as the same number is amended — most importantly the action-pipeline claim that "each
    `engine:tick` advances the counter by 1", which is exactly what would make a `tick`-difference
    animation clock look correct. `ReplayPlayer`'s "+1 tick per recorded action" is restated as what
    it is, a REFUSAL that bounds what is replayable (a nested `ctx.dispatch` and `engine:undo`/`redo`
    are not), and the two measurably-false replay lines are deleted rather than sharpened.

    No runtime behaviour changes: this is the documentation and invariant half of a feature whose
    code landed across the tasks before it, plus one new engine-side test pinning #132's parameter
    census.

- 8f6e8fd: Asset-gated scene reveal: a scene's declared `requiredAssets` now gate what a player
  SEES, on both entry paths, without ever gating a mount or the host's barrier.

    Before this, `SceneDescriptor.requiredAssets` was a declaration `validate-assets`
    checked and no code read at runtime. A scene could name every ref it needed and the
    player would still watch them pop in after the fade.

    **The declaration now travels on two carriers.** A scene being ENTERED carries it on
    `SceneTransitionState.requiredAssets`, which `startScenePreload` promotes and awaits
    before the client dispatches `engine:scene_ready`. A scene already COMMITTED carries it
    on the new `BaseGameSnapshot.sceneRequiredAssets`, which `useCriticalAssetPreloadGate`
    promotes for a route entered mid-scene — a restore or a replay — so that path is gated
    too rather than only a live transition.

    **Fail-open is the guarantee, not a fallback.** Both arms settle on four independent
    paths: the load resolving, the load REJECTING, an elapsed budget
    (`CRITICAL_ASSET_PRELOAD_BUDGET_MS` = 8 s for the route arm,
    `SCENE_PRELOAD_BUDGET_MS` = 5 s for the transition arm), and a nothing-to-load
    short-circuit. No combination of a missing,
    slow or undeclared asset can produce a permanently black screen. The transition arm's
    ack fires on all four outcomes deliberately: the host barrier waits for every player and
    evaluates `timeoutTicks` only when an action is applied, so a turn-based match has no
    ticker to time a withheld ack out — withholding it would freeze the match rather than
    degrade it.

    **A gate withholds a reveal, never a MOUNT.** `GameShell` mounts on the same commit it
    did before, which is what keeps the unique disposer of a page-injected `AssetManager`
    reachable; `/replays/player`'s `isReady` is unchanged for the same reason, and its cover
    is an overlay above a mounted shell.

    **Two new optional `GameScreenRegistry` slots.** `loadingScreen` covers every screen key;
    `loadingScreens[key]` covers one, and `'none'` opts a key out of a registry-wide cover.
    Either accepts a component, a static `{ message }`, a static `{ image }`, or the
    `'spinner'` / `'progress'` presets. They resolve through ONE cascade and render at three
    sites — a suspended code-split chunk, a scene transition, and a route entry — always as a
    SIBLING of the transition overlay, never inside its `aria-hidden` subtree. **The default is unchanged from before the slots existed: a game that declares neither gets the engine's own empty placeholder, which is what the Suspense site rendered before.**

    Properties you can rely on:
    - A declared ref that is `deferred` in the manifest is promoted for the run and restored
      by nothing — the promoted manifest is built from the same base object, so entry
      equivalence keeps every cached ref and `registerManifest` evicts none.
    - `engine:scene_ready` still carries `{ playerId }` and nothing else. No client's load
      timing, fraction or outcome enters authoritative state.
    - Neither budget collapses under `NEXT_PUBLIC_CHIMERA_E2E`. The e2e build is where a
      never-releasing gate is observed; disabling it there would make its own spec pass
      vacuously.

    One caveat worth knowing before you rely on the route arm:
    - **The guarantee is scoped to a live, rendering client.** A seat in `state.players` with
      no mounted `SceneRouter` — a disconnect mid-transition, or an AI seat — can already
      stall the host barrier today. This change does not fix that, and the budgets are chosen
      so it does not meaningfully widen the window.

- 6b600c2: A scene transition waiting on a seat that cannot acknowledge is now released by a host-side
  budget, instead of holding forever.

    The barrier requires an `engine:scene_ready` from every key of `state.players`, and that action
    has exactly one producer — `useFadeTransition`, inside a mounted `SceneRouter`. A seat with no
    renderer never sends one: an AI seat has no renderer at all, and a disconnect mid-transition
    leaves the seat in `state.players` with its renderer gone (no engine action removes a seat).
    `SceneTransitionState.timeoutTicks` could not cover for it either, because a tick advances only
    when an action is applied and a turn-based match applies none while a transition is pending.

    `SessionRuntime` now measures a pending transition against a wall clock —
    `DEFAULT_SCENE_TRANSITION_BUDGET_MS`, 30 s, above every client-side budget it has to outlast so
    a slow-but-live client is never mistaken for a seat that cannot ack — and dispatches a new
    host-only engine action, `engine:scene_expire`. That action carries no payload and decides
    nothing: it sets `SceneTransitionState.expired`, which `isTransitionTimedOut` reads beside the
    tick budget, so the descriptor's own `onClientTimeout` still chooses between committing and
    dropping exactly as it does when the tick budget elapses.

    The wall clock stays in the host runtime; the reduce remains pure and clock-free, and
    `engine:scene_ready` still carries `{ playerId }` and nothing else — no client's load timing
    enters authoritative state.

    Worth knowing before a game adds a transition: in a match with an AI seat the acks can never
    complete the barrier, so this budget is not a rescue there but the release path, and every scene
    hop costs it in full. A game that adds a transition should pick `sceneTransitionBudgetMs` with
    that case in mind.

- 88680bb: Restored the mandated structured-logger wiring across the main-process composition root
  and removed a dead `UndoPolicy` field.
    - `buildHostSessionPipeline` now forwards its injected `Logger` into both
      `InMemoryActionHistory` and `ActionPipeline`, so the `action-history:overflow` warn
      (Invariant #45) and the `engine:tick` timer-rejection warn (Invariant #90, §4.20) are
      reachable in production instead of being swallowed by a noop logger.
    - `SettingsManager.getSettings()` now emits the mandated warn when called for an
      unregistered `gameId` before degrading to engine defaults (Invariant #34).
    - `ProfileManager` is now constructed with an injected `Logger` child — the last
      main-process manager that was missing one (Invariant #67).
    - Removed `UndoPolicy.requireConsentFrom`, a field with no enforcement anywhere in the
      engine. Multi-player undo consent is not a supported policy dimension (§4.5, §7).

- c4d095d: Add F90 — a minimum visible time for loading covers. One optional registry knob,
  `GameScreenRegistry.loadingScreenMinVisibleMs?: number` (in `@chimera-engine/simulation`'s
  zero-dependency foundation leaf): once a cover the player can actually see has been shown, it
  stays on screen at least that long, so a fast load reads as a beat instead of a flicker. A
  wait that outlives the minimum changes nothing, and an absent or `0` value keeps every path
  byte-identical — no timer is armed at all.

    The renderer half supplies the machinery. `resolveLoadingCoverHoldMs(registry)` is the single
    resolver: `0` for absent/zero/negative/non-finite declarations, `0` under
    `NEXT_PUBLIC_CHIMERA_E2E === '1'` read at call time (the hold is a deliberate delay like the
    screen fades, never a release budget), and deliberately NOT collapsed under
    `prefers-reduced-motion`, where zeroed fades make a sub-perceptual flash strictly worse.
    `useMinimumVisibleHold(shown, holdMs)` is the shared delayed-release latch — one timer per
    release, monotonic stamp at the rise, re-show cancels and re-stamps, StrictMode-safe, and
    structurally inert at `0`. Registration warns once (never throws) on a non-finite or negative
    declaration, and once — honoring the value, never clamping — on a minimum above
    `SCENE_PRELOAD_BUDGET_MS`.

    Visibility is the arming condition at every consumer: the hold arms only when the cover
    cascade resolves a game-declared form (never the engine placeholder or `'none'`) and nothing
    opaque paints over the cover. On `/game` the reveal — the latched app-level fade-in plus the
    route cover drop — waits for max(gate settle, shown + minimum), with the faded lobby→game
    entry unchanged (the opaque scrim covers the route cover, so a mount-stamped hold would
    extend a black screen), a waiting restore bypassing the hold, and `/replays/player` holding
    only its cover, `isReady` untouched. `SceneRouter` keeps one held-layer slot for the drops it
    cannot defer — the transition cover's host-side commit and a Suspense fallback's chunk
    resolution — re-rendering the dropped cover's same cascade resolution (last measured
    fraction, or `reason="code"`) as a sibling layer for the remainder, with one clock per visual
    wait and at most one cover layer in the DOM at a time. `GameShell` gains an optional
    `sceneCoverOccluded` prop threading the pages' occlusion signal through to the router.

    Nothing host-visible moves: `useFadeTransition` — the `engine:scene_ready` ack, both fade
    channels and the progress protocol — ships byte-identical, and no preload budget widens or
    collapses. Additive throughout; a registry without the field behaves exactly as before.

### Patch Changes

- 1655193: Hardened the production debug-mode startup guard for packaged builds (Invariant #27/#77).

    `assertProductionDebugGuard` early-returned unless `NODE_ENV === 'production'`, but an
    electron-builder-packaged launch never sets `NODE_ENV` — so a shipped binary started with
    `CHIMERA_DEBUG=1` booted the full debug bridge with `GameSnapshot`-level Inspector access.
    Both startup guards now take `app.isPackaged` and share one `isProductionRuntime` predicate
    (`isPackaged || NODE_ENV === 'production'`), adopting the same trusted build signal the replay
    privacy gate already used. The existing `NODE_ENV` trigger is unchanged.

    As defence in depth, the app bundler gained an opt-in production `define`: packaging scripts
    declare `CHIMERA_PACKAGED_BUILD=1`, which bakes both `IS_DEBUG_MODE` reads so the emitted bundle
    contains the literal `IS_DEBUG_MODE = false` — the debug bridge sits behind a permanently-false
    gate even if the startup guard were bypassed. (This step made the gate dead but left the debug
    module graph in the bundle; a separate change in this same release removes it — see "Packaged
    builds no longer bundle the Runtime Debug Layer".) Dev and e2e builds share that bundler and
    deliberately get no define, so the F9
    Inspector stays reachable; a drift test fails loudly if a packaging script ever loses the flag.

    Also fixes a scaffolding bug this exposed: the packaging scripts emitted by `create-chimera-game`
    (both workspace and standalone) never set `NEXT_PUBLIC_CHIMERA_PACKAGED=1` on their `next build`
    step, so every scaffolded game's distributable shipped the dev-only component gallery and replay
    routes. Both emitters now declare it, and `start:debug` rebuilds the renderer as well as the app
    bundle so a preceding `pnpm package` cannot leave a debug launch half-gated.

- 6cd3bbd: The scene actions that FINISH a transition now pass the terminal-match gate, so a transition
  still in flight when a match resolves is no longer stranded by the guard itself.

    Both terminal guards rejected everything once `gameResult` was recorded: the pipeline's own
    gate, and the game route's `sendAction` wrapper. Nothing ties `gameResult` to `sceneTransition`
    — and the game resolver runs on the output of every reduce, including the prepare's own — so
    the state is reachable. There the rejection stranded the transition: the acks are what the host
    waits for, the host's own commit or drop is what clears it, and the barrier's timeout is counted
    in ticks that only an applied action advances.

    `engine:scene_prepare` still does not pass: a resolved match may FINISH the transition it is in,
    and may not BEGIN another. The set is one exported predicate,
    `isSceneTransitionCompletionAction` in `simulation/foundation/scene-lifecycle.ts`, which both
    guards consult — the renderer may not import the pipeline, and two copies of the list would
    drift.

    Admitting them is necessary and not sufficient: the release still needs every seat in
    `state.players` to acknowledge, or the host's own budget to expire the transition. What a seat
    that cannot acknowledge at all does to it is measured in
    `simulation/scene/__tests__/unackable-seat-barrier.test.ts`.

    Also fixed, in the same path: a scene commit landing after a result now carries the recorded
    `gameResult` through unchanged. `initialize`/`teardown` may return any state and the commit
    spreads it, so the newly-admitted commit would otherwise have been a door through which game
    code could blank a recorded result and resume a finished match. Only `gameResult` is re-pinned,
    so an entered scene still writes its own `phase`.

    The spectator gate is unchanged: a seatless viewer has nothing to acknowledge for.

## 1.0.0-rc.5

## 1.0.0-rc.4

## 1.0.0-rc.3

## 1.0.0-rc.2

### Minor Changes

- 7f237bb: Dev multiplayer harness: game-owned fixtures, auto-session, standalone packaging (§4.32)
    - `@chimera-engine/electron` ships the harness as the `chimera-dev-mp` bin (+ the
      `./dev-harness` library subpath): one command spawns an auto-hosting instance plus
      auto-joining clients, relays the host's `host:port:token` lobby code via an atomic
      announce-file handshake, auto-readies every seat, and auto-starts the match once the
      roster is complete. Works identically from the monorepo and from a standalone
      scaffolded app (the app dir is the harness root; entry from `package.json` `main`).
    - Games inject their own test data from `<appRoot>/dev/`: `profiles/*.json` (cosmetic
      engine-shaped identities, seeded as each instance's active profile) and
      `scenarios/*.json` (per-seat game-defined attributes such as a JSON-encoded deck,
      host-authored match settings such as an arena id, AI seats, auto-start) — validated by
      the new `@chimera-engine/simulation` `shared/dev-fixture-contract.ts` schemas and
      riding the same lobby channels a real player uses into `snapshot.setup`.
    - Per-game player-attribute value cap: `GameLobbySetup.maxAttributeValueLength`
      (default 256 — unchanged behaviour) lets a game admit deck-sized values; the wire
      schema's coarse bound is now `WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH` (16384) with
      the precise cap enforced by `LobbyManager` on both write paths.
    - `create-chimera-game` scaffolds ship a `dev:mp` script, starter `dev/` fixtures, and
      a synthesized standalone `.gitignore`; `verify:scaffold` gains a `dev-harness`
      dry-run step and `verify:pack` probes the new subpath.
    - Fixes the previously dead harness wiring: the spawn entry pointed at a deleted
      monorepo path, `--dev-auto-join` could never match its own equals-form flag, and the
      documented seed-profile copy was unimplemented.

- RC polish across the engine chrome and settings:
    - New real frame-rate limiter: `FrameRateLimiter` (exported from the r3f barrel) gates
      `gl.render` at render priority and reads `targetFps` from resolved settings, replacing
      the previously non-functional display cap.
    - Removed the dead `display.fullscreen`, `display.vsync`, and `display.uiScale` settings
      engine-wide (they had no runtime effect; fullscreen is forced in production). The
      gameplay settings tab is now language-only.
    - Slimmed the default chrome: dropped the lobby role badge and the default HUD's
      `Tick`/undo/redo affordances (`DefaultGameHud`), and removed the duplicated title from
      the blank game template.

## 1.0.0-rc.1

## 1.0.0-rc.0

### Major Changes

- M10 — first public release (`1.0.0`). Adopt the locked `1.X.Y` versioning scheme: every
  `@chimera-engine/*` engine package and the `create-chimera-game` initializer now share one
  version and re-publish together. This bump retires the independent `0.x` per-package semver
  and aligns the whole first-party set at `1.0.0`. Previewed on npm as `1.0.0-rc.0` under the
  `rc` dist-tag before the final release.

### Minor Changes

- e9f122f: Add the optional spectator capability to the `GameManifest` contract and the reserved allow-spectators match setting (F72). New exports from `foundation/game-manifest-contract`: `GameSpectatorSupport` (an opaque `mode: 'perspective'` — the only v1 visibility model), the optional `GameManifest.spectators` field, and the pure `resolveSpectatorSupport(manifest)` helper (returns `undefined` for an absent field or a malformed `mode`, never throws, never mutates). New exports from `foundation/game-lobby-contract`: the engine-owned reserved match-setting key `ALLOW_SPECTATORS_SETTING` (`'engine.allowSpectators'`), its `ALLOW_SPECTATORS_DEFAULT` (`'false'`), and the pure `readAllowSpectators(matchSettings)` reader (`true` only when the key is exactly `'true'`, fail-safe closed otherwise). Behaviour-neutral for every existing game: absent `spectators` resolves to `undefined` and join-in-progress stays rejected — no game admits spectators until it declares the capability and the host enables it per match.
- da1f1cd: Let a spectator switch which seat they follow (F72 Spectator Mode). The `SPECTATE_TARGET_UPDATE` wire message is now plumbed end-to-end: the networking transports gain `ClientTransport.sendSpectateTarget(targetPlayerId)` and `HostTransport.onSpectateTargetUpdate((from, targetPlayerId) => …)` (mirrored across the local WebSocket provider — `WsClientTransport`, `MessageRouter`, `WsHostTransport` — and the `InMemoryMultiplayerProvider`); the host derives the spectator from the connection (never a client-supplied id, Invariant #99) and, after validating the requested target is a currently-seated player, re-points the viewer's `SpectatorRegistry` entry and immediately re-broadcasts the new-perspective projection — an unknown or non-seated target is ignored and the perspective is unchanged. A new renderer→main IPC seam drives it: `window.__chimera.spectate.setFollowedTarget(targetPlayerId)` sends the Zod-validated `chimera:spectate:set-target` channel (Invariant #5), which `LobbyManager.setSpectatorTarget` forwards over the joined session's transport. The message is out-of-band / cosmetic: never an `EngineAction`, never advances `tick`, and never enters `ActionHistory`, saves, or replays (Invariant #115).

## 0.10.0

### Minor Changes

- 483a4ab: Add the optional hardware-cursor declaration to the `GameManifest` contract (F69). New exports from `foundation/game-manifest-contract`: `GameCursorRole` (`'default' | 'pointer' | 'disabled'`), `GameCursorHotspot`, `GameCursorImage` (game-asset-relative `image` path + optional `hotspot`), `DEFAULT_CURSOR_HOTSPOT`, the optional `GameManifest.cursor` field, and the pure `resolveGameCursor(manifest)` helper that normalizes declared roles (hotspots defaulted to `(0, 0)`) and returns `undefined` for absent or empty declarations — behaviour-neutral: the plain system cursor stays. Image paths are opaque at this layer and resolved only by the renderer through the game-asset protocol.
- abdd11d: Add the optional logo-screen declaration to the `GameManifest` contract (F70). New exports from `foundation/game-manifest-contract`: `GameLogoScreen` (an opaque game-owned `route` of the form `` `/${string}` ``), the optional `GameManifest.logoScreen` field, and the pure `resolveGameLogoScreen(manifest)` helper. The resolver returns `undefined` for an absent declaration or a malformed route (non-string, missing the leading slash, or carrying a `?` query / `#` fragment) and never throws — a bad manifest can never brick a packaged boot; the host just falls back to the main menu. Behaviour-neutral for games that declare nothing: boot goes straight to `/main-menu` exactly as before.

### Patch Changes

- 70e4147: Fix player colours (and other host-authored seat attributes) flashing their default value at the start of a replay before snapping to the chosen value.

    Seat setup — chosen player colours, names, team, etc. — is match-initialization data carried on the `engine:start_game` payload, not a gameplay action. A replay's `gameConfig` is frozen at lobby-start, before that setup exists, so `createBaseReplayInitialSnapshot` reconstructed the initial frame without any `setup`; the value only appeared once the recorded `engine:start_game` action replayed, producing a one-frame default → chosen flash. The reconstruction now lifts `setup` from the replay's first `engine:start_game` action (validated via the same `parseSetup` sanitiser the live pipeline uses) and seeds it into the initial snapshot, so the first frame already carries the correct attributes. Determinism is preserved — the replayed `engine:start_game` re-applies the identical value, leaving every post-action frame bit-identical — and the fix is self-healing for already-recorded replays (no file-format change).

- 26da224: Fix "Return to lobby" doing nothing after a match ends (from the post-game summary or the post-game replay).
    - `@chimera-engine/simulation`: the `ActionPipeline` terminal-match gate now allows `engine:return_to_lobby` after a `gameResult` is recorded. It is the host-only abandon-to-lobby reset (the reverse of `start_game`) and does not mutate the recorded result, so it must not be rejected alongside gameplay/turn/undo actions — otherwise the host can never leave a finished match back to the lobby.
    - `@chimera-engine/renderer`: the in-game menu's leave action is now injectable through `GameShell` → `InGameMenuHost`, and the replay player supplies a context-aware leave (back to the lobby for a post-game replay, back to the replay library for a library-opened one). `GameStoreBootstrap` also returns to the lobby on a `phase:'lobby'` snapshot when on the replay player route, not just `/game`.

## 0.9.0

### Minor Changes

- Initial package extraction from the Chimera monorepo (M9, F57–F66). The pure,
  zero-runtime-dependency simulation core — engine, action registry, reducers, snapshot
  and projection, and the deterministic host — published as `@chimera-engine/simulation`.
