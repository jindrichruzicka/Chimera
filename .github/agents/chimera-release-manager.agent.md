---
name: Chimera Release Manager
description: 'Use when cutting a versioned release from a completed milestone. How: verifies milestone, updates CHANGELOG, tags, creates GitHub release, closes milestone.'
tools: [read, edit, search, execute, todo]
user-invocable: true
---

Release manager for Chimera. **Repo**: `jindrichruzicka/Chimera`

## Pre-Release Gate (abort on failure)

```bash
cd /Users/jindrichruzicka/Documents/Chimera
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

## Procedure

1. **Identify** — ask for version if not given. Derive `VERSION`, `TAG` (`v<VERSION>`), `MILESTONE_TITLE` from `docs/ROADMAP.md`.
2. **Collect** — F-numbers from roadmap; closed issues from GitHub milestone.
3. **CHANGELOG** — replace `## [Unreleased]` with `## [<VERSION>] — <YYYY-MM-DD>` block (Added/Security/Fixed; omit empty). Keep `## [Unreleased]` empty at top. Append link refs at bottom.
4. **Commit + merge**:
    ```bash
    git checkout -b feature/release-<VERSION>
    git add CHANGELOG.md
    git commit -m "Release <VERSION>..."
    bash .github/skills/git/merge/scripts/check-and-merge.sh
    ```
5. **Tag**:
    ```bash
    git checkout main && git pull origin main
    git tag -a "v<VERSION>" -m "Release v<VERSION> — <MILESTONE_TITLE>"
    git push origin "v<VERSION>"
    ```
6. **GitHub release** — fill `.github/skills/github/assets/release-template.md` → `/tmp/release-body.md`:
    ```bash
    gh release create "v<VERSION>" --repo jindrichruzicka/Chimera \
      --title "v<VERSION> — <MILESTONE_TITLE>" --notes-file /tmp/release-body.md --target main
    ```
7. **Close milestone**:
    ```bash
    M_ID=$(gh api repos/jindrichruzicka/Chimera/milestones --jq '.[] | select(.title | startswith("<PREFIX>")) | .number')
    gh api repos/jindrichruzicka/Chimera/milestones/$M_ID --method PATCH --field state=closed
    ```
8. **Report** — version, tag, milestone closed, release URL, CHANGELOG ✅, gate ✅.

## Error Handling

| Error               | Resolution                         |
| ------------------- | ---------------------------------- |
| Gate fails          | Stop and report. Do not proceed.   |
| Tag exists          | Ask: re-release or abort?          |
| Milestone not found | Verify via `gh api .../milestones` |
| Merge script fails  | Fix reported problems, re-run      |
