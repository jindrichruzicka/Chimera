---
title: 'Dev Tooling & Multiplayer Harness'
description: 'pnpm dev:mp <N> command, 6 harness CLI flags, HarnessOptions interface, CHIMERA_DEV_HARNESS guard, startup flow (findFreePort/resetDirs/spawn/waitForPort), seed profiles dev-p1..dev-p8, production guard.'
tags: [dev-tools, multiplayer, harness, electron, testing, tooling]
---

# Dev Tooling & Multiplayer Harness

> §4.32 of the Chimera architecture.
> Related: [Multiplayer Provider](multiplayer-provider-websocket.md) · [Player Profiles & Directory](player-profiles-directory.md) · [E2E Testing](../testing/e2e-testing-playwright.md)

---

## Overview

Running multiplayer scenarios by hand is the single biggest development friction point. The dev harness collapses it to a one-line command:

```bash
pnpm dev:mp 3                              # 1 host + 2 auto-joining clients
pnpm dev:mp 4 --game tactics --scenario skirmish
```

Each instance boots, consumes its CLI flags, and automatically hosts or joins before the main menu renders. All instances use distinct `userData` directories and distinct seed profiles.

---

## Scope and Non-Goals

- **In scope**: spawn N Electron instances on localhost, wire up host + auto-join, per-instance data isolation, graceful teardown on Ctrl+C, seed profile rotation.
- **Out of scope**: performance measurement (N renderers sharing one GPU), production packaging (refused), automated match-outcome assertions (that is the Playwright E2E suite, §13).

---

## CLI Flags (Equals-Separator Form)

All flags use `--flag=value` to avoid shell-quoting ambiguity:

| Flag                          | Values                   | Effect                                                     |
| ----------------------------- | ------------------------ | ---------------------------------------------------------- |
| `--dev-auto-host`             | boolean presence         | Skip main menu; call `LobbyManager.hostLobby({ port })`    |
| `--dev-auto-join=<host:port>` | `127.0.0.1:7777`         | Skip main menu; call `LobbyManager.joinLobby({ address })` |
| `--dev-port=<n>`              | integer `[1, 65535]`     | Port the hosting instance listens on                       |
| `--dev-profile-id=<id>`       | `dev-p1`, `dev-p2`, …    | Load seed profile from `tools/dev-profiles/`               |
| `--dev-game=<id>`             | content-database game id | Pre-select game, skipping game picker                      |
| `--dev-scenario=<name>`       | scenario identifier      | Pre-select scenario within the game                        |

`CHIMERA_DEV_HARNESS=1` env var must be present for any flag to take effect. Without it, flags are ignored with a warning.

Each instance also receives Electron's built-in `--user-data-dir=.dev-userdata/p<i>` for independent profiles, saves, settings, logs, and crash dumps (invariant #78).

---

## HarnessOptions Interface

```typescript
// tools/dev-multiplayer.ts

interface HarnessOptions {
    players: number; // 2..8 (rejected outside this range)
    game?: string;
    scenario?: string;
    port?: number; // Default: random free port
}
```

---

## Startup Flow

```
pnpm dev:mp 3
  │
  ▼
 tools/dev-multiplayer.ts
  │
  ├── findFreePort() → 7812
  ├── resetDevUserDataDirs(3)        ← hermetic: wipe + recreate .dev-userdata/p{1..3}
  │
  ├─ spawn electron #1  (host, userData=.dev-userdata/p1, profile=dev-p1, port=7812)
  │       └─ LobbyManager.hostLobby({ port: 7812 })  ← main menu bypassed
  │
  ├─ waitForPortListening(7812, 10_000ms)
  │
  ├─ spawn electron #2  (client, p2, addr=127.0.0.1:7812)
  │       └─ LobbyManager.joinLobby(…) → ProfileSanitizer.admit
  │
  └─ spawn electron #3  (client, p3, addr=127.0.0.1:7812)
          └─ LobbyManager.joinLobby(…) → ProfileSanitizer.admit

 Ctrl+C: installSignalForwarding sends SIGTERM to all children.
 Each instance runs clean-shutdown path before exiting.
```

---

## Seed Profiles

```
tools/dev-profiles/
├── dev-p1.json   # { localProfileId: 'dev-p1', displayName: 'Dev Player 1', avatar: { kind: 'builtin', ref: 'avatars/red.png' } }
├── dev-p2.json   # { … avatar: { kind: 'builtin', ref: 'avatars/blue.png' } }
├── dev-p3.json   # { … avatar: { kind: 'builtin', ref: 'avatars/green.png' } }
├── dev-p4.json
└── dev-p8.json
```

On startup with `--dev-profile-id`, `ProfileManager` copies the seed file into `userData/profiles/` before normal profile resolution — distinct avatars and names, no interactive setup.

---

## Production Guard

```typescript
// electron/main/index.ts

if (process.env.CHIMERA_DEV_HARNESS === '1' && process.env.NODE_ENV === 'production') {
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

| #   | Rule                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #77 | `electron/main/index.ts` must refuse to start when `CHIMERA_DEV_HARNESS=1` + `NODE_ENV=production`. All harness flags are ignored (with a warning) when `CHIMERA_DEV_HARNESS` is absent.                             |
| #78 | Each harness-spawned instance runs in an isolated `userData` directory (`.dev-userdata/p<i>/`). Shared state between instances is forbidden — profiles, saves, settings, logs, and crash dumps must be per-instance. |

---

## Cross-References

- [Multiplayer Provider](multiplayer-provider-websocket.md) — `LobbyManager` APIs the harness calls
- [Player Profiles & Directory](player-profiles-directory.md) — seed profiles and `ProfileSanitizer.admit()`
- [E2E Testing](../testing/e2e-testing-playwright.md) — the automated assertion layer above this harness
