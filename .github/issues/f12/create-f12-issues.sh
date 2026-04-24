#!/usr/bin/env bash
# ============================================================
# create-f12-issues.sh
#
# Creates the F12 feature issue and all 12 task issues for
# §4.12 Runtime Debug Layer (M7 — Hardening).
#
# Prerequisites:
#   - gh CLI authenticated with `issues` scope
#   - Run from the repo root: bash .github/issues/f12/create-f12-issues.sh
# ============================================================
set -euo pipefail

GH_REPO="jindrichruzicka/Chimera"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== F12: Runtime Debug Layer (§4.12) — Issue Creation ==="
echo "Repo: $GH_REPO"
echo ""

# ── Step 1: Resolve M7 milestone numeric ID ──────────────────
echo "[1/15] Resolving M7 milestone ID..."
M7_ID=$(gh api repos/$GH_REPO/milestones --jq '.[] | select(.title | startswith("M7")) | .number')
if [[ -z "$M7_ID" ]]; then
    echo "ERROR: M7 milestone not found. Create it first."
    echo "  gh api repos/$GH_REPO/milestones --method POST -f title='M7 — Hardening' -f due_on='2026-07-11T00:00:00Z'"
    exit 1
fi
echo "  M7 milestone ID: $M7_ID"

# ── Step 2: Ensure required labels exist ─────────────────────
echo "[2/15] Ensuring labels exist..."
gh label create "feature"       --color "0075ca" --description "Feature-level issue"                          --repo $GH_REPO 2>/dev/null || true
gh label create "task"          --color "e4e669" --description "Atomic implementation task"                   --repo $GH_REPO 2>/dev/null || true
gh label create "milestone:M7"  --color "bfd4f2" --description "M7 — Hardening"                              --repo $GH_REPO 2>/dev/null || true
gh label create "simulation"    --color "f9d0c4" --description "simulation/ package"                          --repo $GH_REPO 2>/dev/null || true
gh label create "electron"      --color "f9d0c4" --description "electron/ main + preload"                     --repo $GH_REPO 2>/dev/null || true
gh label create "renderer"      --color "f9d0c4" --description "renderer/ package"                            --repo $GH_REPO 2>/dev/null || true
gh label create "testing"       --color "f9d0c4" --description "Unit / integration / E2E tests"               --repo $GH_REPO 2>/dev/null || true
gh label create "invariant"     --color "e99695" --description "Touches or enforces an Appendix B invariant"  --repo $GH_REPO 2>/dev/null || true
echo "  Labels ready."

# ── Step 3: Create the F12 feature issue ─────────────────────
echo "[3/15] Creating F12 feature issue..."
F12_NUM=$(gh issue create \
    --repo "$GH_REPO" \
    --title "Runtime Debug Layer (§4.12)" \
    --label "feature,milestone:M7,simulation,electron,renderer,invariant" \
    --body-file "$SCRIPT_DIR/feature.md" \
    --json number --jq '.number')
gh api repos/$GH_REPO/issues/$F12_NUM --method PATCH --field milestone=$M7_ID > /dev/null
echo "  Created feature issue #$F12_NUM"

# Helper: substitute F12_ISSUE_NUMBER placeholder before creating task bodies
create_task() {
    local step="$1"
    local title="$2"
    local labels="$3"
    local body_file="$4"

    echo "[$step/15] Creating task: $title..."
    # Replace placeholder with real feature issue number
    local tmp_body
    tmp_body=$(mktemp)
    sed "s/<!-- F12_ISSUE_NUMBER -->/$F12_NUM/g" "$body_file" > "$tmp_body"

    local issue_num
    issue_num=$(gh issue create \
        --repo "$GH_REPO" \
        --title "$title" \
        --label "$labels" \
        --body-file "$tmp_body" \
        --json number --jq '.number')
    gh api repos/$GH_REPO/issues/$issue_num --method PATCH --field milestone=$M7_ID > /dev/null
    rm -f "$tmp_body"
    echo "  Created task issue #$issue_num"
    echo "$issue_num"
}

# ── Step 4–15: Create task issues ────────────────────────────
T1=$(create_task  4  "Add IS_DEBUG_MODE constant to shared/constants.ts" \
    "task,milestone:M7,simulation" \
    "$SCRIPT_DIR/t01-is-debug-mode.md")

T2=$(create_task  5  "Implement SnapshotRingBuffer in simulation/debug/" \
    "task,milestone:M7,simulation,testing" \
    "$SCRIPT_DIR/t02-snapshot-ring-buffer.md")

T3=$(create_task  6  "Implement SnapshotDiff in simulation/debug/" \
    "task,milestone:M7,simulation,testing" \
    "$SCRIPT_DIR/t03-snapshot-diff.md")

T4=$(create_task  7  "Declare DebugProtocol typed IPC messages in simulation/debug/" \
    "task,milestone:M7,simulation,invariant" \
    "$SCRIPT_DIR/t04-debug-protocol.md")

T5=$(create_task  8  "Implement SnapshotInspector facade in simulation/debug/" \
    "task,milestone:M7,simulation,testing" \
    "$SCRIPT_DIR/t05-snapshot-inspector.md")

T6=$(create_task  9  "Wire debugObserver hook into ActionPipeline" \
    "task,milestone:M7,simulation" \
    "$SCRIPT_DIR/t06-pipeline-debug-observer.md")

T7=$(create_task 10  "Implement debug-bridge.ts in electron/main/" \
    "task,milestone:M7,electron,invariant" \
    "$SCRIPT_DIR/t07-debug-bridge.md")

T8=$(create_task 11  "Implement debug-api.ts preload script for Inspector Window" \
    "task,milestone:M7,electron,invariant" \
    "$SCRIPT_DIR/t08-debug-api-preload.md")

T9=$(create_task 12  "Implement Inspector Window UI (renderer/app/debug/page.tsx)" \
    "task,milestone:M7,renderer" \
    "$SCRIPT_DIR/t09-inspector-window-ui.md")

T10=$(create_task 13  "Write unit tests for simulation/debug/ modules" \
    "task,milestone:M7,simulation,testing" \
    "$SCRIPT_DIR/t10-unit-tests-simulation-debug.md")

T11=$(create_task 14  "Write IPC security and production isolation tests for debug layer" \
    "task,milestone:M7,electron,testing,invariant" \
    "$SCRIPT_DIR/t11-security-production-tests.md")

T12=$(create_task 15  "Review all F12 changes and merge to main" \
    "task,milestone:M7,simulation,electron,renderer" \
    "$SCRIPT_DIR/t12-review-and-merge.md")

# ── Step: Update feature issue body with real task numbers ───
echo ""
echo "[16/16] Updating F12 feature issue #$F12_NUM with task numbers..."
CHILD_TASKS="- [ ] #$T1
- [ ] #$T2
- [ ] #$T3
- [ ] #$T4
- [ ] #$T5
- [ ] #$T6
- [ ] #$T7
- [ ] #$T8
- [ ] #$T9
- [ ] #$T10
- [ ] #$T11
- [ ] #$T12"

# Re-read feature body and replace placeholder child task list
UPDATED_BODY=$(sed \
    "s/<!-- Populated after feature issue is created. List task issue numbers here. -->/${CHILD_TASKS}/g" \
    "$SCRIPT_DIR/feature.md" | \
    sed "s/- \[ \] #<!-- T[0-9]* -->//g")

echo "$UPDATED_BODY" | gh issue edit "$F12_NUM" --repo "$GH_REPO" --body-file -

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "✅ F12 issues created successfully"
echo ""
echo "| #    | Type    | Title |"
echo "|------|---------|-------|"
echo "| #$F12_NUM | feature | Runtime Debug Layer (§4.12) |"
echo "| #$T1  | task    | Add IS_DEBUG_MODE constant |"
echo "| #$T2  | task    | Implement SnapshotRingBuffer |"
echo "| #$T3  | task    | Implement SnapshotDiff |"
echo "| #$T4  | task    | Declare DebugProtocol typed IPC messages |"
echo "| #$T5  | task    | Implement SnapshotInspector facade |"
echo "| #$T6  | task    | Wire debugObserver hook into ActionPipeline |"
echo "| #$T7  | task    | Implement debug-bridge.ts |"
echo "| #$T8  | task    | Implement debug-api.ts preload script |"
echo "| #$T9  | task    | Implement Inspector Window UI |"
echo "| #$T10 | task    | Write unit tests for simulation/debug/ |"
echo "| #$T11 | task    | Write IPC security and production tests |"
echo "| #$T12 | task    | Review all F12 changes and merge to main |"
echo ""
echo "Milestone: https://github.com/$GH_REPO/milestone/$M7_ID"
echo "Feature:   https://github.com/$GH_REPO/issues/$F12_NUM"
