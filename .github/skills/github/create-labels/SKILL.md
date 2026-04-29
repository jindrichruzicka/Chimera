---
name: create-labels
description: 'Create or update GitHub labels for the Chimera project. Creates milestone labels (milestone:M1, milestone:M2), type labels (feature, task, bug), and module labels (simulation, renderer, etc.). Use when: setting up a new milestone, ensuring labels exist before creating issues, organizing project labels.'
argument-hint: 'Label name or milestone (e.g. "milestone:M1" or "all")'
---

# Create Labels Skill

## Catalogue

| Name           | Color    | Description                   |
| -------------- | -------- | ----------------------------- |
| `milestone:M1` | `6b3ea1` | Core Engine (M1)              |
| `milestone:M2` | `6b3ea1` | Multiplayer & Networking (M2) |
| `milestone:M3` | `6b3ea1` | AI & Content Pipeline (M3)    |
| `feature`      | `0e8a16` | Feature issue                 |
| `task`         | `0075ca` | Task/implementation issue     |
| `bug`          | `d73a4a` | Bug fix issue                 |
| `refactor`     | `6f41c1` | Refactoring issue             |
| `simulation`   | `0596ca` | Simulation core               |
| `networking`   | `0596ca` | Multiplayer/networking        |
| `renderer`     | `0596ca` | React/R3F renderer            |
| `electron`     | `0596ca` | Electron main/preload         |
| `ai`           | `0596ca` | AI engine                     |
| `testing`      | `0596ca` | Test infrastructure           |
| `tooling`      | `0596ca` | Dev tools/build               |

## Create

```bash
export GH_REPO=jindrichruzicka/Chimera
gh label create "<name>" --color "<hex>" --description "<desc>" --repo $GH_REPO || true
```

`|| true` skips on conflict. Use `--force` to overwrite existing color/desc.

## Bulk create

```bash
for label in "milestone:M1:6b3ea1:Core Engine (M1)" "task:0075ca:Task/implementation issue" "feature:0e8a16:Feature issue" "bug:d73a4a:Bug fix issue" "simulation:0596ca:Simulation core" "renderer:0596ca:React/R3F renderer" "electron:0596ca:Electron main/preload" "networking:0596ca:Multiplayer/networking" "ai:0596ca:AI engine" "testing:0596ca:Test infrastructure" "tooling:0596ca:Dev tools/build"; do
  IFS=':' read -r name color desc <<< "$label"
  gh label create "$name" --color "$color" --description "$desc" --repo $GH_REPO || true
done
```

Labels are repo-wide. Always create labels before issues that reference them.
