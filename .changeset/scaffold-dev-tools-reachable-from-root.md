---
'create-chimera-game': minor
'@chimera-engine/electron': patch
---

Make all four `@chimera-engine/electron` dev tools reachable from a scaffolded project's root, and fix `fetch:fonts` dying before it ran.

The scaffolded `fetch:fonts` script documented its argument inline as `--url <google-css-url>`. A package script is handed to `sh`, which reads the angle brackets as a **redirection** — so `pnpm fetch:fonts` opened a file named `google-css-url`, failed, and reported `sh: google-css-url: No such file or directory`. The message names neither the script nor the bin, so it reads as `chimera-fetch-fonts` being missing from the scaffold. The script now carries no `--url` placeholder; the CSS URL is passed as a trailing argument (`pnpm fetch:fonts --url "<css url>"`), which pnpm appends to the delegated script, so nothing has to be hand-edited before the first run.

The standalone project root forwarded only `dev:mp`, leaving `fetch:fonts`, `icons:generate`, and `validate:assets` reachable solely as `pnpm --filter @chimera-engine/<game> <script>` — a form nothing in the scaffold's own output taught. The emitted root now forwards all four, matching the monorepo, where each is a plain root script. The forwards are bare delegations (no build chain: these tools read source and assets, never build output) and end on the delegated script so trailing arguments reach the bin.

`verify:scaffold`'s fonts arm now drives `pnpm fetch:fonts --url …` from the project root instead of invoking the bin with a hand-built argv, so it covers the root forward, the shipped script, and pnpm's argument forwarding — the chain that was broken while the arm stayed green. It additionally refuses any `fetch:fonts` script containing a shell redirection character, and the blank-template suite refuses one in **any** template script and cross-checks every `chimera-*` command the template invokes against the bins `@chimera-engine/electron` declares.
