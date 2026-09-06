---
title: 'Chimera Architecture — §6 Multiplayer Latency, Prediction and Connection Diagnostics'
description: 'How Chimera absorbs network latency behind a host-authoritative simulation: what the engine offers instead of client prediction and what adding it would take, round-trip latency measurement whose PING/PONG half is wired and whose store half is not, and the NAT / port-forwarding connection diagnostics that buildNetworkDiagnostics feeds to the Debug Inspector.'
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
validated it and broadcast the next authoritative snapshot. This section owns what
makes that cost visible and measurable:

| Mechanism              | Owns                                              | Where it runs       |
| ---------------------- | ------------------------------------------------- | ------------------- |
| Round-trip measurement | `PING` / `PONG` → `onLatencyUpdate` (no consumer) | protocol → renderer |
| Connection diagnostics | `buildNetworkDiagnostics`, `NetworkDiagnostics`   | `electron/main/`    |

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
  cadence this is imperceptible.
- **A client cannot resolve a contested or randomised outcome locally.** It does
  not hold the authoritative RNG stream, and under fog-of-war it does not hold
  the opposing state either (§8).

---

## 6.2 Client prediction: none, deliberately

The engine offers no client prediction: an action dispatched through it waits for
the host to validate it and broadcast the next authoritative snapshot, and that
wait is the cost §6.1 describes. What a GAME does with its own state before
dispatching is the game's — `apps/tactics` lays its commitment-mode buffer over
the viewer's own snapshot and renders that, which its own section documents
([commitment battle mode](../security-trust/tactics-commitment-battle-mode.md)).

What used to sit here was a surface that implied otherwise: an
`ActionDefinition.predictable` flag a game could set, a
`getPredictableActionTypes()` bridge method the renderer called at bootstrap,
and a `predictedActions` queue the IPC client appended to — none of which any
component, hook or reducer ever read — beside two exported and unit-tested
classes, `ClientPredictor` and `ReconcileBuffer`, that nothing outside their own
directory constructed. They were also typed on `BaseGameSnapshot`, the state
Invariant #3 keeps inside the main process, so a client could not have used them
as written. All of it is removed.

**What adding prediction would take**, if a game ever needs it: the renderer
holds a `PlayerSnapshot`, not the authoritative state, so the reducers it would
replay have to be renderer-safe and registered as such — a game-supplied table
alongside `rendererGameRegistry`, not a reach into `simulation/engine`. The
optimistic state is a VIEW concern: it may never become an authoritative write
(Invariant #4), and the authoritative snapshot always wins on reconcile. What is
deleted here is a shape that did not satisfy those constraints; it is not a
design that was tried and rejected.

---

## 6.3 Measuring the round trip

A client sends `PING` carrying `sentAt`; the server echoes it in `PONG`
immediately. `WsClientTransport` computes `Math.max(0, performance.now() -
msg.sentAt)` on receipt and hands it to every callback registered through
`ClientTransport.onLatencyUpdate` (§4.14).

**The chain stops there.** Nothing in production subscribes to
`onLatencyUpdate`. So
`MatchStatusStore.latencyMs` is written only by its own initialiser and its reset,
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

- **#3** — a client holds a projected `PlayerSnapshot`, never the authoritative `GameSnapshot`. That is the constraint any future prediction surface has to be built against, and the one the deleted classes did not meet.
- **#6** — network messages are validated before they touch the simulation, so nothing a client does locally can make a state change authoritative.
- **#27** — the connection-diagnostics builder is reachable only through the
  debug branch, so a packaged non-debug build does not contain it.
