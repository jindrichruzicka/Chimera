#!/usr/bin/env bash
# .claude/skills/invariants/tests/check-invariants.test.sh
#
# Test suite for check-invariants.sh.
#
# Creates a minimal temp directory tree for each case, plants a violation (or
# a clean file), runs the script against the temp tree, and asserts the exit
# code and output.
#
# Run from anywhere:
#   bash .claude/skills/invariants/tests/check-invariants.test.sh

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

# Test: @chimera-engine/ai import inside simulation/ → violation [invariant-1]
# simulation/ is the zero-dependency foundation leaf (it absorbed the former
# shared/ package, issue #758). Uses an `ai` back-edge so ONLY Check 13 fires —
# Check 2 is renderer-only and Check 4 filters engine-package specifiers.
test_engine_import_in_simulation_leaf_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/messages.ts" \
        "import type { PlayerAgent } from '@chimera-engine/ai/engine/PlayerAgent.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "@chimera-engine/ai import in simulation/ detected as [invariant-1]"
        else
            fail "simulation/ back-edge detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "@chimera-engine/ai import in simulation/ not detected (exit 0)"
    fi
}

# Test: @chimera-engine/simulation self-import inside simulation/ is NOT a back-edge → no
# violation. Confirms the leaf check omits the simulation package from the
# forbidden alternation.
test_simulation_self_import_not_flagged() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/game-screen-contract.ts" \
        "import type { GameContent } from '@chimera-engine/simulation/game-content-contract.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "@chimera-engine/simulation self-import in simulation/ not flagged"
    else
        fail "@chimera-engine/simulation self-import in simulation/ wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
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

# Test 11b: import from games/ inside InGameMenuHost.tsx → violation [invariant-48/80]
# Invariant #80 names InGameMenuHost alongside GameShell as a coupling surface.
test_games_import_in_ingamemenuhost_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/components/shell/InGameMenuHost.tsx" \
        "import { TacticsMenu } from '../../../games/tactics/screens/Menu';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-48/80\]'; then
            pass "games/ import in InGameMenuHost.tsx detected as [invariant-48/80]"
        else
            fail "InGameMenuHost games/ import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "games/ import in InGameMenuHost.tsx not detected (exit 0)"
    fi
}

# Test 12b: clean InGameMenuHost.tsx (engine-internal import only) → NOT flagged
test_clean_ingamemenuhost_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/components/shell/InGameMenuHost.tsx" \
        "import { Modal } from '../ui/Modal.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "clean InGameMenuHost.tsx (engine-internal import) not flagged"
    else
        fail "clean InGameMenuHost.tsx wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 13: CHIMERA_DEBUG in package.json → violation [invariant-27]
test_chimera_debug_in_package_json_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "package.json" \
        '{ "scripts": { "dev:debug": "cross-env CHIMERA_DEBUG=1 electron ." } }'

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\].*package.json'; then
            pass "CHIMERA_DEBUG in package.json detected as [invariant-27]"
        else
            fail "CHIMERA_DEBUG violation detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "CHIMERA_DEBUG in package.json not detected (exit 0)"
    fi
}

# Test 14: bracket-access CHIMERA_DEBUG read in simulation/foundation/constants.ts
#          → violation [invariant-27] (breaks define replacement)
test_bracket_access_chimera_debug_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = process.env['CHIMERA_DEBUG'] === '1' && process.env.NODE_ENV !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\].*CHIMERA_DEBUG'; then
            pass "bracket-access CHIMERA_DEBUG read detected as [invariant-27]"
        else
            fail "bracket-access CHIMERA_DEBUG detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "bracket-access CHIMERA_DEBUG read not detected (exit 0)"
    fi
}

# Test 15: bracket-access NODE_ENV read in simulation/foundation/constants.ts
#          → violation [invariant-27] (both reads must stay dot access)
test_bracket_access_node_env_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env['NODE_ENV'] !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\].*NODE_ENV'; then
            pass "bracket-access NODE_ENV read detected as [invariant-27]"
        else
            fail "bracket-access NODE_ENV detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "bracket-access NODE_ENV read not detected (exit 0)"
    fi
}

# Test 16: clean package.json + spec-shaped simulation/foundation/constants.ts → exit 0
test_clean_debug_mode_shape_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "package.json" \
        '{ "scripts": { "dev": "electron ." } }'
    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "clean package.json and dot-access IS_DEBUG_MODE not flagged"
    else
        fail "clean debug-mode shape wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 16a: repo marker present but the constants file is missing → flagged
#           [invariant-27]. This is the ANTI-ROT probe: without it, a wrong
#           CONSTANTS path makes Check 9 skip SILENTLY on every real run. The
#           probe anchors on a marker the check does not own so that a
#           whole-DIRECTORY rename cannot hide the file.
test_missing_constants_file_in_real_repo_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "package.json" \
        '{ "scripts": { "dev": "electron ." } }'
    # The marker says "this is the real repo" — but the constant is nowhere.
    plant_file "${tmp}" "pnpm-workspace.yaml" "packages:\n  - 'apps/*'"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    # Anchored on the FILE NAME, not a bare `invariant-27`: several checks emit
    # that number (the packaging-config scan, the REPO_MARKER anti-rot probe), so
    # a bare match would let this single-cause probe pass for a different
    # violation entirely.
    if [[ ${exit_code} -ne 0 ]] && grep -q '\[invariant-27\].*constants\.ts.*missing' <<<"${out}"; then
        pass "missing constants file in a real repo root flagged as [invariant-27]"
    else
        fail "anti-rot probe did not fire for a missing constants file:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 16b: no repo marker (a bare fixture root) → probe stays INERT, so the
#           harness's own single-file temp roots do not trip it.
test_missing_constants_file_without_repo_marker_inert() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "package.json" \
        '{ "scripts": { "dev": "electron ." } }'

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "anti-rot probe stays inert in a bare fixture root"
    else
        fail "anti-rot probe wrongly fired without a repo marker:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 16c/16d: the REPO_MARKER anti-rot probe itself.
#
# Every repo-only rule in this script is armed by `pnpm-workspace.yaml`. Rename
# it and they ALL fall silently inert — the exact failure that left Check 9 dead
# code for months. The probe turns that into a violation, and these two fixtures
# are the only thing that exercises it: without them the backstop is as
# unreachable as the rule it protects, which was the original defect.
#
# The skills directory is planted because the probe only arms in a root shaped
# like this repo: `package.json` plus `.claude/skills/invariants`. Each mirror
# names only its OWN surface, so this file stays a pure `.claude`→`.github`
# substitution of its twin.
plant_repo_shaped_root() {
    local root="$1"
    plant_file "${root}" "package.json" '{ "scripts": { "dev": "electron ." } }'
    plant_file "${root}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"
    mkdir -p "${root}/.claude/skills/invariants"
}

# Test 16c: repo-shaped root with the marker RENAMED → probe fires.
test_missing_repo_marker_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_repo_shaped_root "${tmp}"
    # The rename that would silently disarm every marker-gated rule.
    plant_file "${tmp}" "pnpm-workspace.yml" "packages:\n  - 'apps/*'"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]] && grep -q '\[invariant-27\].*pnpm-workspace\.yaml.*missing' <<<"${out}"; then
        pass "renamed repo marker detected as [invariant-27]"
    else
        fail "repo-marker anti-rot probe did not fire:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 16d: the same root WITH the marker → silent. Without this the probe could
#           be satisfied by firing unconditionally.
test_present_repo_marker_inert() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_repo_shaped_root "${tmp}"
    plant_file "${tmp}" "pnpm-workspace.yaml" "packages:\n  - 'apps/*'"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "repo-marker probe stays silent when the marker is present"
    else
        fail "repo-marker probe fired with the marker present:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 17: dot-access literals surviving only in a comment while the real
#          initializer regressed to bracket access → still flagged
#          [invariant-27] (check must anchor to the assignment, not the file)
test_comment_masked_bracket_access_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "// Spec shape: process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production'"$'\n'"export const IS_DEBUG_MODE = process.env['CHIMERA_DEBUG'] === '1' && process.env['NODE_ENV'] !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\]'; then
            pass "comment-masked bracket-access initializer detected as [invariant-27]"
        else
            fail "comment-masked bracket access detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "comment-masked bracket-access initializer not detected (exit 0)"
    fi
}

# Test 18: simulation/foundation/constants.ts exists but the IS_DEBUG_MODE assignment was
#          removed/renamed → flagged [invariant-27] (shape can't be verified)
test_missing_is_debug_mode_assignment_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const DEBUG_CHANNEL = 'chimera:debug';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\].*IS_DEBUG_MODE'; then
            pass "missing IS_DEBUG_MODE assignment detected as [invariant-27]"
        else
            fail "missing assignment detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "missing IS_DEBUG_MODE assignment not detected (exit 0)"
    fi
}

# Test 19: real-file layout — docblock above a multi-line dot-access
#          assignment → NOT flagged (anchored extraction spans the full
#          statement and ignores surrounding comments)
test_multiline_spec_shape_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "/**"$'\n'" * Invariant #27: production asserts IS_DEBUG_MODE === false at startup."$'\n'" */"$'\n'"export const IS_DEBUG_MODE ="$'\n'"    process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "multi-line dot-access IS_DEBUG_MODE with docblock not flagged"
    else
        fail "multi-line spec shape wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 20: dot-access literals surviving only in a /* */ block comment while
#          the real initializer regressed to bracket access → still flagged
#          [invariant-27] (block comments must not anchor the extraction)
test_block_comment_masked_bracket_access_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "/**"$'\n'" * Spec shape: export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"$'\n'" */"$'\n'"export const IS_DEBUG_MODE = process.env['CHIMERA_DEBUG'] === '1' && process.env['NODE_ENV'] !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\]'; then
            pass "block-comment-masked bracket-access initializer detected as [invariant-27]"
        else
            fail "block-comment-masked bracket access detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "block-comment-masked bracket-access initializer not detected (exit 0)"
    fi
}

# Test 21: /* */ block comment citing the full spec shape above a clean
#          dot-access assignment → NOT flagged (stripping block comments must
#          not break the real-assignment extraction)
test_block_comment_spec_citation_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "/**"$'\n'" * Spec shape: export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"$'\n'" */"$'\n'"export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "block-comment spec citation above clean assignment not flagged"
    else
        fail "block-comment spec citation wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 22: dot-access literals surviving only in a trailing // comment while
#          the real initializer regressed → still flagged [invariant-27]
#          (a trailing comment on the assignment line must not mask it)
test_trailing_comment_masked_regression_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = true; // spec: process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production'"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\]'; then
            pass "trailing-comment-masked regressed initializer detected as [invariant-27]"
        else
            fail "trailing-comment-masked regression detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "trailing-comment-masked regressed initializer not detected (exit 0)"
    fi
}

# Test 23: trailing // comment on a clean dot-access assignment → NOT flagged
#          (comment stripping must not break the real-assignment extraction)
test_trailing_comment_on_clean_assignment_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production'; // baked at build time"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "trailing comment on clean dot-access assignment not flagged"
    else
        fail "trailing comment on clean assignment wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 24: CHIMERA_DEBUG in a nested packaging config (e.g. build/electron-builder.yml)
#          → violation [invariant-27] (scan must recurse beyond the repo root)
test_chimera_debug_in_nested_packaging_config_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "build/electron-builder.yml" \
        'extraMetadata:'$'\n''  env:'$'\n''    CHIMERA_DEBUG: "1"'

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-27\].*build/electron-builder.yml'; then
            pass "CHIMERA_DEBUG in nested packaging config detected as [invariant-27]"
        else
            fail "nested packaging config violation detected but invariant number/path missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "CHIMERA_DEBUG in nested packaging config not detected (exit 0)"
    fi
}

# Test 25: CHIMERA_DEBUG in node_modules/*/package.json → NOT flagged
#          (third-party packages are outside the packaging-config invariant;
#          guards the recursive scan against over-flagging)
test_chimera_debug_in_node_modules_not_flagged() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "node_modules/some-dep/package.json" \
        '{ "scripts": { "weird": "CHIMERA_DEBUG=1 node ./bin.js" } }'

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "CHIMERA_DEBUG in node_modules/ package.json not flagged (no false positive)"
    else
        fail "CHIMERA_DEBUG in node_modules/ wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 26: clean dot-access assignment containing a string literal with `//`
#          (a URL) before the pinned reads → NOT flagged (the line-comment
#          stripper must not truncate inside string literals)
test_url_string_in_assignment_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const IS_DEBUG_MODE = process.env.UPDATE_URL !== 'https://updates.chimera.dev' && process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "URL string literal inside the assignment not flagged (no false positive)"
    else
        fail "URL string literal inside the assignment wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 27: string literal containing `/*` (a glob) on a line before a clean
#          dot-access assignment → NOT flagged (the block-comment stripper
#          must not open a comment inside a string literal and swallow the
#          rest of the file)
test_glob_string_before_assignment_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/foundation/constants.ts" \
        "export const SAVE_GLOB = 'saves/*.json';"$'\n'"export const IS_DEBUG_MODE = process.env.CHIMERA_DEBUG === '1' && process.env.NODE_ENV !== 'production';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "glob string literal before the assignment not flagged (no false positive)"
    else
        fail "glob string literal before the assignment wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# ─── Checks 11 & 12: @chimera-engine/ai boundary (invariants 106 / 107, issue #765) ───

# Test 28: import from games/ inside ai/ → violation [invariant-47]
# The import-direction half of invariant #106 is enforced by Check 4 (#47):
# ai/ must not import from games/*.
test_games_import_in_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/engine/Bad.ts" \
        "import { something } from 'games/tactics/data.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "games/ import in ai/ detected as [invariant-47]"
        else
            fail "ai/ games/ import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "games/ import in ai/ not detected (exit 0)"
    fi
}

# Test 29: a game-named subtree under ai/ → violation [invariant-106]
# The pure AI framework must contain no game-specific subtree (e.g. a
# re-introduced policies/<game>/). Benign body isolates the containment check.
test_game_subtree_under_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/policies/tactics/policy.ts" \
        "export const noop = 1;"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-106\]'; then
            pass "game-named subtree under ai/ detected as [invariant-106]"
        else
            fail "ai/ subtree detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "game-named subtree under ai/ not detected (exit 0)"
    fi
}

# Test 30: a stray top-level source file under ai/ → violation [invariant-106]
# The only allowed top-level source file is index.ts; a game policy dropped at
# ai/ top level (e.g. tacticsPolicy.ts) must be flagged.
test_stray_top_level_file_under_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/tacticsPolicy.ts" \
        "export const noop = 1;"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-106\]'; then
            pass "stray top-level file under ai/ detected as [invariant-106]"
        else
            fail "ai/ top-level file detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "stray top-level file under ai/ not detected (exit 0)"
    fi
}

# Test 31: ai/ index.ts barrel at top level → NOT flagged (allowed member)
test_ai_index_barrel_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/index.ts" \
        "export type { PlayerAgent } from './engine/PlayerAgent.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "ai/index.ts barrel not flagged (allowed top-level member)"
    else
        fail "ai/index.ts barrel wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 32: a <GAME>_ constant defined in ai/ → violation [invariant-107]
test_game_constant_token_in_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/engine/Leak.ts" \
        "export const TACTICS_MAX_STAMINA = 3;"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-107\]'; then
            pass "TACTICS_ constant in ai/ detected as [invariant-107]"
        else
            fail "ai/ game constant detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "TACTICS_ constant in ai/ not detected (exit 0)"
    fi
}

# Test 33: a 'tactics:' action namespace defined in ai/ → violation [invariant-107]
test_game_namespace_token_in_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/engine/Leak.ts" \
        "export const ACTION = 'tactics:move_unit';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-107\]'; then
            pass "'tactics:' namespace in ai/ detected as [invariant-107]"
        else
            fail "ai/ game namespace detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "'tactics:' namespace in ai/ not detected (exit 0)"
    fi
}

# Test 34: a non-tactics game namespace ('cards:') in ai/ → violation [invariant-107]
# Proves the no-game-token check is not hardcoded to tactics — any per-game
# action-string namespace (except the reserved engine:) is forbidden.
test_generic_game_namespace_in_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/engine/Leak.ts" \
        "export const ACTION = 'cards:play_card';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-107\]'; then
            pass "non-tactics game namespace in ai/ detected as [invariant-107]"
        else
            fail "ai/ generic game namespace detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "non-tactics game namespace in ai/ not detected (exit 0)"
    fi
}

# Test 35: the reserved engine: namespace in ai/ → NOT flagged (allowed cut)
# Invariant #11: engine: is the only namespace that may cross the package cut.
test_engine_namespace_in_ai_allowed() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "ai/engine/Ok.ts" \
        "export const ACTION = 'engine:end_turn';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "reserved engine: namespace in ai/ not flagged (allowed cut)"
    else
        fail "reserved engine: namespace in ai/ wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# ─── Networking package (F60, issue #768) ──────────────────────────────────────

# Test 36: import from renderer/ inside networking/ → violation [invariant-1]
# networking/ depends on @chimera-engine/simulation only (+ ws); it must not reach the
# UI layer.
test_renderer_import_in_networking_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "networking/provider/Bad.ts" \
        "import { foo } from '@chimera-engine/renderer/components/ui/Button.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "renderer/ import in networking/ detected as [invariant-1]"
        else
            fail "renderer/ import in networking/ detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "renderer/ import in networking/ not detected (exit 0)"
    fi
}

# Test 37: import from games/ inside networking/ → violation [invariant-47]
test_games_import_in_networking_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "networking/provider/Bad.ts" \
        "import { something } from '../../games/tictactoe/data';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "games/ import in networking/ detected as [invariant-47]"
        else
            fail "games/ import in networking/ detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "games/ import in networking/ not detected (exit 0)"
    fi
}

# Test 38: a non-provider top-level dir under networking/ → violation [invariant-47]
# Only provider/, __tests__/, dist/ are allowed immediate children; concrete
# providers stay internal under provider/ (Check 14).
test_non_provider_dir_under_networking_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "networking/discovery/scan.ts" \
        "export const noop = 1;"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "non-provider dir under networking/ detected as [invariant-47]"
        else
            fail "networking/ dir detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "non-provider dir under networking/ not detected (exit 0)"
    fi
}

# Test 39: a stray top-level source file under networking/ → violation [invariant-47]
# The only allowed top-level source file is index.ts (the curated barrel).
test_stray_top_level_file_under_networking_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "networking/SteamProvider.ts" \
        "export const noop = 1;"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "stray top-level file under networking/ detected as [invariant-47]"
        else
            fail "networking/ top-level file detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "stray top-level file under networking/ not detected (exit 0)"
    fi
}

# Test 40: networking/index.ts barrel at top level → NOT flagged (allowed member)
test_networking_index_barrel_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "networking/index.ts" \
        "export type { MultiplayerProvider } from './provider/MultiplayerProvider.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "networking/index.ts barrel not flagged (allowed top-level member)"
    else
        fail "networking/index.ts barrel wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 41: a clean networking/provider/ file → NOT flagged (provider/ allowed)
test_networking_provider_dir_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "networking/provider/MultiplayerProvider.ts" \
        "export type HostTransport = { send(): void };"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "networking/provider/ file not flagged (allowed member)"
    else
        fail "networking/provider/ file wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 42: orchestration import of a provider/local internal → violation [invariant-47]
# electron/main orchestration must use the @chimera-engine/networking barrel interfaces
# only; reaching into provider/local/* is provider-internal containment (Check 15).
test_provider_local_import_in_orchestration_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "electron/main/lobby/LobbyManager.ts" \
        "import { LocalWebSocketProvider } from '@chimera-engine/networking/provider/local/LocalWebSocketProvider.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "provider/local import in orchestration detected as [invariant-47]"
        else
            fail "provider/local import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "provider/local import in orchestration not detected (exit 0)"
    fi
}

# Test 43: orchestration import of a provider/steam internal → violation [invariant-47]
test_provider_steam_import_in_orchestration_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "electron/main/runtime/StateBroadcaster.ts" \
        "import { SteamNetworkProvider } from '@chimera-engine/networking/provider/steam/SteamNetworkProvider.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-47\]'; then
            pass "provider/steam import in orchestration detected as [invariant-47]"
        else
            fail "provider/steam import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "provider/steam import in orchestration not detected (exit 0)"
    fi
}

# Test 44: composition root electron/main/index.ts importing provider/local → NOT flagged
# index.ts is the sole DI-wiring point permitted to name the concrete provider (Invariant #38).
test_composition_root_provider_import_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "electron/main/index.ts" \
        "import { LocalWebSocketProvider } from '@chimera-engine/networking/provider/local/LocalWebSocketProvider.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "composition root provider import not flagged (allowlisted, Invariant #38)"
    else
        fail "composition root provider import wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 45: orchestration import of the @chimera-engine/networking barrel → NOT flagged (sanctioned)
test_barrel_import_in_orchestration_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "electron/main/lobby/LobbyManager.ts" \
        "import { JoinRejectedError } from '@chimera-engine/networking';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "barrel import in orchestration not flagged (sanctioned public surface)"
    else
        fail "barrel import in orchestration wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 46: engine shell page importing a games/* module → violation [invariant-94]
test_games_import_in_shell_page_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/app/settings/page.tsx" \
        "import { tacticsSettings } from 'games/tactics/settings-schema';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-94\]'; then
            pass "games/ import in a shell page detected as [invariant-94]"
        else
            fail "shell-page games/ import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "games/ import in a shell page not detected (exit 0)"
    fi
}

# Test 47: shell page importing a @chimera-engine/<game> package → violation [invariant-94]
# The post-F57 specifier form carries no `/games/` substring; detection is by the
# engine-package allowlist (a non-engine @chimera-engine/* package is a game).
test_game_package_import_in_shell_page_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/app/main-menu/page.tsx" \
        "import { Registry } from '@chimera-engine/tactics/screens/index.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-94\]'; then
            pass "@chimera-engine/<game> import in a shell page detected as [invariant-94]"
        else
            fail "shell-page @chimera-engine/<game> import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "@chimera-engine/<game> import in a shell page not detected (exit 0)"
    fi
}

# Test 48: clean shell page (engine @chimera-engine/* import only) → NOT flagged
test_clean_shell_page_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/app/lobby/page.tsx" \
        "import { parseLobbyConfig } from '@chimera-engine/simulation/foundation/lobby-config.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "clean shell page (engine import) not flagged"
    else
        fail "clean shell page wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test 49: game surface importing a renderer internal (store) → violation [invariant-96]
test_renderer_internal_in_game_surface_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/screens/TacticsDebugPanel.tsx" \
        "import { useGameStore } from '@chimera-engine/renderer/state/gameStore.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-96\]'; then
            pass "renderer internal in a game surface detected as [invariant-96]"
        else
            fail "game-surface renderer-internal import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "renderer internal in a game surface not detected (exit 0)"
    fi
}

# Test 50: game surface deep-importing behind the ui barrel → violation [invariant-96]
# A deep component-file path is a renderer internal; only the barrel is public.
test_renderer_deep_ui_in_game_surface_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/shell/TacticsShellBackground.tsx" \
        "import { Button } from '@chimera-engine/renderer/components/ui/Button.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-96\]'; then
            pass "deep ui import in a game surface detected as [invariant-96]"
        else
            fail "game-surface deep-ui import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "deep ui import in a game surface not detected (exit 0)"
    fi
}

# Test 51: game surface importing only the public ui/chat barrels → NOT flagged
test_clean_game_surface_passes() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/screens/TacticsGameHud.tsx" \
        "import { Button } from '@chimera-engine/renderer/components/ui';"
    plant_file "${tmp}" "apps/tactics/shell/TacticsShellChat.tsx" \
        "import { ChatPanel } from '@chimera-engine/renderer/components/chat/index.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "clean game surface (public ui/chat barrels) not flagged"
    else
        fail "clean game surface wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# ─── Relocated per-game gameplay code (apps/<game>/, F63) ───────────────────────
# The per-game gameplay dirs apps/<game>/{simulation,ai} carry the same
# determinism/boundary invariants as the engine simulation/ ai/ packages, and the
# renderer surfaces apps/<game>/{screens,shell,scene,renderer} carry the
# GameSnapshot-containment and public-barrel invariants. These fixtures prove the
# checks bind on the relocated dirs, not just the engine packages.

# Test: Math.random() in apps/<game>/simulation/ → violation [invariant-2/43]
test_math_random_in_app_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/simulation/Reducer.ts" \
        "export function reduce() { return Math.random(); }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-2/43\]'; then
            pass "Math.random() in apps/<game>/simulation/ detected as [invariant-2/43]"
        else
            fail "apps/<game>/simulation Math.random() detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "Math.random() in apps/<game>/simulation/ not detected (exit 0)"
    fi
}

# Test: Date.now() in apps/<game>/ai/ → violation [invariant-2/43]
test_date_now_in_app_ai_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/ai/Agent.ts" \
        "export function tick() { return Date.now(); }"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-2/43\]'; then
            pass "Date.now() in apps/<game>/ai/ detected as [invariant-2/43]"
        else
            fail "apps/<game>/ai Date.now() detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "Date.now() in apps/<game>/ai/ not detected (exit 0)"
    fi
}

# Test: import from renderer/ inside apps/<game>/simulation/ → violation [invariant-1]
test_renderer_import_in_app_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/simulation/Bad.ts" \
        "import { foo } from '../../../renderer/hooks/useFoo';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "renderer/ import in apps/<game>/simulation/ detected as [invariant-1]"
        else
            fail "apps/<game>/simulation renderer import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "renderer/ import in apps/<game>/simulation/ not detected (exit 0)"
    fi
}

# Test: bare @chimera-engine/renderer specifier (no subpath) in simulation/ → violation
# [invariant-1]. The tightened Check 2 pattern catches the package root, which a
# `.*renderer/` path pattern would miss.
test_bare_renderer_specifier_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Bad.ts" \
        "import { foo } from '@chimera-engine/renderer';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "bare @chimera-engine/renderer specifier in simulation/ detected as [invariant-1]"
        else
            fail "bare renderer specifier detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "bare @chimera-engine/renderer specifier in simulation/ not detected (exit 0)"
    fi
}

# Test: import from electron/ inside simulation/ → violation [invariant-1]
# (Check 3 had no test before this.)
test_electron_import_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Bad.ts" \
        "import { app } from '../../electron/main/index';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "electron/ import in simulation/ detected as [invariant-1]"
        else
            fail "simulation electron import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "electron/ import in simulation/ not detected (exit 0)"
    fi
}

# Test: import from electron/ inside apps/<game>/simulation/ → violation [invariant-1]
test_electron_import_in_app_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/simulation/Bad.ts" \
        "import { app } from '../../../electron/main/index';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "electron/ import in apps/<game>/simulation/ detected as [invariant-1]"
        else
            fail "apps/<game>/simulation electron import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "electron/ import in apps/<game>/simulation/ not detected (exit 0)"
    fi
}

# Test: bare @chimera-engine/electron specifier (no subpath) in simulation/ → violation
# [invariant-1] (tightened Check 3 pattern).
test_bare_electron_specifier_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Bad.ts" \
        "import type { AppApi } from '@chimera-engine/electron';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-1\]'; then
            pass "bare @chimera-engine/electron specifier in simulation/ detected as [invariant-1]"
        else
            fail "bare electron specifier detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "bare @chimera-engine/electron specifier in simulation/ not detected (exit 0)"
    fi
}

# Test: GameSnapshot referenced in apps/<game>/screens/ → violation [invariant-3]
# Renderer-process game surfaces must not name the main-process-only snapshot type.
test_game_snapshot_in_app_screen_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/screens/TacticsBad.tsx" \
        "import type { GameSnapshot } from '../simulation/types';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-3\]'; then
            pass "GameSnapshot in apps/<game>/screens/ detected as [invariant-3]"
        else
            fail "apps/<game>/screens GameSnapshot detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "GameSnapshot in apps/<game>/screens/ not detected (exit 0)"
    fi
}

# Test: a game import under renderer/app/logo-screen/ → violation [invariant-94]
# The old hardcoded SHELL_PAGE_DIRS array missed logo-screen; the renderer/app/*/
# glob covers every page dir, including ones added after the check was written.
test_games_import_in_globbed_shell_page_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "renderer/app/logo-screen/page.tsx" \
        "import { tacticsLogo } from '@chimera-engine/tactics/screens/index.js';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-94\]'; then
            pass "game import under renderer/app/logo-screen/ detected as [invariant-94]"
        else
            fail "globbed shell-page game import detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "game import under renderer/app/logo-screen/ not detected (exit 0)"
    fi
}

# Test: game surface importing the r3f, i18n, and game public barrels → NOT flagged
# ui/chat/r3f (under components/) plus the TOP-LEVEL i18n runtime and the game-
# registration seam @chimera-engine/renderer/game are the five public surfaces that
# chimera/no-game-renderer-internals sanctions; Check 17's allowlist mirrors them.
# The game-seam fixture sits in a scanned surface dir on purpose, so it exercises
# the RENDERER_BARREL_RE allowlist rather than an unscanned dir.
test_r3f_i18n_game_barrels_in_game_surface_pass() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/screens/TacticsScene.tsx" \
        "import { PerfProbe } from '@chimera-engine/renderer/components/r3f';"
    plant_file "${tmp}" "apps/tactics/shell/TacticsShellHud.tsx" \
        "import { useTranslate } from '@chimera-engine/renderer/i18n';"
    plant_file "${tmp}" "apps/tactics/shell/TacticsGameSeam.tsx" \
        "import { registerRendererGame } from '@chimera-engine/renderer/game';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "r3f + i18n + game public barrels in a game surface not flagged"
    else
        fail "r3f/i18n/game public barrels in a game surface wrongly flagged:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test: generated build output under a scanned dir is NOT scanned → no violation
# apps/<game>/renderer/ carries gitignored Next output (out/, .next/); check_grep
# prunes out/.next/dist so a stray forbidden string in an emitted bundle cannot
# raise a false positive pointing at generated code.
test_build_output_dir_not_scanned() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/renderer/out/bundle.js" \
        "const leaked = 'GameSnapshot';"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -eq 0 ]]; then
        pass "generated build output (out/) not scanned (no false positive)"
    else
        fail "generated build output (out/) wrongly scanned:"
        echo "${out}" | sed 's/^/       /' >&2
    fi
}

# Test: i18n runtime symbol referenced in simulation/ → violation [invariant-110]
# useTranslate is a renderer-only runtime symbol; the simulation layer must not name
# it. (Check 18 had no test before this.)
test_i18n_runtime_in_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "simulation/engine/Bad.ts" \
        "export const label = useTranslate();"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-110\]'; then
            pass "useTranslate in simulation/ detected as [invariant-110]"
        else
            fail "simulation i18n runtime symbol detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "useTranslate in simulation/ not detected (exit 0)"
    fi
}

# Test: i18n runtime symbol in apps/<game>/simulation/ → violation [invariant-110]
test_i18n_runtime_in_app_simulation_detected() {
    local tmp
    tmp=$(mktemp -d -t chimera-inv-test-XXXXXX)
    trap 'rm -rf "${tmp}"' RETURN

    plant_file "${tmp}" "apps/tactics/simulation/Bad.ts" \
        "export const label = useTranslate();"

    local out exit_code
    out=$(run_from_root "${tmp}" 2>&1) && exit_code=0 || exit_code=$?

    if [[ ${exit_code} -ne 0 ]]; then
        if echo "${out}" | grep -q '\[invariant-110\]'; then
            pass "useTranslate in apps/<game>/simulation/ detected as [invariant-110]"
        else
            fail "apps/<game>/simulation i18n runtime symbol detected but invariant number missing:"
            echo "${out}" | sed 's/^/       /' >&2
        fi
    else
        fail "useTranslate in apps/<game>/simulation/ not detected (exit 0)"
    fi
}

# ─── Run ──────────────────────────────────────────────────────────────────────

echo "Running check-invariants.sh test suite..."
test_clean_tree_passes
test_math_random_in_simulation_detected
test_date_now_in_ai_detected
test_renderer_import_in_simulation_detected
test_games_import_in_simulation_detected
test_engine_import_in_simulation_leaf_detected
test_simulation_self_import_not_flagged
test_game_snapshot_in_preload_detected
test_comment_mention_not_flagged
test_test_title_string_not_flagged
test_eslint_fixture_not_flagged
test_production_still_flagged_alongside_test_mention
test_games_import_in_gameshell_detected
test_clean_gameshell_passes
test_games_import_in_ingamemenuhost_detected
test_clean_ingamemenuhost_passes
test_chimera_debug_in_package_json_detected
test_bracket_access_chimera_debug_detected
test_bracket_access_node_env_detected
test_clean_debug_mode_shape_passes
test_missing_constants_file_in_real_repo_detected
test_missing_constants_file_without_repo_marker_inert
test_missing_repo_marker_detected
test_present_repo_marker_inert
test_comment_masked_bracket_access_detected
test_missing_is_debug_mode_assignment_detected
test_multiline_spec_shape_passes
test_block_comment_masked_bracket_access_detected
test_block_comment_spec_citation_passes
test_trailing_comment_masked_regression_detected
test_trailing_comment_on_clean_assignment_passes
test_chimera_debug_in_nested_packaging_config_detected
test_chimera_debug_in_node_modules_not_flagged
test_url_string_in_assignment_passes
test_glob_string_before_assignment_passes
test_games_import_in_ai_detected
test_game_subtree_under_ai_detected
test_stray_top_level_file_under_ai_detected
test_ai_index_barrel_passes
test_game_constant_token_in_ai_detected
test_game_namespace_token_in_ai_detected
test_generic_game_namespace_in_ai_detected
test_engine_namespace_in_ai_allowed
test_renderer_import_in_networking_detected
test_games_import_in_networking_detected
test_non_provider_dir_under_networking_detected
test_stray_top_level_file_under_networking_detected
test_networking_index_barrel_passes
test_networking_provider_dir_passes
test_provider_local_import_in_orchestration_detected
test_provider_steam_import_in_orchestration_detected
test_composition_root_provider_import_passes
test_barrel_import_in_orchestration_passes
test_games_import_in_shell_page_detected
test_game_package_import_in_shell_page_detected
test_clean_shell_page_passes
test_renderer_internal_in_game_surface_detected
test_renderer_deep_ui_in_game_surface_detected
test_clean_game_surface_passes
test_math_random_in_app_simulation_detected
test_date_now_in_app_ai_detected
test_renderer_import_in_app_simulation_detected
test_bare_renderer_specifier_in_simulation_detected
test_electron_import_in_simulation_detected
test_electron_import_in_app_simulation_detected
test_bare_electron_specifier_in_simulation_detected
test_game_snapshot_in_app_screen_detected
test_games_import_in_globbed_shell_page_detected
test_r3f_i18n_game_barrels_in_game_surface_pass
test_build_output_dir_not_scanned
test_i18n_runtime_in_simulation_detected
test_i18n_runtime_in_app_simulation_detected

echo
if [[ ${FAILURES} -eq 0 ]]; then
    echo -e "${GREEN}All tests passed.${RESET}"
    exit 0
else
    echo -e "${RED}${FAILURES} test(s) failed.${RESET}" >&2
    exit 1
fi
