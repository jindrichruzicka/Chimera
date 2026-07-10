<p align="center">
  <img src="docs/assets/chimera-logo-compact.png" alt="Chimera" width="120" />
</p>

<h1 align="center">Chimera</h1>

<p align="center">
  <b>Ship a deterministic, host-authoritative multiplayer desktop game — without building an engine first.</b><br />
  Electron · Next.js · React 19 · Three.js / React Three Fiber · TypeScript
</p>

---

## Quick Start

One command scaffolds a complete, ready-to-run game project:

```sh
pnpm create chimera-game my-card-game
cd my-card-game
```

Prove it works, play it, ship it:

```sh
pnpm --filter @chimera-engine/my-card-game test       # unit tests — green out of the box
pnpm exec next build apps/my-card-game/renderer       # build the UI
pnpm --filter @chimera-engine/my-card-game build:app  # bundle the Electron main
pnpm exec electron apps/my-card-game                  # play it
pnpm package                                          # distributable (.app / installer)
```

Requires Node.js **≥ 20** and [pnpm](https://pnpm.io) **≥ 10**. The engine arrives as published
`@chimera-engine/*` packages — no monorepo checkout needed.

Hacking on the engine itself? Clone this repo, then `pnpm install && pnpm test`. Start at
[`docs/architecture-overview.md`](docs/architecture-overview.md).

## Folder Structure

Everything you write lives in one app folder:

```
apps/my-card-game/
├── simulation/          # game rules, actions, and state — pure & deterministic, no DOM/IPC
├── ai/                  # AI brains that play your game — same purity rules as simulation/
├── screens/             # React components for your game's UI
├── content/             # schemas for the kinds of content your game loads
├── renderer/            # Next.js shell wiring for your game
├── electron/            # desktop entry point & composition root
├── e2e/                 # Playwright end-to-end tests
├── assets/              # game-owned binaries: icons, textures, models, audio
├── manifest.ts          # registers your game with the engine
└── settings-schema.ts   # your game's settings schema (zod)
```

Start in `simulation/` (what your game **is**) and `screens/` (what it **looks like**); add
`data/` for JSON game content and `scene/` for 3D scene work as you grow. The engine handles
the rest.

## Why Chimera

- **Determinism you can bank on.** Pure reducers, seeded RNG, fixed-point math — bit-identical
  across macOS, Windows, and Linux. Saves, replays, and undo/redo fall out for free.
- **Multiplayer is the default, not a retrofit.** Host-authoritative architecture with a local
  WebSocket host, pluggable providers (LAN today, Steam unchanged tomorrow), client-side
  prediction, and reconnect + resync.
- **Fog of war by construction.** Per-player state projection means clients never even receive
  what they shouldn't see; a commitment scheme keeps shuffles, dice, and hidden cards cheat-proof.
- **Batteries included.** Lobby with AI seats, save/load with migrations, replay export,
  rebindable keyboard + gamepad input, camera presets, audio buses, chat, toasts, settings UI.
- **A stack you already know.** Electron, Next.js, React 19, Three.js / React Three Fiber —
  all TypeScript, end to end.
- **Secure by default.** Context isolation, an enumerated typed preload surface, sanitised
  side-channels, timing-safe lobby passwords.
- **Tooling that respects your time.** In-engine inspector with time travel, `pnpm dev:mp N` for
  instant local multiplayer sessions, Vitest + fast-check + Playwright baked in.
