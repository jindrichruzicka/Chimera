#!/usr/bin/env bash
# Integration test for check-and-merge.sh: commit-structure validation and the
# pre-merge gate report.
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

# The fixture repo carries the five gate scripts the script runs, all green, so
# the pre-merge gate is exercised for real rather than failing for want of a
# package.json; the gate-failure case below overrides `test` on its own branch.
cat > package.json <<'PKG'
{ "name": "chimera-merge-fixture", "private": true, "scripts": { "format:check": "true", "lint": "true", "typecheck": "true", "test": "true", "verify:packaged-bundle": "true" } }
PKG
echo "seed" > README.md
git add README.md
git add package.json
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

    GATE_DIRS_BEFORE=$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name "chimera-merge-gate-*" 2>/dev/null | sort)
    if bash "$SCRIPT_UNDER_TEST" --dry-run >/tmp/chimera-merge-out-1.log 2>&1; then
        pass "body + fixup branch passes checks (exit 0)"
        # A green step's output is captured, not echoed: pnpm's own `> name script` banner must not leak.
        if grep -q "chimera-merge-fixture@" /tmp/chimera-merge-out-1.log; then
            fail "a passing gate step leaked its own output into the report"
        else
            pass "passing gate steps print no output of their own"
        fi
        GATE_DIRS_AFTER=$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name "chimera-merge-gate-*" 2>/dev/null | sort)
        if [[ "$GATE_DIRS_BEFORE" == "$GATE_DIRS_AFTER" ]]; then
            pass "gate log directory is removed after a green gate"
        else
            fail "a green gate left its log directory behind"
        fi
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

# ─── Test 4: a red gate step reports its own output, not just its label ──────
test_failing_gate_step_reports_its_output() {
    git checkout -b feature/gate-boom-4 >/dev/null 2>&1
    # Only `test` goes red; the other four stay green, so the report must name
    # exactly one step. The red step prints 80 numbered lines before GATE_BOOM
    # so the window the report shows can be measured against the captured log
    # from both sides of its edge.
    cat > package.json <<'PKG'
{ "name": "chimera-merge-fixture", "private": true, "scripts": { "format:check": "true", "lint": "true", "typecheck": "true", "test": "i=1; while [ $i -le 80 ]; do printf 'L%03d\\n' $i; i=$((i+1)); done; echo GATE_BOOM; echo GATE_ERR_MARK >&2; exit 1", "verify:packaged-bundle": "true" } }
PKG
    git add package.json
    git commit -m "feat(x): break the test script" -m "Body: the gate must name this step and show GATE_BOOM." >/dev/null

    if bash "$SCRIPT_UNDER_TEST" --dry-run >/tmp/chimera-merge-out-4.raw.log 2>&1; then
        fail "branch with a red gate step wrongly accepted (should have aborted)"
    else
        # The report is coloured; grep the plain text, or the reset code between
        # the glyph and the label hides `✗ pnpm test` from a literal match.
        sed "s/\x1b\[[0-9;]*m//g" /tmp/chimera-merge-out-4.raw.log > /tmp/chimera-merge-out-4.log
        if grep -q "✗ pnpm test" /tmp/chimera-merge-out-4.log; then
            pass "failing gate step is named"
        else
            fail "report does not name the failing step:"
            sed 's/^/       /' /tmp/chimera-merge-out-4.log >&2
        fi
        if [[ "$(grep -c '✗ ' /tmp/chimera-merge-out-4.log)" == "1" ]]; then
            pass "exactly one step is reported red"
        else
            fail "the report names more or fewer than one red step:"
            grep '✗ ' /tmp/chimera-merge-out-4.log | sed 's/^/       /' >&2
        fi
        if grep -q "GATE_BOOM" /tmp/chimera-merge-out-4.log; then
            pass "failing gate step's own output is in the report"
        else
            fail "report does not carry the failing step's output (GATE_BOOM):"
            sed 's/^/       /' /tmp/chimera-merge-out-4.log >&2
        fi
        # The path the operator is told to open: the per-step file, named after
        # the step, inside the gate's own directory — and it must still exist.
        GATE_LOG=$(sed -n 's/.*(full output: \(.*\))$/\1/p' /tmp/chimera-merge-out-4.log | head -1)
        if [[ "$GATE_LOG" == */chimera-merge-gate-*/pnpm_test.log && -f "$GATE_LOG" ]]; then
            pass "report names the step's log path, and the file is there"
        else
            fail "report carries no usable log path (got '${GATE_LOG}')"
        fi
        # Both streams belong in that file: pnpm passes a script's stderr through
        # to its own, and vitest prints its unhandled-error block — the
        # `[vitest-worker]: Timeout calling` line among it — there. Matched as a
        # whole line: pnpm echoes the script TEXT on stdout, and that banner
        # contains the marker too.
        if [[ -f "$GATE_LOG" ]] && grep -qx "GATE_ERR_MARK" "$GATE_LOG"; then
            pass "the step's stderr is in the captured file"
        else
            fail "the captured file does not carry the step's stderr (GATE_ERR_MARK)"
        fi
        # The window is what makes the report diagnose anything: a vitest FAIL
        # summary sits a few dozen lines from the end of its log. Pin it from
        # both sides of the edge, measured against the captured file itself so
        # pnpm's own banner and trailer lines cannot shift it.
        if [[ "$GATE_LOG" == */chimera-merge-gate-*/pnpm_test.log && -f "$GATE_LOG" ]]; then
            TOTAL=$(wc -l < "$GATE_LOG")
            INSIDE=$(sed -n "$((TOTAL - 59))p" "$GATE_LOG")
            OUTSIDE=$(sed -n "$((TOTAL - 60))p" "$GATE_LOG")
            if grep -qF -- "$INSIDE" /tmp/chimera-merge-out-4.log; then
                pass "the 60th line from the end of the step's log is in the report"
            else
                fail "the 60th line from the end ('${INSIDE}') is missing from the report"
            fi
            if grep -qF -- "$OUTSIDE" /tmp/chimera-merge-out-4.log; then
                fail "the 61st line from the end ('${OUTSIDE}') leaked into the report"
            else
                pass "the 61st line from the end of the step's log is not in the report"
            fi
            # The script keeps a red gate's directory so the printed path stays
            # valid; this test provoked it, so this test removes it.
            rm -rf "$(dirname "$GATE_LOG")"
        fi
        if grep -q "✗ pnpm lint" /tmp/chimera-merge-out-4.log; then
            fail "a green step (pnpm lint) was reported as failed"
        else
            pass "green steps are not reported"
        fi
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/gate-boom-4 >/dev/null 2>&1
}

# ─── Test 5: every gate step runs under the sleep assertion ───────────────────
test_gate_steps_run_under_the_sleep_assertion() {
    git checkout -b feature/awake-5 >/dev/null 2>&1
    echo "e" > e.txt
    git add e.txt
    git commit -m "feat(x): add e" -m "Body describes why e was added." >/dev/null

    # A fake `caffeinate` first on PATH: it appends its argv and runs the
    # command, so a step that bypassed the wrapper leaves no line behind.
    FAKEBIN="$WORK/fakebin"
    mkdir -p "$FAKEBIN"
    cat > "$FAKEBIN/caffeinate" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "$CHIMERA_FAKE_CAFFEINATE_LOG"
shift 2
exec "$@"
FAKE
    chmod +x "$FAKEBIN/caffeinate"
    : > "$WORK/caffeinate.log"

    if CHIMERA_FAKE_CAFFEINATE_LOG="$WORK/caffeinate.log" PATH="$FAKEBIN:$PATH" \
        bash "$SCRIPT_UNDER_TEST" --dry-run >/tmp/chimera-merge-out-5.log 2>&1; then
        pass "gate is green under the sleep assertion (exit 0)"
    else
        fail "gate under the sleep assertion wrongly failed:"
        sed 's/^/       /' /tmp/chimera-merge-out-5.log >&2
    fi
    if [[ "$(grep -c '^-dims -- pnpm ' "$WORK/caffeinate.log")" == "5" ]]; then
        pass "all five gate steps ran under caffeinate -dims"
    else
        fail "expected 5 caffeinate invocations, one per gate step; got:"
        sed 's/^/       /' "$WORK/caffeinate.log" >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/awake-5 >/dev/null 2>&1
}

# ─── Test 6: a copy of the skill with no wrapper beside it runs the steps directly ─
test_gate_without_a_wrapper_runs_the_steps_directly() {
    git checkout -b feature/no-wrapper-6 >/dev/null 2>&1
    echo "f" > f.txt
    git add f.txt
    git commit -m "feat(x): add f" -m "Body describes why f was added." >/dev/null

    # The script finds the wrapper five directories above its own; a copy nested
    # five deep inside $WORK looks for $WORK/nest/tools/with-awake.sh, which is
    # not there — the shape of a skill copied out of the repo.
    COPY_DIR="$WORK/nest/1/2/3/4/5"
    mkdir -p "$COPY_DIR"
    cp "$SCRIPT_UNDER_TEST" "$COPY_DIR/check-and-merge.sh"
    FAKEBIN="$WORK/fakebin"
    mkdir -p "$FAKEBIN"
    cat > "$FAKEBIN/caffeinate" <<'FAKE'
#!/bin/sh
printf '%s\n' "$*" >> "$CHIMERA_FAKE_CAFFEINATE_LOG"
shift 2
exec "$@"
FAKE
    chmod +x "$FAKEBIN/caffeinate"
    : > "$WORK/caffeinate-6.log"

    if CHIMERA_FAKE_CAFFEINATE_LOG="$WORK/caffeinate-6.log" PATH="$FAKEBIN:$PATH" \
        bash "$COPY_DIR/check-and-merge.sh" --dry-run >/tmp/chimera-merge-out-6.log 2>&1; then
        pass "gate is green from a copy with no wrapper beside it (exit 0)"
    else
        fail "gate from a copy with no wrapper wrongly failed:"
        sed 's/^/       /' /tmp/chimera-merge-out-6.log >&2
    fi
    if [[ ! -s "$WORK/caffeinate-6.log" ]]; then
        pass "no gate step went through caffeinate without the wrapper"
    else
        fail "a step reached caffeinate although no wrapper was there:"
        sed 's/^/       /' "$WORK/caffeinate-6.log" >&2
    fi

    git checkout main >/dev/null 2>&1
    git branch -D feature/no-wrapper-6 >/dev/null 2>&1
}

echo "Running check-and-merge.sh tests..."
test_body_plus_fixup_passes
test_two_body_commits_rejected
test_body_plus_two_fixups_passes
test_failing_gate_step_reports_its_output
test_gate_steps_run_under_the_sleep_assertion
test_gate_without_a_wrapper_runs_the_steps_directly

echo
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${GREEN}All tests passed.${RESET}"
    exit 0
else
    echo -e "${RED}${FAILURES} test(s) failed.${RESET}" >&2
    exit 1
fi
