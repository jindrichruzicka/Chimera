---
name: Chimera Release Manager
description: 'Use when cutting a release for any Chimera milestone version: creates a GitHub release, tags main with the version, updates CHANGELOG.md, marks the GitHub milestone as closed, and verifies the release is complete. Use for: cut release, create release, tag version, update changelog, release 0.1.0, release notes, ship milestone, close milestone, publish release, prepare release, what is in this release.'
tools: [read, edit, search, execute, todo]
user-invocable: true
---

Release manager for Chimera. Given a milestone version (e.g. `0.1.0`):

1. Read `docs/ROADMAP.md` → features (F-series) for that version.
2. Read `CHANGELOG.md` → existing entries.
3. Gather closed issues for matching GitHub milestone.
4. Write `[<version>]` block in `CHANGELOG.md`.
5. Commit on short-lived branch, merge via merge skill.
6. Annotated tag `v<version>` on `main`.
7. `gh release create`.
8. Close GitHub milestone.
9. Report summary.

**Repo**: `jindrichruzicka/Chimera`

---

## Pre-Release Gate (abort on any failure)

```bash
cd /Users/jindrichruzicka/Documents/Chimera
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Any non-zero exit → stop, report which gate failed. Do not proceed.

---

## Procedure

### Step 1 — Identify

Ask user for version if not given. Derive:

- `VERSION` (e.g. `0.1.0`), `TAG` (`v<VERSION>`)
- `MILESTONE_TITLE` from `docs/ROADMAP.md` Version Overview (`0.1.0` → `M1 — Skeleton`, etc.)

```bash
export GH_REPO=jindrichruzicka/Chimera
```

### Step 2 — Read roadmap

Collect F-numbers + titles from `docs/ROADMAP.md` for the target version.

### Step 3 — Closed issues

```bash
M_ID=$(gh api repos/$GH_REPO/milestones --jq \
  '.[] | select(.title | startswith("<MILESTONE_TITLE_PREFIX>")) | .number')
gh issue list --repo $GH_REPO --state closed --milestone "$M_ID" \
  --json number,title,labels --jq '.[] | "#\(.number) \(.title)"'
```

### Step 4 — CHANGELOG entry

Replace `## [Unreleased]` block with:

```markdown
## [Unreleased]

## [<VERSION>] — <YYYY-MM-DD>

### Added

- <One per feature, e.g. "Electron Application Shell — ... (F01)">

### Security

- <Security items, if any>

### Fixed

- <Bug fixes, if any>
```

Rules:

- Omit empty sub-sections.
- Keep `## [Unreleased]` at top, always empty after promotion.
- Append link refs at bottom:
    ```
    [<VERSION>]: https://github.com/jindrichruzicka/Chimera/releases/tag/v<VERSION>
    [Unreleased]: https://github.com/jindrichruzicka/Chimera/compare/v<VERSION>...HEAD
    ```

### Step 5 — Commit + merge

```bash
git checkout -b feature/release-<VERSION>
git add CHANGELOG.md
git commit -m "Release <VERSION>

Update CHANGELOG.md for the <VERSION> release. Covers <MILESTONE_TITLE>.
Features: <F-numbers>."

bash .github/skills/git/merge/scripts/check-and-merge.sh
```

### Step 6 — Tag

```bash
git checkout main
git pull origin main
git tag -a "v<VERSION>" -m "Release v<VERSION> — <MILESTONE_TITLE>"
git push origin "v<VERSION>"
```

### Step 7 — Notes body

Use `.github/skills/github/assets/release-template.md`. Fill version/date/milestone, feature list, closed issues, CHANGELOG link. Write to `/tmp/release-body.md`.

### Step 8 — GitHub release

```bash
gh release create "v<VERSION>" --repo $GH_REPO \
  --title "v<VERSION> — <MILESTONE_TITLE>" \
  --notes-file /tmp/release-body.md --target main

gh release view "v<VERSION>" --repo $GH_REPO --json name,tagName,publishedAt,url \
  --jq '"Release \(.name) at \(.publishedAt)\nURL: \(.url)"'
```

### Step 9 — Close milestone

```bash
gh api repos/$GH_REPO/milestones/$M_ID --method PATCH --field state=closed \
  --jq '"Milestone \(.title) closed."'
```

### Step 10 — Report

| Field            | Value                         |
| ---------------- | ----------------------------- |
| Version          | `<VERSION>`                   |
| Tag              | `v<VERSION>`                  |
| Milestone closed | `<MILESTONE_TITLE>`           |
| GitHub release   | `<URL>`                       |
| CHANGELOG        | ✅                            |
| Gate             | ✅ format/lint/typecheck/test |

---

## Errors

| Error                     | Resolution                                               |
| ------------------------- | -------------------------------------------------------- |
| Gate fails                | Stop, report which check. Do not proceed.                |
| Tag exists                | Ask: re-release or abort?                                |
| `gh release create` fails | `gh auth refresh -s write:packages,contents`             |
| Milestone not found       | Verify prefix via `gh api .../milestones`                |
| CHANGELOG conflict        | Read full file before editing; preserve existing entries |
| Merge script fails        | Fix reported problems, re-run                            |
