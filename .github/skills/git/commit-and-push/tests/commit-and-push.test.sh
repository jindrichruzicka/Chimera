#!/usr/bin/env bash
# Integration tests for commit-and-push.sh
#
# Exercises the four scenarios:
#   1. Non-feature branch (main) → rejected
#   2. Feature branch, no prior commits → normal commit + push
#   3. Feature branch, prior commits exist → fixup commit + push
#   4. No staged changes → rejected

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT_UNDER_TEST="${SCRIPT_DIR}/../scripts/commit-and-push.sh"

if [[ ! -f "$SCRIPT_UNDER_TEST" ]]; then
    echo "FAIL: cannot find script under test at ${SCRIPT_UNDER_TEST}" >&2
    exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
pass() { echo -e "  ${GREEN}ok${RESET}     $*"; }
fail() { echo -e "  ${RED}FAIL${RESET}   $*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0

# ─── build a disposable repo with a bare "origin" ─────────────────────────────
WORK=$(mktemp -d -t chimera-cap-test-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

git init --bare "$WORK/origin.git" --initial-branch=main >/dev/null 2>&1

git init --initial-branch=main "$WORK/work" >/dev/null 2>&1
cd "$WORK/work"
git config user.email "test@chimera.local"
git config user.name  "Chimera Test"
git remote add origin "$WORK/origin.git"

echo "seed" > README.md
git add README.md
git commit -m "chore: initial commit" >/dev/null
git push -u origin main >/dev/null 2>&1

# ─── helpers ──────────────────────────────────────────────────────────────────
# Make a scratch change and stage it
stage_change() {
    local file="change-${RANDOM}.txt"
    echo "$RANDOM" > "$file"
    git add "$file"
}

# ─── Test 1: on main → rejected ───────────────────────────────────────────────
test_rejects_on_main() {
    stage_change

    if bash "$SCRIPT_UNDER_TEST" -m "feat: test" >/tmp/cap-out-1.log 2>&1; then
        fail "commit on main should have been rejected but was accepted"
        git reset HEAD --quiet  # tidy up staged file
    else
        if grep -qi "feature\|fix\|refactor\|feature branch\|not on a feature" /tmp/cap-out-1.log; then
            pass "rejects commit on main with branch-type message"
        else
            fail "rejected on main but error message unclear:"
            sed 's/^/       /' /tmp/cap-out-1.log >&2
        fi
        git reset HEAD --quiet  # tidy up staged file
    fi
}

# ─── Test 2: feature branch, no prior commits → normal commit + push ──────────
test_first_commit_on_feature_branch() {
    git checkout -b feature/first-commit-test-2 >/dev/null 2>&1
    stage_change

    if bash "$SCRIPT_UNDER_TEST" \
            -m "feat(x): add first file" \
            -m "Body: explains why." \
            >/tmp/cap-out-2.log 2>&1; then
        # Verify commit was created with the right subject
        SUBJECT=$(git log -1 --format="%s")
        BODY=$(git log -1 --format="%b" | sed '/^[[:space:]]*$/d')
        if [[ "$SUBJECT" == "feat(x): add first file" ]] && [[ -n "$BODY" ]]; then
            pass "first commit on feature branch uses provided message with body"
        else
            fail "commit created but subject/body wrong: '${SUBJECT}' / '${BODY}'"
        fi
        # Verify it was pushed to origin
        if git ls-remote --heads origin feature/first-commit-test-2 | grep -q .; then
            pass "branch was pushed to origin after first commit"
        else
            fail "branch was NOT pushed to origin after first commit"
        fi
    else
        fail "first commit on feature branch was unexpectedly rejected:"
        sed 's/^/       /' /tmp/cap-out-2.log >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/first-commit-test-2 >/dev/null 2>&1
    git push origin --delete feature/first-commit-test-2 >/dev/null 2>&1 || true
}

# ─── Test 3: feature branch, prior commits exist → fixup + push ───────────────
test_fixup_when_prior_commits_exist() {
    git checkout -b feature/fixup-test-3 >/dev/null 2>&1

    # Create the first (canonical) commit
    echo "a" > a.txt
    git add a.txt
    git commit -m "feat(x): canonical first commit" -m "Body: explains the canonical change." >/dev/null
    FIRST_SHA=$(git rev-parse HEAD)
    git push -u origin feature/fixup-test-3 >/dev/null 2>&1

    # Now stage another change and run the script
    stage_change

    if bash "$SCRIPT_UNDER_TEST" >/tmp/cap-out-3.log 2>&1; then
        SUBJECT=$(git log -1 --format="%s")
        if echo "$SUBJECT" | grep -q "^fixup!"; then
            pass "subsequent commit on feature branch is a fixup! commit"
        else
            fail "subsequent commit not a fixup!: '${SUBJECT}'"
        fi
        # Verify the fixup references the first commit
        if echo "$SUBJECT" | grep -q "$(git log -1 --format="%s" "$FIRST_SHA")"; then
            pass "fixup! commit references the first commit subject"
        else
            fail "fixup! subject does not reference first commit: '${SUBJECT}'"
        fi
        # Verify it was pushed
        REMOTE_COUNT=$(git ls-remote origin "refs/heads/feature/fixup-test-3" | wc -l | tr -d ' ')
        if [[ "$REMOTE_COUNT" -gt 0 ]]; then
            pass "fixup commit was pushed to origin"
        else
            fail "fixup commit was NOT pushed to origin"
        fi
    else
        fail "fixup commit on feature branch unexpectedly rejected:"
        sed 's/^/       /' /tmp/cap-out-3.log >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/fixup-test-3 >/dev/null 2>&1
    git push origin --delete feature/fixup-test-3 >/dev/null 2>&1 || true
}

# ─── Test 4: no staged changes → rejected ─────────────────────────────────────
test_rejects_when_nothing_staged() {
    git checkout -b feature/nothing-staged-4 >/dev/null 2>&1

    # Do NOT stage anything
    if bash "$SCRIPT_UNDER_TEST" -m "feat: empty" >/tmp/cap-out-4.log 2>&1; then
        fail "should have been rejected when nothing is staged"
    else
        if grep -qi "nothing\|staged\|no changes" /tmp/cap-out-4.log; then
            pass "rejects with informative message when nothing is staged"
        else
            pass "rejects when nothing is staged (exit non-zero)"
        fi
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/nothing-staged-4 >/dev/null 2>&1
}

# ─── Test 5: fix/* branch (not only feature/*) → accepted ─────────────────────
test_fix_branch_accepted() {
    git checkout -b fix/some-bug-5 >/dev/null 2>&1
    stage_change

    if bash "$SCRIPT_UNDER_TEST" \
            -m "fix(x): correct the bug" \
            -m "Body: root cause was missing guard." \
            >/tmp/cap-out-5.log 2>&1; then
        pass "fix/* branch is accepted for first commit"
    else
        fail "fix/* branch was wrongly rejected:"
        sed 's/^/       /' /tmp/cap-out-5.log >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D fix/some-bug-5 >/dev/null 2>&1
    git push origin --delete fix/some-bug-5 >/dev/null 2>&1 || true
}

echo "Running commit-and-push.sh tests..."
test_rejects_on_main
test_first_commit_on_feature_branch
test_fixup_when_prior_commits_exist
test_rejects_when_nothing_staged
test_fix_branch_accepted

echo
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GREEN}All tests passed.${RESET}"
    exit 0
else
    echo -e "${RED}${FAILURES} test(s) failed.${RESET}" >&2
    exit 1
fi
