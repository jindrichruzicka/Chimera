# fetch-google-fonts (`chimera-fetch-fonts`)

The development-time Google-Fonts self-hosting downloader — the only sanctioned way to bring
game fonts on-disk (Invariant #97). It fetches a Google Fonts CSS URL with a desktop UA,
downloads every `.woff2` face, writes them under the game's committed asset directory, and
prints a `GameFontFace[]` snippet to paste into the game's `shell/fonts.ts`. The runtime never
fetches Google-hosted CSS or fonts; the emitted `src` is always a relative committed-asset
reference.

## Monorepo form

```sh
pnpm fetch:fonts -- --game <gameId> --url "<google-css-url>"
```

Runs with cwd = repo root, so the defaults land the downloads in
`apps/<gameId>/assets/fonts` and emit `src: '<gameId>/fonts/<file>'` — unchanged from before
the tool moved here.

## Standalone form (scaffolded games)

The tool ships as the `chimera-fetch-fonts` bin of `@chimera-engine/electron` (pre-built node
ESM at `dist/dev-tools/fetch-google-fonts/index.js`), so a game scaffolded by
`create-chimera-game` runs it with no monorepo. The blank template wires an app-level script:

```jsonc
"fetch:fonts": "chimera-fetch-fonts --game <kebab> --out-dir assets/fonts"
```

and forwards it from the project root, so a game runs it without editing anything:

```sh
pnpm fetch:fonts --url "https://fonts.googleapis.com/css2?family=Inter&display=swap"
```

pnpm appends trailing arguments to the delegated script, so the URL reaches the bin. Paste
the printed snippet into `shell/fonts.ts`.

**Why no `--url` placeholder in the script:** it used to read `--url <google-css-url>` as
inline documentation. A package script is handed to `sh`, which reads the angle brackets as a
REDIRECTION — so `pnpm fetch:fonts` opened a file named `google-css-url`, failed, and reported
`sh: google-css-url: No such file or directory` before this bin was ever looked up. The error
named neither the script nor the tool, so it read as the tool being missing from the scaffold.
Required arguments belong on the command line, not baked into the script as prose.

**Why the explicit `--out-dir assets/fonts`:** pnpm runs a package script with cwd = the app
package (`apps/<kebab>`). The tool's default output dir is `apps/<gameId>/assets/fonts`
resolved against the cwd — from `apps/<kebab>` that derives the doubled phantom path
`apps/<kebab>/apps/<kebab>/assets/fonts`. A relative `--out-dir` resolves against the cwd
directly, landing the files in the game's own `assets/fonts`.

## Flags

| Flag               | Required | Default                      | Meaning                                                                                             |
| ------------------ | -------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `--game`           | yes      | —                            | Game id; derives the default output dir and `src` prefix                                            |
| `--url`            | yes      | —                            | Google Fonts CSS URL (`https://fonts.googleapis.com/css2?…`)                                        |
| `--out-dir`        | no       | `apps/<gameId>/assets/fonts` | Download dir; relative values resolve against `--workspace-root` (default: cwd)                     |
| `--src-prefix`     | no       | `<gameId>/fonts`             | Prefix of every emitted `GameFontFace.src`; must stay a relative asset path (never absolute or URL) |
| `--workspace-root` | no       | `process.cwd()`              | Base that relative `--out-dir` (and the default output dir) resolve against                         |

## Workflow

1. Pick faces on fonts.google.com and copy the CSS URL it offers.
2. Run the tool (either form above). It prints one `wrote <path>` line per face and then the
   `GameFontFace[]` snippet.
3. Paste the snippet into the game's `shell/fonts.ts` (`gameFonts`), commit the `.woff2` files.
4. `validate-assets` verifies every declared `src` resolves on disk (Invariants #52/#22).
