---
title: 'Dev Tooling & Multiplayer Harness'
description: 'chimera-dev-mp CLI (dev:mp), game-owned dev fixtures (dev/profiles + dev/scenarios), harness CLI flags, announce-file handshake, auto host/join/start flow, CHIMERA_DEV_HARNESS guard, standalone-scaffold usage.'
tags: [dev-tools, multiplayer, harness, electron, testing, tooling]
---

# Dev Tooling & Multiplayer Harness

> §4.32 of the Chimera architecture.
> Related: [Multiplayer Provider](multiplayer-provider-websocket.md) · [Player Profiles & Directory](player-profiles-directory.md) · [E2E Testing](../testing/e2e-testing-playwright.md)

---

## Overview

Running multiplayer scenarios by hand is the single biggest development friction point. The dev harness collapses it to a one-line command:

```bash
pnpm dev:mp 3                       # 1 host + 2 auto-joining clients, generated profiles
pnpm dev:mp --scenario skirmish     # seats, profiles and match config from the game's dev/ fixtures
pnpm dev:mp 2 --dry-run             # print the validated spawn plan as JSON; spawn nothing
```

Each instance boots, consumes its `--dev-*` flags, and automatically hosts or joins **before the main menu renders** (the window boots straight into `/lobby`; the renderer's `GameStoreBootstrap` carries every window to `/game` when the auto-started snapshot lands). All instances use distinct `userData` directories and distinct player profiles.

The harness ships as the **`chimera-dev-mp` bin of `@chimera-engine/electron`** (library subpath: `@chimera-engine/electron/dev-harness`), so a standalone scaffolded game (create-chimera-game) runs exactly the tool the monorepo does. Dev-only code in the published tarball follows the debug-api precedent: the gate is the runtime env (Invariant #77), not file presence.

---

## Scope and Non-Goals

- **In scope**: spawn N Electron instances on localhost, auto host + join + ready + start, game-owned fixture injection (profiles, per-seat attributes, match settings, AI seats), per-instance data isolation, graceful teardown on Ctrl+C.
- **Out of scope**: performance measurement (N renderers sharing one GPU), production packaging (refused), automated match-outcome assertions (that is the Playwright E2E suite, §13).

---

## Game-Owned Dev Fixtures (`<appRoot>/dev/`)

A game injects its own test data by committing fixtures next to its app:

```
<appRoot>/dev/
├── profiles/                # Cosmetic identities (EngineProfile shape: id, displayName, avatar, locale)
│   ├── alice.json
│   └── bob.json
└── scenarios/               # One file per launchable session shape
    └── skirmish.json
```

A scenario (validated by `DevScenarioSchema`, `shared/dev-fixture-contract.ts`):

```json
{
    "gameId": "<game-id>",
    "seats": [
        { "profile": "alice.json", "attributes": { "deck": "[\"strike\",\"guard\"]" } },
        { "profile": "bob.json", "attributes": { "deck": "[\"fang\"]" }, "ready": false }
    ],
    "aiSeats": 1,
    "matchSettings": { "arena": "lava-pit" },
    "autoStart": true
}
```

Where each piece of game data goes — the same sanctioned channels a real player uses:

| Fixture field         | Runtime channel                                                                                  | Notes                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seats[i].profile`    | Seeded into the profile repository, then the normal join attestation                             | Cosmetic only (Invariant #59). Engine-shaped; unknown game fields in the file are tolerated and **stripped** at parse.                                                      |
| `seats[i].attributes` | Owner-authored per-seat lobby attributes → `GameSetupConfig.playerAttributes` → `snapshot.setup` | Game-defined keys/values (opaque strings; JSON-encode structured payloads such as a deck). Values are capped per game — see `GameLobbySetup.maxAttributeValueLength` below. |
| `matchSettings`       | Host-authored `setMatchSetting` merges over the game's `lobbySetup` defaults                     | Game-defined vocabulary (e.g. an arena id, a turn mode). Host-authored, so no wire cap applies.                                                                             |
| `aiSeats`             | Host-side `addAi()` after the human seats                                                        | The auto-start latch waits for exactly this many AI slots.                                                                                                                  |
| `autoStart`           | Host calls `startGame()` once the roster is complete and every seat is ready                     | Default `true`. `false` (or a seat's `ready: false`) leaves the seeded lobby waiting for manual interaction — the lobby-iteration workflow.                                 |

With **no fixtures at all**, `pnpm dev:mp N` still works: each instance gets a generated `Dev Player <n>` profile and the game's `lobbySetup` defaults.

A game should keep its fixtures honest with a contract test that cross-validates them against its own lobby vocabulary — see `apps/<game>/dev/fixtures.test.ts` in the reference app for the pattern (profiles parse, scenario parses, every settings key/value belongs to the game's declared options).

### Attribute value caps (deck-sized payloads)

Client-authored attribute values cross the wire, so two caps apply (the chat-relay two-tier pattern):

- **Coarse wire bound** — `WIRE_MAX_PLAYER_ATTRIBUTE_VALUE_LENGTH` (16 384): anything past it is dropped as malformed.
- **Per-game cap** — `GameLobbySetup.maxAttributeValueLength` (default **256**, the historical behaviour), enforced by `LobbyManager` on both the local fail-fast path and the host's wire merge. A game whose per-seat data is a structured payload (e.g. a JSON-encoded deck) raises it in its lobby-setup descriptor.

---

## CLI (`chimera-dev-mp`)

```
chimera-dev-mp [N] [--scenario <name>] [--app <dir>] [--entry <path>] [--game <id>] [--debug] [--dry-run]
```

| Flag                | Effect                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `N` (positional)    | Human seat count (2–8). Omit when `--scenario` provides the seat list.                                        |
| `--scenario <name>` | Load `<appRoot>/dev/scenarios/<name>.json` (with or without the `.json`).                                     |
| `--app <dir>`       | The app root. Default: cwd (must contain a `package.json` with `main`).                                       |
| `--entry <path>`    | Built Electron main entry override. Default: the app's `package.json` `main`.                                 |
| `--game <id>`       | Expected gameId; each instance cross-checks it against its hosted game.                                       |
| `--debug`           | Launch instances with `CHIMERA_DEBUG=1` (F9 Debug Inspector).                                                 |
| `--dry-run`         | Resolve + validate everything, print the spawn plan as JSON, exit without spawning (used by verify:scaffold). |

Everything is validated **before any spawn**: the scenario (Zod, strict), every referenced profile file (engine schema + distinct `localProfileId`s — duplicates would collide at the host's join gate), seat-count consistency, and the built entry (the CLI errors with the build command rather than auto-building). One limit: the CLI validates attribute values against the **coarse wire bound only** — the per-game `maxAttributeValueLength` needs the game's own lobby setup, so an over-cap value surfaces at instance seeding (a loud bootstrap failure + teardown, not a silent drop).

The CLI requires `CHIMERA_DEV_HARNESS=1` (the app's `dev:mp` script sets it) and refuses `NODE_ENV=production` (`assertHarnessEnv`, Invariant #77). `NODE_ENV` is the only signal available to it: `chimera-dev-mp` is a plain Node CLI that _spawns_ Electron, so there is no `app.isPackaged` to read. The packaged trigger is enforced one level down — each spawned instance runs the engine's `main()` startup guard, which refuses for a packaged binary **or** `NODE_ENV=production`. Child instances always launch windowed development mode (`NODE_ENV`/`CHIMERA_ENV=development`) with `ELECTRON_RUN_AS_NODE` stripped.

### Script wiring (identical in both worlds)

- **App-level** (`apps/<game>/package.json` and the scaffold template): `"dev:mp": "cross-env CHIMERA_DEV_HARNESS=1 chimera-dev-mp"` — the bin resolves from the app's `@chimera-engine/electron` devDependency.
- **Monorepo root**: `pnpm dev:mp` rebuilds the packages + the reference app's bundle, then delegates to the app's `dev:mp` (dogfooding the published bin path). Trailing args (`pnpm dev:mp 3 --scenario skirmish`) reach the harness.
- **Standalone root** (emitted by create-chimera-game): `pnpm dev:mp` builds the renderer + app bundle and delegates the same way.

---

## Instance Flags (`--dev-*`, equals-separator form)

Parsed by `parseHarnessFlags` (`electron/main/index.ts`); every flag is ignored (with one warning) unless `CHIMERA_DEV_HARNESS=1` (Invariant #77).

| Flag                          | Effect                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `--dev-auto-host`             | Host + seed a lobby before the window renders.                                                   |
| `--dev-auto-join=<lobbyCode>` | Join the full `host:port:token` code relayed from the host's announce file.                      |
| `--dev-profile-file=<path>`   | Seed this profile JSON into the repository as the active profile (the §4.24 seed-copy).          |
| `--dev-profile-id=<id>`       | Active-profile id; `dev-p<N>` ids get a generated "Dev Player N" identity when no file is given. |
| `--dev-scenario-file=<path>`  | The scenario driving the auto-flow (settings, attributes, AI seats, auto-start).                 |
| `--dev-seat=<n>`              | This instance's 1-based seat in the scenario (seat 1 = host).                                    |
| `--dev-players=<n>`           | Expected human seats for a scenario-less auto-host (the auto-start latch waits for them).        |
| `--dev-announce-file=<path>`  | Host only: where to write the announce payload (inside its own userData dir, Invariant #78).     |
| `--dev-game=<id>`             | Cross-checked against the hosted game's id; mismatch aborts before any seeding.                  |

There is no port flag: the hosting provider binds an OS-assigned port and mints a session token, so the join code is only knowable from the announce.

---

## Startup Flow (announce-file handshake)

```
chimera-dev-mp CLI                         host instance (p1)                    client instance (p_i)
──────────────────────                     ─────────────────────                 ─────────────────────
resolveHarnessPlan (validate fixtures)
resetDevUserDataDirs (wipe + recreate)
spawn host ─────────────────────────────►  seed profile → ensureActiveProfile
                                           DevHarnessCoordinator.bootstrap():
                                             hostLobby(maxPlayers = seats+aiSeats)
                                             setMatchSetting × scenario.matchSettings
                                             setPlayerAttribute (seat 1)
                                             addAi × aiSeats
                                             write announce {lobbyCode} (atomic)
                                             ready
waitForAnnounceFile ◄──────────────────────  (announce = "host fully seeded" barrier)
spawn clients(lobbyCode) ────────────────────────────────────────────────────►  seed profile, joinLobby(code,
                                           ProfileGate.admit → roster              attestation) → own-seat
                                           auto-start latch: roster complete       attributes → ready
                                             + all ready + AI slots present
                                             → startGame() (once)
                                           snapshot lands → every window: /lobby → /game
Ctrl+C / any exit → SIGTERM all (one-out, all-out; SIGKILL after 5s grace)
```

A bootstrap failure (bad fixture, gameId mismatch, join rejection) exits that instance with a fatal log, and the orchestrator's one-out-all-out teardown stops the siblings — a harness that half-starts is worse than one that stops loudly.

---

## Production Guard

```typescript
// electron/main/startup-guard.ts (Invariant #77)
// isProductionRuntime = isPackaged || env.NODE_ENV === 'production'.
// `isPackaged` (app.isPackaged, injected by the main() composition root) is the
// load-bearing term: electron-builder never sets NODE_ENV, so a NODE_ENV-only
// test would be vacuous for every shipped binary.
if (env['CHIMERA_DEV_HARNESS'] === '1' && isProductionRuntime(env, isPackaged)) {
    throw new Error('CHIMERA_DEV_HARNESS is enabled in a production build. Refusing to start.');
}
```

---

## What This Is Not

- **Not an E2E test runner.** Automated assertions belong in the Playwright suite (§13).
- **Not a performance benchmark.** N renderers on one GPU is not representative. Use `§4.16 PerfHud` on single-instance runs.
- **Not a load-testing tool.** For 50-player correctness checking, build a headless `InMemoryMultiplayerProvider` test instead.

---

## Invariants

| #   | Rule                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #77 | The harness is development-only. The CLI (`assertHarnessEnv`) refuses `NODE_ENV=production`; each spawned instance additionally hits the engine's `main()` startup guard, which refuses for a packaged binary **or** `NODE_ENV=production`. All `--dev-*` flags are ignored (with a warning) when `CHIMERA_DEV_HARNESS` is absent. |
| #78 | Each harness-spawned instance runs in an isolated `userData` directory (`.dev-userdata/p<i>/`); shared state between instances is forbidden. The host's announce file lives inside its OWN dir and is read only by the orchestrator — never by a sibling.                                                                          |

---

## Cross-References

- [Multiplayer Provider](multiplayer-provider-websocket.md) — the `LobbyManager` operations the coordinator drives
- [Player Profiles & Directory](player-profiles-directory.md) — seed profiles and `ProfileSanitizer.admit()`
- [E2E Testing](../testing/e2e-testing-playwright.md) — the automated assertion layer above this harness
- `shared/dev-fixture-contract.ts` — the scenario/announce schemas + pure helpers
