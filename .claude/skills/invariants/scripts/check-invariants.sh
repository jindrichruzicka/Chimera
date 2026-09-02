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
#   * Generated build output (out/, .next/, dist/) is pruned — it mirrors the
#     source (the authority), so scanning it only adds noise and could raise a
#     false positive on an emitted bundle (e.g. a game's apps/<game>/renderer/out/).
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
            --exclude-dir="out" --exclude-dir=".next" --exclude-dir="dist" \
            -E "${pattern}" "${existing_dirs[@]}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        || true
    )
}

# Game-import detection (engine allowlist).
#
# A game can be named three ways, and a guard that misses one is a guard the
# other two can be routed around:
#   - `apps/<game>/…`   — its on-disk home, reached by a relative or bare path
#   - `games/<game>/…`  — the legacy home; kept so the old form stays rejected
#   - `@chimera-engine/<game>` — the package specifier, which carries no path
#     segment at all and is indistinguishable from an engine package by shape
# The third is therefore identified by EXCLUSION: any `@chimera-engine/<pkg>`
# whose `<pkg>` is not on the engine allowlist. The first two by a path SEGMENT
# anchored at both ends — `(^|/)(apps|games)/` — so neither a prefix lookalike
# (`…/webapps/…`) nor a suffix one (`…/gamestate.js`) is read as a game. Both
# arms match the shared ESLint classifier in
# electron/dev-tools/eslint/game-path.ts verbatim, including the scoped arm's
# anchor at the opening quote: a specifier reaching a game through a vendored
# `…/node_modules/@chimera-engine/<game>` path is therefore not matched here
# either.
#
# Three specifier positions are matched — `… from '…'`, a side-effect
# `import '…'`, and a dynamic `import('…')` — because a lazy or
# side-effect-only load crosses the boundary exactly as an eager one does.
# `require('…')` is not among them; it is banned repo-wide by
# @typescript-eslint/no-require-imports.
#
# Usage in a pipeline: match the import RE below, then drop engine packages
# with `grep -vE "${ENGINE_PKG_EXCLUDE_RE}"`.
ENGINE_PKG_EXCLUDE_RE="@chimera-engine/(simulation|ai|networking|renderer|electron)[/'\"]"
# A quoted specifier that names a game: an apps/|games/ path segment, or any
# @chimera-engine/ pkg (engine packages filtered back out by the exclude RE).
GAME_SPECIFIER_RE="['\"](([^'\"]*/)?(apps|games)/|@chimera-engine/)"
# That specifier in the three import positions: `from '…'`, `import '…'`,
# `import('…')` — the optional paren tolerates a space before it.
GAME_IMPORT_RE="(from|import[[:space:]]*\(?)[[:space:]]*${GAME_SPECIFIER_RE}"

# ─── Check 1 & 43: no Math.random / Date.now / performance.now (sim/ai + per-game) ───
# Covers both invariant 2 (purity) and invariant 43 (no non-deterministic APIs).
# Scans the engine simulation/ ai/ packages AND the relocated per-game gameplay
# dirs apps/<game>/{simulation,ai} (F63).
check_grep "2/43" \
    'Math\.random|Date\.now|performance\.now' \
    simulation ai apps/*/simulation apps/*/ai

# ─── Check 2: simulation/ ai/ networking/ (+ per-game) must not import renderer/ ──────
# Also scans the per-game gameplay dirs apps/<game>/{simulation,ai}. The pattern
# catches both a `renderer/` path and the bare `@chimera-engine/renderer` package root
# (no subpath), which a plain `.*renderer/` pattern would miss.
check_grep "1" \
    "from ['\"]([^'\"]*renderer/|@chimera-engine/renderer['\"])" \
    simulation ai networking apps/*/simulation apps/*/ai

# ─── Check 3: simulation/ ai/ networking/ (+ per-game) must not import electron/ ──────
# Mirrors Check 2: adds apps/<game>/{simulation,ai} and catches the bare
# `@chimera-engine/electron` package root alongside an `electron/` path.
check_grep "1" \
    "from ['\"]([^'\"]*electron/|@chimera-engine/electron['\"])" \
    simulation ai networking apps/*/simulation apps/*/ai

# ─── Check 4: simulation/ ai/ networking/ must not import a game ──────────────
# A game is a relative/bare apps/ or games/ path or a non-engine @chimera-engine/<game>
# package (e.g. @chimera-engine/tactics); engine @chimera-engine/* imports are filtered out.
for games_guard_dir in simulation ai networking; do
    [[ -d "${games_guard_dir}" ]] || continue
    while IFS= read -r match; do
        violation "47" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            "${GAME_IMPORT_RE}" "${games_guard_dir}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${ENGINE_PKG_EXCLUDE_RE}" \
        || true
    )
done

# ─── Check 5: renderer/ must not import from electron/main/ ──────────────────
check_grep "1" \
    "from ['\"].*electron/main/" \
    renderer

# ─── Check 6: GameSnapshot must not appear in preload, renderer, or game surfaces ──
# Invariant 3: GameSnapshot never leaves the main process. Scans the engine
# renderer AND the per-game renderer-process surfaces
# apps/<game>/{screens,components,shell,renderer}.
check_grep "3" \
    'GameSnapshot' \
    electron/preload renderer apps/*/screens apps/*/components apps/*/shell apps/*/renderer

# ─── Check 7: GameShell / InGameMenuHost must not import a game (inv 48 & 80) ─
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
        grep -nE "${GAME_IMPORT_RE}" "${shell_file}" \
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
# refactor to bracket access would silently stop the packaged build from folding
# IS_DEBUG_MODE to `false`, leaving a LIVE debug gate in a distributable. Both
# reads of the expression are pinned — the CHIMERA_DEBUG flag and the NODE_ENV
# production gate — because the define must replace both to fold the whole
# expression to a literal.
#
# The `-f` guard keeps the check inert in the harness's throwaway fixture roots,
# which plant only the file under test. On its own that guard makes a wrong
# CONSTANTS path skip the whole check SILENTLY, so the anti-rot probe below
# turns that into a violation.
#
# The probe anchors on `pnpm-workspace.yaml`, deliberately NOT on the constant's
# own directory: a whole-DIRECTORY rename would take a dir-existence test down
# with it. A marker the check does not own means "this is the real repo, so the
# file must be findable" — while fixture roots (no workspace file) stay inert.
CONSTANTS="simulation/foundation/constants.ts"
REPO_MARKER="pnpm-workspace.yaml"

# Strip JS comments from $1, preserving line numbering 1:1 (a full-line comment
# emits an empty line), so a stripped file can still be scanned positionally.
#
# String-aware: `//` and `/*` inside '…'/"…"/`…` literals (URLs, globs) are
# content, not comment markers, and must survive — a string-blind stripper
# truncates them and raises false violations. Known limitation: regex literals
# are not modelled; a `//` inside one is treated as a comment (fails closed).
#
# Shared by BOTH halves of Check 9. Comment text quoting the pinned shape must
# never be able to satisfy — or anchor — a check about executable code.
strip_js_comments() {
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
    }' "$1"
}

# The marker arms every repo-only rule below. If it is ever renamed, those rules
# would ALL fall silently inert — the exact way Check 9 rotted into a no-op once
# before. Fail loudly instead of skipping: a checkout that is not the repo root
# has no `package.json` + `.claude/` pair either, so this cannot misfire.
if [[ ! -f "${REPO_MARKER}" && -f "package.json" && -d ".claude/skills/invariants" ]]; then
    violation "27" "${REPO_MARKER}: missing from what looks like the repo root — every marker-gated invariant check has silently stopped running (did the workspace file get renamed? update REPO_MARKER in this script)"
fi

if [[ -f "${REPO_MARKER}" && ! -f "${CONSTANTS}" ]]; then
    violation "27" "${CONSTANTS}: missing — invariant 27's IS_DEBUG_MODE shape check cannot run (did the constant move? update CONSTANTS in this script)"
fi
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
        strip_js_comments "${CONSTANTS}" \
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

# The debug GATE in electron/main/index.ts carries a verbatim copy of this
# expression, and is equally load-bearing: it is what the define folds to
# `if (false)`, pruning the debug module graph out of packaged bundles.
#
# It is deliberately NOT checked here. A shell text scan cannot tell code from a
# string literal, cannot balance braces, and cannot tell a static import from a
# dynamic one. Each of those is enough on its own to make such a check green over
# a shipped debug graph: a decoy string supplies both the anchor and the pinned
# literals, and hoisting the imports out leaves an empty correct-shaped `if` that
# still anchors the capture. Guards that must understand the source belong where
# a parser is available.
#
# The gate is pinned instead by two checks that CAN establish it:
#   - tools/packaged-build-flag.test.ts — parses the file with the TypeScript
#     compiler API (enclosure, static-vs-dynamic imports, expression identity).
#   - apps/tactics/electron/__tests__/packaged-bundle-content.test.ts — asserts
#     the emitted bundle itself, which is the property rather than a proxy for it.
# Both run under `pnpm test`, which CI runs alongside this script.

# ─── Check 10: electron/main core must not import a game (invariant 2) ───────
# The host (main process) stays agnostic of which games exist. Since F62 (#778)
# the main-side game registry is a runtime injection seam (mainGameRegistry.ts is
# a game-agnostic factory); since #788/#789 content schemas and lobby setup also
# arrive by injection, so there are NO in-package composition points left — every
# non-test electron/main module must be game-free. The host's game wiring lives in
# each consumer app's own composition root apps/<game>/electron/main.ts (a flat
# file under electron/, not the electron/main/ dir, so outside this check). Mirrors the
# renderer-side GameShell / rendererGameRegistry guard (Check 7) and the ESLint
# rule chimera/no-main-games-import. Matches the specifier positions listed at
# GAME_IMPORT_RE. Test files are excluded (they import game fixtures), as are
# comment lines (jsdoc may cite an apps/ or games/ path).
if [[ -d electron/main ]]; then
    while IFS= read -r match; do
        violation "2" "${match}"
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" \
            "${GAME_IMPORT_RE}" electron/main 2>/dev/null \
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
# belongs in apps/<game>/ai/. The import-direction half of this invariant
# (ai/ must not import a game) is enforced by Check 4 (invariant 47).
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
            *) violation "106" "${dir}/  (non-framework dir under ai/; game-specific AI belongs in apps/<game>/ai/)" ;;
        esac
    done < <(find ai -mindepth 1 -maxdepth 1 -type d ! -name node_modules | sort)
    while IFS= read -r file; do
        case "$(basename "${file}")" in
            index.ts) ;;
            *) violation "106" "${file}  (non-framework file under ai/; game-specific AI belongs in apps/<game>/ai/)" ;;
        esac
    done < <(find ai -mindepth 1 -maxdepth 1 -type f \( -name '*.ts' -o -name '*.tsx' \) | sort)
fi

# ─── Check 12: no game-specific tokens in game-agnostic packages (inv 107) ────
# ai/ and simulation/ are game-agnostic — they must not DEFINE per-game
# gameplay tokens:
#   * per-game constants — <GAME>_* (e.g. TACTICS_MAX_STAMINA); and
#   * per-game action-string namespaces — '<gameId>:*' (e.g. 'tactics:move_unit').
# The reserved engine: namespace (Invariant #11) is never a game namespace, so
# it is suppressed below — alongside two more non-game prefixes explained in
# the simulation/ paragraph further down.
#
# The action-namespace half is generic: any quoted '<gameId>:<action>' literal
# whose namespace is not engine: is flagged, so a second game needs no edit
# here. The constant half stays keyed to known game prefixes (TACTICS_) — there
# is no false-positive-free way to detect "a game's constant" generically — so
# extend the alternation as games are added.
#
# The guarded dirs are the two game-agnostic packages the invariant names.
# `simulation/` absorbed the former `shared/` package, so it inherited that
# half of the guard; reaching it needed two suppressions, both for literals the
# heuristic cannot tell from a `<gameId>:` namespace:
#   * `node:` — builtin import specifiers (`node:crypto`). The same class that
#     keeps networking/ out, below.
#   * `chimera:` — the app's own preload↔main IPC channel prefix
#     (`chimera:debug`), sibling to the reserved `engine:` namespace.
# `dist/` is excluded because both packages build there and a compiled copy of a
# guarded source would report the same literal twice.
#
# networking/ is game-agnostic too but is intentionally NOT guarded here:
# the transport layer legitimately contains colon-namespaced NON-game literals —
# `node:` builtin import specifiers and `host:port`-style address formats. The
# `host:port` half has no suppression that would not also hide a real game
# namespace, so the dir stays out. Its game-agnosticism is enforced structurally
# by Check 14 (containment) and the import-direction Checks 2/3/4.
# False-positive suppression mirrors check_grep (comments/tests/fixtures/node_modules).
GAME_TOKEN_RE="(TACTICS_|['\"][a-z][a-z0-9_]*:[a-z])"
# Namespaces that are NOT a game: the reserved engine: cut (Invariant #11), the
# app's own chimera: IPC prefix, and node: builtin specifiers. Suppressed
# per-TOKEN, never per-line — a line-scoped filter would drop
# `{ debug: 'chimera:debug', move: 'tactics:move_unit' }` whole, and an object
# literal mapping channel constants is exactly the shape these packages hold.
# The opening-quote anchor is load-bearing: without it, a quoted game namespace
# whose name merely ends in a suppressed word ('myengine:') has its tail blanked
# from inside the quotes and escapes detection.
ENGINE_NAMESPACE_ALT="engine|chimera|node"
for token_guard_dir in ai simulation; do
    [[ -d "${token_guard_dir}" ]] || continue
    while IFS= read -r match; do
        violation "107" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" --exclude-dir="dist" \
            "${GAME_TOKEN_RE}" "${token_guard_dir}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | awk -v sup="['\"](${ENGINE_NAMESPACE_ALT}):" -v tok="${GAME_TOKEN_RE}" \
            '{ probe = $0; gsub(sup "[a-zA-Z0-9_:./-]*", "", probe); if (probe ~ tok) print }' \
        || true
    )
done

# ─── Check 13: simulation/ is the zero-dependency foundation leaf (invariant 1) ───
# `@chimera-engine/simulation` is the foundation/contract layer (it absorbed the former
# `shared/` package, issue #758) and must point inward only — it must not import from
# ai, networking, renderer, or electron. Cross-package imports use `@chimera-engine/<pkg>`
# specifiers; `simulation` is omitted from the forbidden alternation because a
# simulation-internal `@chimera-engine/simulation` import is not a back-edge.
check_grep "1" \
    "from ['\"]@chimera-engine/(ai|networking|renderer|electron)[/'\"]" \
    simulation

# ─── Check 14: networking/ exposes provider interfaces only (invariant 47) ────
# `@chimera-engine/networking`'s sole source top-level members are provider/ (the
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
# Main-process orchestration must talk to @chimera-engine/networking through the public
# barrel interfaces (MultiplayerProvider/HostTransport/ClientTransport) only; it
# must never reach into a provider-specific subdirectory (provider/local/*,
# provider/steam/*, or their server/client internals) — provider-internal
# containment (issue #769). The sole exempt file is the composition root
# electron/main/index.ts, which wires the concrete provider into the DI graph
# (Invariant #38). Mirrors Check 10 (electron/main must not import a game) and
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

# ─── Check 16: the renderer names no game (invariants 94 & #784) ─────────────
# Every renderer/app/* page (main-menu, lobby, game, settings, saves,
# component-gallery, debug, replays, logo-screen, …) is game-agnostic, AND the
# renderer game-registration seam (renderer/game/) is now
# game-agnostic too (#784): the registry became a runtime injection point
# (registerRendererGame) and the tactics loaders moved to the consumer app
# (apps/tactics/renderer/register.ts). None of these may import an apps/* or
# games/* module or a @chimera-engine/<game> package directly — a game's renderer
# contribution enters only at the consumer-app composition root, selected by the
# chimera-game-registration build alias. The lobby page may parse LobbyConfig via
# @chimera-engine/simulation helpers (engine, allowed). Mirrors the ESLint
# renderer/** game-import ban + chimera/no-shell-games-import and the host-side
# Check 7 (#80); locks the boundary across the @chimera-engine/renderer package cut
# (issues #774, #784). Matches the specifier positions listed at GAME_IMPORT_RE,
# across all three ways a game can be named; engine @chimera-engine/* packages
# and comment lines are filtered out. No file is exempt — the renderer registry
# seam is scanned alongside the shell pages.
# Glob every page dir under renderer/app/ (so pages added later are covered
# automatically — the old hardcoded list had already gone stale, missing
# logo-screen) plus the renderer game-registration seam renderer/game/.
for shell_page_dir in renderer/app/*/ renderer/game; do
    [[ -d "${shell_page_dir}" ]] || continue
    while IFS= read -r match; do
        violation "94" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            "${GAME_IMPORT_RE}" "${shell_page_dir}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${ENGINE_PKG_EXCLUDE_RE}" \
        || true
    )
done

# ─── Check 17: game renderer surfaces use only the public renderer barrels (inv 96)
# A game's React surfaces — apps/<name>/{screens,components,shell}/*.tsx —
# may reach the shared library ONLY through the public barrels
# chimera/no-game-renderer-internals sanctions. RENDERER_BARREL_RE below is what
# this check accepts; Invariant #96 is the prose authority.
# Every other @chimera-engine/renderer/* specifier
# (stores, IPC bridges, shell/, hooks, asset managers, stylesheets, or a deep
# component-file path behind any barrel) is a renderer internal and is forbidden.
# Mirrors the ESLint rule chimera/no-game-renderer-internals, which remains the
# comprehensive authority (it also guards non-surface game files and relative
# renderer paths); this review-gate check guards the three REACT surface dirs of
# the four the invariant names — the composition root apps/<name>/renderer/* is
# covered by the ESLint rule alone — matched through the package specifier across
# the cut (issue #774). The
# barrel allow-list is tail-anchored to the closing quote so `.../ui` and
# `.../ui/index.js` pass while `.../ui/Button.js` is flagged. RENDERER_BARREL_RE
# below is also where the components/ vs TOP-LEVEL split is spelled out, and the
# tail anchor is what keeps a deep file behind ANY of those barrels flagged while
# the bare barrel and its index.js form pass. Bare
# `renderer/` paths are intentionally NOT matched: a game's own renderer/ helper
# (apps/<name>/renderer/*) is not a boundary crossing.
RENDERER_BARREL_RE="@chimera-engine/renderer/(components/(ui|chat|r3f)|i18n|game|audio|assets|input)(/index(\.(ts|js))?)?['\"]"
GAME_SURFACE_DIRS=()
for surface_dir in apps/*/screens apps/*/components apps/*/shell; do
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
            "(from|import\()[[:space:]]*['\"]@chimera-engine/renderer/" "${GAME_SURFACE_DIRS[@]}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE "${RENDERER_BARREL_RE}" \
        || true
    )
fi

# ─── Check 18: i18n runtime stays renderer-only (invariant 110) ──────────────
# The i18n RUNTIME — translation resolution, the ICU formatter, and the React
# binding, all under renderer/i18n/ — is a renderer concern. simulation/, ai/,
# networking/, and the per-game gameplay dirs apps/<game>/{simulation,ai} must
# never import or reference it. The ONLY i18n surface
# allowed in simulation/ is the declarative language CONTRACT in
# simulation/foundation/game-manifest-contract.ts (GameLanguage,
# GameManifest.languages, resolveGameLanguages/firstLanguageCode) — a language
# declaration, not a runtime — so this check deliberately does NOT match those
# identifiers; it matches only runtime symbols/paths. The renderer-import ban of
# Check 2 already forbids `from '.../renderer/...'`; this is the additional,
# i18n-specific containment for Invariant #110 (it also catches a bare-specifier
# or dynamic import that Check 2's `from ['\"].*renderer/` pattern would miss).
# False-positive suppression (comments/tests/fixtures/node_modules) is inherited
# from check_grep, so the JSDoc mention of `useTranslate()` in
# simulation/bridge/debug-api-types.ts is not flagged.
check_grep "110" \
    'renderer/i18n|useTranslate|I18nProvider|formatMessage|TranslationBundle|TranslationKey' \
    simulation ai networking apps/*/simulation apps/*/ai

# NOTE: the per-game i18n-runtime containment (Invariant #110 for
# apps/<game>/{simulation,ai}) lives in Check 18 above — its dir list already
# includes apps/*/simulation apps/*/ai, so it is intentionally not duplicated as
# a separate per-game check below.

# ─── Check 19: gameplay purity — no env reads or node I/O (invariants 43, 2) ──
# validate()/reduce() must be pure: no environment reads and no I/O (Invariant
# #43). Scans the engine simulation/ ai/ packages AND the per-game gameplay dirs
# apps/<game>/{simulation,ai}, flagging `process.env` reads and imports of node
# built-in I/O/process modules (fs, child_process, sockets, etc.) in both the
# `node:`-prefixed and bare-specifier forms.
#
# Two engine infrastructure files carry a SANCTIONED, non-reducer I/O surface and
# are path-exempted (startup/projection infrastructure, not validate()/reduce()):
#   * simulation/foundation/constants.ts — the module where the engine's
#     env-derived flags are declared, for readers outside validate()/reduce().
#   * simulation/content/ContentLoader.ts — the content-DB loader's fs read
#     (§4.8); a failed load throws fatally at main startup, never inside a tick.
# node:crypto is deliberately NOT in the module list: simulation/projection/
# CommitmentScheme.ts uses it under the §8 commitment mandate (and carries its own
# `@chimera-review:` marker), so it is neither matched nor exempted here.
PURITY_IO_RE="process\.env|(from|import\(|require\()[[:space:]]*['\"](node:)?(fs|child_process|net|http|https|dns|dgram|tls|readline|cluster|worker_threads)['\"/]"
PURITY_DIRS=()
for purity_dir in simulation ai apps/*/simulation apps/*/ai; do
    [[ -d "${purity_dir}" ]] && PURITY_DIRS+=("${purity_dir}")
done
if [[ ${#PURITY_DIRS[@]} -gt 0 ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            simulation/foundation/constants.ts) ;;
            simulation/content/ContentLoader.ts) ;;
            *) violation "2/43" "${match}" ;;
        esac
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            --exclude-dir="out" --exclude-dir=".next" --exclude-dir="dist" \
            "${PURITY_IO_RE}" "${PURITY_DIRS[@]}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 20: games must not register engine: action types (invariant 11) ────
# The `engine:` action namespace is reserved; a game must not REGISTER an action
# type in it. Registration puts a string literal in the `type:` field of an
# ActionDefinition, so this flags a `type: 'engine:…'` literal in per-game
# gameplay code apps/<game>/{simulation,ai}.
#
# False positives avoided by shape: a game legitimately REFERENCES the engine's
# own end-turn action to re-emit it — e.g. `const ENGINE_END_TURN =
# 'engine:end_turn'` (an assignment, not a `type:` literal) and an emission
# `{ type: ENGINE_END_TURN_ACTION, … }` (a `type:` with an identifier, not a
# literal). Neither matches the `type:`-literal registration shape.
check_grep "11" \
    "type:[[:space:]]*['\"]engine:" \
    apps/*/simulation apps/*/ai

# ─── Check 21: no float literals in per-game simulation state (invariants 75, 44) ─
# FixedPoint (bigint Q32.32) is the ONLY allowed fractional representation in a
# game snapshot; floating-point is forbidden in simulation state (Invariants #44,
# #75). Flags decimal number literals in per-game simulation logic
# apps/<game>/simulation.
#
# FP-suppression path (the highest false-positive risk in the set): a decimal in a
# FULL-LINE comment — e.g. an architecture section citation like `§4.6` on a
# `*`-prefixed JSDoc line — is dropped by check_grep's comment filter, so the
# JSDoc citations in the tree are not flagged. That filter suppresses FULL-LINE
# comments only: a decimal in a TRAILING comment (e.g. `x = 0 // §4.6`) still
# fires, as does a decimal in CODE (e.g. inside a version string like "v1.5").
# Move such a citation onto its own full-line comment, or narrow the pattern at
# that site. `.test.ts` fixtures (which assert non-integers are rejected) are
# excluded by check_grep.
check_grep "75/44" \
    '[0-9]+\.[0-9]' \
    apps/*/simulation

# ─── Check 22: game screens barrel exports only React.lazy screens (invariant 87) ─
# Every screen exported from a game's screens barrel apps/<game>/screens/index.ts(x)
# must be wrapped in React.lazy(() => import('./…')); an eager same-dir static
# import of a screen COMPONENT defeats the per-game bundle split. Flags a static
# same-dir value import/re-export (`… from './…'`) in the barrel. A React.lazy
# dynamic `import('./…')` call has no `from` clause so it does not match; static
# imports from parent dirs (`../simulation`, `../styles`) or packages are
# same-package and allowed. Type-only same-dir specifiers (`import type … from
# './…'`, `export type … from './…'`) are excluded — they are erased at compile
# time and pull no runtime component into the eager graph, so they fall outside
# Invariant #87. That exclusion is anchored to the STATEMENT start (via the
# `path:line:` prefix, the same technique as Check 24's comment filter), so an
# `import type`/`export type` phrase in a TRAILING comment on a genuine
# value-import line cannot mask the violation.
for screens_barrel in apps/*/screens/index.ts apps/*/screens/index.tsx; do
    [[ -f "${screens_barrel}" ]] || continue
    while IFS= read -r match; do
        violation "87" "${match}"
    done < <(
        grep -HnE \
            "from[[:space:]]*['\"]\./" "${screens_barrel}" 2>/dev/null \
        | grep -vE ':[[:space:]]*(//|/\*|\*)' \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(import|export)[[:space:]]+type[[:space:]]' \
        || true
    )
done

# ─── Check 23: game lobby/shell surfaces perform no privileged lobby writes (inv 100) ─
# A game's lobby/shell/screen surfaces must not write the IPC-mirrored lobbyStore,
# call LobbyManager, or reach the lobby through the debug bridge; they receive
# setGameParam/setPlayerAttribute as props and call those engine-provided
# setters (Invariant #100). Scans apps/<game>/{shell,screens,components} for a
# LobbyManager or lobbyStore reference, or a `__chimera.….lobby` access. The
# legitimate `__chimera.replay` reads (the replay export bridge) do not match, and
# the engine-provided useLobbyApi() hook is deliberately not flagged.
check_grep "100" \
    'LobbyManager|lobbyStore|__chimera.*\.lobby' \
    apps/*/shell apps/*/screens apps/*/components

# ─── Check 24: game fonts are local — no external font URLs (invariant 97) ────
# Game-owned fonts must be committed to the game package and referenced by local
# game-asset paths; GameFontFace.src must not be an external URL and runtime font
# loading must not fetch Google Fonts CSS or fonts.gstatic.com files (Invariant
# #97). Scans a game's shell/styles/screens/components/assets surfaces — INCLUDING .css — for
# a fonts.gstatic.com / fonts.googleapis.com reference or a `url(https://…)` in a
# stylesheet. Local `src: 'game-id/fonts/…woff2'` relative paths (the sanctioned
# form) do not match.
#
# NOTE: this check matches URL text containing `://`, so it deliberately does NOT
# use the shared loose comment filter (`:[[:space:]]*(//…)`), which would drop
# every match — the `//` in `https://` reads as a comment marker to that filter.
# It anchors the comment filter to the `path:line:` prefix instead, so only a line
# whose CONTENT starts with a comment marker (a genuine comment) is suppressed.
# Consequence: a font URL cited in a full-line comment (content starting with
# `//`, `/*`, or `*`) is suppressed, but a TRAILING comment on a code line — e.g.
# a `src: '…woff2'; // was https://fonts.gstatic.com/…` provenance note — DOES
# trip the gate. A trailing-comment URL cannot be told apart from a code URL by
# grep, because `https://` itself contains `//`; keep any font-URL provenance note
# on its own full-line comment.
FONT_DIRS=()
for font_dir in apps/*/shell apps/*/styles apps/*/screens apps/*/components apps/*/assets; do
    [[ -d "${font_dir}" ]] && FONT_DIRS+=("${font_dir}")
done
if [[ ${#FONT_DIRS[@]} -gt 0 ]]; then
    while IFS= read -r match; do
        violation "97" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.css" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            --exclude-dir="out" --exclude-dir=".next" --exclude-dir="dist" \
            "fonts\.gstatic\.com|fonts\.googleapis\.com|url\(['\"]?https?://" "${FONT_DIRS[@]}" 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 25: named trust-gate file-pins (invariants 8, 9, 21, 23, 61, 73) ──
# Each invariant below mandates a NAMED gate — a specific call that must run at a
# specific site. A refactor that renames the local field/method, or moves the
# file, silently removes the gate; these pins turn that into a loud failure that
# forces a conscious re-pin (update the table below). Presence is asserted against
# COMMENT-STRIPPED source (reusing strip_js_comments, which is string-aware) so a
# commented-out mention of the call can neither satisfy a pin nor mask a removal.
#
# Marker-gated on REPO_MARKER (pnpm-workspace.yaml) so the harness's throwaway
# fixture roots stay inert, exactly like Check 9 — the repo-shaped-root harness
# fixture plants all six files with their needles (plant_repo_shaped_root), so the
# marker-present harness cases stay green.
#
# The needle is deliberately refactor-sensitive: the gate's receiver/method name
# is part of it, so `this.projector.project(` → `this.projector.emit(`
# (Invariant #8) trips the pin. Where the qualified `Class.method(` spelling
# exists only in comments (admit()/relay()), the needle pins the real call site.
assert_pin() {
    local inv="$1"
    local file="$2"
    local needle="$3"
    local stripped
    if [[ ! -f "${file}" ]]; then
        violation "${inv}" "${file}: mandated trust-gate file is missing — it moved or was renamed; re-pin it in check-invariants.sh (Check 25)"
        return
    fi
    # Capture the stripped source first, THEN grep a here-string. Piping
    # strip_js_comments directly into `grep -q` is unsafe under `set -o pipefail`:
    # grep closes the pipe on its first match, the awk stripper dies with SIGPIPE,
    # and pipefail would propagate that non-zero status so `! pipeline` fires a
    # false violation exactly when the needle IS present.
    stripped=$(strip_js_comments "${file}")
    if ! grep -qF -- "${needle}" <<<"${stripped}"; then
        violation "${inv}" "${file}: mandated trust-gate '${needle}' not found in code — the gate was renamed or removed; re-pin it consciously (Check 25)"
    fi
}
if [[ -f "${REPO_MARKER}" ]]; then
    assert_pin "8" "electron/main/runtime/StateBroadcaster.ts" "this.projector.project("
    assert_pin "9" "electron/main/runtime/SessionRuntime.ts" "this.commitmentScheme.verify("
    assert_pin "21" "renderer/components/shell/GameShell.tsx" "assetManager.dispose("
    assert_pin "23" "electron/main/saves/FileSaveRepository.ts" "fs.rename(tmp, dest)"
    assert_pin "61" "electron/main/profile/ProfileGate.ts" "admit(rawProfile"
    assert_pin "73" "electron/main/lobby/LobbyManager.ts" "this.chatRelay.relay("
fi

# ─── Check 26: IPC handler registrations are contained (invariant 5) ──────────
# Invariant #5: all IPC methods are declared in ipc-handlers.ts (exposed through
# preload/api.ts). A non-comment ipcMain.handle()/ipcMain.on() registration may
# appear ONLY in the sanctioned barrel electron/main/ipc/ipc-handlers.ts and the
# debug bridge electron/main/debug-bridge.ts (the #3/#27 debug exception). A new
# IPC module must be added to the allowlist case below — that forced edit is the
# review point. Anchored on `ipcMain.` so unrelated EventEmitter/Electron APIs
# (protocol.handle, webContents.on, app.on, screen.on, proc.on) do not match.
# Test files (which build fake ipcMain objects) and comment lines are excluded.
if [[ -d electron/main ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            electron/main/ipc/ipc-handlers.ts) ;;
            electron/main/debug-bridge.ts) ;;
            *) violation "5" "${match}" ;;
        esac
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" \
            'ipcMain\.(handle|on)\(' electron/main 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 27: applyRestoredFile is the only disk→live-state entrypoint (inv 24) ─
# Invariant #24: SessionRuntime.applyRestoredFile() is the ONLY entry point for
# replacing the live GameSnapshot from a file. References to that identifier may
# resolve only to the composition root (electron/main/index.ts), the method's home
# (SessionRuntime.ts), the menu-restore coordinator (SessionRestoreCoordinator.ts),
# and the restored-host test harness (restored-host-harness.ts, a non-.test.ts file
# that mirrors the composition root's single apply helper). A new caller —
# production OR test-support — must be added to the allowlist case below; that
# forced edit is the review point. Comment lines (JSDoc citing the method) and
# test files are excluded.
if [[ -d electron/main ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            electron/main/index.ts) ;;
            electron/main/runtime/SessionRuntime.ts) ;;
            electron/main/runtime/SessionRestoreCoordinator.ts) ;;
            electron/main/__test-support__/restored-host-harness.ts) ;;
            *) violation "24" "${match}" ;;
        esac
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" \
            'applyRestoredFile' electron/main 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 28: TimerManager.advance() has one consumer (invariant 55) ─────────
# Invariant #55: the engine:tick reducer is the ONLY consumer of
# TimerManager.advance(). Game action reducers may create or cancel timers but must
# NOT call advance(). The sole sanctioned call site is
# simulation/engine/EngineActions.ts (the engine:tick reducer). The definition in
# simulation/engine/GameTimer.ts is a shorthand object method `advance(registry…`
# with no `TimerManager.` receiver, so it does not match the qualified-call
# pattern; and the unrelated ai/engine CommandScheduler.advance() is not matched
# either, because the pattern is anchored on the `TimerManager.` receiver.
TIMER_ADVANCE_DIRS=()
for timer_dir in simulation ai apps/*/simulation apps/*/ai; do
    [[ -d "${timer_dir}" ]] && TIMER_ADVANCE_DIRS+=("${timer_dir}")
done
if [[ ${#TIMER_ADVANCE_DIRS[@]} -gt 0 ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            simulation/engine/EngineActions.ts) ;;
            *) violation "55" "${match}" ;;
        esac
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            --exclude-dir="out" --exclude-dir=".next" --exclude-dir="dist" \
            'TimerManager\.advance\(' "${TIMER_ADVANCE_DIRS[@]}" 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 29: authoritative state carries no settings/camera/profile (32/57/59) ─
# Invariants #32/#57/#59: settings, camera parameters (zoom/lookAt/fov/position),
# and player-profile data (displayName/avatar) are NEVER stored in GameSnapshot,
# PlayerSnapshot, SaveFile, or any projection type — each has a separate,
# non-replayed lifecycle. Flags any of those field identifiers in the engine
# snapshot/persistence/projection dirs and per-game simulation.
#
# FP-adjudication path: `settings` is a common word and the highest false-positive
# risk in this set. The clean tree has zero hits. This grep honours NO suppression
# marker — a `@chimera-review:` comment records a reviewed exception for a human but
# does not silence the check. Clearing a genuine non-authoritative use means renaming
# the field, or adding a code-level exemption here (a pattern-exclusion or a `case`
# path-exempt, as Check 19 does for node:crypto).
#
# This is inlined rather than routed through check_grep so it can use the
# row-anchored comment filter: a field with a URL default (e.g.
# `avatar: 'https://…'`) contains `://`, which the shared loose filter would read
# as a `:` + `//` comment marker and silently drop — the exact violation this
# check exists to catch.
HYGIENE_DIRS=()
for hygiene_dir in simulation/engine simulation/persistence simulation/projection apps/*/simulation; do
    [[ -d "${hygiene_dir}" ]] && HYGIENE_DIRS+=("${hygiene_dir}")
done
if [[ ${#HYGIENE_DIRS[@]} -gt 0 ]]; then
    while IFS= read -r match; do
        violation "32/57/59" "${match}"
    done < <(
        grep -rnE \
            --include="*.ts" --include="*.tsx" --include="*.js" \
            --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="fixtures" --exclude-dir="node_modules" \
            --exclude-dir="out" --exclude-dir=".next" --exclude-dir="dist" \
            '\b(settings|zoom|lookAt|fov|displayName|avatar)\b' "${HYGIENE_DIRS[@]}" 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 30: engine CSS token discipline (invariants 109, 86, 85) ───────────
# (a) Invariant #109: engine UI motion keyframes live ONLY in
#     renderer/styles/animations.css; a module-local @keyframes in a component or
#     app *.module.css breaks token indirection (CSS Modules hash keyframe names).
# (b) Invariant #86: engine UI components (renderer/components/ui) reference
#     var(--ch-*) tokens — never a hardcoded hex/rgb/hsl colour literal.
# (c) Invariant #85: a game token OVERRIDE file (apps/<game>/styles) may only
#     REDEFINE tokens declared in renderer/styles/tokens.css; declaring a NEW
#     --ch-* name there is a module-boundary violation. This is the check that
#     would have caught an earlier tactics Button override that declared a new
#     --ch-button-* token absent from the engine tokens.css.

# 30(a): module-local @keyframes in component/app module CSS.
CSS_KEYFRAME_DIRS=()
for kf_dir in renderer/components renderer/app; do
    [[ -d "${kf_dir}" ]] && CSS_KEYFRAME_DIRS+=("${kf_dir}")
done
if [[ ${#CSS_KEYFRAME_DIRS[@]} -gt 0 ]]; then
    while IFS= read -r match; do
        violation "109" "${match}"
    done < <(
        grep -rnE --include="*.module.css" \
            --exclude-dir="node_modules" --exclude-dir="out" \
            --exclude-dir=".next" --exclude-dir="dist" \
            '@keyframes' "${CSS_KEYFRAME_DIRS[@]}" 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# 30(b): hardcoded colour literals in engine ui module CSS. Matches a hex literal
# (#rgb..#rrggbbaa) or an rgb()/rgba()/hsl()/hsla() function form. A 1–2 digit
# `#nn` invariant reference in a comment is too short for the {3,8} hex class, and
# full-line CSS comments are stripped by the shared filter — but a hex in a TRAILING
# comment still fires (as with the Check 21 float literal).
if [[ -d renderer/components/ui ]]; then
    while IFS= read -r match; do
        violation "86" "${match}"
    done < <(
        grep -rnE --include="*.module.css" \
            --exclude-dir="node_modules" --exclude-dir="out" \
            --exclude-dir=".next" --exclude-dir="dist" \
            '#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\(' renderer/components/ui 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# 30(c): a game override declaring a --ch-* name absent from tokens.css. The
# authority set is the --ch-* names DECLARED (name followed by `:`) in tokens.css;
# a `var(--ch-…)` REFERENCE (name followed by `)`) is not a declaration and is not
# collected. Scope is apps/*/styles only (Invariant #85's override surface).
# Known limitation: a --ch-* declaration inside a CSS comment in an override is a
# false positive — keep commentary off declaration-shaped lines.
TOKENS_FILE="renderer/styles/tokens.css"
if [[ -f "${TOKENS_FILE}" ]]; then
    tokens_declared=$(
        grep -oE '(^|[^A-Za-z0-9-])--ch-[a-zA-Z0-9-]+[[:space:]]*:' "${TOKENS_FILE}" \
            | grep -oE -- '--ch-[a-zA-Z0-9-]+' | sort -u
    )
    for override in apps/*/styles/*.css; do
        [[ -f "${override}" ]] || continue
        while IFS= read -r name; do
            [[ -z "${name}" ]] && continue
            if ! grep -qxF -- "${name}" <<<"${tokens_declared}"; then
                violation "85" "${override}: declares ${name}, which is not declared in ${TOKENS_FILE} (Invariant #85: a game override may only redefine engine tokens)"
            fi
        done < <(
            grep -oE '(^|[^A-Za-z0-9-])--ch-[a-zA-Z0-9-]+[[:space:]]*:' "${override}" \
                | grep -oE -- '--ch-[a-zA-Z0-9-]+' | sort -u
        )
    done
fi

# ─── Check 31: main-process logging & egress hygiene (invariants 67, 69) ──────
# (67) No raw console.* in electron/main production code — every manager logs via
#      its injected Logger child. The sole sanctioned exception is the startup
#      guard in electron/main/index.ts (it runs before the root logger exists and
#      writes the refusal reason to stderr via console.error). That file is
#      case-exempted here; it is comprehensively guarded by the no-console ESLint
#      zone over electron/main/** and pinned by
#      electron/main/__tests__/eslint-no-console.test.ts — this grep is a
#      complementary early-warning for the other main-process modules.
# (69) No automatic network egress from electron/main: no fetch() call and no
#      node http/https client import. Telemetry egress is the #69 target. The
#      custom chimera:// protocol (protocol.handle, supportFetchAPI) and Electron
#      did-navigate httpResponseCode params are not client calls and do not match
#      the narrow patterns below, so no exemption is needed.
MAIN_EGRESS_RE="\bfetch\(|(from|import\(|require\()[[:space:]]*['\"](node:)?https?['\"]"
if [[ -d electron/main ]]; then
    while IFS= read -r match; do
        file="${match%%:*}"
        case "${file}" in
            electron/main/index.ts) ;;
            *) violation "67" "${match}" ;;
        esac
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" --exclude-dir="__tests__" \
            --exclude-dir="__test-support__" \
            'console\.' electron/main 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
    while IFS= read -r match; do
        violation "69" "${match}"
    done < <(
        grep -rnE --include="*.ts" --exclude="*.test.ts" --exclude="*.test.tsx" \
            --exclude-dir="node_modules" --exclude-dir="__tests__" \
            --exclude-dir="__test-support__" \
            "${MAIN_EGRESS_RE}" electron/main 2>/dev/null \
        | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|/\*|\*)' \
        || true
    )
fi

# ─── Check 32: no raw r3f Canvas binding in a game app (invariant 127) ───────
# The belt-and-braces arm of Invariant #127: GameCanvas (role="main" |
# "overlay") is the only canvas root a game mounts, so no file under apps/*/
# may take the `Canvas` BINDING from '@react-three/fiber' on an import or
# re-export statement. The precise arm is ESLint `chimera/no-raw-r3f-canvas`;
# the split between the arms is recorded in the invariant. The mutation probe
# for this check: `import * as fiber` + `<fiber.Canvas>` keeps this check
# silent while the property is false — nothing on the import statement names
# Canvas — and is caught by the ESLint arm; dynamic import() destructuring is
# visible to neither.
#
# Statements are JOINED before matching (prettier splits long specifier
# lists, and a line grep goes blind on the split form): the awk pass emits
# one `path:line:statement` record per import/export statement, numbered at
# the statement's FIRST line. Only lines STARTING with import/export enter a
# record, which is also what excludes commented copies (`// import`,
# `* import`) — a leading-comment `/* x */ import` evades this check and is
# caught by the ESLint arm.
#
# Word-boundary by construction: the binding must follow `{` or `,`, so the
# engine's GameCanvas (a letter before Canvas) never matches; `Canvas as X`
# and the string-named `'Canvas' as X` do. Type-only forms are exempt — a
# type cannot mount a canvas (the ESLint arm's verdict, shared).
RAW_CANVAS_FIBER_RE="from[[:space:]]*['\"]@react-three/fiber['\"]"
RAW_CANVAS_BINDING_RE="[{,][[:space:]]*('Canvas'|\"Canvas\"|Canvas)[[:space:]]*(,|\}|as[[:space:]])"
# Statement-level `import type` / `export type` only: an INLINE `type X`
# specifier needs no exclusion leg, because the `type` keyword sits between
# the `{`/`,` delimiter and the name, so a type-qualified specifier can never
# match the binding RE above in the first place.
RAW_CANVAS_TYPE_RE="^[^:]*:[0-9]+:[[:space:]]*(import|export)[[:space:]]+type[[:space:]]"

# Emits one `path:line:statement` record per import/export statement in $1,
# multi-line statements joined onto one record. A statement ends on the first
# line carrying a quote (the specifier) or a trailing semicolon; non-import
# export statements (`export function …`) produce join noise that the fiber
# filter below discards, erring loud rather than silent.
check32_scan_file() {
    awk -v path="$1" -v sq="'" '
        {
            if (!joining) {
                if ($0 !~ /^[[:space:]]*(import|export)[[:space:]]/) next
                joining = 1; start = NR; buf = $0
            } else {
                buf = buf " " $0
            }
            if (index($0, sq) > 0 || index($0, "\"") > 0 || $0 ~ /;[[:space:]]*$/) {
                print path ":" start ":" buf
                joining = 0
            }
        }
    ' "$1"
}

# One filter for the real scan AND the anti-rot control below, over
# `path:line:statement` records.
check32_filter() {
    grep -E "${RAW_CANVAS_FIBER_RE}" \
        | grep -E "${RAW_CANVAS_BINDING_RE}" \
        | grep -vE "${RAW_CANVAS_TYPE_RE}" \
        || true
}

# Anti-rot control (the Check 9 lesson: a gate that cannot fail is a no-op).
# Every run first proves the REAL pipeline — the statement joiner and the
# filter — still catches known-bad fixtures (single-line and multi-line) and
# still passes the known-good ones. Fixture files are planted in a throwaway
# temp dir, so the control runs identically in the repo and in test harness
# fixture roots.
CHECK32_CONTROL_DIR=$(mktemp -d -t chimera-check32-control-XXXXXX)
cat > "${CHECK32_CONTROL_DIR}/bad.tsx" <<'CHECK32_EOF'
import { Canvas } from '@react-three/fiber';
import {
    useFrame,
    Canvas as Root,
} from '@react-three/fiber';
CHECK32_EOF
cat > "${CHECK32_CONTROL_DIR}/good.tsx" <<'CHECK32_EOF'
import { useFrame } from '@react-three/fiber';
import type { Canvas } from '@react-three/fiber';
import { GameCanvas } from '@chimera-engine/renderer/components/r3f';
// import { Canvas } from '@react-three/fiber';
CHECK32_EOF
CHECK32_BAD_HITS=$(check32_scan_file "${CHECK32_CONTROL_DIR}/bad.tsx" | check32_filter | wc -l | tr -d ' ')
CHECK32_GOOD_HITS=$(check32_scan_file "${CHECK32_CONTROL_DIR}/good.tsx" | check32_filter | wc -l | tr -d ' ')
rm -rf "${CHECK32_CONTROL_DIR}"
if [[ "${CHECK32_BAD_HITS}" != "2" ]]; then
    violation "127" ".claude/skills/invariants/scripts/check-invariants.sh:1: Check 32 negative control — the pipeline caught ${CHECK32_BAD_HITS}/2 planted violations; the gate has rotted, fix the joiner or the filter"
fi
if [[ "${CHECK32_GOOD_HITS}" != "0" ]]; then
    violation "127" ".claude/skills/invariants/scripts/check-invariants.sh:1: Check 32 negative control — the pipeline flags ${CHECK32_GOOD_HITS} known-good record(s); the gate over-fires"
fi

if [[ -d apps ]]; then
    while IFS= read -r check32_file; do
        while IFS= read -r match; do
            violation "127" "${match}"
        done < <(check32_scan_file "${check32_file}" | check32_filter)
    done < <(
        find apps \( -name node_modules -o -name dist -o -name out -o -name coverage \
                -o -name .next -o -name test-results \) -prune -o \
            -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' \) -print 2>/dev/null \
        | sort
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
