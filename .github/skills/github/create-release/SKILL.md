---
name: create-release
description: 'Cut a versioned release for the Chimera project from a GitHub milestone. Checks all milestone issues are closed, determines the semver version, checks and updates README, promotes the CHANGELOG [Unreleased] block, updates package.json, runs the full pre-release gate, commits, tags, pushes, creates the GitHub release with CHANGELOG notes, and closes the milestone. Use when: shipping a milestone, cutting a release tag, publishing a new version.'
argument-hint: 'Milestone designator or title (e.g. "M1" or "M1 — Core Engine")'
---

# Create Release Skill

Cuts a versioned GitHub release from a completed milestone: validates readiness, updates docs, promotes the CHANGELOG, creates the git tag, and publishes the GitHub release.

## When to Use

- Shipping a milestone (M1, M2, M3, …)
- Cutting a release tag after all milestone issues are closed
- Publishing a new version to GitHub Releases

---

## Procedure

### Step 1 — Resolve milestone

```bash
export GH_REPO=jindrichruzicka/Chimera

# List all milestones (open and closed)
gh api repos/$GH_REPO/milestones --field state=all \
  --jq '.[] | "\(.number) \(.title) [\(.state)] open:\(.open_issues) closed:\(.closed_issues)"'
```

Match the input argument against the milestone title (e.g. "M1", "M1 — Core Engine"). Record:

- `MILESTONE_NUMBER` — the GitHub milestone number
- `MILESTONE_TITLE` — the full milestone title (e.g. `M1 — Core Engine`)
- `MILESTONE_DESIGNATOR` — the short prefix (e.g. `M1`)

---

### Step 2 — Verify all milestone issues are closed

```bash
# Check for any open issues still attached to this milestone
gh issue list --repo $GH_REPO \
  --milestone "$MILESTONE_TITLE" \
  --state open \
  --json number,title,labels \
  --jq '.[] | "#\(.number) \(.title)"'
```

**If any open issues are returned — STOP.**

Do not proceed with the release. Report the open issues to the user and ask them to either close or move the issues before retrying.

**If no open issues — proceed.**

---

### Step 3 — Determine the release version

#### 3a. Read the latest released version

```bash
# From git tags
git tag --sort=-v:refname | head -5

# From CHANGELOG (latest released block)
head -40 CHANGELOG.md
```

#### 3b. Read the [Unreleased] block

```bash
# Show the unreleased section to understand scope
awk '/^## \[Unreleased\]/{found=1; next} /^## \[/{if(found) exit} found{print}' CHANGELOG.md
```

#### 3c. Propose the version

Apply SemVer rules to the `[Unreleased]` content:

| Unreleased content contains                          | Bump  | Example: current `0.1.0` → |
| ---------------------------------------------------- | ----- | -------------------------- |
| `### Breaking` or incompatible IPC / snapshot change | major | `1.0.0`                    |
| `### Added` new capabilities / features              | minor | `0.2.0`                    |
| Only `### Fixed`, `### Changed`, `### Security`      | patch | `0.1.1`                    |

Cross-check against the milestone designator convention:

- `M1` → `0.1.0`, `M2` → `0.2.0`, `M3` → `0.3.0` (minor bump per milestone)
- Hot-fix milestones use patch: `0.1.1`, `0.1.2`, …

**Present the proposed version to the user and ask for confirmation before proceeding.**

```
Proposed release: v<VERSION>
Current latest:   v<CURRENT>
Milestone:        <MILESTONE_TITLE>

Unreleased entries: <summary>

Confirm? (yes / override with different version)
```

Record the confirmed version as `VERSION` (without the `v` prefix).

---

### Step 4 — Check README for required updates

Read `README.md` in full. Assess whether any of the following need updating:

| Section                      | Update needed if…                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| **Status**                   | The milestone described in "Status" is no longer the current one; landmark completed     |
| **Getting started**          | Prerequisites (Node, pnpm versions) changed; new mandatory env vars or setup steps added |
| **Project layout**           | New top-level packages or directories landed and are not yet listed                      |
| **Features**                 | New user-facing capabilities shipped in this milestone that are not mentioned            |
| **Configuration / env vars** | New `CHIMERA_*` env vars or config keys introduced                                       |

For each section that needs updating:

1. Describe the required change
2. Apply the edit directly to `README.md`
3. Do not rewrite sections that are already accurate — only make targeted additions or corrections

If no README updates are needed, record that and proceed.

---

### Step 5 — Update CHANGELOG

Promote the `[Unreleased]` block to the new version and add a new empty `[Unreleased]` block at the top. Also update the comparison links at the bottom.

**Before:**

```markdown
## [Unreleased]

### Added

- …

## [0.1.0] — 2026-04-23

…

[0.1.0]: https://github.com/jindrichruzicka/Chimera/releases/tag/v0.1.0
[Unreleased]: https://github.com/jindrichruzicka/Chimera/compare/v0.1.0...HEAD
```

**After (example promoting to 0.2.0):**

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

- `TODAY_DATE` is the current calendar date in `YYYY-MM-DD` format
- The new `[Unreleased]` block is empty (no sub-sections) — entries are added during future development
- All existing link definitions are preserved; the new version link is added above the previous one
- The `[Unreleased]` link target is updated to compare from the new tag

---

### Step 6 — Update package.json version

```bash
# Update version field using npm version (no git tag — we tag manually)
npm version $VERSION --no-git-tag-version
```

Verify the change:

```bash
node -e "const p = require('./package.json'); console.log(p.version);"
```

Expected output: `<VERSION>`

---

### Step 7 — Run the pre-release gate

All four checks must exit 0 before any git operation:

```bash
pnpm format          # auto-fix formatting
pnpm format:check    # must exit 0
pnpm lint            # must exit 0
pnpm typecheck       # must exit 0
pnpm test            # must exit 0
```

If any check fails — fix the underlying issue before proceeding. Do NOT skip, bypass, or `--no-verify`.

---

### Step 8 — Commit the release prep

Stage all release prep changes (CHANGELOG, README if updated, package.json):

```bash
git add CHANGELOG.md package.json README.md
git status  # confirm only expected files are staged
```

Commit with a conventional release commit:

```bash
git commit -m "chore(release): v$VERSION

- Promote [Unreleased] → [$VERSION] in CHANGELOG
- Bump package.json version to $VERSION
- Update README to reflect $MILESTONE_TITLE completion
"
```

If README was not changed, omit the last bullet from the commit message.

---

### Step 9 — Create and push the git tag

```bash
# Create annotated tag
git tag -a "v$VERSION" -m "Release v$VERSION — $MILESTONE_TITLE"

# Push commit and tag together
git push origin main
git push origin "v$VERSION"
```

Verify the tag is visible on origin:

```bash
git ls-remote --tags origin | grep "v$VERSION"
```

---

### Step 10 — Extract release notes from CHANGELOG

Extract the content of the newly-promoted version block to use as the GitHub release body:

```bash
awk "/^## \[$VERSION\]/{found=1; next} /^## \[/{if(found) exit} found{print}" CHANGELOG.md \
  > /tmp/release-notes.md

cat /tmp/release-notes.md
```

Review the extracted notes — they should contain all sub-sections (`### Added`, `### Fixed`, etc.) from the promoted block.

---

### Step 11 — Create the GitHub release

```bash
gh release create "v$VERSION" \
  --repo $GH_REPO \
  --title "v$VERSION — $MILESTONE_TITLE" \
  --notes-file /tmp/release-notes.md \
  --latest
```

Verify the release was created:

```bash
gh release view "v$VERSION" --repo $GH_REPO \
  --json tagName,name,url,publishedAt \
  --jq '"Tag: \(.tagName)\nTitle: \(.name)\nURL: \(.url)\nPublished: \(.publishedAt)"'
```

---

### Step 12 — Close the milestone on GitHub

```bash
# Retrieve milestone number
M_NUM=$(gh api repos/$GH_REPO/milestones \
  --field state=all \
  --jq ".[] | select(.title | startswith(\"$MILESTONE_DESIGNATOR\")) | .number")

# Close the milestone
gh api repos/$GH_REPO/milestones/$M_NUM \
  --method PATCH \
  --field state=closed

# Verify
gh api repos/$GH_REPO/milestones/$M_NUM \
  --jq '"\(.title) — \(.state)"'
```

---

### Step 13 — Report summary

Print a concise release summary:

```
✅ Released v<VERSION> — <MILESTONE_TITLE>

  Tag:       v<VERSION>
  Commit:    <SHA>
  GitHub:    https://github.com/jindrichruzicka/Chimera/releases/tag/v<VERSION>
  Milestone: closed

  CHANGELOG: [Unreleased] promoted to [<VERSION>] — <TODAY_DATE>
  README:    <updated | no changes needed>
  package.json: bumped to <VERSION>
```

---

## Important Rules

### Only release from `main`

```bash
git branch --show-current   # must output "main"
```

If not on `main`, stop and ask the user to merge all milestone branches first via the merge sub-skill.

### All milestone issues must be closed

Do not release if any issue in the milestone is still open (Step 2). A release tag represents a complete, shipped milestone — not a partial one.

### Never force-push or amend the release commit

The release commit is a permanent record. If a mistake is made post-release, create a patch release (`v<MAJOR>.<MINOR>.<PATCH+1>`) following this same skill.

### Annotated tags only

Always use `git tag -a` (annotated), never lightweight tags. Annotated tags carry a message and tagger identity, which is required for `git describe` to work correctly.

### The `[Unreleased]` block must be empty after promotion

Do not carry forward any entries from the old `[Unreleased]` block. The new `[Unreleased]` block starts empty; entries accumulate there during the next development cycle.
