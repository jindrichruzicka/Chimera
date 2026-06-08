#!/usr/bin/env bash
# .github/skills/invariants/tests/check-invariants.test.sh
#
# Test suite for check-invariants.sh.
#
# Creates a minimal temp directory tree for each case, plants a violation (or
# a clean file), runs the script against the temp tree, and asserts the exit
# code and output.
#
# Run from anywhere:
#   bash .github/skills/invariants/tests/check-invariants.test.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SCRIPT_UNDER_TEST="${SCRIPT_DIR}/../scripts/check-invariants.sh"

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

# Run the script with REPO_ROOT overridden to a temp dir.
# Returns the exit code in $RUN_EXIT, stdout+stderr in $RUN_OUT.
run_in_dir() {
    local root="$1"
    RUN_OUT=$(bash "${SCRIPT_UNDER_TEST}" 2>&1) && RUN_EXIT=0 || RUN_EXIT=$?
    # The script uses `cd "${REPO_ROOT}"` resolved from its own path.
    # We need a different approach: run in a subshell with the temp dir as CWD
    # and a symlinked "scripts" directory — simpler to just patch via env.
    # Instead, we create a wrapper that temporarily re-targets the directories
    # searched by the script by symlinking them inside the temp dir.
    true
}

# Run the script from a temp root directory by creating a shallow wrapper.
run_from_root() {
    local root="$1"
    # Run in a subshell; cd to root then call the script with adjusted paths.
    (
        cd "${root}"
        # The script resolves REPO_ROOT as four levels up from scripts/.
        # Override by relaunching through a local copy that uses PWD.
        PATCHED=$(mktemp /tmp/check-invariants-patched-XXXXXX.sh)
        sed "s|REPO_ROOT=.*|REPO_ROOT=\"${root}\"|" "${SCRIPT_UNDER_TEST}" > "${PATCHED}"
        chmod +x "${PATCHED}"
        bash "${PATCHED}" 2>&1
        STATUS=$?
        rm -f "${PATCHED}"
        exit ${STATUS}
    )
}

# Create a minimal tree with a single TypeScript file in a given subdirectory.
# Usage: plant_file <root> <rel_path> <content>
plant_file() {
    local root="$1"
    local rel="$2"
    local content="$3"
    mkdir -p "${root}/$(dirname "${rel}")"
    printf '%s\n' "${content}" > "${root}/${rel}"
}

# ─── Test cases ───────────────────────────────────────────────────────────────

# Test 1: clean tree → exit 0
test_clean_tree_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Reducer.ts" \
        "export function reduce(state: unknown): unknown { return state; }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "clean tree exits 0"
    else
        fail "clean tree wrongly exits ${exit_code}:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 2: Math.random() in simulation/ → violation [invariant-2/43]
test_math_random_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Reducer.ts" \
        "export function reduce() { return Math.random(); }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-2/43\]'; then
            pass "Math.random() in simulation/ detected as [invariant-2/43]"
        else
            fail "Math.random() violation detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "Math.random() in simulation/ not detected (exit 0)"
    fi
}

# Test 3: Date.now() in ai/ → violation [invariant-2/43]
test_date_now_in_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/engine/Agent.ts" \
        "export function tick() { return Date.now(); }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-2/43\]'; then
            pass "Date.now() in ai/ detected as [invariant-2/43]"
        else
            fail "Date.now() violation detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "Date.now() in ai/ not detected (exit 0)"
    fi
}

# Test 4: import from renderer/ inside simulation/ → violation [invariant-1]
test_renderer_import_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Bad.ts" \
        "import { foo } from '../../renderer/hooks/useFoo';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "renderer/ import in simulation/ detected as [invariant-1]"
        else
            fail "renderer/ import violation detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "renderer/ import in simulation/ not detected (exit 0)"
    fi
}

# Test 5: import from games/ inside simulation/ → violation [invariant-47]
test_games_import_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Bad.ts" \
        "import { something } from '../../games/tictactoe/data';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "games/ import in simulation/ detected as [invariant-47]"
        else
            fail "games/ import violation detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "games/ import in simulation/ not detected (exit 0)"
    fi
}

# Test 6: GameSnapshot used in electron/preload/ → violation [invariant-3]
test_game_snapshot_in_preload_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "electron/preload/bad-api.ts" \
        "import type { GameSnapshot } from '../../simulation/engine/types';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-3\]'; then
            pass "GameSnapshot in electron/preload/ detected as [invariant-3]"
        else
            fail "GameSnapshot violation detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "GameSnapshot in electron/preload/ not detected (exit 0)"
    fi
}

# Test 7: comment-only mention of Math.random() → NOT flagged (no false positive)
test_comment_mention_not_flagged() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Reducer.ts" \
        "// Do not call Math.random() here — use ctx.rng() instead."$'\n'"export function reduce() { return 42; }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "comment-only mention of Math.random() not flagged (no false positive)"
    else
        fail "comment mention of Math.random() wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 8: string-literal mention in a *.test.ts title → NOT flagged
test_test_title_string_not_flagged() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Reducer.test.ts" \
        "it('flags Math.random() in bad fixture', () => { expect(true).toBe(true); });"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "test-title string in *.test.ts not flagged (no false positive)"
    else
        fail "test-title string in *.test.ts wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 9: ESLint fixture under __tests__/fixtures/ → NOT flagged
test_eslint_fixture_not_flagged() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/__tests__/fixtures/bad-random.fixture.ts" \
        "export function bad() { return Math.random(); }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "__tests__/fixtures/*.fixture.ts not flagged (no false positive)"
    else
        fail "__tests__/fixtures/*.fixture.ts wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 10: real violation in a production .ts file still flagged when a
#          *.test.ts file nearby contains the same string in a title
test_production_still_flagged_alongside_test_mention() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Reducer.test.ts" \
        "it('flags Math.random() in bad fixture', () => {});"
    plant_file "${tmp}" "simulation/engine/Reducer.ts" \
        "export function reduce() { return Math.random(); }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] && echo "${out}" | grep -q 'Reducer.ts.*Math.random'; then
        pass "production Math.random() still flagged when nearby test title mentions it"
    else
        fail "production Math.random() not flagged, or false-positive suppressed real hit:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 11: import from games/ inside GameShell.tsx → violation [invariant-48/80]
test_games_import_in_gameshell_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/components/shell/GameShell.tsx" \
        "import { TacticsBoard } from '../../../games/tactics/screens/Board';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-48/80\]'; then
            pass "games/ import in GameShell.tsx detected as [invariant-48/80]"
        else
            fail "GameShell games/ import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "games/ import in GameShell.tsx not detected (exit 0)"
    fi
}

# Test 12: clean GameShell.tsx (engine-internal import only) → NOT flagged
test_clean_gameshell_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/components/shell/GameShell.tsx" \
        "import { PerfHud } from './perf/PerfHud.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "clean GameShell.tsx (engine-internal import) not flagged"
    else
        fail "clean GameShell.tsx wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# ─── Run ──────────────────────────────────────────────────────────────────────

echo "Running check-invariants.sh test suite..."
test_clean_tree_passes
test_math_random_in_simulation_detected
test_date_now_in_ai_detected
test_renderer_import_in_simulation_detected
test_games_import_in_simulation_detected
test_game_snapshot_in_preload_detected
test_comment_mention_not_flagged
test_test_title_string_not_flagged
test_eslint_fixture_not_flagged
test_production_still_flagged_alongside_test_mention
test_games_import_in_gameshell_detected
test_clean_gameshell_passes

echo
if [[ ${FAILURES} -eq 0 ]]; then
    echo -e "${GREEN}All tests passed.${RESET}"
    exit 0
else
    echo -e "${RED}${FAILURES} test(s) failed.${RESET}" >&2
    exit 1
fi
