---
'@chimera-engine/electron': minor
'@chimera-engine/simulation': minor
'create-chimera-game': minor
---

Dev multiplayer harness: game-owned fixtures, auto-session, standalone packaging (§4.32)

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
