#!/usr/bin/env bash
# .github/skills/invariants/scripts/check-invariants.sh
#
# Mechanical subset of Appendix B invariant checks.
#
# Exit 0  → no violations found.
# Exit 1  → violations found; each printed as:
#              [invariant-N] relative/path:line  matched text
#
# Run from the repository root:
#   bash .github/skills/invariants/scripts/check-invariants.sh

set -euo pipefail

# Resolve repo root (two levels up from scripts/)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/../../../.." && pwd)
cd "${REPO_ROOT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
RESET='\033[0m'

VIOLATIONS=0

# Print a violation line and increment counter.
# Usage: violation <invariant-number> <grep-output-line>
violation() {
    local inv="$1"
    local line="$2"
    echo -e "${RED}[invariant-${inv}]${RESET} ${line}"
    VIOLATIONS=$((VIOLATIONS + 1))
}

# Run grep and emit violations for each matching line.
# Comment lines (trimmed start = // or *) are excluded to avoid false-positives
# from jsdoc blocks that cite forbidden APIs as examples of what NOT to use.
# Usage: check_grep <invariant-number> <grep-pattern> <directory...>
check_grep() {
    local inv="$1"
    local pattern="$2"
    shift 2
    local dirs=("$@")

    # Collect only directories that exist to avoid grep errors on missing paths.
    local existing_dirs=()
    for d in "${dirs[@]}"; do
        [[ -d "${d}" ]] && existing_dirs+=("${d}")
    done
    [[ ${#existing_dirs[@]} -eq 0 ]] && return

    while IFS= read -r match; do
        violation "${inv}" "${match}"
    done < <(
        grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
            -E "${pattern}" "${existing_dirs[@]}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        || true
    )
}

# ─── Check 1 & 43: no Math.random / Date.now / performance.now in simulation or ai ───
# Covers both invariant 2 (purity) and invariant 43 (no non-deterministic APIs).
check_grep "2/43" \
    'Math\.random|Date\.now|performance\.now' \
    simulation ai

# ─── Check 2: simulation/ must not import from renderer/ ──────────────────────
check_grep "1" \
    "from ['\"].*renderer/" \
    simulation ai

# ─── Check 3: simulation/ must not import from electron/ ──────────────────────
check_grep "1" \
    "from ['\"].*electron/" \
    simulation ai

# ─── Check 4: simulation/ must not import from games/ ────────────────────────
check_grep "47" \
    "from ['\"].*games/" \
    simulation ai

# ─── Check 5: renderer/ must not import from electron/main/ ──────────────────
check_grep "1" \
    "from ['\"].*electron/main/" \
    renderer

# ─── Check 6: GameSnapshot must not be imported in preload or renderer ────────
# Invariant 3: GameSnapshot never leaves the main process.
check_grep "3" \
    'GameSnapshot' \
    electron/preload renderer

# ─── Summary ─────────────────────────────────────────────────────────────────
echo
if [[ ${VIOLATIONS} -eq 0 ]]; then
    echo -e "${GREEN}All invariant checks passed.${RESET}"
    exit 0
else
    echo -e "${RED}---${RESET}"
    echo -e "${RED}${VIOLATIONS} violation(s) found. Fix them and re-run.${RESET}"
    exit 1
fi
