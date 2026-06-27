---
title: 'Extension-Library Adopter On-Ramp'
description: 'How a third party builds, versions, and publishes a @chimera/<domain> extension library (e.g. @chimera/cards) that plugs into the Chimera engine — the install matrix, the peerDependencies-on-@chimera/simulation rule, and the publish flow mirroring F66 — without ever pointing a dependency arrow outward from the core.'
tags:
    [
        adopter,
        extension-library,
        packaging,
        publishing,
        peer-dependencies,
        npm,
        changesets,
        provenance,
        m9,
    ]
---

# Extension-Library Adopter On-Ramp

> Realises [Appendix C.6 — Adopter Model](architecture-overview.md#c6-adopter-model) of the Chimera architecture.
> Related: [Appendix C.3 — Target Package Layout](architecture-overview.md#c3-target-package-layout) · [Appendix C.7 — As-Built Build Model](architecture-overview.md#c7-as-built-package-build-model-m9) · [Architecture Invariants](executive-architecture/architecture-invariants.md) · [M9 — Package Extraction](roadmap-sections/m9-package-extraction-v0.9.0.md)

This guide is for a **third-party developer building a `@chimera/<domain>` extension library** — a reusable domain toolkit on top of the engine, such as `@chimera/cards` (a card-game kit) or `@chimera/hex-grid` (a hex-board kit). It turns the one-paragraph Adopter Model of Appendix C.6 into an actionable on-ramp: which `@chimera/*` packages a game needs, why an extension declares the core as a **peer** dependency, and how to publish the library with the same gates the engine itself uses (F66).

Everything here is a **packaging and dependency-declaration discipline** — no engine code or engine `package.json` changes. The single rule it all serves: **dependency arrows point inward toward the core, never outward** (Invariant #1). The engine team has no knowledge of, and no dependency on, your extension or any game.

---

## The install matrix — which `@chimera/*` a game needs

A consuming game pulls in only the engine packages its feature set requires. From Appendix C.6:

| Package               | Required when…                               | Notes                                                         |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `@chimera/simulation` | **always** — the core contract               | Zero-dependency leaf; every other package points inward to it |
| `@chimera/ai`         | the game has AI players                      | Depends on `@chimera/simulation`                              |
| `@chimera/networking` | the game has multiplayer                     | Depends on `@chimera/simulation`                              |
| `@chimera/renderer`   | the game uses the React / R3F renderer shell | Depends on `@chimera/simulation`; peers on React/Three/Next   |
| `@chimera/electron`   | the game ships as an Electron desktop app    | Composes all of the above; `electron` is an optional peer     |
| `@chimera/<domain>`   | the game opts into a domain extension        | **Optional, adopter-chosen** (e.g. `@chimera/cards`)          |

An extension library sits in the last row. It builds _on_ the engine for a category of games and is consumed _by_ games — it is never a dependency of the engine.

---

## The inward-dependency rule (Invariant #1, in `package.json`)

[Invariant #1](executive-architecture/architecture-invariants.md) keeps `@chimera/simulation` a pure, zero-dependency leaf that everything else points inward to. For an adopter this rule shows up as one concrete `package.json` decision:

> An extension library declares its `@chimera/*` engine packages as **`peerDependencies`**, not regular `dependencies`.

### Why a peer, not a dependency

A game that uses your extension **already depends on `@chimera/simulation` directly** — it always needs the core. So the consumer's dependency graph has two requesters of simulation: the game and your extension.

- If your extension declared `@chimera/simulation` as a normal **`dependency`**, a package manager is free to install a **second, version-skewed copy** of simulation nested under your extension.
- `@chimera/simulation` holds **process-singleton** state — the `ActionRegistry`, the engine's zod schemas, and the type identities used for registry lookups. Two copies in one process means two registries and two sets of schema identities: actions registered against one are invisible to the other, and `instanceof`/identity checks silently fail.
- Declaring it as a **`peerDependency`** forces a **single shared `@chimera/simulation`**, provided once by the consuming game and satisfying both requesters.

This is the same reason [`@chimera/renderer`](../renderer/package.json) lists `react`, `react-dom`, and `three` as `peerDependencies` (React and Three must be singletons), and why [`@chimera/electron`](../electron/package.json) lists `electron` as an **optional** peer via `peerDependenciesMeta`. Your extension is just applying that singleton discipline to the engine packages.

> **Aside — why the engine's own packages use `dependencies`, not peers.** Inside this monorepo, `@chimera/ai`/`networking`/`renderer`/`electron` declare `@chimera/simulation` as a regular `"workspace:*"` **dependency**. That is correct _for them_ because they are co-versioned and co-published in lockstep through the Changeset cascade (see below) — there is exactly one simulation in the published set. An **external** extension has no such guarantee about the consumer's tree, so it uses a peer to force the singleton. Same invariant, different declaration because the context differs.

---

## Worked example — `@chimera/cards`

A card-game toolkit that provides shared card/deck action definitions (built on simulation) and AI helpers for card play (built on `@chimera/ai`). Its `package.json`:

```jsonc
{
    "name": "@chimera/cards",
    "version": "0.1.0",
    "description": "Card-game domain toolkit (decks, hands, shared card actions) for the Chimera engine.",
    "license": "MIT",
    "private": false,
    "publishConfig": {
        "access": "public",
    },
    "type": "module",
    "exports": {
        ".": {
            "types": "./dist/index.d.ts",
            "default": "./dist/index.js",
        },
        "./ai": {
            "types": "./dist/ai/index.d.ts",
            "default": "./dist/ai/index.js",
        },
    },
    "files": ["dist", "CHANGELOG.md"],
    "scripts": {
        "build": "tsc -p tsconfig.build.json",
    },
    // The engine packages are PEERS — the consuming game provides the single shared copy.
    "peerDependencies": {
        "@chimera/simulation": "^0.9.0",
        "@chimera/ai": "^0.9.0",
    },
    // Also list peers as devDependencies so the library builds and tests locally.
    "devDependencies": {
        "@chimera/simulation": "^0.9.0",
        "@chimera/ai": "^0.9.0",
        "typescript": "^5",
    },
    // Only TRUE bundled-at-publish runtime deps go here (none in this example).
    "dependencies": {},
}
```

Key points, each mirroring the real engine manifests:

- **`"private": false` + `"publishConfig": { "access": "public" }`** — publishable as a public scoped package, exactly as `@chimera/simulation` and friends declare.
- **`"type": "module"` + an `exports` map onto `./dist`** — consumers resolve only your curated public subpaths, never internal files (Invariant #47). Add a subpath (`./ai` above) when you want a separately-importable surface.
- **`"files": ["dist", "CHANGELOG.md"]`** — ship the built output and the changelog, nothing else. (npm does not auto-include `CHANGELOG.md`; list it explicitly.)
- **`peerDependencies` on the engine packages** — `@chimera/simulation` always; add `@chimera/ai` only because this toolkit uses AI. Use a caret range (`^0.9.0`) so the consumer's matching-major simulation satisfies it.
- **The same packages echoed in `devDependencies`** — peers are not installed for you, so the library needs them present to compile and run its own tests.
- **`dependencies`** — reserve strictly for third-party runtime libraries you genuinely bundle (e.g. a CSV parser). Anything an undeclared import reaches at runtime fails the readiness gate below.

If a peer is genuinely optional (the consumer can use the library without it), mark it with `peerDependenciesMeta`, exactly as `@chimera/electron` does for `electron`:

```jsonc
"peerDependenciesMeta": {
  "@chimera/ai": { "optional": true }
}
```

### How a game consumes it

The game's `package.json` lists **both** the engine packages it needs **and** the extension, as regular `dependencies`:

```jsonc
{
    "dependencies": {
        "@chimera/simulation": "^0.9.0",
        "@chimera/ai": "^0.9.0",
        "@chimera/renderer": "^0.9.0",
        "@chimera/electron": "^0.9.0",
        "@chimera/cards": "^0.1.0",
    },
}
```

That single `@chimera/simulation` the game installs is the one copy that satisfies `@chimera/cards`'s peer requirement — one registry, one set of schemas, one identity. The arrows all point inward: `@chimera/cards` → `@chimera/simulation`, the game → both, the engine → nothing.

> The [`create-chimera-game` CLI](../tools/create-chimera-game) (`pnpm create:game <name>`) scaffolds the **game/app** side and is the on-ramp for _consumers_. An **extension library** is hand-authored against the manifest shape above — it is a publishable library, not an app, so it has no scaffold template.

---

## The publish flow (mirroring F66)

Publish your extension with the same three gates the engine uses, ported into your own repo. Each engine gate below is a working reference implementation you can copy.

1. **Publish-readiness gate** — model on [`tools/verify-publish.ts`](../tools/verify-publish.ts) (`pnpm verify:publish`). For each package it: builds `dist/`; **depchecks** by scanning the _published_ `.js` for external module specifiers and asserting each is declared in `dependencies`/`peerDependencies`/`optionalDependencies` (so an undeclared runtime import — or a peer you forgot — fails the gate); runs `publint --strict` to validate `exports`/`files`/`types`; and runs `pnpm publish --dry-run` to verify the manifest. This is the gate that proves your `peerDependencies` block is complete.

2. **True-artifact gate** — model on [`tools/verify-pack.ts`](../tools/verify-pack.ts) (`pnpm verify:pack`). It `pnpm pack`s the package and installs the tarball into a throwaway consumer **outside the workspace**, then resolution-probes every public `exports` subpath so a missing `exports`/`files` entry throws (Invariant #96). This catches packaging mistakes that `workspace:*` symlinks hide — the published artifact is what a real adopter installs, so the published artifact is what you test.

3. **Versioning + release** — use [Changesets](https://github.com/changesets/changesets) for independent semver and a per-package `CHANGELOG.md`, the same setup documented in [`.changeset/README.md`](../.changeset/README.md) and gated by [`tools/changeset-policy.ts`](../tools/changeset-policy.ts). Then publish from a **tag-triggered CI workflow** modelled on [`.github/workflows/release.yml`](../.github/workflows/release.yml): build → run both gates above → `changeset publish` with **npm provenance** (`id-token: write` permission + `NPM_CONFIG_PROVENANCE=true`) so the published package carries an OIDC attestation.

> **The simulation-cascade caveat.** Your peer range pins you to a `@chimera/simulation` major. When the engine ships a **`@chimera/simulation` major** (a breaking core change), bump your `peerDependencies` range to the new major and cut a **matching major** of your extension — the break propagates to you exactly as it propagates to the engine's own dependents under the [`verify:changeset-policy`](../tools/changeset-policy.ts) cascade. A minor/patch simulation release needs no action from you.

---

## Adopter checklist

- [ ] `"private": false` and `"publishConfig": { "access": "public" }`.
- [ ] `@chimera/simulation` (and any other engine packages used) in **`peerDependencies`**, with caret ranges — never plain `dependencies`.
- [ ] The same engine packages echoed in `devDependencies` so the library builds/tests.
- [ ] Curated `exports` map onto `./dist` and a `"files"` allowlist (`dist`, `CHANGELOG.md`).
- [ ] `dependencies` holds only genuinely-bundled third-party runtime libs.
- [ ] Readiness + true-artifact gates green (`verify:publish` / `verify:pack` equivalents).
- [ ] Independent semver via Changesets; peer range tracks `@chimera/simulation` majors.
- [ ] Tag-triggered release publishes with npm provenance.
