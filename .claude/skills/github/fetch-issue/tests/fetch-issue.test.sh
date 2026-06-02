#!/usr/bin/env bash
# .claude/skills/github/fetch-issue/tests/fetch-issue.test.sh
#
# Test suite for fetch-issue.sh.
#
# Uses a mock `gh` command via PATH override so tests do not call GitHub.
#
# Run from anywhere:
#   bash .claude/skills/github/fetch-issue/tests/fetch-issue.test.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT_UNDER_TEST="${SCRIPT_DIR}/../scripts/fetch-issue.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
RESET='\033[0m'

pass() { echo -e "  ${GREEN}ok${RESET}     $*"; }
fail() { echo -e "  ${RED}FAIL${RESET}   $*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0
WORK_ROOT=$(mktemp -d -t chimera-fetch-issue-test-XXXXXX)
ORIGINAL_PATH="${PATH}"
trap 'rm -rf "${WORK_ROOT}"' EXIT

make_mock_gh() {
    local mock_output="$1"
    local bin_dir="${WORK_ROOT}/bin"
    mkdir -p "${bin_dir}"
    export GH_MOCK_LOG="${WORK_ROOT}/gh.log"
    : > "${GH_MOCK_LOG}"
    export GH_MOCK_OUTPUT="${mock_output}"
    export PATH="${bin_dir}:${ORIGINAL_PATH}"

    cat > "${bin_dir}/gh" <<'GHEOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "issue" && "${2:-}" == "view" ]]; then
    issue_ref="${3:-}"
    repo_arg=""

    while [[ $# -gt 0 ]]; do
        if [[ "${1}" == "--repo" ]]; then
            repo_arg="${2:-}"
            shift 2
            continue
        fi
        shift
    done

    {
        echo "ref=${issue_ref}"
        echo "repo=${repo_arg}"
    } > "${GH_MOCK_LOG}"

    printf '%s\n' "${GH_MOCK_OUTPUT}"
    exit 0
fi

echo "mock gh: unhandled command $*" >&2
exit 1
GHEOF
    chmod +x "${bin_dir}/gh"
}

run_script() {
    local issue_ref="$1"
    bash "${SCRIPT_UNDER_TEST}" "${issue_ref}" 2>&1
}

test_number_ref_uses_default_repo() {
    make_mock_gh '#42 Planner fetch issue'

    local out exit_code
    out=$(run_script 42) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]] \
        && grep -q '^ref=42$' "${GH_MOCK_LOG}" \
        && grep -q '^repo=jindrichruzicka/Chimera$' "${GH_MOCK_LOG}" \
        && echo "${out}" | grep -q '#42 Planner fetch issue'; then
        pass "issue number uses the default Chimera repo"
    else
        fail "issue number should call gh issue view 42 with the default repo:"
        echo "${out}" | sed 's/^/       /' >&2
        sed 's/^/       gh: /' "${GH_MOCK_LOG}" >&2
    fi
}

test_url_ref_extracts_repo_and_number() {
    make_mock_gh '#77 External repo issue'

    local out exit_code
    out=$(run_script 'https://github.com/example/project/issues/77?focusedCommentId=1') && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]] \
        && grep -q '^ref=77$' "${GH_MOCK_LOG}" \
        && grep -q '^repo=example/project$' "${GH_MOCK_LOG}" \
        && echo "${out}" | grep -q '#77 External repo issue'; then
        pass "issue URL extracts repository and issue number"
    else
        fail "issue URL should call gh issue view 77 with the URL repository:"
        echo "${out}" | sed 's/^/       /' >&2
        sed 's/^/       gh: /' "${GH_MOCK_LOG}" >&2
    fi
}

test_invalid_ref_aborts_before_calling_gh() {
    make_mock_gh 'should not be printed'

    local out exit_code
    out=$(run_script 'not-an-issue') && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] \
        && echo "${out}" | grep -qi 'issue number or GitHub issue URL' \
        && [[ ! -s "${GH_MOCK_LOG}" ]]; then
        pass "invalid references abort before calling gh"
    else
        fail "invalid references should fail without invoking gh:"
        echo "${out}" | sed 's/^/       /' >&2
        sed 's/^/       gh: /' "${GH_MOCK_LOG}" >&2
    fi
}

echo "fetch-issue.sh tests"
test_number_ref_uses_default_repo
test_url_ref_extracts_repo_and_number
test_invalid_ref_aborts_before_calling_gh

if [[ ${FAILURES} -gt 0 ]]; then
    echo
    echo "${FAILURES} failure(s)" >&2
    exit 1
fi

echo
echo "All fetch-issue.sh tests passed."