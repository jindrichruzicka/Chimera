#!/usr/bin/env bash
#
# pull-latest.sh tests
#
# These tests validate the pull-latest script behavior.
# Run with: bash .github/skills/git/pull-latest/tests/test-pull-latest.sh
#

set -euo pipefail

TEST_DIR=$(mktemp -d)
REPO_DIR="$TEST_DIR/test-repo"
ORIGIN_DIR="$TEST_DIR/origin"
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
    rm -rf "$TEST_DIR"
}
trap cleanup EXIT

log_test() {
    echo "TEST: $1"
}

log_pass() {
    echo "  ✓ PASS: $1"
    ((PASS_COUNT++))
}

log_fail() {
    echo "  ✗ FAIL: $1"
    ((FAIL_COUNT++))
}

# Helper: Create a test repository
setup_test_repo() {
    log_test "Setting up test repository..."

    # Create bare origin repo
    git init --bare "$ORIGIN_DIR"

    # Create working repo
    git clone "$ORIGIN_DIR" "$REPO_DIR"
    cd "$REPO_DIR"

    # Configure git
    git config user.email "test@example.com"
    git config user.name "Test User"

    # Create initial commit on main
    echo "initial content" > file.txt
    git add file.txt
    git commit -m "Initial commit"
    git push -u origin main

    log_pass "Test repository created"
}

# Test 1: Clean pull on up-to-date repo
test_clean_pull() {
    log_test "Test: Clean pull on up-to-date repo"

    cd "$REPO_DIR"

    # Simulate remote update
    cd "$ORIGIN_DIR"
    # Note: Can't directly modify bare repo, so we'll test differently

    cd "$REPO_DIR"

    # Run the script
    if bash ../../../.github/skills/git/pull-latest/scripts/pull-latest.sh 2>&1 | grep -q "Main branch updated successfully"; then
        log_pass "Clean pull works"
    else
        log_fail "Clean pull failed"
    fi
}

# Test 2: Dirty working tree should fail
test_dirty_working_tree() {
    log_test "Test: Dirty working tree should fail"

    cd "$REPO_DIR"

    # Create uncommitted changes
    echo "dirty content" > dirty.txt

    # Run the script and expect failure
    if bash ../../../.github/skills/git/pull-latest/scripts/pull-latest.sh 2>&1 | grep -q "Working tree has uncommitted changes"; then
        log_pass "Dirty working tree correctly rejected"
    else
        log_fail "Dirty working tree should have been rejected"
    fi

    # Clean up
    git add dirty.txt
    git commit -m "Add dirty file"
}

# Test 3: Script should return to previous branch
test_return_to_branch() {
    log_test "Test: Return to previous branch"

    cd "$REPO_DIR"

    # Create a feature branch
    git checkout -b feature/test-branch
    echo "feature content" > feature.txt
    git add feature.txt
    git commit -m "Feature commit"

    # Run the script
    OUTPUT=$(bash ../../../.github/skills/git/pull-latest/scripts/pull-latest.sh 2>&1)

    # Check if it returned to the feature branch
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$CURRENT_BRANCH" == "feature/test-branch" ]]; then
        log_pass "Returned to previous branch"
    else
        log_fail "Did not return to previous branch (currently on: $CURRENT_BRANCH)"
    fi

    # Clean up
    git checkout main
    git branch -D feature/test-branch
}

# Test 4: Script should work when already on main
test_already_on_main() {
    log_test "Test: Already on main branch"

    cd "$REPO_DIR"
    git checkout main

    # Run the script
    if bash ../../../.github/skills/git/pull-latest/scripts/pull-latest.sh 2>&1 | grep -q "Main branch updated successfully"; then
        log_pass "Works when already on main"
    else
        log_fail "Failed when already on main"
    fi
}

# Run all tests
echo "=================================="
echo "Pull Latest Script Tests"
echo "=================================="
echo ""

setup_test_repo
echo ""
test_clean_pull
echo ""
test_dirty_working_tree
echo ""
test_return_to_branch
echo ""
test_already_on_main
echo ""
echo "=================================="
echo "Results: $PASS_COUNT passed, $FAIL_COUNT failed"
echo "=================================="

if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
fi
