---
name: create-labels
description: 'Create or update GitHub labels for the Chimera project. Creates milestone labels (milestone:M1, milestone:M2), type labels (feature, task, bug), and module labels (simulation, renderer, etc.). Use when: setting up a new milestone, ensuring labels exist before creating issues, organizing project labels.'
argument-hint: 'Label name or milestone (e.g. "milestone:M1" or "all")'
---

# Create Labels Skill

Creates or updates GitHub labels for the Chimera project following the standard label catalogue.

## When to Use

- Setting up labels for a new milestone
- Ensuring labels exist before creating issues
- Organizing project labels by milestone, type, and module

---

## Standard Label Catalogue

### Milestone Labels

| Name           | Color    | Description                   |
| -------------- | -------- | ----------------------------- |
| `milestone:M1` | `6b3ea1` | Core Engine (M1)              |
| `milestone:M2` | `6b3ea1` | Multiplayer & Networking (M2) |
| `milestone:M3` | `6b3ea1` | AI & Content Pipeline (M3)    |

### Type Labels

| Name       | Color    | Description               |
| ---------- | -------- | ------------------------- |
| `feature`  | `0e8a16` | Feature issue             |
| `task`     | `0075ca` | Task/implementation issue |
| `bug`      | `d73a4a` | Bug fix issue             |
| `refactor` | `6f41c1` | Refactoring issue         |

### Module Labels

| Name         | Color    | Description            |
| ------------ | -------- | ---------------------- |
| `simulation` | `0596ca` | Simulation core        |
| `networking` | `0596ca` | Multiplayer/networking |
| `renderer`   | `0596ca` | React/R3F renderer     |
| `electron`   | `0596ca` | Electron main/preload  |
| `ai`         | `0596ca` | AI engine              |
| `testing`    | `0596ca` | Test infrastructure    |
| `tooling`    | `0596ca` | Dev tools/build        |

---

## Procedure

### Create a single label

```bash
export GH_REPO=jindrichruzicka/Chimera
gh label create "<name>" --color "<hex>" --description "<desc>" --repo $GH_REPO
```

**Example:**

```bash
gh label create "milestone:M1" --color "6b3ea1" --description "Core Engine (M1)" --repo $GH_REPO
```

### Create all labels for a milestone

```bash
gh label create "milestone:M1" --color "6b3ea1" --description "Core Engine (M1)" --repo $GH_REPO || true
gh label create "task" --color "0075ca" --description "Task/implementation issue" --repo $GH_REPO || true
gh label create "simulation" --color "0596ca" --description "Simulation core" --repo $GH_REPO || true
```

The `|| true` prevents failure if the label already exists.

### Create all standard labels (one-liner)

```bash
for label in "milestone:M1:6b3ea1:Core Engine (M1)" "task:0075ca:Task/implementation issue" "feature:0e8a16:Feature issue" "bug:d73a4a:Bug fix issue" "simulation:0596ca:Simulation core" "renderer:0596ca:React/R3F renderer" "electron:0596ca:Electron main/preload" "networking:0596ca:Multiplayer/networking" "ai:0596ca:AI engine" "testing:0596ca:Test infrastructure" "tooling:0596ca:Dev tools/build"; do
  IFS=':' read -r name color desc <<< "$label"
  gh label create "$name" --color "$color" --description "$desc" --repo $GH_REPO || true
done
```

---

## Notes

- Labels are repo-wide, not milestone-specific
- Safe to re-run: use `|| true` to skip if label exists
- Use `--force` to overwrite an existing label's description/color
- Always create labels before creating issues that reference them
