---
title: 'Chimera Architecture — §6 Multiplayer Latency, Prediction and Connection Diagnostics'
description: 'How Chimera absorbs network latency behind a host-authoritative simulation: the two halves of client prediction — a wired per-action predictable opt-in feeding the PredictionStore queue, and the unwired ClientPredictor / ReconcileBuffer replay classes, round-trip latency measurement whose PING/PONG half is wired and whose store half is not, and the NAT / port-forwarding connection diagnostics that buildNetworkDiagnostics feeds to the Debug Inspector.'
tags:
    [
        multiplayer,
        latency,
        prediction,
        reconciliation,
        nat,
        port-forwarding,
        network-diagnostics,
        host-authority,
    ]
---

# §6 Multiplayer Latency, Prediction and Connection Diagnostics

> §6 of the Chimera architecture.
>
> Related: [WebSocket Message Protocol](websocket-message-protocol.md) (§4.3) · [Renderer State Stores](renderer-state-stores.md) (§4.4) · [Multiplayer Provider](multiplayer-provider-websocket.md) (§4.14) · [Runtime Debug Layer](runtime-debug-layer.md) (§4.12) · [Architecture Invariants](../executive-architecture/architecture-invariants.md)

---

## What this section owns

Host authority is the engine's founding rule, and it costs a round trip: a
client that dispatches an action cannot see its own result until the host has
validated it and broadcast the next authoritative snapshot. This section owns
the three mechanisms that make that cost visible, measurable or — at the game's
option — hidden:

| Mechanism                     | Owns                                                     | Where it runs                   |
| ----------------------------- | -------------------------------------------------------- | ------------------------------- |
| Prediction opt-in (wired)     | `ActionDefinition.predictable` → `PredictionStore` queue | registry → renderer             |
| Prediction replay (not wired) | `ClientPredictor`, `ReconcileBuffer`                     | `simulation/engine/prediction/` |
| Round-trip measurement        | `PING` / `PONG` → `onLatencyUpdate` (no consumer)        | protocol → renderer             |
| Connection diagnostics        | `buildNetworkDiagnostics`, `NetworkDiagnostics`          | `electron/main/`                |

It does **not** own the host-authority rule itself (Invariants #3, #4, #6, #8),
the message union (§4.3), the provider and lobby (§4.14), or the projection that
decides what a client is allowed to see (§8). Those are cited, not restated.

---

## 6.1 Host authority and the latency it creates

The host's simulation is the single source of truth. Every action — including
one dispatched by the host's own UI — is routed through validation before any
state mutation, and a rejected action returns an `ActionRejection` rather than
mutating anything. The renderer reads state and never writes it (Invariant #4);
network messages are validated before they reach the simulation (Invariant #6);
and what a client receives is a `PlayerSnapshot` produced by
`StateProjector.project()`, never the full `BaseGameSnapshot` (Invariants #3, #8).

Two consequences follow, and they are the reason this section exists:

- **A client's own action has a visible round-trip delay.** At human-turn
  cadence this is imperceptible, which is why prediction is opt-in rather than
  default.
- **A client cannot resolve a contested or randomised outcome locally.** It does
  not hold the authoritative RNG stream, and under fog-of-war it does not hold
  the opposing state either (§8). Such actions are therefore never predicted;
  the client waits.

---

## 6.2 Client prediction (optional)

Prediction is **opt-in per action**, and the opt-in has two independent halves.
The flag and the renderer-side queue it drives are wired end to end. The
simulation-side replay classes are not. A reader has to keep them apart, so this
section names which is which at every step.

### The `predictable` flag — wired

`ActionDefinition.predictable?: boolean` is the whole opt-in surface. It is
absent by default, and absence means "not predictable" — the safe direction.

Its production chain is live:

1. `ipc-handlers.ts` answers `chimera:game:predictable-action-types` with every
   registered type whose definition has `predictable === true`.
2. `gameStoreBootstrap` fetches that set once and closes an `isPredictable`
   predicate over it — injected rather than imported, so the renderer bridge
   never takes an `ActionRegistry` dependency on `simulation/`.
3. `ipcClient.sendAction` calls `PredictionStore.addPrediction(action)` for a
   predictable type before forwarding to the port, and `bootstrap`'s snapshot
   listener calls `confirmPrediction(snapshot.tick)` on every authoritative
   snapshot, evicting everything the host has confirmed.

So `PredictionStore.predictedActions` is a live queue of in-flight actions that
a component can render as pending. Note that this is **bookkeeping, not
simulation**: nothing re-runs a reducer, so the queue tells the UI what has not
landed yet without producing a speculative snapshot.

It is not a real-time-only feature. Tactics — the turn-based reference game —
marks its move action `predictable: true`, and its test suite pins that.

### `ClientPredictor` — not wired

`ClientPredictor.applyOptimistic(snapshot, action)` applies an action locally,
immediately, by running the action's own `reduce` — the same reducer the host
will run, so the optimistic result and the authoritative one are produced by
identical code.

It refuses rather than degrades: for an action whose `predictable` is absent or
`false` it throws `NonPredictableActionError`, which carries the offending
action `type` on the error so a caller can report it without re-parsing a
message. There is no silent fall-through that would optimistically apply an
unpredictable action.

`predictable` is the **only** thing it checks. It does not compare
`action.playerId` against a viewer, so "own-player only" is a rule the caller
must keep, not one the predictor enforces.

The predictor is pure. It installs no timer, reads no clock and consumes
randomness only through the `GameReduceContext` it was constructed with
(Invariants #1, #2, #43).

### `ReconcileBuffer` — not wired

`ReconcileBuffer` holds the bounded queue of actions submitted optimistically
but not yet confirmed.

- `reconcile(authoritativeSnapshot, predictor)` drains the **leading run** of
  confirmed actions — it shifts from the head while `queue[0].tick <=
snapshot.tick` and stops at the first unconfirmed one — then replays whatever
  remains on top of the authoritative snapshot through the predictor. A
  confirmed action sitting behind an unconfirmed one is therefore replayed, not
  evicted. With an in-order queue the two are the same thing; out of order they
  are not.
- The queue is capped at `MAX_BUFFER_DEPTH` (32), overridable per instance via
  `ReconcileBufferOptions.maxBufferDepth`. At the cap `enqueue` evicts the head
  rather than refusing the new action, so a client that has fallen far behind
  keeps predicting its most recent inputs. The eviction emits a `warn` naming
  the dropped action's type **only if** a logger was injected —
  `ReconcileBufferOptions.logger` is optional and evictions are silent without
  one.
- Its type parameter is `TState extends BaseGameSnapshot`, which is the full
  authoritative state type — the one Invariant #3 keeps inside the host's main
  process. Constraining it to `PlayerSnapshot`, so that it operated on the
  projected per-player view a client actually holds, is a **deliberately
  deferred design decision**, recorded as such in `ClientPredictor`'s own
  header. Wiring prediction to a real client is what would force it.

### The renderer may not touch either class

Prediction lives in `simulation/`, and the renderer is forbidden from importing
`ClientPredictor` or `ReconcileBuffer` directly. The renderer's contact with
prediction is `PredictionStore` alone (§4.4), reached through
`ipcClient.sendAction()`.

The prohibition is stated in the headers of `renderer/bridge/ipcClient.ts` and
`ipcClient.test.ts` and is **not mechanically enforced** — no lint zone bans the
specifier and no assertion reads the import graph. Both files name the classes
in prose; neither imports them, and nothing measures that they do not.

### Status: two exported classes with no production consumer

`ClientPredictor` and `ReconcileBuffer` are exported from the engine barrel
(`simulation/engine/index.ts`) and unit-tested, and nothing outside their own
directory constructs either. That is a claim about THESE TWO CLASSES only — the
`predictable` flag above is wired, and a reader who conflates the two will
conclude that prediction does not exist at all.

It is stated here rather than left to be discovered: someone who finds the
classes and expects to trace them to a caller will not find one, and the absence
is the current design state, not an omission. It is also why the
`BaseGameSnapshot` constraint above has not had to be revisited.

---

## 6.3 Measuring the round trip

A client sends `PING` carrying `sentAt`; the server echoes it in `PONG`
immediately. `WsClientTransport` computes `Math.max(0, performance.now() -
msg.sentAt)` on receipt and hands it to every callback registered through
`ClientTransport.onLatencyUpdate` (§4.14).

**The chain stops there.** Nothing in production subscribes to
`onLatencyUpdate`. So
`PredictionStore.latencyMs` is written only by its own initialiser and its reset,
both to `0`, and `perfStoreBootstrap`'s `latencyMs > 0 ? latencyMs : null`
therefore resolves to `null` — the `PerfHud` (§4.16–§4.17) ping metric has no
producer.

Everything needed to close it exists: the measurement is produced and tested,
the subscription verb exists on the transport, the store field is declared,
and the HUD reads it. What is missing is one subscriber writing the value into
the store. This is recorded rather than described as working, because a reader
tracing "where does ping come from" would otherwise stop at a field that is
always zero.

The message shapes belong to §4.3, the transport to §4.14 and the store to §4.4.

---

## 6.4 NAT, port-forwarding and connection diagnostics

A host on a home network is usually behind NAT, so a remote client cannot reach
it until a port is forwarded. Chimera does not attempt to traverse NAT; it
reports what a human needs in order to forward the port themselves.

### `buildNetworkDiagnostics`

`electron/main/network-diagnostics.ts` builds the `NetworkDiagnostics` snapshot
the Debug Inspector renders:

| Field            | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `localAddresses` | The host's **non-internal IPv4** addresses, flattened across every interface — the addresses a LAN client can dial |
| `hostPort`       | The active hosted port, or `null` when not hosting                                                                 |
| `isHosting`      | `hostPort !== null`                                                                                                |

Loopback and IPv6 entries are filtered out deliberately: the value is a _dial
this_ answer, and neither form is one.

The builder is **pure and injected**. It imports neither `electron` nor
`node:os`; the interface map and the host port arrive as narrow function ports
(`networkInterfaces`, `getHostPort`), so the composition root owns the live
wiring and the builder is unit-testable with plain stubs. `NetworkDiagnostics`
is imported type-only from `simulation/debug`, so the module carries no runtime
coupling to the debug graph. It is `import()`ed only inside the
debug branch of `electron/main/index.ts`, whose condition is written as an
inlined `process.env.CHIMERA_DEBUG` / `NODE_ENV` test rather than as a named
constant — deliberately, so esbuild can fold the branch and keep the module out
of a packaged build entirely (Invariant #27).

### Where the diagnostics surface

`LobbyManager` supplies the live host port, `electron/main/index.ts` composes the
ports at the point of use, and the result reaches the Inspector over the debug
bridge as connection-diagnostics data. The read is deliberately bridge-level
rather than session-level: a player is most likely to want the address and port
while sitting in a lobby with no game session attached at all.

### The transport seam

If NAT traversal is ever added, it enters as a transport option rather than a
change to this section. `ServerConnectionOptions` already exposes
`resolveEndpoint` and `socketFactory` (§4.14), both defaulting to today's exact
behaviour, so a STUN/TURN relay or WebRTC shim slots in without touching the
simulation or state contracts. The seam ships dormant — no consumer wires it.

---

## Invariants

- **#1 / #2 / #43** — `ClientPredictor` and `ReconcileBuffer` live in
  `simulation/` and are pure: no DOM, no Node, no wall clock, randomness only
  through `ReduceContext.rng`.
- **#3** — the type the prediction classes are constrained to, `BaseGameSnapshot`, is the state Invariant #3 keeps inside the main process; narrowing them to the projected `PlayerSnapshot` a client actually holds is deferred, not done.
- **#6** — network messages are validated before they touch the simulation, so a prediction is never what makes a state change authoritative.
- **#27** — the connection-diagnostics builder is reachable only through the
  debug branch, so a packaged non-debug build does not contain it.
