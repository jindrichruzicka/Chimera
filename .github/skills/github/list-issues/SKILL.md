---
name: list-issues
description: 'List and query GitHub issues for the Chimera project. Filters by milestone, label, state, or search term. Use when: checking what issues exist, finding open tasks, reviewing milestone progress, searching for specific issues.'
argument-hint: 'Filter criteria (e.g. "milestone:M1 open tasks" or "all open")'
---

# List Issues Skill

```bash
export GH_REPO=jindrichruzicka/Chimera
```

## Common Queries

```bash
# All open issues
gh issue list --repo $GH_REPO --state open --json number,title --jq '.[] | "#\(.number) \(.title)"'

# By milestone (title or label)
gh issue list --repo $GH_REPO --state open --milestone "M1 — Core Engine" --json number,title --jq '.[] | "#\(.number) \(.title)"'
gh issue list --repo $GH_REPO --state open --label "milestone:M1" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# By type
gh issue list --repo $GH_REPO --state open --label "task"    --json number,title --jq '.[] | "#\(.number) \(.title)"'
gh issue list --repo $GH_REPO --state open --label "feature" --json number,title --jq '.[] | "#\(.number) \(.title)"'
gh issue list --repo $GH_REPO --state open --label "bug"     --json number,title --jq '.[] | "#\(.number) \(.title)"'

# By module (simulation/renderer/electron/networking/ai/testing/tooling)
gh issue list --repo $GH_REPO --state open --label "simulation" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# Detailed
gh issue list --repo $GH_REPO --state open --label "milestone:M1" \
  --json number,title,labels,milestone \
  --jq '.[] | "#\(.number) \(.title) | [\(.labels | .[].name | join(", "))] | \(.milestone.title // "no milestone")"'

# Search keyword
gh issue list --repo $GH_REPO --state open --search "save load" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# Count
gh issue list --repo $GH_REPO --state open --label "milestone:M1" --label "task" --json number --jq 'length'
```

## Notes

- `--state open` / `closed`. Multi-label: combine `--label` flags.
- Milestone via `--milestone "<title>"` or `--label "milestone:M<N>"`.
- Search syntax: `--search "keyword label:task is:open"`.
