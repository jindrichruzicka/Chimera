---
name: create-release
description: 'Cut a versioned release for the Chimera project from a GitHub milestone. Checks all milestone issues are closed, determines the semver version, checks and updates README, promotes the CHANGELOG [Unreleased] block, updates package.json, runs the full pre-release gate, commits, tags, pushes, creates the GitHub release with CHANGELOG notes, and closes the milestone. Use when: shipping a milestone, cutting a release tag, publishing a new version.'
argument-hint: 'Milestone designator or title (e.g. "M1" or "M1 — Core Engine")'
---

# Create Release Skill

Validates milestone readiness, updates docs, promotes CHANGELOG, tags, and publishes a GitHub Release.

## Preconditions

- On `main`: `git branch --show-current` outputs `main` (else stop, ask user to merge milestone branches first via merge skill).
- All milestone issues closed (verified in Step 2).

## Step 1 — Resolve milestone

```bash
export GH_REPO=jindrichruzicka/Chimera
gh api repos/$GH_REPO/milestones --field state=all \
  --jq '.[] | "\(.number) \(.title) [\(.state)] open:\(.open_issues) closed:\(.closed_issues)"'
```

Record `MILESTONE_NUMBER`, `MILESTONE_TITLE` (full, e.g. `M1 — Core Engine`), `MILESTONE_DESIGNATOR` (e.g. `M1`).

## Step 2 — Verify all milestone issues closed

```bash
gh issue list --repo $GH_REPO --milestone "$MILESTONE_TITLE" --state open \
  --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

**If any open → STOP.** Report to user; do not proceed.

## Step 3 — Determine version

> **Locked `1.X.Y` from `1.0.0` on.** See [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md). The milestone/project version is **one shared version** that every `@chimera-engine/*` package and `create-chimera-game` also carry. A milestone advances the **compatibility line** `X` and resets patch to `0` → **`1.X.0`**. Between-milestone package updates are handled by `/publish-packages` as patches (`1.X.Y`), not here.

```bash
git tag --sort=-v:refname | head -5
head -40 CHANGELOG.md
awk '/^## \[Unreleased\]/{found=1; next} /^## \[/{if(found) exit} found{print}' CHANGELOG.md
```

Version rule (from `1.0.0`):

| Milestone                                              | Version     |
| ------------------------------------------------------ | ----------- |
| **M10** — first public release                         | `1.0.0`     |
| Next coordinated milestone (any breaking/feature line) | `1.(X+1).0` |

`X` may contain breaking changes — that is expected and is exactly what a new milestone/compatibility line is for; the shared `X` is the compatibility promise across the whole set. (Legacy `0.x`: `M1`→`0.1.0` … `M9`→`0.9.0`, independent per-package semver — retired at `1.0.0`.)

**Confirm with user** before proceeding:

```
Proposed: v<VERSION>   Current: v<CURRENT>   Milestone: <MILESTONE_TITLE>
Unreleased: <summary>
Confirm? (yes / override version)
```

Record `VERSION` (no `v` prefix).

## Step 4 — Check README

Read `README.md` in full. Update only sections that need it:

| Section                  | Update if                                           |
| ------------------------ | --------------------------------------------------- |
| Getting started          | Node/pnpm version changed; new env vars/setup       |
| Features                 | New user-facing capabilities shipped this milestone |
| Configuration / env vars | New `CHIMERA_*` env vars / config keys              |

Apply targeted edits only. Record "no changes needed" if applicable.

## Step 5 — Update CHANGELOG

Promote `[Unreleased]` to `[<VERSION>] — <YYYY-MM-DD>` and add a new empty `[Unreleased]` block. Update link definitions.

Example (promoting to 0.2.0):

```markdown
## [Unreleased]

## [0.2.0] — <TODAY_DATE>

### Added

- …

## [0.1.0] — 2026-04-23

…

[0.2.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.2.0
[0.1.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.1.0
[Unreleased]: https://github.com/jindrichruzicka/Chimera/compare/v0.2.0...HEAD
```

Rules:

- `TODAY_DATE` = current date `YYYY-MM-DD`.
- New `[Unreleased]` block is empty.
- Preserve all existing link defs; add new version link above previous; update `[Unreleased]` compare URL.

## Step 6 — Bump versions to the shared `1.X.Y`

Two things move to `$VERSION` together: the **root project** version and the **locked package group** (every `@chimera-engine/*` package + `create-chimera-game`).

```bash
# 1. Root project package.json (the milestone/project version).
npm version $VERSION --no-git-tag-version
node -e "console.log(require('./package.json').version);"  # → <VERSION>
```

For the **package group**, let Changesets drive the `fixed` group so all members land on `$VERSION` in one step (see [`.changeset/README.md`](../../../../.changeset/README.md)). If no changeset yet describes this release, author one (`minor` for a milestone / new `X` line — the leading `1` is the fixed public major):

```bash
# 2. Apply versions to the fixed package group + write per-package CHANGELOGs.
pnpm version-packages   # = changeset version && pnpm install --lockfile-only
```

Confirm every first-party package (and the root, if you keep them equal) is now on `$VERSION`.

> **First 1.0.0 (M10) note:** the tree is coming from drifted `0.x` versions. Land a single changeset covering the whole `fixed` group at `minor`/`major` as needed so `changeset version` re-aligns everything to `1.0.0`; if changesets can't reach `1.0.0` cleanly from the drifted state, set each first-party `package.json` version to `1.0.0` directly, then re-run the alignment gate below.

## Step 7 — Pre-release gate (all exit 0)

```bash
pnpm verify:version-alignment   # locked 1.X.Y: all first-party pkgs on the SAME 1.X.Y
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

`verify:version-alignment` MUST pass — if it reports drift, re-align (Step 6); never override it. Never bypass / `--no-verify`.

## Step 8 — Commit release prep

```bash
# Stage the release-prep changes: root CHANGELOG/package.json/README plus the
# fixed-group version bumps + per-package CHANGELOGs written by `pnpm version-packages`.
git add CHANGELOG.md package.json README.md \
        pnpm-lock.yaml \
        simulation/package.json ai/package.json networking/package.json \
        renderer/package.json electron/package.json tools/create-chimera-game/package.json \
        simulation/CHANGELOG.md ai/CHANGELOG.md networking/CHANGELOG.md \
        renderer/CHANGELOG.md electron/CHANGELOG.md tools/create-chimera-game/CHANGELOG.md \
        .changeset
git status   # confirm only expected files staged

git commit -m "chore(release): v$VERSION

- Promote [Unreleased] → [$VERSION] in CHANGELOG
- Bump root + locked package group (@chimera-engine/* + create-chimera-game) to $VERSION
- Update README to reflect $MILESTONE_TITLE completion
"
```

Omit README bullet if not changed. Add only the package/CHANGELOG paths that actually changed.

## Step 9 — Tag + push

```bash
git tag -a "v$VERSION" -m "Release v$VERSION — $MILESTONE_TITLE"
git push origin main
git push origin "v$VERSION"
git ls-remote --tags origin | grep "v$VERSION"
```

> **Heads-up — `v*` triggers npm publish.** `release.yml` triggers on `v*.*.*` tags, so pushing this milestone tag runs `changeset publish` in CI and publishes any `@chimera-engine/*` / `create-chimera-game` version that is in the manifests but not yet on the registry (already-published versions are a no-op). To control package versions deliberately, declare bumps with the `publish-packages` skill _before_ tagging the milestone.

## Step 10 — Extract release notes

```bash
awk "/^## \[$VERSION\]/{found=1; next} /^## \[/{if(found) exit} found{print}" CHANGELOG.md \
  > /tmp/release-notes.md
cat /tmp/release-notes.md
```

## Step 11 — Create GitHub release

```bash
gh release create "v$VERSION" --repo $GH_REPO \
  --title "v$VERSION — $MILESTONE_TITLE" \
  --notes-file /tmp/release-notes.md \
  --latest

gh release view "v$VERSION" --repo $GH_REPO \
  --json tagName,name,url,publishedAt \
  --jq '"Tag: \(.tagName)\nTitle: \(.name)\nURL: \(.url)\nPublished: \(.publishedAt)"'
```

## Step 12 — Close milestone

```bash
M_NUM=$(gh api repos/$GH_REPO/milestones --field state=all \
  --jq ".[] | select(.title | startswith(\"$MILESTONE_DESIGNATOR\")) | .number")
gh api repos/$GH_REPO/milestones/$M_NUM --method PATCH --field state=closed
gh api repos/$GH_REPO/milestones/$M_NUM --jq '"\(.title) — \(.state)"'
```

## Step 13 — Summary

```
✅ Released v<VERSION> — <MILESTONE_TITLE>
  Tag: v<VERSION>   Commit: <SHA>
  URL: https://github.com/jindrichruzicka/Chimera/releases/tag/v<VERSION>
  Milestone: closed
  CHANGELOG: [Unreleased] → [<VERSION>] (<TODAY_DATE>)
  README:    <updated | no changes>
  package.json: <VERSION>
```

## Rules

- **Locked `1.X.Y` (from `1.0.0`).** The milestone version, every `@chimera-engine/*` package, and `create-chimera-game` all share one `1.X.Y`. A milestone sets `1.X.0`; `verify:version-alignment` enforces it. Full policy: [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md).
- **Only release from `main`.**
- **All milestone issues must be closed** — release tag = complete milestone, not partial.
- **Never force-push or amend** the release commit. For mistakes: cut a patch release using this same skill.
- **Annotated tags only** (`git tag -a`); required for `git describe`.
- **`[Unreleased]` empty after promotion** — new entries accumulate during next dev cycle.
