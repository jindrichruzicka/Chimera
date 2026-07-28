# generate-icons

The deterministic platform icon-set generator. It reads one square master PNG
and writes the whole application/window icon set beside it: loose square PNGs at
eight sizes, the `.icns` and `.ico` platform containers, and `chimera.png` — the
512 render under a stable, size-less filename.

## Running it

**In the monorepo** — no arguments, so the defaults resolve against the cwd,
which for a root script is the repo root:

```bash
pnpm icons:generate
```

That regenerates the engine's own committed set: `docs/assets/chimera-logo-compact.png`
→ `electron/assets/icons/`.

**In a standalone game** — the published bin, from the game package, with both
paths given:

```bash
pnpm --filter <your-game> icons:generate
# runs: chimera-generate-icons --source assets/icons/icon.png --out assets/icons
```

## Why the standalone form passes both flags

The defaults are engine-relative and resolved against the **cwd**, never against
the tool's own location. Each flag is explicit for a different reason:

- **`--source`** defaults to `docs/assets/chimera-logo-compact.png`. A game has
  no `docs/assets/`, so a bare run refuses, names that path, and names the
  flags. That failure is loud.
- **`--out`** defaults to `electron/assets/icons`. A game **does** have an
  `electron/` directory — its main-process source — so once the codecs are
  installed, omitting `--out` writes eleven files into it and exits **0**. That
  failure is silent, which is why the scaffolded script never relies on the
  default.

The cwd rule is the same one `validate-assets`, `fetch-google-fonts` and the
dev-harness follow, and here it is load-bearing rather than stylistic: the
published bin lives at `dist/dev-tools/generate-icons/`, so a module-relative
derivation would resolve both defaults inside the installed package, at paths no
consumer has.

## The codecs are OPTIONAL peer dependencies

`sharp` (a multi-megabyte platform-specific native binary) and `png2icons` are
declared as **optional peers** of `@chimera-engine/electron`, so nothing in the
engine's dependency closure asks a game to install either. Opt in once:

```bash
pnpm add -D sharp png2icons
```

Until then the bin is reachable and runs, and fails with exactly that
instruction:

```
generate-icons: sharp + png2icons are required to generate icons and are
optional peer dependencies. Install them as devDependencies: pnpm add -D sharp png2icons
```

Stated precisely, because the loose version is wrong: a Next-based scaffold
installs `sharp` anyway — Next declares it as an `optionalDependency`, and pnpm's
`.pnpm/node_modules` hoisted layer is on the resolution path — so the tool there
can load it, at Next's version rather than the declared peer range. What this
design saves such a project is the **second** copy and `png2icons`, and it is
what keeps both out of the closure for anyone installing `@chimera-engine/electron`
outside a Next app. In a fresh scaffold the run above fails on `png2icons`.

§4.32 carries the rationale for the arrangement and what enforces it; this file
does not restate it.

## What a game actually consumes

Worth stating plainly, because the generated set is smaller in effect than it
looks:

| Icon a player sees                        | Where it comes from                                        |
| ----------------------------------------- | ---------------------------------------------------------- |
| Installer / bundle (`.icns`, `.ico`, PNG) | electron-builder derives it from the top-level `icon:` PNG |
| Window and dock                           | the game manifest's `icon`, resolved under the game assets |
| Window and dock, **fallback only**        | `<app>/assets/icons/chimera.png`                           |

So for a scaffolded game, replacing the single committed `assets/icons/icon.png`
rebrands both icons a player normally sees. The generated set feeds the third
row — the `resolveAppIcon` fallback, taken only when the manifest declares no
`icon`, or declares one that escapes the game's asset root. A game consumes it
by repointing its `electron-builder.yml` file set at its own `assets/icons`.

The generated set is still packaged in full (~4.5 MB) by the template's
`from: assets` block, so a game that generates it and never repoints the
fallback ships it for nothing.

## Layout

| File                 | Purpose                                                        |
| -------------------- | -------------------------------------------------------------- |
| `chimera.png`        | 512×512 under a size-less name — the runtime fallback filename |
| `chimera.icns`       | macOS container                                                |
| `chimera.ico`        | Windows container                                              |
| `chimera-<size>.png` | Loose squares at 16, 32, 48, 64, 128, 256, 512, 1024           |

The stem is fixed at `chimera` on purpose: the runtime fallback resolves that
exact filename, so a game's regenerated set is game-branded under the same
contract name.

## Notes

- The master should be square and at least 1024×1024 for the full set to be
  downscales throughout. The blank scaffold's placeholder is 512×512, so it
  upscales for `chimera-1024.png` until a game brings its own art.
- The generator never touches the master, and never writes anything that is not
  `chimera*` — so pointing `--out` at the directory holding `icon.png` is safe.
