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

```bash
git tag --sort=-v:refname | head -5
head -40 CHANGELOG.md
awk '/^## \[Unreleased\]/{found=1; next} /^## \[/{if(found) exit} found{print}' CHANGELOG.md
```

SemVer:

| Unreleased contains                                  | Bump  | `0.1.0` → |
| ---------------------------------------------------- | ----- | --------- |
| `### Breaking` / incompatible IPC or snapshot change | major | `1.0.0`   |
| `### Added` new features                             | minor | `0.2.0`   |
| Only `### Fixed`/`### Changed`/`### Security`        | patch | `0.1.1`   |

Convention: `M1`→`0.1.0`, `M2`→`0.2.0`, `M3`→`0.3.0`. Hot-fix milestones bump patch.

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

## Step 6 — Bump package.json

```bash
npm version $VERSION --no-git-tag-version
node -e "console.log(require('./package.json').version);"  # → <VERSION>
```

## Step 7 — Pre-release gate (all exit 0)

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

Never bypass / `--no-verify`.

## Step 8 — Commit release prep

```bash
git add CHANGELOG.md package.json README.md
git status   # confirm only expected files staged

git commit -m "chore(release): v$VERSION

- Promote [Unreleased] → [$VERSION] in CHANGELOG
- Bump package.json version to $VERSION
- Update README to reflect $MILESTONE_TITLE completion
"
```

Omit README bullet if not changed.

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

- **Only release from `main`.**
- **All milestone issues must be closed** — release tag = complete milestone, not partial.
- **Never force-push or amend** the release commit. For mistakes: cut a patch release using this same skill.
- **Annotated tags only** (`git tag -a`); required for `git describe`.
- **`[Unreleased]` empty after promotion** — new entries accumulate during next dev cycle.
