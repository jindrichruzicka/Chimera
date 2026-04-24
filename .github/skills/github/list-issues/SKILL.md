---
name: list-issues
description: 'List and query GitHub issues for the Chimera project. Filters by milestone, label, state, or search term. Use when: checking what issues exist, finding open tasks, reviewing milestone progress, searching for specific issues.'
argument-hint: 'Filter criteria (e.g. "milestone:M1 open tasks" or "all open")'
---

# List Issues Skill

Lists and queries GitHub issues for the Chimera project with various filters.

## When to Use

- Checking what issues exist for a milestone
- Finding open tasks to work on
- Reviewing milestone progress
- Searching for specific issues by label or keyword

---

## Procedure

### List all open issues

```bash
export GH_REPO=jindrichruzicka/Chimera
gh issue list --repo $GH_REPO --state open --json number,title,labels --jq '.[] | "#\(.number) \(.title)"'
```

### List issues for a specific milestone

```bash
# By milestone title
gh issue list --repo $GH_REPO --state open --milestone "M1 — Core Engine" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# By milestone label
gh issue list --repo $GH_REPO --state open --label "milestone:M1" --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

### List issues by type

```bash
# All open tasks
gh issue list --repo $GH_REPO --state open --label "task" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# All open features
gh issue list --repo $GH_REPO --state open --label "feature" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# All open bugs
gh issue list --repo $GH_REPO --state open --label "bug" --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

### List issues by module

```bash
# Simulation issues
gh issue list --repo $GH_REPO --state open --label "simulation" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# Renderer issues
gh issue list --repo $GH_REPO --state open --label "renderer" --json number,title --jq '.[] | "#\(.number) \(.title)"'

# Electron issues
gh issue list --repo $GH_REPO --state open --label "electron" --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

### List issues with details

```bash
# Show number, title, labels, and milestone
gh issue list --repo $GH_REPO --state open --label "milestone:M1" \
  --json number,title,labels,milestone \
  --jq '.[] | "#\(.number) \(.title) | [\(.labels | .[].name | join(", "))] | \(.milestone.title // "no milestone")"'
```

### Search issues by keyword

```bash
gh issue list --repo $GH_REPO --state open --search "save load" --json number,title --jq '.[] | "#\(.number) \(.title)"'
```

### Count issues by type

```bash
# Count open tasks for M1
gh issue list --repo $GH_REPO --state open --label "milestone:M1" --label "task" --json number --jq 'length'

# Count open features for M1
gh issue list --repo $GH_REPO --state open --label "milestone:M1" --label "feature" --json number --jq 'length'
```

---

## Common Queries

### What tasks are available for M1?

```bash
gh issue list --repo $GH_REPO --state open --label "milestone:M1" --label "task" \
  --json number,title,labels \
  --jq '.[] | "#\(.number) \(.title)"'
```

### What features are in progress for M2?

```bash
gh issue list --repo $GH_REPO --state open --label "milestone:M2" --label "feature" \
  --json number,title \
  --jq '.[] | "#\(.number) \(.title)"'
```

### Are there any open bugs?

```bash
gh issue list --repo $GH_REPO --state open --label "bug" \
  --json number,title,labels \
  --jq '.[] | "#\(.number) \(.title)"'
```

### What simulation tasks are open?

```bash
gh issue list --repo $GH_REPO --state open --label "simulation" --label "task" \
  --json number,title \
  --jq '.[] | "#\(.number) \(.title)"'
```

---

## Notes

- Use `--state open` or `--state closed` to filter by state
- Combine multiple `--label` flags to filter by multiple labels
- Use `--jq` to format output in custom ways
- Milestone can be filtered by title (`--milestone "M1 — Core Engine"`) or label (`--label "milestone:M1"`)
- Search uses GitHub's search syntax: `--search "keyword label:task is:open"`
