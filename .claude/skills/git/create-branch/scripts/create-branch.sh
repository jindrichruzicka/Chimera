#!/usr/bin/env bash
# .claude/skills/git/create-branch/scripts/create-branch.sh <issue-number>
#
# Validates a GitHub issue, derives the correct branch name following the
# SKILL.md slug algorithm, checks for existing branches, updates main,
# and creates the branch.
#
# Usage:
#   bash .claude/skills/git/create-branch/scripts/create-branch.sh 42

set -euo pipefail

GH_REPO="jindrichruzicka/Chimera"

# ─── Args ─────────────────────────────────────────────────────────────────────

if [[ $# -ne 1 ]] || ! [[ "$1" =~ ^[0-9]+$ ]]; then
    echo "Usage: $(basename "$0") <issue-number>" >&2
    exit 1
fi

ISSUE_NUMBER="$1"

# ─── Step 1 — Resolve the issue ───────────────────────────────────────────────

if ! ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" \
        --repo "$GH_REPO" \
        --json number,title,labels,state,milestone 2>&1); then
    echo "Error: Issue #${ISSUE_NUMBER} does not exist in ${GH_REPO}." >&2
    exit 1
fi

ISSUE_STATE=$(echo "$ISSUE_JSON" | jq -r '.state')
ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
LABEL_NAMES=$(echo "$ISSUE_JSON" | jq -r '[.labels[].name] | join(",")')

# Check open
if [[ "$ISSUE_STATE" != "OPEN" ]]; then
    echo "Error: Issue #${ISSUE_NUMBER} is closed. Reopen it before starting work." >&2
    exit 1
fi

# Determine prefix from labels
HAS_TASK=false
HAS_BUG=false
HAS_FEATURE_ONLY=false

IFS=',' read -ra LABELS <<< "$LABEL_NAMES"
for label in "${LABELS[@]+"${LABELS[@]}"}"; do
    label=$(echo "$label" | tr -d '[:space:]')
    case "$label" in
        task) HAS_TASK=true ;;
        bug)  HAS_BUG=true ;;
    esac
done

# Feature-only check: has no task/bug label at all
if [[ "$HAS_TASK" == "false" && "$HAS_BUG" == "false" ]]; then
    # Check if it has a feature label
    for label in "${LABELS[@]+"${LABELS[@]}"}"; do
        label=$(echo "$label" | tr -d '[:space:]')
        if [[ "$label" == "feature" ]]; then
            HAS_FEATURE_ONLY=true
        fi
    done
    if [[ "$HAS_FEATURE_ONLY" == "true" ]]; then
        echo "Error: Issue #${ISSUE_NUMBER} is a feature issue. Break it into task issues first." >&2
    else
        echo "Error: Issue #${ISSUE_NUMBER} has no workable label (task or bug). Add one before branching." >&2
    fi
    exit 1
fi

if [[ "$HAS_BUG" == "true" ]]; then
    PREFIX="fix"
else
    PREFIX="feature"
fi

# ─── Step 2 — Derive the branch slug ──────────────────────────────────────────

# 1. Strip §X.Y architecture reference suffix
slug="$ISSUE_TITLE"
slug="${slug//(§[0-9]*.*)}"   # remove (§...) suffix
# Use sed for portability
slug=$(echo "$slug" | sed 's/(§[^)]*)//')
# 2. Lowercase
slug=$(echo "$slug" | tr '[:upper:]' '[:lower:]')
# 3. Replace any character that is not a-z, 0-9, or - with -
slug=$(echo "$slug" | sed 's/[^a-z0-9-]/-/g')
# 4. Collapse consecutive -
slug=$(echo "$slug" | sed 's/-\{2,\}/-/g')
# 5. Strip leading/trailing -
slug=$(echo "$slug" | sed 's/^-//;s/-$//')
# 6. Truncate to 50 characters
slug="${slug:0:50}"
# 7. Strip trailing - after truncation
slug=$(echo "$slug" | sed 's/-$//')
# 8. Append -<NUMBER>
slug="${slug}-${ISSUE_NUMBER}"

BRANCH_NAME="${PREFIX}/${slug}"

# ─── Step 3 — Check for existing branch ───────────────────────────────────────

if git branch --list "$BRANCH_NAME" | grep -q .; then
    echo "Branch '${BRANCH_NAME}' already exists locally. Check it out instead?" >&2
    exit 1
fi

if git ls-remote --heads origin "$BRANCH_NAME" | grep -q .; then
    echo "Branch '${BRANCH_NAME}' already exists on origin. Check it out instead?" >&2
    exit 1
fi

# ─── Step 4 — Update main ─────────────────────────────────────────────────────

# Stash check: abort if working tree is dirty on main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == "main" ]]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
        echo "Error: Working tree is not clean. Commit or stash changes before switching branches." >&2
        exit 1
    fi
fi

git checkout main
if ! git pull --ff-only origin main; then
    echo "Error: Local main has diverged from origin. Resolve manually before branching." >&2
    exit 1
fi

# ─── Step 5 — Create the branch ───────────────────────────────────────────────

git checkout -b "$BRANCH_NAME"

BASE_SHA=$(git rev-parse --short main)

# ─── Step 6 — Report ──────────────────────────────────────────────────────────

MILESTONE_NAME=$(echo "$ISSUE_JSON" | jq -r '.milestone.title // "(none)"')

cat <<EOF

[create-branch] Branch created successfully.

  Issue:     #${ISSUE_NUMBER} — ${ISSUE_TITLE}
  Branch:    ${BRANCH_NAME}
  Base:      main @ ${BASE_SHA}
  Milestone: ${MILESTONE_NAME}

Next steps:
  1. Implement the changes described in issue #${ISSUE_NUMBER}.
  2. Commit with a descriptive body: git commit -m "subject" -m "body..."
  3. Additional commits must use fixup!: git commit --fixup HEAD
  4. When ready, use the git skillset → merge sub-skill to land the branch.

EOF
