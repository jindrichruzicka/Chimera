#!/usr/bin/env bash
# .claude/skills/invariants/scripts/check-invariants.sh
#
# Mechanical subset of Architecture Invariant checks (docs/executive-architecture/architecture-invariants.md).
#
# Exit 0  → no violations found.
# Exit 1  → violations found; each printed as:
#              [invariant-N] relative/path:line  matched text
#
# Run from the repository root:
#   bash .claude/skills/invariants/scripts/check-invariants.sh

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
#
# False-positive suppression:
#   * Comment lines (trimmed start = // or *) are excluded — jsdoc blocks may
#     cite forbidden APIs as examples of what NOT to use.
#   * Test files (*.test.ts / *.test.tsx) are excluded — their string-literal
#     titles legitimately contain forbidden API names (e.g. "flags Math.random()").
#     Production determinism is enforced by ESLint (no-restricted-syntax), and
#     the surrounding test suites assert it; the invariant script is a
#     cross-check against production code, not against the tests themselves.
#   * Fixture files under __tests__/fixtures/ are excluded — they are
#     intentionally-bad inputs for ESLint smoke tests.
#
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
        grep -rn \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            -E "${pattern}" "${existing_dirs[@]}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        || true
    )
}

# Game-import detection (engine allowlist).
#
# Games are now first-class `@chimera/<game>` packages (F57: `@chimera/tactics`
# replaces the old `@chimera/games/tactics` alias) and will leave `games/`
# entirely in F63 (→ `apps/tactics`). A `@chimera/<game>` specifier carries no
# `/games/` substring and is indistinguishable from an engine package by shape,
# so a game is identified by exclusion: any `@chimera/<pkg>` import whose `<pkg>`
# is NOT an engine package, plus any relative/bare `games/*` path.
#
# Usage in a pipeline: match a candidate-import RE below, then drop engine
# packages with `grep -vE "${ENGINE_PKG_EXCLUDE_RE}"`.
ENGINE_PKG_EXCLUDE_RE="@chimera/(shared|simulation|ai|networking|renderer|electron)[/'\"]"
# Static `import … from`/`export … from` of a games/ path or any @chimera/ pkg.
GAME_IMPORT_STATIC_RE="from ['\"][^'\"]*(games/|@chimera/)"
# Static + dynamic `import('…')` of a games/ path or any @chimera/ pkg.
GAME_IMPORT_ANY_RE="(from|import\()[[:space:]]*['\"][^'\"]*(games/|@chimera/)"

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

# ─── Check 4: simulation/ and ai/ must not import a game ─────────────────────
# A game is a relative/bare games/ path or a non-engine @chimera/<game> package
# (e.g. @chimera/tactics); engine @chimera/* imports are filtered back out.
for games_guard_dir in simulation ai; do
    [[ -d "${games_guard_dir}" ]] || continue
    while IFS= read -r match; do
        violation "47" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            "${GAME_IMPORT_STATIC_RE}" "${games_guard_dir}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${ENGINE_PKG_EXCLUDE_RE}" \
        || true
    )
done

# ─── Check 5: renderer/ must not import from electron/main/ ──────────────────
check_grep "1" \
    "from ['\"].*electron/main/" \
    renderer

# ─── Check 6: GameSnapshot must not be imported in preload or renderer ────────
# Invariant 3: GameSnapshot never leaves the main process.
check_grep "3" \
    'GameSnapshot' \
    electron/preload renderer

# ─── Check 7: GameShell / InGameMenuHost must not import games/ (inv 48 & 80) ─
# These engine-renderer shell components stay game-agnostic; the
# GameScreenRegistry passed as a prop is the sole coupling point between the
# engine renderer and a game's React code. Invariant #80 names both GameShell
# and InGameMenuHost as the engine↔game-React coupling surfaces.
SHELL_GAME_AGNOSTIC_FILES=(
    "renderer/components/shell/GameShell.tsx"
    "renderer/components/shell/InGameMenuHost.tsx"
)
for shell_file in "${SHELL_GAME_AGNOSTIC_FILES[@]}"; do
    [[ -f "${shell_file}" ]] || continue
    while IFS= read -r match; do
        violation "48/80" "${shell_file}:${match}"
    done < <(
        grep -nE "${GAME_IMPORT_STATIC_RE}" "${shell_file}" \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${ENGINE_PKG_EXCLUDE_RE}" \
        || true
    )
done

# ─── Check 8: CHIMERA_DEBUG never appears in packaging config (invariant 27) ──
# Production packaging must never be able to set the debug flag. The scan
# recurses the whole tree so packaging configs in subdirectories (e.g.
# build/electron-builder.yml) are guarded the moment they land; third-party
# and generated trees (node_modules, .git, dist, out, coverage) are pruned —
# they are outside the invariant and node_modules would dominate the scan.
# Deliberately broader than the invariant text: a dev-only script setting
# CHIMERA_DEBUG would also be flagged — debug-mode dev entry points must live
# outside package.json (e.g. under tools/).
while IFS= read -r cfg; do
    cfg="${cfg#./}"
    while IFS= read -r match; do
        violation "27" "${cfg}:${match}"
    done < <(grep -n 'CHIMERA_DEBUG' "${cfg}" || true)
done < <(
    find . \( -name node_modules -o -name .git -o -name dist -o -name out -o -name coverage \) -prune -o \
        -type f \( -name 'package.json' \
            -o -name 'electron-builder*.json' -o -name 'electron-builder*.yml' \
            -o -name 'electron-builder*.yaml' -o -name 'electron-builder*.js' \
            -o -name 'forge.config.*' \) -print 2>/dev/null \
    | sort
)

# ─── Check 9: IS_DEBUG_MODE keeps its define-replaceable shape (invariant 27) ─
# Bundler `define` replacement only matches dot-access member expressions; a
# refactor to bracket access would silently break production tree-shaking of
# the debug module graph. Both reads of the expression are pinned — the
# CHIMERA_DEBUG flag and the NODE_ENV production gate.
CONSTANTS="shared/constants.ts"
if [[ -f "${CONSTANTS}" ]]; then
    # Anchor to the assignment itself: strip /* */ block comments (a block
    # comment citing the full spec shape must not anchor the capture) and all
    # `//` comments — full-line and trailing — then capture from
    # `export const IS_DEBUG_MODE` through its terminating `;`, so the pinned
    # literals surviving in any comment cannot mask a regressed initializer.
    # The stripper is string-aware: `//` and `/*` inside '…'/"…"/`…` literals
    # (URLs, globs) are content, not comment markers, and must survive — a
    # string-blind stripper truncates them and raises false violations.
    # Known limitation: regex literals are not modelled; a `//` inside one
    # would still be treated as a comment (fails closed — false positive).
    IS_DEBUG_ASSIGNMENT=$(
        awk '{
            line = $0; out = ""
            n = length(line); i = 1
            while (i <= n) {
                c = substr(line, i, 1)
                two = substr(line, i, 2)
                if (inblock) {
                    if (two == "*/") { inblock = 0; i += 2 } else { i++ }
                } else if (instr != "") {
                    out = out c
                    if (c == "\\") { out = out substr(line, i + 1, 1); i += 2 }
                    else { if (c == instr) instr = ""; i++ }
                } else if (two == "/*") { inblock = 1; i += 2 }
                else if (two == "//") { break }
                else {
                    if (c == "\x27" || c == "\"" || c == "`") instr = c
                    out = out c; i++
                }
            }
            # Only template literals span lines; an open quote string at EOL
            # is invalid JS — reset so it cannot poison the following lines.
            if (instr == "\x27" || instr == "\"") instr = ""
            print out
        }' "${CONSTANTS}" \
        | awk '/export const IS_DEBUG_MODE/{found=1} found{print} found&&/;/{exit}' \
        || true
    )
    if [[ -z "${IS_DEBUG_ASSIGNMENT}" ]]; then
        violation "27" "${CONSTANTS}: export const IS_DEBUG_MODE assignment not found (invariant 27 pins its define-replaceable shape)"
    else
        if ! grep -q "process\.env\.CHIMERA_DEBUG === '1'" <<<"${IS_DEBUG_ASSIGNMENT}"; then
            violation "27" "${CONSTANTS}: IS_DEBUG_MODE must read process.env.CHIMERA_DEBUG === '1' via dot access (define-replaceable shape)"
        fi
        if ! grep -q "process\.env\.NODE_ENV !== 'production'" <<<"${IS_DEBUG_ASSIGNMENT}"; then
            violation "27" "${CONSTANTS}: IS_DEBUG_MODE must read process.env.NODE_ENV !== 'production' via dot access (define-replaceable shape)"
        fi
    fi
fi

# ─── Check 10: electron/main core must not import games/* (invariant 2) ──────
# The host (main process) stays agnostic of which games exist; only the three
# composition registries may import games/*. Mirrors the renderer-side
# GameShell / rendererGameRegistry guard (Check 7) and the ESLint rule
# chimera/no-main-games-import. Matches static (`import … from`, `export … from`)
# and dynamic (`import('…')`) specifiers alike. Test files are excluded (they
# import game fixtures), as are comment lines (jsdoc may cite a games/ path).
if [[ -d electron/main ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            electron/main/game/mainGameRegistry.ts) ;;
            electron/main/content/gameContentRegistry.ts) ;;
            electron/main/lobby/lobbySetupRegistry.ts) ;;
            *) violation "2" "${match}" ;;
        esac
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" \
            "${GAME_IMPORT_ANY_RE}" electron/main 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${ENGINE_PKG_EXCLUDE_RE}" \
        || true
    )
fi

# ─── Check 11: ai/ holds only the game-agnostic framework (invariant 106) ─────
# The pure AI framework package must contain no game-specific subtree (e.g. a
# re-introduced policies/<game>/). Game-specific AI belongs in games/<name>/ai/.
# Only the framework directories below are allowed as immediate children of ai/.
if [[ -d ai ]]; then
    while IFS= read -r dir; do
        case "$(basename "${dir}")" in
            engine|__tests__) ;;
            *) violation "106" "${dir}/  (non-framework dir under ai/; game-specific AI belongs in games/<name>/ai/)" ;;
        esac
    done < <(find ai -mindepth 1 -maxdepth 1 -type d ! -name node_modules | sort)
fi

# ─── Check 12: no game-specific tokens in game-agnostic packages (inv 107) ────
# ai/ and shared/ are game-agnostic — they must not define per-game gameplay
# tokens. Game constants live in games/<name>/. Today tactics is the only game;
# extend the alternation as games are added (e.g. <GAME>_ constants and
# '<gameId>:' action-string namespaces). Comments/tests are excluded by check_grep.
check_grep "107" \
    'TACTICS_|tactics:' \
    ai shared

# ─── Check 13: shared/ is the zero-dependency foundation leaf (invariant 1) ───
# `@chimera/shared` is the foundation/contract layer and must point inward only —
# it must not import from simulation, ai, networking, renderer, or electron.
# Relocate the contract type into shared and re-export from the old home instead
# (issue #758). Cross-package imports use `@chimera/<pkg>` specifiers; the leading
# `@chimera/shared` package is excluded by listing only the forbidden packages.
check_grep "1" \
    "from ['\"]@chimera/(simulation|ai|networking|renderer|electron)[/'\"]" \
    shared

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
