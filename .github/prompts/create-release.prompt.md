---
description: 'Cut a versioned release from a completed GitHub milestone. Usage: /create-release <milestone-designator> (e.g. M1, M2, "M1 — Core Engine")'
argument-hint: '<milestone-designator>'
---

Given milestone `{{milestone-designator}}`:

Load `.github/skills/github/create-release/SKILL.md` and follow the full procedure.

The workflow:

1. **Resolve the milestone** — match `{{milestone-designator}}` to a GitHub milestone title and number
2. **Verify readiness** — confirm all milestone issues are closed; stop and report if any are still open
3. **Determine version** — read the latest git tag and CHANGELOG, apply SemVer rules to the `[Unreleased]` content, propose the version, and wait for confirmation
4. **Check README** — review every README section for staleness (Status, Getting Started, Project Layout, Features, env vars); apply targeted updates where needed
5. **Update CHANGELOG** — promote `[Unreleased]` → `[<version>]` with today's date, add empty `[Unreleased]` block, update comparison links
6. **Bump package.json** — run `npm version <version> --no-git-tag-version`
7. **Run the pre-release gate** — `pnpm format && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (all must exit 0; fix failures before proceeding)
8. **Commit** — stage `CHANGELOG.md`, `package.json`, and `README.md` (if changed); commit with `chore(release): v<version>` and a body listing what was updated
9. **Tag and push** — create annotated tag `v<version>`, push commit and tag to `origin/main`
10. **Create GitHub release** — extract notes from the promoted CHANGELOG block; publish via `gh release create`
11. **Close milestone** — mark the GitHub milestone as closed via `gh api … --method PATCH`
12. **Report** — print a concise summary: tag, commit SHA, release URL, milestone state, files updated

Reference: `.github/skills/github/create-release/SKILL.md`
