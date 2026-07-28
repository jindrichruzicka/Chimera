---
'@chimera-engine/electron': minor
'create-chimera-game': minor
---

A scaffolded game can validate its own asset references from day one: the blank template
now ships an app-level `validate:assets` script running `chimera-validate-assets ../..`.
pnpm runs package scripts with cwd = `apps/<kebab>` and the validator resolves its
positional argument against that cwd, so `../..` lands on the project root — whose `apps/*`
discovery then finds the game and resolves `apps/<kebab>/assets/…` exactly as it does in
the monorepo. No new tool mode: the scaffold keeps the `apps/<kebab>` shape, so the
existing discovery works unchanged. The script is app-level because the depth depends on
it, and because a standalone project's root manifest carries no `@chimera-engine/electron`
for pnpm to link a bin from. A blank game declares no assets yet, so the script reports
`Checked 0 asset refs` until the adopter adds some — it is wired and correct, not a
demonstration.

`chimera-validate-assets` now REFUSES a root with no `apps/` directory instead of
reporting success. Games are discovered at `<root>/apps/<gameId>/`, so such a root could
report "Checked 0 asset refs; all files exist." and exit 0 — the answer "nothing is broken"
about a tree in which no game could be found. That is reachable by hand rather than
hypothetical: running the bin bare from a game package defaults the root to that package.
`apps/` is the discriminator precisely because a game package never has one, while both
supported layouts do. The refusal names the cause and the invocation that fixes it. A root
that HAS `apps/` is scanned exactly as before, whatever it turns out to contain — including
reporting 0 refs, which for a freshly scaffolded game is the honest answer.
