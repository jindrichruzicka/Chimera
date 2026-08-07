---
name: create-release
description: 'Cut a versioned release from a completed GitHub milestone: verify issues closed, pick the locked 1.X.Y version, promote CHANGELOG, bump the fixed package group, gate, tag, GitHub release, close milestone. Use when: shipping a milestone / cutting a release tag.'
argument-hint: 'Milestone designator or title (e.g. "M1" or "M1 — Core Engine")'
---

# Create Release Skill

## Preconditions

- On `main`: `git branch --show-current` outputs `main` — else stop; ask the user to merge milestone branches first via the merge skill.
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

> **Locked `1.X.Y` from `1.0.0` on** ([`docs/versioning-policy.md`](../../../../docs/versioning-policy.md)): one shared version carried by the milestone/project, every `@chimera-engine/*` package, and `create-chimera-game`. A milestone advances the compatibility line `X` and resets patch → `1.X.0`. Between-milestone package updates are `/publish-packages` patches (`1.X.Y`), not here.

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

`X` may contain breaking changes — the shared `X` is the compatibility promise across the whole set. (Legacy `0.x`: `M1`→`0.1.0` … `M9`→`0.9.0`, independent per-package semver — retired at `1.0.0`.)

**Confirm with user** before proceeding:

```
Proposed: v<VERSION>   Current: v<CURRENT>   Milestone: <MILESTONE_TITLE>
Unreleased: <summary>
Confirm? (yes / override version)
```

Record `VERSION` (no `v` prefix).

## Step 4 — Check README

Read `README.md` in full; apply targeted edits only; record "no changes needed" if applicable.

| Section                  | Update if                                           |
| ------------------------ | --------------------------------------------------- |
| Getting started          | Node/pnpm version changed; new env vars/setup       |
| Features                 | New user-facing capabilities shipped this milestone |
| Configuration / env vars | New `CHIMERA_*` env vars / config keys              |

## Step 5 — Update CHANGELOG

Promote `[Unreleased]` to `[<VERSION>] — <YYYY-MM-DD>` (`TODAY_DATE` = current date) and add a new empty `[Unreleased]` block. Preserve all existing link defs; add the new version link above the previous; update the `[Unreleased]` compare URL.

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

## Step 6 — Bump versions to the shared `1.X.Y`

Root project version and the locked package group (every `@chimera-engine/*` package + `create-chimera-game`) move to `$VERSION` together.

```bash
# 1. Root project package.json (the milestone/project version).
npm version $VERSION --no-git-tag-version
node -e "console.log(require('./package.json').version);"  # → <VERSION>
```

Let Changesets drive the `fixed` group so all members land on `$VERSION` in one step (see [`.changeset/README.md`](../../../../.changeset/README.md)). If no changeset yet describes this release, author one — `minor` for a milestone / new `X` line (the leading `1` is the fixed public major):

```bash
# 2. Apply versions to the fixed package group + write per-package CHANGELOGs.
pnpm version-packages   # = changeset version && pnpm install --lockfile-only
```

Confirm every first-party package (and the root, if kept equal) is now on `$VERSION`.

> **First `1.0.0` (M10):** the tree comes from drifted `0.x` versions. Land a single changeset covering the whole `fixed` group at `minor`/`major` as needed so `changeset version` re-aligns everything to `1.0.0`; if changesets can't reach `1.0.0` cleanly, set each first-party `package.json` version to `1.0.0` directly, then re-run the alignment gate below.

## Step 7 — Pre-release gate (all exit 0)

```bash
pnpm verify:version-alignment   # locked 1.X.Y: all first-party pkgs on the SAME 1.X.Y
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

If `verify:version-alignment` reports drift, re-align (Step 6) — never override it. Never bypass / `--no-verify`.

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

Omit README bullet if not changed; add only the package/CHANGELOG paths that actually changed.

## Step 9 — Tag + push

```bash
git tag -a "v$VERSION" -m "Release v$VERSION — $MILESTONE_TITLE"
git push origin main
git push origin "v$VERSION"
git ls-remote --tags origin | grep "v$VERSION"
```

> **`v*` triggers npm publish.** `release.yml` fires on `v*.*.*` tags, so this milestone tag runs `changeset publish` in CI, publishing any `@chimera-engine/*` / `create-chimera-game` version in the manifests but not yet on the registry (already-published versions are a no-op). Declare deliberate version bumps via the `publish-packages` skill _before_ tagging the milestone.

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

- **Locked `1.X.Y` (from `1.0.0`)** — one shared version across milestone + package group (Step 3); `verify:version-alignment` enforces it. Policy: [`docs/versioning-policy.md`](../../../../docs/versioning-policy.md).
- **Only release from `main`.**
- **All milestone issues closed** — release tag = complete milestone, not partial.
- **Never force-push or amend** the release commit; for mistakes, cut a patch release with this same skill.
- **Annotated tags only** (`git tag -a`) — required for `git describe`.
- **`[Unreleased]` empty after promotion** — next dev cycle's entries accumulate there.
