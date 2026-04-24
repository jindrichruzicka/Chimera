#!/usr/bin/env bash
#
# pull-latest.sh — Update local main with latest from origin
#
# Usage:
#   bash .github/skills/git/pull-latest/scripts/pull-latest.sh [--verbose]
#
# This script:
#   1. Validates the working tree is clean
#   2. Fetches latest changes from origin
#   3. Checks out main
#   4. Pulls with --ff-only (safe, no merge commits)
#   5. Reports the update status
#

set -euo pipefail

# Configuration
VERBOSE=false
if [[ "${@:-}" == *"--verbose"* ]]; then
    VERBOSE=true
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[pull-latest]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[pull-latest]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[pull-latest]${NC} $1"
}

log_error() {
    echo -e "${RED}[pull-latest]${NC} $1" >&2
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[pull-latest]${NC} (verbose) $1"
    fi
}

# Step 0: Record current branch
log_info "Checking current branch..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || {
    log_error "Not a git repository. Cannot determine current branch."
    exit 1
}
log_verbose "Current branch: $CURRENT_BRANCH"

# Step 1: Check working tree is clean
log_info "Checking working tree status..."
DIRTY_STATUS=$(git status --porcelain 2>/dev/null)
if [[ -n "$DIRTY_STATUS" ]]; then
    log_error "Working tree has uncommitted changes."
    echo ""
    echo "Changes found:"
    echo "$DIRTY_STATUS"
    echo ""
    log_error "Commit or stash your changes before pulling latest."
    echo ""
    echo "To stash changes:"
    echo "  git stash"
    echo ""
    echo "To commit changes:"
    echo "  git add ."
    echo "  git commit -m \"Your commit message\""
    exit 1
fi
log_success "Working tree is clean."

# Step 2: Check if origin remote exists
log_info "Checking for origin remote..."
if ! git remote get-url origin &>/dev/null; then
    log_error "No 'origin' remote configured."
    echo ""
    echo "To configure origin:"
    echo "  git remote add origin <repository-url>"
    exit 1
fi
log_success "Origin remote found."

# Step 3: Fetch latest from origin
log_info "Fetching latest changes from origin..."
if ! git fetch origin 2>&1; then
    log_error "Failed to fetch from origin. Check your network connection."
    exit 1
fi
log_success "Fetch completed."

# Step 4: Checkout main
log_info "Checking out main branch..."
if ! git checkout main 2>&1; then
    log_error "Failed to checkout main branch."
    echo ""
    log_error "Resolve any branch conflicts and try again."
    exit 1
fi
log_success "Checked out main."

# Step 5: Pull with --ff-only
log_info "Pulling latest changes (fast-forward only)..."
if ! git pull --ff-only origin main 2>&1; then
    log_error "Fast-forward pull failed."
    echo ""
    log_error "Your local 'main' has diverged from 'origin/main'."
    echo ""
    log_error "Options:"
    echo "  1. Push your local main: git push origin main"
    echo "  2. Rebase your local main: git rebase origin/main"
    echo "  3. Reset your local main (WARNING: loses local commits): git reset --hard origin/main"
    echo ""

    # Show the divergence
    LOCAL_SHA=$(git rev-parse HEAD)
    REMOTE_SHA=$(git rev-parse origin/main)
    echo "Local main:  $LOCAL_SHA"
    echo "Origin main: $REMOTE_SHA"

    # Return to previous branch
    if [[ "$CURRENT_BRANCH" != "main" ]]; then
        log_info "Returning to previous branch: $CURRENT_BRANCH"
        git checkout "$CURRENT_BRANCH" 2>&1 || true
    fi

    exit 1
fi
log_success "Pull completed successfully."

# Step 6: Report update summary
echo ""
log_success "Main branch updated successfully!"
echo ""

LATEST_SHA=$(git rev-parse --short HEAD)
LATEST_MSG=$(git log -1 --pretty=%s)
echo "  Branch:  main"
echo "  Latest:  $LATEST_SHA — $LATEST_MSG"
echo ""

# Check if we're ahead of origin/main (shouldn't be after successful pull)
AHEAD_COUNT=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo "0")
if [[ "$AHEAD_COUNT" != "0" ]]; then
    echo "  Status:  $AHEAD_COUNT commit(s) behind origin/main"
else
    echo "  Status:  Up to date with origin/main"
fi
echo ""

# Step 7: Offer to return to previous branch
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    log_info "You were previously on branch: $CURRENT_BRANCH"
    echo ""
    log_info "Returning to previous branch..."
    if git checkout "$CURRENT_BRANCH" 2>&1; then
        log_success "Switched back to $CURRENT_BRANCH"
    else
        log_warn "Could not switch back to $CURRENT_BRANCH"
    fi
    echo ""

    log_info "Next steps:"
    echo "  - Create a new branch: git checkout -b feature/<description>"
    echo "  - View changes: git log origin/main..HEAD --oneline"
else
    log_info "Next steps:"
    echo "  - Create a new branch: git checkout -b feature/<description>"
    echo "  - View changes: git log --oneline -5"
fi
