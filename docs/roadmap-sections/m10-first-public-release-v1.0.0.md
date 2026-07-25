---
title: 'M10 — First Public Release (v1.0.0)'
description: 'The first public 1.0.0 release of Chimera. Introduces the locked 1.X.Y versioning scheme: every @chimera-engine/* package and create-chimera-game share one version, kept in sync per milestone and re-published together on every patch. Carries F71 — an opt-in, renderer-only internationalization (i18n) system — and F72 — read-only spectator mode.'
tags:
    [
        milestone,
        m10,
        release,
        v1,
        versioning,
        semver,
        lock-step,
        create-chimera-game,
        publishing,
        i18n,
        internationalization,
        localization,
        spectator,
        multiplayer,
    ]
---

# M10 — First Public Release (v1.0.0)

> **Goal**: Cut Chimera's first public **`1.0.0`** release and adopt the **locked `1.X.Y` versioning scheme** across the whole published surface. From this milestone on, every `@chimera-engine/*` package and the `create-chimera-game` initializer ship at **one shared version**.
>
> **Status**: Open. Carries **F71 — Internationalization / i18n** and **F72 — Spectator Mode** (see Features below); further features may be added as work is planned.

---

## Versioning scheme (adopted at 1.0.0)

`1.0.0` is the first _public_ Chimera release, and from it forward the version is read as **`1.X.Y`**:

- **`1`** — the major "Chimera 1" line: the first public API surface.
- **`X`** (middle) — the **major/compatibility line**. It may contain breaking changes and is **synced across every package** (including `create-chimera-game`) so a matching `X` always signals mutual compatibility. A milestone advances `X` and resets the patch to `0` (`1.X.0`).
- **`Y`** (patch) — any package update between milestones. **All packages re-release together at the same `1.X.Y`**, even when only one changed, so the shared version always signals a compatible set.

Worked example (matches the design intent):

| Event                                                     | Resulting version (all packages) |
| --------------------------------------------------------- | -------------------------------- |
| M10 release                                               | `1.0.0`                          |
| `create-chimera-game` needs a fix                         | `1.0.1`                          |
| `@chimera-engine/ai` needs a fix                          | `1.0.2`                          |
| `@chimera-engine/simulation` new feature line (milestone) | `1.1.0`                          |

The complete rules, the lock-step rationale, and the release-time enforcement live in **[`docs/versioning-policy.md`](../versioning-policy.md)**.

---

## Enforcement

- **Changesets** are configured with a single `fixed` version group so a bump to any package bumps the whole set to one version (`.changeset/config.json`).
- A **`verify:version-alignment`** gate (`tools/version-alignment.ts`) fails the release if the published `@chimera-engine/*` packages and `create-chimera-game` are not all on the identical `1.X.Y`. It runs in the pre-release gate and in `release.yml` before publish.

---

## Features

### F71 — Internationalization / i18n

Introduces an **opt-in** internationalization system so a game can ship multiple UI
languages, while games that do not need it pay **zero cost** and see **no behaviour
change**. Realizes Appendix D.4 with an **in-house, renderer-only** translation runtime
(no new dependency) rather than `react-i18next`, keeping the deterministic simulation
**language-agnostic** — it emits stable identifiers/codes, and only the renderer maps
them to localised text.

The design reuses the established **manifest-declaration → registry-forward →
renderer-injector** pattern (F69 hardware cursor, F70 logo screen): a game **optionally**
declares its languages in `GameManifest` (`languages?`), contributes per-locale bundles
through `LoadedRendererGameShell.translations`, and the engine handles switching +
persistence through the existing `gameplay.language` setting (§4.13). The engine ships a
base English bundle for its own strings; games may **override any engine token** (e.g.
relabel the chat panel) and add their own. A `<LanguageSelector>` engine component (hidden
by default; games place it where they want) and a settings **Language** field drive the
choice, and a global **F4** debug hotkey renders raw tokens for auditing (shipped in #869
as a debug-inspector toggle, moved to the app-wide hotkey in #874 so it also works outside
a game). The runtime formats with an **ICU subset** (`{param}`, `{n, plural, …}`,
`{g, select, …}`). **Tactics** fully adopts the system as the reference: English + Czech,
all UI + game messages translated, Language as the first Gameplay settings entry.

| Task                                                              | Issue                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Optional `languages` declaration on `GameManifest` + resolver     | [#861](https://github.com/jindrichruzicka/Chimera/issues/861) |
| Translation runtime core (keys, bundles, fallback-chain resolver) | [#862](https://github.com/jindrichruzicka/Chimera/issues/862) |
| ICU-style message formatter (`{param}`, plural, select)           | [#863](https://github.com/jindrichruzicka/Chimera/issues/863) |
| Engine base English bundle + token catalogue                      | [#864](https://github.com/jindrichruzicka/Chimera/issues/864) |
| `I18nProvider` + `useTranslate()` hook                            | [#865](https://github.com/jindrichruzicka/Chimera/issues/865) |
| `LoadedRendererGameShell.translations` game-contribution seam     | [#866](https://github.com/jindrichruzicka/Chimera/issues/866) |
| `<LanguageSelector>` engine UI-barrel component                   | [#867](https://github.com/jindrichruzicka/Chimera/issues/867) |
| Settings `language` field + persistence                           | [#868](https://github.com/jindrichruzicka/Chimera/issues/868) |
| Debug-inspector "Show translation tokens" toggle                  | [#869](https://github.com/jindrichruzicka/Chimera/issues/869) |
| Tokenize engine components/pages via `useTranslate()`             | [#870](https://github.com/jindrichruzicka/Chimera/issues/870) |
| Tactics adoption (English + Czech, full UI/message translation)   | [#871](https://github.com/jindrichruzicka/Chimera/issues/871) |
| E2E, docs, and invariants (feature-review gate)                   | [#872](https://github.com/jindrichruzicka/Chimera/issues/872) |

Feature issue: [#860](https://github.com/jindrichruzicka/Chimera/issues/860).

**Out of scope (deferred):** RTL/bidi layout, locale-aware number/date/currency
formatting (beyond ICU plural/select on counts), OS/profile-locale auto-detection,
content-database data translation, and a key-extraction tool — all candidates for a
follow-up.

### F72 — Spectator Mode

Lets a peer **watch a running match** it did not join, fixing the previously
broken join-in-progress path (a mid-match join used to fabricate a phantom seat).
A **spectator** is a read-only session viewer: it is never a participant — never
in `GameSnapshot.players`, the host's seat ledger, saves, or replays — and
everything it sees crosses the wire as an already-projected `PlayerSnapshot`
through the single `StateProjector.project()` gate (Invariants #3 / #8 / #98), so
spectating leaks nothing a seated viewer could not already see.

Spectating is **opt-in per game and off per match**, reusing the established
**manifest-declaration → registry-forward → host-toggle** shape: a game declares
the capability in `GameManifest` (`spectators: { mode: 'perspective' }`), and the
host enables it per match through the reserved, host-authored `engine.allowSpectators`
match setting (off by default, synced verbatim in `snapshot.setup`). The host's
join classifier admits a running-match join as a spectator only when both gates
pass, else cleanly rejects it (`spectators_disabled` when the capability is
present but the toggle is off, `match_in_progress` when the game declares none) —
lobby and reconnect joins stay players, unchanged. An admitted spectator follows
one seated player through the host-local `SpectatorRegistry`, is pushed that
seat's perspective, and re-points to another seat through the **out-of-band**
`SPECTATE_TARGET_UPDATE` channel (never an `EngineAction`, never advancing `tick`
— the analog of CHAT/PROFILE_UPDATE). The renderer treats a spectator as
read-only: controls locked, no host-only save, `sendAction` inert, and a
perspective HUD with a **Tab** switch hotkey. **Tactics** is the reference
adopter. Ratifies **Invariants #114** (read-only viewers) and **#115** (out-of-band
perspective switch); see the [Spectator Mode Contract](../core-components/spectator-mode-contract.md).

| Task                                                                   | Issue                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Spectator contract & wire types (roles, WELCOME role, reject, message) | [#876](https://github.com/jindrichruzicka/Chimera/issues/876) |
| `GameManifest.spectators` capability, resolver, reserved match-setting | [#877](https://github.com/jindrichruzicka/Chimera/issues/877) |
| Classify a running-match join as spectator or reject                   | [#878](https://github.com/jindrichruzicka/Chimera/issues/878) |
| Spectator viewer registry + perspective projection broadcast           | [#879](https://github.com/jindrichruzicka/Chimera/issues/879) |
| Perspective switching (`SPECTATE_TARGET_UPDATE` message + IPC)         | [#880](https://github.com/jindrichruzicka/Chimera/issues/880) |
| Renderer spectator UX: read-only board, perspective HUD, hotkey        | [#881](https://github.com/jindrichruzicka/Chimera/issues/881) |
| Tactics adoption: allow-spectators toggle, manifest, read-only board   | [#882](https://github.com/jindrichruzicka/Chimera/issues/882) |
| E2E, docs, and invariants #114/#115 (feature-review gate)              | [#883](https://github.com/jindrichruzicka/Chimera/issues/883) |

Feature issue: [#875](https://github.com/jindrichruzicka/Chimera/issues/875).

**Out of scope (deferred):** relay/observer counts in the lobby UI, spectator
chat, latency/late-join catch-up buffering, and spectating a replay rather than a
live match — all candidates for a follow-up.

### F74 — Audio Cues, Fades & Crossfade

Lands the design-stage **Cue, Fade & Crossfade Extensions** of the Audio System
(§4.25) as working, TDD'd code, adding five renderer-only capabilities on top of
the existing 32-voice pool and three-stage bus graph **without reshaping either**:
**play-from-cue**, **play-to-cue**, **loop points**, **fades** (fade-in,
fade-out-to-end-or-cue, fade-to-hold), and **crossfade / two simultaneous tracks**.
Every new behaviour writes only a voice's own **stage-1 `GainNode`** and leans on
native `AudioBufferSourceNode` scheduling (`start(when, offset, duration)`,
`loopStart`/`loopEnd`, `source.stop(when)`) rather than JS timers, so all timing is
driven by `AudioContext.currentTime` and nothing crosses into the deterministic
simulation (Invariant #63).

Cue sheets are authored **sim-side** as opaque `AudioClipMetadata` in the existing
`AssetManifestEntry.metadata` slot (typed `unknown`, extends Invariant #20) and
parsed **only** by `renderer/audio`; `validate-assets` range-checks every cue at
build time. Cue resolution is **fail-soft** — an unresolvable load-bearing cue
abandons that play with a warning rather than throwing. Live-handle verbs
(`fadeOut`/`fadeTo`/`crossfade`) reach the manager through a new
`useMusicTrack`/`useAudioHandle` hook (via `useAudioManager()` only, Invariant #84),
while the public `AudioHandle` gains no fields. This feature graduates design-stage
invariants **#116–#126** into the enforced/roll-called set. **Tactics**
(`apps/tactics`) is the reference adopter.

| Task                                                                      | Issue                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Sim-side cue-sheet types (`AudioCueName`, `AudioClipMetadata`)            | [#910](https://github.com/jindrichruzicka/Chimera/issues/910) |
| `audioClipEntry` manifest authoring builder                               | [#911](https://github.com/jindrichruzicka/Chimera/issues/911) |
| Renderer Cue/fade types + fail-soft `parseAudioCueSheet` + resolver       | [#912](https://github.com/jindrichruzicka/Chimera/issues/912) |
| `AssetManager.getManifestMetadata` read channel                           | [#913](https://github.com/jindrichruzicka/Chimera/issues/913) |
| Stage-1 gain ramp primitive (cancel-and-reanchor, curves, feature-detect) | [#914](https://github.com/jindrichruzicka/Chimera/issues/914) |
| `from`/`to`/`loopRegion` in `play()` + two-tier cue validation            | [#915](https://github.com/jindrichruzicka/Chimera/issues/915) |
| `fadeIn` + `VoiceRecord` phase/intent + atomic `t0` application           | [#916](https://github.com/jindrichruzicka/Chimera/issues/916) |
| `AudioManager.fadeOut` (timer-free single-release)                        | [#917](https://github.com/jindrichruzicka/Chimera/issues/917) |
| `AudioManager.fadeTo` (ramp-to-absolute-and-hold)                         | [#918](https://github.com/jindrichruzicka/Chimera/issues/918) |
| `AudioManager.crossfade` (linked fade on a shared `t0`)                   | [#919](https://github.com/jindrichruzicka/Chimera/issues/919) |
| Voice-preemption rework + `MUSIC_PRIORITY`                                | [#920](https://github.com/jindrichruzicka/Chimera/issues/920) |
| `useSound` keys + `useMusicTrack`/`useAudioHandle` hook                   | [#921](https://github.com/jindrichruzicka/Chimera/issues/921) |
| `validate-assets` cue-sheet build gate                                    | [#922](https://github.com/jindrichruzicka/Chimera/issues/922) |
| E2E, docs, and invariants #116–#126 (feature-review gate)                 | [#923](https://github.com/jindrichruzicka/Chimera/issues/923) |

Feature issue: [#909](https://github.com/jindrichruzicka/Chimera/issues/909).

**Out of scope (deferred):** variable playback rate / pitch-shift / time-stretch
(the rate is fixed at `1`), a higher-level `MusicDirector` layer, per-cue DSP
effects / filters / EQ / reverb and 3D/spatial/HRTF panning, streaming
(`MediaElementAudioSource`) playback, resizing the 32-voice pool or reshaping the
three-stage bus graph, and cross-clip / global cue registries — all candidates for
a follow-up.

### F75 — Standalone-Reachable Font Self-Hosting Tooling

The Google-Fonts self-hosting downloader — the development-time tooling that Invariant #97 names as the only sanctioned way to bring game fonts on-disk — was reachable only inside the monorepo (`pnpm fetch:fonts`, tsx). F75 relocates it from repo-root `tools/fetch-google-fonts.ts` into a dedicated tooling subdirectory of the already-published `@chimera-engine/electron` package (`electron/dev-tools/fetch-google-fonts/`) and exposes it as a `chimera-fetch-fonts` bin, replaying the shipped `chimera-dev-mp` pattern (pre-built node JS, `#!/usr/bin/env node` shebang, `isDirectInvocation` entry) — zero new publish/version surface, no Changesets `fixed`-array or verify-list edits. Its two monorepo-layout assumptions (output dir + emitted `src` prefix) are parameterized behind byte-for-byte-compatible defaults, so `pnpm fetch:fonts -- --game <id> --url <css>` (root cwd) is unchanged. The `create-chimera-game` blank template gains an `assets/fonts/` convention, a `shell/fonts.ts` `gameFonts` stub forwarded through `renderer/loaders.ts`, and a scaffolded app-level `fetch:fonts` script naming the bare bin with an explicit `--out-dir assets/fonts` — so that when pnpm runs the script with cwd = `apps/<kebab>`, the `.woff2` files land in the game's own asset dir instead of a doubled `apps/<kebab>/apps/<kebab>/…` path, and a fresh standalone game self-hosts fonts on day one. Upholds (does not graduate) **Invariants #97, #52, #22, #20**; Tactics remains the reference adopter of the `GameFontFace[]` shape.

| Task                                                                                | Issue                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Relocate fetch-google-fonts into `electron/dev-tools/` and repoint every reference  | [#925](https://github.com/jindrichruzicka/Chimera/issues/925) |
| Parameterize output dir + emitted src prefix with byte-for-byte defaults            | [#926](https://github.com/jindrichruzicka/Chimera/issues/926) |
| Expose the tool as the `chimera-fetch-fonts` bin from `@chimera-engine/electron`    | [#927](https://github.com/jindrichruzicka/Chimera/issues/927) |
| Wire the blank scaffold: `assets/fonts`, `shell/fonts.ts`, `fonts:` forward, script | [#928](https://github.com/jindrichruzicka/Chimera/issues/928) |
| Docs, roadmap F75 entry, and the F75 feature-review gate                            | [#929](https://github.com/jindrichruzicka/Chimera/issues/929) |

Feature issue: [#924](https://github.com/jindrichruzicka/Chimera/issues/924).

**Out of scope (deferred):** no new published package (rejected the five-surface tax of a dedicated CLI package); no `readFlagValue` arg-parser hardening; no migration/re-fetch of existing games' fonts; `--game` stays required; no standalone root-level `fetch:fonts` script (its cwd would mis-root `--out-dir`); the scaffold ships an empty `gameFonts` stub (no auto-population) — all candidates for a follow-up.

### F76 — Standalone-Reachable Asset-Reference Validation

Makes the `validate-assets` build-time guard (Invariants #52/#22, and #20 by living outside `simulation/`) reachable by standalone games — the third sibling of the M10 dev-tooling-reachability arc after the fonts downloader (F75) and alongside the harness (§4.32). The tool relocates from the never-published repo-root `tools/` into `electron/dev-tools/validate-assets/` inside the already-published `@chimera-engine/electron`, and ships as the `chimera-validate-assets` bin exactly as `chimera-dev-mp` does. Two distribution facts drive the work. First, the relocated tool has a genuine runtime dependency on the `typescript` package (it uses `createSourceFile`/`forEachChild`/`isCallExpression` values for its on-demand-load AST scan) that `electron/package.json` does not declare — it only works today via root-devDep hoisting, the exact under-declaration `verify:pack` exists to catch — so shipping the bin requires adding `typescript` as a real electron dependency. Second, and contrary to first appearances, there is no layout problem to solve: a standalone project scaffolded by `create-chimera-game` is not flat — it places the game at `apps/<kebab>` under an `apps/*` pnpm workspace — so the existing monorepo discovery, pointed at the project root, already scans `apps/*`, finds the single game, and resolves `<root>/apps/<kebab>/assets/…` byte-for-byte.

The feature therefore adds no `ProjectLayout` or flat-mode abstraction. The only new surface is a scaffolded **app-level** `validate:assets` script, `chimera-validate-assets ../..`, which from cwd = `apps/<kebab>` resolves the positional workspace root to the project root and reuses the unmodified discovery. The script is app-level for two concrete reasons — pnpm links the bin only into `apps/<kebab>/node_modules/.bin`, and app-level cwd makes `../..` point at the project root (a root-cwd run would resolve above the project and pass vacuously on an empty `apps/*`). The F76 gate extends `verify:scaffold` end-to-end: the scaffolded game passes with good refs, fails non-zero the moment a broken ref is planted (the non-vacuity proof), and the bin resolves `typescript` from electron's own declared dependency in a clean install. This authors no new invariant — #52/#22/#20 are already enforced — so the gate roll-calls them upheld rather than graduating anything.

| Task                                                                                                                       | Issue                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Relocate validate-assets into electron/dev-tools/ and repoint every LIVE reference                                         | [#931](https://github.com/jindrichruzicka/Chimera/issues/931) |
| Expose the chimera-validate-assets bin and declare electron's runtime typescript dependency                                | [#932](https://github.com/jindrichruzicka/Chimera/issues/932) |
| Wire the blank scaffold: an app-level validate:assets script pointing discovery at the project root                        | [#933](https://github.com/jindrichruzicka/Chimera/issues/933) |
| Finalize docs, roadmap F76 entry, and the F76 feature-review gate (verify-scaffold broken/good + typescript-clean-install) | [#934](https://github.com/jindrichruzicka/Chimera/issues/934) |

Feature issue: [#930](https://github.com/jindrichruzicka/Chimera/issues/930).

**Out of scope (deferred):** No new published package. A dedicated `@chimera-engine/cli` home is rejected (multiple enforcement-list + Changesets `fixed`-array edits for one dev script); the tool rides electron's existing bin/version/verify surface — the F75 precedent; No `ProjectLayout`/flat-mode abstraction, and no `--flat`/`--game-root`/`--game-id` flags. The scaffold keeps the `apps/<kebab>` shape under an `apps/*` workspace, so the existing monorepo discovery pointed at the project root (via the app-level script's `../..`) validates the game non-vacuously with zero new tool code; a flat mode is a follow-up only if a future scaffold ever drops the `apps/` prefix; No root-level `validate:assets` script. App-level only, because pnpm links the bin into `apps/<kebab>/node_modules/.bin` (not the project root's) AND app-level cwd = `apps/<kebab>` makes `../..` resolve to the project root; a root-cwd run would resolve above the project, scan a nonexistent `apps/*`, and pass vacuously; No `readFlagValue` hardening. No new flags are introduced; the naive positional `argv[0]` workspace-root parsing is untouched — a robust arg parser stays a follow-up; No migration of existing games. `apps/tactics` keeps the monorepo default (`pnpm validate:assets`, cwd = repo root) — all candidates for a follow-up.

### F77 — Standalone-Reachable Platform Icon-Set Generation

Repo-root `tools/generate-icons.ts` derives the whole platform icon set — loose PNGs, the `chimera.png` runtime default, and the `.icns`/`.ico` containers — from one master logo, but it lives in the unpublished root package, so a standalone game that ships its own master has no way to run it. F77 relocates the generator into `electron/dev-tools/generate-icons/` inside the already-published `@chimera-engine/electron` and exposes it as a `chimera-generate-icons` bin, reusing the `chimera-dev-mp` BIN pattern — including the package's `isDirectInvocation` entry gate, which realpath-canonicalizes both the module URL and `argv[1]` so the bin actually runs when a scaffolded game invokes it through its `node_modules/.bin` symlink rather than silently no-opping. The distinguishing concern is dependency weight: the tool's `sharp` (a large native binary) and `png2icons` codecs must not become runtime dependencies of electron, or every game install — most of which never regenerate icons — would drag in the native binary.

The fix keeps both codecs OUT of electron's `dependencies`, declares them as OPTIONAL peer dependencies (which pnpm/npm do not auto-install), and lazily `await import()`s them inside the generate path with a clear actionable error when they are absent, so the base game install stays exactly as lean as today. The blank scaffold gains an opt-in `icons:generate` script and documents the real icon-consumption path — what electron-builder derives from the top-level `icon:` field, what the `resolveAppIcon` fallback reads, and how the `from: assets/icons` repoint brands the shipped set — and a verify-scaffold step proves the bin is reachable and runnable through the project's `.bin` symlink while the codec-absent path reports the actionable message, the end-to-end proof that reachability did not cost install weight.

| Task                                                                                                | Issue                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Relocate generate-icons into electron/dev-tools/ and repoint every reference                        | [#936](https://github.com/jindrichruzicka/Chimera/issues/936) |
| Lazy-import sharp + png2icons as optional peer deps with an actionable missing-dep error            | [#937](https://github.com/jindrichruzicka/Chimera/issues/937) |
| Expose the tool as the chimera-generate-icons bin with a symlink-safe isDirectInvocation entry gate | [#938](https://github.com/jindrichruzicka/Chimera/issues/938) |
| Wire the blank scaffold icons:generate script and document the real icon-consumption path           | [#939](https://github.com/jindrichruzicka/Chimera/issues/939) |
| Finalize docs, roadmap F77 entry, and the F77 verify-scaffold feature-review gate                   | [#940](https://github.com/jindrichruzicka/Chimera/issues/940) |

Feature issue: [#935](https://github.com/jindrichruzicka/Chimera/issues/935).

**Out of scope (deferred):** No new published package. A dedicated `@chimera-engine/cli` home is rejected (five enforcement-list edits + a Changesets `fixed`-array edit for a single dev script); the tool rides electron's existing bin/version/verify surface, exactly as `chimera-dev-mp` and `chimera-fetch-fonts`; No `--basename` flag. The generated stem stays `chimera` so a game that repoints `electron-builder.yml` `from: assets/icons` at its own generated set gets a branded fallback under the `chimera.png` filename the host's `resolveAppIcon` resolves; a configurable basename is a follow-up; No auto-generation on scaffold and no auto-installed codecs. The `icons:generate` script and the `sharp`/`png2icons` install are opt-in; forcing either onto every scaffold would re-impose the native-binary cost on games that never regenerate icons; No auto-rewiring of the consumer's icon fields. The tool writes the engine-shaped set; the scaffold documents which fields a game repoints (electron-builder top-level `icon:`, manifest `icon`, the `from: assets/icons` fallback) to actually consume it — rewriting them at generate time is out of scope; No `readFlagValue` hardening. The naive positional `--source`/`--out` parser is preserved as-is; a robust parser is a shared follow-up with the sibling tooling features; No migration of existing games. The engine and `apps/tactics` keep their committed icon sets; this feature does not re-generate them — all candidates for a follow-up.

### F78 — Standalone-Reachable Architectural-Invariant Lint Preset

Standalone games ship with the published `@chimera-engine/*` packages and nothing of the repo-root `tools/` tree, so the seven architectural-invariant ESLint rules — the executable form of the determinism, design-token, and engine-boundary invariants — never reach a scaffolded game. A fresh game's `eslint .` is broken out of the box (no flat config is emitted and the ESLint extension is deliberately unrecommended), which means a `fromFloat()` in a game's `simulation/` reducer or a hardcoded colour in a screen's CSS passes review unflagged. F78 closes that gap the way F75 closed it for fonts: it relocates the rules into the already-published `@chimera-engine/electron` package, compiles them so the plugin ships as real JS (retiring the `plugin.cjs` runtime-tsx hack), and exposes both the plugin and a curated flat-config preset at a new `@chimera-engine/electron/eslint` subpath — the SUBPATH-EXPORT pattern proven by `verify-packaged-bundle`, not a bin.

The scaffold gains an `eslint.config.mjs` that composes the preset as a focused overlay onto a game's flat zones (`simulation/`, `ai/`, `screens/`, plus the CSS token arm), leaving the game to own its base config, and a token-override CSS stub so the token guardrail is live from the first commit; the monorepo's own root config is repointed at the same compiled subpath so the engine and every standalone game run byte-identical rules from one source. The merge-readiness gate is a `verify:scaffold` assertion that a freshly scaffolded game lints GREEN clean AND that planted `fromFloat()`, unknown-token, and hardcoded-design-value violations are each reported by their rule id — proving the rules actually FIRE out of the monorepo, not merely that the config resolves.

| Task                                                                                      | Issue                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Design + curate the standalone lint-preset surface as a rules manifest                    | [#942](https://github.com/jindrichruzicka/Chimera/issues/942) |
| Relocate the rules into electron, compile to dist, and repair the token-path coupling     | [#943](https://github.com/jindrichruzicka/Chimera/issues/943) |
| Export the plugin at the eslint subpath, repoint the root config, and retire the tsx tree | [#944](https://github.com/jindrichruzicka/Chimera/issues/944) |
| Export the games-facing standaloneLintConfig overlay preset factory                       | [#945](https://github.com/jindrichruzicka/Chimera/issues/945) |
| Wire the blank scaffold to ship and run the lint preset                                   | [#946](https://github.com/jindrichruzicka/Chimera/issues/946) |
| Docs, roadmap F78, and the verify-scaffold clean-plus-planted-violation gate              | [#947](https://github.com/jindrichruzicka/Chimera/issues/947) |

Feature issue: [#941](https://github.com/jindrichruzicka/Chimera/issues/941).

**Out of scope (deferred):** No new published package. A dedicated `@chimera-engine/eslint-config` home is rejected for the same reason F75 rejected a CLI package — multiple enforcement-list + Changesets `fixed`-array edits for one dev surface; the rules ride electron's existing dist/version/verify surface like `chimera-dev-mp` and `packaged-bundle`; No full opinionated base config. The preset is an OVERLAY (Chimera rule blocks + zone globs + CSS token arm) layered on the game's own TS base, never owning the game's parser options, ignores, or Prettier compatibility; No extension of the engine-internal boundary rules to games. `no-main-games-import` / `no-main-provider-internals` / `no-shell-games-import` stay scoped to the engine's `electron/main/` and `renderer/app/` shell — a game's `electron/main.ts` composition root legitimately names its game and wires its provider; No retune of the engine's own lint semantics. Every existing monorepo rule zone, severity, and exemption (incl. the fromFloat test-file relaxation and the `no-console` ratchet) is preserved verbatim; F78 relocates the machinery, it does not re-tune the config; No formatter opinions. The scaffold recommends the ESLint extension but ships no Prettier config or `.editorconfig`; formatting stays out of the guardrail scope; No new rules or arg-parser hardening. No invariant is authored and no rule logic is rewritten beyond the token-path resolution repair — all candidates for a follow-up.

---

## Cross-References

- [Versioning Policy](../versioning-policy.md) — the canonical `1.X.Y` lock-step rules and enforcement.
- [Product Roadmap (Index Hub)](../ROADMAP.md) — milestone/version overview.
- [M9 — Package Extraction & Game Scaffolding (v0.9.0)](m9-package-extraction-v0.9.0.md) — the package hierarchy this scheme locks together.
