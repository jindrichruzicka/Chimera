#!/usr/bin/env bash
# Integration test for check-and-merge.sh commit-structure validation.
#
# Constructs a throw-away git repo with a bare "origin" remote and exercises
# the script with --dry-run against branches of known shape. Asserts on the
# script's exit code and stderr/stdout output.
#
# Shape under test (the one that regressed):
#   main:      C0
#   branch:    C0 -- C1(body)  -- fixup!(C1)
#
# Expected: all checks pass. Previously the script walked commits
# newest-first and skipped the newest via `tail -n +2`, which validated the
# body commit as a "non-fixup! after the first" and aborted the merge.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT_UNDER_TEST="${SCRIPT_DIR}/../scripts/check-and-merge.sh"

if [[ ! -f "$SCRIPT_UNDER_TEST" ]]; then
    echo "FAIL: cannot find script under test at ${SCRIPT_UNDER_TEST}" >&2
    exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
pass() { echo -e "  ${GREEN}ok${RESET}     $*"; }
fail() { echo -e "  ${RED}FAIL${RESET}   $*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0

# ─── build a disposable repo with a bare "origin" ────────────────────────────
WORK=$(mktemp -d -t chimera-merge-test-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

cd "$WORK"
git init --bare origin.git --initial-branch=main >/dev/null

git init --initial-branch=main work >/dev/null
cd work
git config user.email "test@chimera.local"
git config user.name  "Chimera Test"
git remote add origin "$WORK/origin.git"

echo "seed" > README.md
git add README.md
git commit -m "chore: initial commit" >/dev/null
git push -u origin main >/dev/null 2>&1

# ─── Test 1: body + one fixup → checks must pass ─────────────────────────────
test_body_plus_fixup_passes() {
    git checkout -b feature/body-plus-fixup-1 >/dev/null 2>&1
    echo "a" > a.txt
    git add a.txt
    git commit -m "feat(x): add a" -m "Body describes why a was added." >/dev/null
    FIRST_SHA=$(git rev-parse HEAD)
    echo "a2" >> a.txt
    git add a.txt
    git commit --fixup "$FIRST_SHA" >/dev/null

    if bash "$SCRIPT_UNDER_TEST" --dry-run >/tmp/chimera-merge-out-1.log 2>&1; then
        pass "body + fixup branch passes checks (exit 0)"
    else
        fail "body + fixup branch wrongly rejected:"
        sed 's/^/       /' /tmp/chimera-merge-out-1.log >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/body-plus-fixup-1 >/dev/null 2>&1
}

# ─── Test 2: body + a real (non-fixup) second commit → must be rejected ──────
test_two_body_commits_rejected() {
    git checkout -b feature/two-real-commits-2 >/dev/null 2>&1
    echo "b" > b.txt
    git add b.txt
    git commit -m "feat(x): add b" -m "First body commit." >/dev/null
    echo "c" > c.txt
    git add c.txt
    git commit -m "feat(x): add c" -m "Second free-form commit (should be a fixup)." >/dev/null

    if bash "$SCRIPT_UNDER_TEST" --dry-run >/tmp/chimera-merge-out-2.log 2>&1; then
        fail "branch with two non-fixup commits wrongly accepted (should have aborted)"
    else
        if grep -q "are not fixup! commits" /tmp/chimera-merge-out-2.log; then
            pass "branch with two non-fixup commits rejected with correct message"
        else
            fail "branch rejected but error message did not mention fixup commits:"
            sed 's/^/       /' /tmp/chimera-merge-out-2.log >&2
        fi
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/two-real-commits-2 >/dev/null 2>&1
}

# ─── Test 3: body + fixup + fixup → still passes ─────────────────────────────
test_body_plus_two_fixups_passes() {
    git checkout -b feature/body-two-fixups-3 >/dev/null 2>&1
    echo "d" > d.txt
    git add d.txt
    git commit -m "feat(x): add d" -m "Body describes why d was added." >/dev/null
    FIRST_SHA=$(git rev-parse HEAD)
    echo "d2" >> d.txt
    git add d.txt
    git commit --fixup "$FIRST_SHA" >/dev/null
    echo "d3" >> d.txt
    git add d.txt
    git commit --fixup "$FIRST_SHA" >/dev/null

    if bash "$SCRIPT_UNDER_TEST" --dry-run >/tmp/chimera-merge-out-3.log 2>&1; then
        pass "body + two fixups branch passes checks (exit 0)"
    else
        fail "body + two fixups branch wrongly rejected:"
        sed 's/^/       /' /tmp/chimera-merge-out-3.log >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/body-two-fixups-3 >/dev/null 2>&1
}

echo "Running check-and-merge.sh commit-structure tests..."
test_body_plus_fixup_passes
test_two_body_commits_rejected
test_body_plus_two_fixups_passes

echo
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GREEN}All tests passed.${RESET}"
    exit 0
else
    echo -e "${RED}${FAILURES} test(s) failed.${RESET}" >&2
    exit 1
fi
