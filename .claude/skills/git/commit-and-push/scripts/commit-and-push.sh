#!/usr/bin/env bash
# .claude/skills/git/commit-and-push/scripts/commit-and-push.sh
#
# Smart commit + push for the Chimera feature-branch workflow:
#
#   • Must be on a feature/*, fix/*, or refactor/* branch (not main).
#   • If the branch already has commits ahead of main:
#       → creates a --fixup commit targeting the first commit and pushes.
#   • If the branch has no commits ahead of main yet:
#       → creates a normal commit using the message args supplied, then pushes.
#
# Usage (first commit — message required):
#   bash commit-and-push.sh -m "feat(module): subject" -m "Body explaining why."
#
# Usage (subsequent commits — message args ignored, fixup is auto-created):
#   bash commit-and-push.sh
#
# The script aborts with a non-zero exit if:
#   • not on a feature/fix/refactor branch
#   • there is nothing staged in the index
#   • git commit or git push fails

set -euo pipefail

# ─── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; RESET='\033[0m'
info()  { echo -e "${GREEN}[commit-and-push]${RESET} $*"; }
warn()  { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error() { echo -e "${RED}[error]${RESET} $*"; }

# ─── 1. Verify we are on a workable branch ────────────────────────────────────
CURRENT=$(git rev-parse --abbrev-ref HEAD)

if ! echo "$CURRENT" | grep -qE '^(feature|fix|refactor)/[a-z0-9][a-z0-9-]*$'; then
    error "Not on a feature branch."
    error "Current branch: '${CURRENT}'"
    error "You must be on a feature/*, fix/*, or refactor/* branch to use this script."
    exit 1
fi

info "Branch: ${CURRENT}"

# ─── 2. Verify there is something staged ──────────────────────────────────────
if git diff --cached --quiet; then
    error "Nothing staged. Stage your changes with 'git add' before committing."
    exit 1
fi

# ─── 3. Determine whether this is the first commit or a follow-up ─────────────
# Fetch so that origin/main is up to date, then find the merge-base.
git fetch origin main --quiet

MERGE_BASE=$(git merge-base HEAD "origin/main")
COMMITS_AHEAD=$(git log "${MERGE_BASE}..HEAD" --format="%H" | wc -l | tr -d ' ')

info "Commits ahead of origin/main: ${COMMITS_AHEAD}"

if [[ "$COMMITS_AHEAD" -eq 0 ]]; then
    # ── First commit on this branch ──────────────────────────────────────────
    info "No prior commits on this branch — creating first commit."

    if [[ $# -eq 0 ]]; then
        error "No commit message supplied."
        error "For the first commit you must provide a message, e.g.:"
        error "  bash commit-and-push.sh -m \"feat(module): subject\" -m \"Body: why.\""
        exit 1
    fi

    git commit "$@"
    COMMITTED_SHA=$(git rev-parse HEAD)
    info "Created first commit: ${COMMITTED_SHA:0:8}"
else
    # ── Follow-up commit — create a fixup targeting the first commit ──────────
    # The first commit on this branch is the oldest one ahead of main.
    FIRST_SHA=$(git log "${MERGE_BASE}..HEAD" --format="%H" | tail -1)
    FIRST_SUBJECT=$(git log -1 --format="%s" "$FIRST_SHA")

    info "Existing commits found. Creating fixup commit targeting: ${FIRST_SHA:0:8} '${FIRST_SUBJECT}'"

    if [[ $# -gt 0 ]]; then
        warn "Message arguments are ignored for fixup commits (the message is derived automatically)."
    fi

    git commit --fixup "$FIRST_SHA"
    COMMITTED_SHA=$(git rev-parse HEAD)
    info "Created fixup commit: ${COMMITTED_SHA:0:8}"
fi

# ─── 4. Push ──────────────────────────────────────────────────────────────────
info "Pushing '${CURRENT}' to origin..."
git push origin "${CURRENT}"
info "Done."
