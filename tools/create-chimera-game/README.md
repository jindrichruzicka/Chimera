# `create-chimera-game`

Scaffolds a new Chimera game app from a template. It copies `templates/<id>/` into
`apps/<game>`, substitutes the game name into every file's contents **and** its file/directory
names, and registers the new app at the repo root so its `workspace:*` dependencies resolve and
it typechecks and boots.

## Usage

```bash
pnpm create:game <name> [--template <id>]
# or directly:
tsx tools/create-chimera-game/index.ts <name> [--template <id>]
```

- `<name>` — the game name in any casing (`my-card-game`, `My Card Game`, `myCardGame`, …). It
  is normalised into every casing the template needs (see the token table below). Must contain a
  letter, start with a letter, and use only letters, digits, and `-` `_` space separators.
- `--template <id>` — which template to scaffold from. **Defaults to `blank`.** The id resolves
  generically to `templates/<id>/`; any directory you add under `templates/` is usable with no
  code change here. An unknown id errors and lists the available ids.

The new app lands in `apps/<kebab-name>/`. Re-running against an existing app errors instead of
overwriting it.

### What the CLI does

1. Validates the name and resolves the template **before** any filesystem write.
2. Copies the template tree into `apps/<game>`, skipping `node_modules` / `dist` / `out` /
   `.next`, substituting tokens in contents and path segments, and asserting no token survives.
3. Wires the app into the repo root (mirroring `apps/tactics`):
    - adds `@chimera/<kebab>: "workspace:*"` to the root `package.json` `dependencies`,
    - appends `{ "path": "./apps/<kebab>/tsconfig.build.json" }` to `tsconfig.build.json`
      `references`,
    - appends `tsc --noEmit -p apps/<kebab>/tsconfig.json` to the root `typecheck` script.
4. Runs `pnpm install` to link the new workspace package.

Then: `pnpm typecheck`, and `pnpm --filter @chimera/<kebab> build:app` to build the app bundle.

## Token reference

Templates embed these placeholders in file contents and in file/directory names; the scaffolder
replaces each with the corresponding casing of the game name. (The placeholder spellings double
as a worked example of each casing.) Example column uses the input `my-card-game`.

| Token               | Casing         | Example        |
| ------------------- | -------------- | -------------- |
| `__game_kebab__`    | kebab-case     | `my-card-game` |
| `__gameCamel__`     | camelCase      | `myCardGame`   |
| `__GamePascal__`    | PascalCase     | `MyCardGame`   |
| `__Game Title__`    | Title Case     | `My Card Game` |
| `__GAME_CONSTANT__` | CONSTANT_CASE  | `MY_CARD_GAME` |
| `__gamelower__`     | lower (joined) | `mycardgame`   |

Legitimate dunders such as `__dirname` / `__filename` are **not** tokens and are left untouched.

## Implementation notes

- Pure tooling: imports only `node:*` and the sibling pure modules
  ([`normalize.ts`](./normalize.ts), [`tokens.ts`](./tokens.ts)). It must **not** import any
  `@chimera/*` package — boundary lint enforces this.
- `templates/<id>/` is not a pnpm workspace member (it holds unsubstituted tokens); only after
  the copy into `apps/*` does the new app become a workspace member.
- The exported `scaffoldGame()` performs the copy + root wiring and is fully unit-tested; the
  `pnpm install` step lives only in the CLI entry, which is excluded under VITEST.
