---
'create-chimera-game': patch
---

A scaffolded game's `pnpm test:e2e` now reds on a flaky spec instead of exiting 0.

The template's Playwright config set `retries: 1` with no `failOnFlakyTests`. Playwright
reports a spec that failed its first attempt and passed the retry as `N flaky` on stdout
and exits 0, so an adopter's e2e gate reported a clean run for a spec that had failed —
and nothing signalled that the shipped config differed from the engine's own, which had
already closed this.

`retries: 1` is kept. `use.trace` is `'on-first-retry'`, which records a trace only when a
retry is taken, so a zero-retry config would trade a green-on-flake for a blind first
failure. With the flag, the retry still produces the trace and the run reds.
