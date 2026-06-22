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

# ─── Check 2: simulation/ ai/ networking/ must not import from renderer/ ──────
check_grep "1" \
    "from ['\"].*renderer/" \
    simulation ai networking

# ─── Check 3: simulation/ ai/ networking/ must not import from electron/ ──────
check_grep "1" \
    "from ['\"].*electron/" \
    simulation ai networking

# ─── Check 4: simulation/ ai/ networking/ must not import a game ──────────────
# A game is a relative/bare games/ path or a non-engine @chimera/<game> package
# (e.g. @chimera/tactics); engine @chimera/* imports are filtered back out.
for games_guard_dir in simulation ai networking; do
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
# The pure AI framework package's sole source top-level members are engine/,
# __tests__/, index.ts and CLAUDE.md (issue #765). It must contain no
# game-specific subtree (e.g. a re-introduced policies/<game>/) nor a stray
# game source file at top level (e.g. tacticsPolicy.ts) — game-specific AI
# belongs in games/<name>/ai/. The import-direction half of this invariant
# (ai/ must not import games/*) is enforced by Check 4 (invariant 47).
#
# Directories: only the framework dirs below are allowed as immediate children.
# `dist` is the generated build output (F59, issue #764) — it mirrors the
# framework source and is gitignored, so it carries no game-specific subtree.
# Files: only index.ts (the contract barrel) is an allowed top-level .ts/.tsx;
# non-source files (CLAUDE.md, package.json, tsconfig*.json) are not matched.
if [[ -d ai ]]; then
    while IFS= read -r dir; do
        case "$(basename "${dir}")" in
            engine|__tests__|dist) ;;
            *) violation "106" "${dir}/  (non-framework dir under ai/; game-specific AI belongs in games/<name>/ai/)" ;;
        esac
    done < <(find ai -mindepth 1 -maxdepth 1 -type d ! -name node_modules | sort)
    while IFS= read -r file; do
        case "$(basename "${file}")" in
            index.ts) ;;
            *) violation "106" "${file}  (non-framework file under ai/; game-specific AI belongs in games/<name>/ai/)" ;;
        esac
    done < <(find ai -mindepth 1 -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
fi

# ─── Check 12: no game-specific tokens in game-agnostic packages (inv 107) ────
# ai/ (and shared/, when present) are game-agnostic — they must not DEFINE
# per-game gameplay tokens (issue #765):
#   * per-game constants — <GAME>_* (e.g. TACTICS_MAX_STAMINA); and
#   * per-game action-string namespaces — '<gameId>:*' (e.g. 'tactics:move_unit').
# The reserved engine: namespace (Invariant #11) is the ONLY namespace allowed
# to cross the package cut, so it is excluded below.
#
# The action-namespace half is generic: any quoted '<gameId>:<action>' literal
# whose namespace is not engine: is flagged, so a second game needs no edit
# here. The constant half stays keyed to known game prefixes (TACTICS_) — there
# is no false-positive-free way to detect "a game's constant" generically — so
# extend the alternation as games are added. shared/ was absorbed into
# @chimera/simulation (#758) and is currently a no-op; it is kept for parity
# with the invariant text should the directory reappear.
# networking/ is game-agnostic too but is intentionally NOT guarded here (#768):
# the transport layer legitimately contains colon-namespaced NON-game literals —
# `node:` builtin import specifiers and `host:port`-style address formats — that
# this heuristic cannot distinguish from a `<gameId>:<action>` namespace, so
# adding it produces false positives. Its game-agnosticism is enforced
# structurally by Check 14 (containment) and the import-direction Checks 2/3/4.
# False-positive suppression mirrors check_grep (comments/tests/fixtures/node_modules).
GAME_TOKEN_RE="(TACTICS_|['\"][a-z][a-z0-9_]*:[a-z])"
for token_guard_dir in ai shared; do
    [[ -d "${token_guard_dir}" ]] || continue
    while IFS= read -r match; do
        violation "107" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            "${GAME_TOKEN_RE}" "${token_guard_dir}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "['\"]engine:" \
        || true
    )
done

# ─── Check 13: shared/ is the zero-dependency foundation leaf (invariant 1) ───
# `@chimera/shared` is the foundation/contract layer and must point inward only —
# it must not import from simulation, ai, networking, renderer, or electron.
# Relocate the contract type into shared and re-export from the old home instead
# (issue #758). Cross-package imports use `@chimera/<pkg>` specifiers; the leading
# `@chimera/shared` package is excluded by listing only the forbidden packages.
check_grep "1" \
    "from ['\"]@chimera/(simulation|ai|networking|renderer|electron)[/'\"]" \
    shared

# ─── Check 14: networking/ exposes provider interfaces only (invariant 47) ────
# `@chimera/networking`'s sole source top-level members are provider/ (the
# pluggable abstraction + the internal concrete providers), __tests__/ (the
# boundary + side-effect smoke tests), index.ts (the curated barrel exposing the
# provider/transport INTERFACES only), and the generated dist/ build output
# (F60, issue #768). A non-allowlisted top-level dir, or a stray top-level
# .ts/.tsx other than index.ts, is flagged — concrete providers must stay
# internal under provider/ (not promoted to the package surface). The
# import-direction half (networking/ must not import ai/renderer/electron/games)
# is enforced by Checks 2/3/4 above and the ESLint boundary rule.
if [[ -d networking ]]; then
    while IFS= read -r dir; do
        case "$(basename "${dir}")" in
            provider|__tests__|dist) ;;
            *) violation "47" "${dir}/  (non-provider dir under networking/; concrete providers stay internal under provider/)" ;;
        esac
    done < <(find networking -mindepth 1 -maxdepth 1 -type d ! -name node_modules | sort)
    while IFS= read -r file; do
        case "$(basename "${file}")" in
            index.ts) ;;
            *) violation "47" "${file}  (non-barrel file under networking/; the curated public barrel is index.ts)" ;;
        esac
    done < <(find networking -mindepth 1 -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
fi

# ─── Check 15: electron/main orchestration imports the networking barrel only (invariant 47)
# Main-process orchestration must talk to @chimera/networking through the public
# barrel interfaces (MultiplayerProvider/HostTransport/ClientTransport) only; it
# must never reach into a provider-specific subdirectory (provider/local/*,
# provider/steam/*, or their server/client internals) — provider-internal
# containment (issue #769). The sole exempt file is the composition root
# electron/main/index.ts, which wires the concrete provider into the DI graph
# (Invariant #38). Mirrors Check 10 (electron/main must not import games/*) and
# the ESLint rule chimera/no-main-provider-internals. Matches static
# (`import … from`, `export … from`) and dynamic (`import('…')`) specifiers; the
# server/client internals live under provider/local/, so (local|steam) covers
# them. Test files are excluded (they import provider internals as fixtures), as
# are comment lines (jsdoc may cite a provider path).
if [[ -d electron/main ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            electron/main/index.ts) ;;
            *) violation "47" "${match}" ;;
        esac
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" \
            "(from|import\()[[:space:]]*['\"][^'\"]*networking/provider/(local|steam)/" electron/main 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 16: engine shell pages must not import games/* (invariant 94) ──────
# The main-menu/lobby/game/settings/saves/component-gallery pages are
# game-agnostic; they reach game React only through renderer-owned loader helpers
# (renderer/game/rendererGameRegistry — a `game/`, not `games/`, path), never a
# games/* module or a @chimera/<game> package directly. The lobby page may parse
# LobbyConfig via @chimera/simulation helpers (engine, allowed). Mirrors the
# ESLint rule chimera/no-shell-games-import and the host-side Check 7 (#80), and
# locks the boundary across the @chimera/renderer package cut (issue #774).
# Matches static + dynamic specifiers; engine @chimera/* packages and comment
# lines are filtered out. No file is exempt — the loader lives in renderer/game/,
# outside these page directories.
SHELL_PAGE_DIRS=(
    renderer/app/main-menu
    renderer/app/lobby
    renderer/app/game
    renderer/app/settings
    renderer/app/saves
    renderer/app/component-gallery
)
for shell_page_dir in "${SHELL_PAGE_DIRS[@]}"; do
    [[ -d "${shell_page_dir}" ]] || continue
    while IFS= read -r match; do
        violation "94" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            "${GAME_IMPORT_ANY_RE}" "${shell_page_dir}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${ENGINE_PKG_EXCLUDE_RE}" \
        || true
    )
done

# ─── Check 17: game renderer surfaces use only the public ui/chat barrels (inv 96)
# A game's React surfaces — games/<name>/screens/*.tsx and
# games/<name>/shell/*.tsx — may reach the shared library ONLY through the two
# public barrels @chimera/renderer/components/ui and
# @chimera/renderer/components/chat. Every other @chimera/renderer/* specifier
# (stores, IPC bridges, shell/, R3F, hooks, asset managers, stylesheets, or a
# deep component-file path behind either barrel) is a renderer internal and is
# forbidden. Mirrors the ESLint rule chimera/no-game-renderer-internals, which
# remains the comprehensive authority (it also guards non-surface game files and
# relative renderer paths); this review-gate check guards the two surface dirs
# the invariant names, matched through the package specifier across the cut
# (issue #774). The barrel allow-list is tail-anchored to the closing quote so
# `.../ui` and `.../ui/index.js` pass while `.../ui/Button.js` is flagged. Bare
# `renderer/` paths are intentionally NOT matched: a game's own renderer/ helper
# (games/<name>/renderer/*) is not a boundary crossing.
RENDERER_BARREL_RE="@chimera/renderer/components/(ui|chat)(/index(\.(ts|js))?)?['\"]"
GAME_SURFACE_DIRS=()
for surface_dir in games/*/screens games/*/shell; do
    [[ -d "${surface_dir}" ]] && GAME_SURFACE_DIRS+=("${surface_dir}")
done
if [[ ${#GAME_SURFACE_DIRS[@]} -gt 0 ]]; then
    while IFS= read -r match; do
        violation "96" "${match}"
    done < <(
        grep -rnE \
            --include="*.tsx" --include="*.jsx" \
            --exclude="*.test.tsx" --exclude="*.test.jsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            "(from|import\()[[:space:]]*['\"]@chimera/renderer/" "${GAME_SURFACE_DIRS[@]}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${RENDERER_BARREL_RE}" \
        || true
    )
fi

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
