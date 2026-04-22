#!/usr/bin/env bash
# .github/skills/git/create-branch/tests/create-branch.test.sh
#
# Test suite for create-branch.sh.
#
# Uses a disposable git repo and a mock `gh` command (via PATH override) to
# avoid real GitHub API calls. Each test covers a distinct scenario from the
# SKILL.md error table and acceptance criteria.
#
# Run from anywhere:
#   bash .github/skills/git/create-branch/tests/create-branch.test.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT_UNDER_TEST="${SCRIPT_DIR}/../scripts/create-branch.sh"

if [[ ! -f "${SCRIPT_UNDER_TEST}" ]]; then
    echo "FAIL: cannot find script under test at ${SCRIPT_UNDER_TEST}" >&2
    exit 1
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
RESET='\033[0m'

pass() { echo -e "  ${GREEN}ok${RESET}     $*"; }
fail() { echo -e "  ${RED}FAIL${RESET}   $*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Build a disposable git repo with a bare origin remote.
# Sets WORK and REPO_DIR globals.
make_repo() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    # shellcheck disable=SC2064
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1

    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md
    git add README.md
    git commit -m "chore: initial commit" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1

    REPO_DIR="${WORK}/repo"
}

# Create a mock `gh` binary in a temp bin dir and prepend it to PATH.
# Usage: mock_gh <json>   — the JSON returned by `gh issue view`
make_mock_gh() {
    local json="$1"
    local bin_dir="${WORK}/bin"
    mkdir -p "${bin_dir}"
    cat > "${bin_dir}/gh" <<GHEOF
#!/usr/bin/env bash
# Mock gh — returns pre-canned JSON for 'gh issue view'
if [[ "\${1:-}" == "issue" && "\${2:-}" == "view" ]]; then
    echo '${json}'
    exit 0
fi
# Pass everything else to the real gh if present
if command -v /usr/bin/gh >/dev/null 2>&1; then
    exec /usr/bin/gh "\$@"
fi
echo "mock gh: unhandled command \$*" >&2
exit 1
GHEOF
    chmod +x "${bin_dir}/gh"
    export PATH="${bin_dir}:${PATH}"
}

# Run the script from REPO_DIR with PATH containing the mock gh.
run_script() {
    local issue_num="$1"
    (
        cd "${REPO_DIR}"
        bash "${SCRIPT_UNDER_TEST}" "${issue_num}" 2>&1
    )
}

# ─── Test cases ───────────────────────────────────────────────────────────────

# Test 1: slug derivation — SKILL.md canonical example
test_slug_canonical_example() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1
    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":2,"title":"Implement `BrowserWindow` creation and app lifecycle","state":"OPEN","labels":[{"name":"task"}],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 2 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]] && echo "${out}" | grep -q "feature/implement-browserwindow-creation-and-app-lifecycle-2"; then
        pass "slug derivation: canonical SKILL.md example produces correct branch name"
    else
        fail "slug derivation: expected branch 'feature/implement-browserwindow-creation-and-app-lifecycle-2':"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 2: slug derivation — §X.Y suffix stripped
test_slug_strips_section_suffix() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1
    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":5,"title":"Add (§3.2) GameSnapshot typing","state":"OPEN","labels":[{"name":"task"}],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 5 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]] && echo "${out}" | grep -q "feature/add-gamesnapshot-typing-5"; then
        pass "slug derivation: (§X.Y) suffix stripped correctly"
    else
        fail "slug derivation: expected branch 'feature/add-gamesnapshot-typing-5':"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 3: bug label → fix/ prefix
test_bug_label_gets_fix_prefix() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1
    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":10,"title":"Fix crash on startup","state":"OPEN","labels":[{"name":"bug"}],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 10 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]] && echo "${out}" | grep -q "fix/fix-crash-on-startup-10"; then
        pass "bug label produces fix/ prefix"
    else
        fail "bug label: expected branch 'fix/fix-crash-on-startup-10':"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 4: closed issue → abort
test_closed_issue_aborts() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1
    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":7,"title":"Some closed task","state":"CLOSED","labels":[{"name":"task"}],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 7 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] && echo "${out}" | grep -qi "closed"; then
        pass "closed issue aborts with error message"
    else
        fail "closed issue: expected non-zero exit with 'closed' in output:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 5: feature-only label → abort
test_feature_only_label_aborts() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1
    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":8,"title":"Some feature","state":"OPEN","labels":[{"name":"feature"}],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 8 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] && echo "${out}" | grep -qi "feature"; then
        pass "feature-only label aborts with error message"
    else
        fail "feature-only label: expected non-zero exit:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 6: branch already exists locally → abort
test_branch_already_exists_aborts() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1

    # Pre-create the branch locally
    git checkout -b "feature/add-gamesnapshot-typing-5" >/dev/null 2>&1
    git checkout main >/dev/null 2>&1

    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":5,"title":"Add (§3.2) GameSnapshot typing","state":"OPEN","labels":[{"name":"task"}],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 5 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] && echo "${out}" | grep -qi "already exists"; then
        pass "branch already exists locally → aborts with clear message"
    else
        fail "branch-exists guard: expected non-zero exit with 'already exists':"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 7: no task/bug label (no label at all) → abort with 'no workable label'
test_no_workable_label_aborts() {
    WORK=$(mktemp -d -t chimera-cb-test-XXXXXX)
    trap "rm -rf '${WORK}'" RETURN

    git init --bare "${WORK}/origin.git" --initial-branch=main >/dev/null 2>&1
    git init --initial-branch=main "${WORK}/repo" >/dev/null 2>&1
    cd "${WORK}/repo"
    git config user.email "test@chimera.local"
    git config user.name  "Chimera Test"
    git remote add origin "${WORK}/origin.git"
    echo "seed" > README.md; git add README.md
    git commit -m "init" >/dev/null 2>&1
    git push -u origin main >/dev/null 2>&1
    REPO_DIR="${WORK}/repo"

    make_mock_gh '{"number":9,"title":"Unlabelled issue","state":"OPEN","labels":[],"milestone":null}'

    local out exit_code
    out=$(cd "${REPO_DIR}" && bash "${SCRIPT_UNDER_TEST}" 9 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] && echo "${out}" | grep -qi "workable label\|no workable"; then
        pass "no workable label → aborts with clear message"
    else
        fail "no-workable-label guard: expected non-zero exit with 'workable label':"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# ─── Run ──────────────────────────────────────────────────────────────────────

echo "Running create-branch.sh test suite..."
test_slug_canonical_example
test_slug_strips_section_suffix
test_bug_label_gets_fix_prefix
test_closed_issue_aborts
test_feature_only_label_aborts
test_branch_already_exists_aborts
test_no_workable_label_aborts

echo
if [[ ${FAILURES} -eq 0 ]]; then
    echo -e "${GREEN}All tests passed.${RESET}"
    exit 0
else
    echo -e "${RED}${FAILURES} test(s) failed.${RESET}" >&2
    exit 1
fi
