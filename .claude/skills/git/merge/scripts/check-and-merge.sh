#!/usr/bin/env bash
# .claude/skills/git/merge/scripts/check-and-merge.sh
#
# Validates the current branch against the Chimera merge standard, then
# performs an autosquash interactive rebase onto main and fast-forward merges
# if everything is clean. Reports every problem found and exits non-zero if
# the merge must not proceed.
#
# Usage: bash .claude/skills/git/merge/scripts/check-and-merge.sh [--dry-run]
#   --dry-run   Run all checks and rebase prep but do NOT perform the final merge.

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ─── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RESET='\033[0m'
info()  { echo -e "${GREEN}[merge]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error() { echo -e "${RED}[error]${RESET} $*"; }

PROBLEMS=()
add_problem() { PROBLEMS+=("$1"); }

# ─── 1. Establish context ──────────────────────────────────────────────────────
CURRENT=$(git rev-parse --abbrev-ref HEAD)
MAIN="main"

if [[ "$CURRENT" == "$MAIN" ]]; then
  error "Already on '${MAIN}'. Checkout the feature/fix branch you want to merge first."
  exit 1
fi

info "Branch:  ${CURRENT}"
info "Target:  ${MAIN}"
echo

# ─── 2. Ensure working tree is clean ──────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  add_problem "Working tree has uncommitted changes. Commit or stash before merging."
fi

# ─── 3. Branch naming convention ──────────────────────────────────────────────
if ! echo "$CURRENT" | grep -qE '^(feature|fix|refactor)/[a-z0-9][a-z0-9-]*$'; then
  add_problem "Branch name '${CURRENT}' does not follow the required pattern: feature/<name>, fix/<name>, or refactor/<name> (lowercase kebab-case)."
fi

# ─── 4. Fetch to make sure origin/main is up to date ──────────────────────────
info "Fetching origin..."
git fetch origin "$MAIN" --quiet

# ─── 5. Check: no commits from main already merged into this branch ────────────
# "Downmerged" commits = commits reachable from HEAD that are also reachable from
# origin/main but are NOT the branch's own commits (i.e. came from a merge-down).
MERGE_BASE=$(git merge-base HEAD "origin/${MAIN}")
MAIN_COMMITS_ON_BRANCH=$(git log "${MERGE_BASE}..HEAD" --oneline --merges --ancestry-path "^origin/${MAIN}" 2>/dev/null | wc -l | tr -d ' ')

if [[ "$MAIN_COMMITS_ON_BRANCH" -gt 0 ]]; then
  add_problem "Branch contains merge commits bringing main into the branch (${MAIN_COMMITS_ON_BRANCH} found). Run 'git rebase origin/main' instead of 'git merge main'."
fi

# ─── 6. Check: first commit has a non-empty body ──────────────────────────────
FIRST_COMMIT=$(git log --ancestry-path "${MERGE_BASE}..HEAD" --format="%H" | tail -1)
if [[ -n "$FIRST_COMMIT" ]]; then
  COMMIT_BODY=$(git log -1 --format="%b" "$FIRST_COMMIT" | sed '/^[[:space:]]*$/d')
  if [[ -z "$COMMIT_BODY" ]]; then
    add_problem "First commit (${FIRST_COMMIT:0:8}) has no body. The first commit must describe what was done and why."
  fi
fi

# ─── 7. Check: no commits after the first are non-fixup ──────────────────────
# All commits after the first should be fixup! commits.
# `git log` lists commits newest-first; the oldest (= first commit on the
# branch) is the LAST line, so drop it with `sed '$d'`, not `tail -n +2`.
COMMIT_LIST=$(git log --ancestry-path "${MERGE_BASE}..HEAD" --format="%H %s" | sed '$d')
NON_FIXUP=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  SHA="${line%% *}"
  SUBJECT="${line#* }"
  if ! echo "$SUBJECT" | grep -q "^fixup!"; then
    NON_FIXUP+=("${SHA:0:8}: ${SUBJECT}")
  fi
done <<< "$COMMIT_LIST"

if [[ ${#NON_FIXUP[@]} -gt 0 ]]; then
  add_problem "$(printf "The following commits after the first are not fixup! commits:\n"; printf '  %s\n' "${NON_FIXUP[@]}")"
fi

# ─── 8. Report problems and bail if any found ─────────────────────────────────
echo
if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
  error "Found ${#PROBLEMS[@]} problem(s) — merge aborted:"
  echo
  N=1
  for p in "${PROBLEMS[@]}"; do
    echo -e "  ${RED}${N}.${RESET} ${p}"
    ((N++))
  done
  echo
  warn "Fix the problems above and re-run this script."
  exit 1
fi

info "All checks passed."
echo

# ─── 8b. Pre-merge gate: format / lint / typecheck / tests ────────────────────
# Catches regressions before they reach main. A green local checkout is not
# sufficient because previous merges may have introduced drift; we re-run the
# full gate against the current branch state. If any check fails the merge is
# aborted with the same severity as a structural problem above.
info "Running pre-merge gate (format:check, lint, typecheck, test)..."
GATE_FAILED=()
run_gate_step() {
  local label="$1"; shift
  if ! "$@" >/dev/null 2>&1; then
    GATE_FAILED+=("$label")
  fi
}
run_gate_step "pnpm format:check" pnpm format:check
run_gate_step "pnpm lint"         pnpm lint
run_gate_step "pnpm typecheck"    pnpm typecheck
run_gate_step "pnpm test"         pnpm test

if [[ ${#GATE_FAILED[@]} -gt 0 ]]; then
  echo
  error "Pre-merge gate failed:"
  for step in "${GATE_FAILED[@]}"; do
    echo -e "  ${RED}✗${RESET} ${step}"
  done
  echo
  warn "Run the failing command manually to see the full output, fix the issues,"
  warn "commit a fixup, and re-run this script."
  exit 1
fi

info "Pre-merge gate passed."
echo

# ─── 9. Autosquash interactive rebase onto main ───────────────────────────────
info "Rebasing '${CURRENT}' onto 'origin/${MAIN}' (autosquash)..."
# GIT_SEQUENCE_EDITOR=true skips the interactive editor entirely when autosquash
# is enabled — fixup commits are collapsed automatically without user input.
if ! GIT_SEQUENCE_EDITOR=true git rebase --interactive --autosquash "origin/${MAIN}"; then
  echo
  error "Rebase encountered conflicts. Resolve them, then run:"
  echo "    git rebase --continue"
  echo "After the rebase completes cleanly, re-run this script."
  exit 1
fi

info "Rebase successful."
echo

# ─── 10. Fast-forward merge to main ──────────────────────────────────────────
if $DRY_RUN; then
  warn "--dry-run specified: skipping actual merge to ${MAIN}."
  warn "If satisfied, run without --dry-run to complete the merge."
  exit 0
fi

info "Checking out '${MAIN}'..."
git checkout "$MAIN"

info "Fast-forward merging '${CURRENT}'..."
if ! git merge --ff-only "$CURRENT"; then
  error "Fast-forward merge failed (branch is not strictly ahead of ${MAIN} after rebase). This should not happen — please investigate."
  git checkout "$CURRENT"
  exit 1
fi

info "Pushing '${MAIN}' to origin..."
git push origin "$MAIN"

# ─── 11. Delete the merged branch ────────────────────────────────────────────
info "Deleting local branch '${CURRENT}'..."
git branch -d "$CURRENT"

info "Deleting remote branch 'origin/${CURRENT}'..."
if git ls-remote --exit-code origin "$CURRENT" &>/dev/null; then
  git push origin --delete "$CURRENT"
else
  warn "Remote branch 'origin/${CURRENT}' not found — skipping remote delete."
fi

echo
info "✓ '${CURRENT}' merged into '${MAIN}', pushed, and branch deleted."
