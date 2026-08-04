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
`useMusicTrack` hook (via `useAudioManager()` only, Invariant #84),
while the public `AudioHandle` gains no fields. This feature graduates design-stage
invariants **#116–#126** into the enforced/roll-called set (total 115 → 126). **Tactics**
(`apps/tactics`) is the reference adopter.

Reaching an adopter took one decision the design had left open (#923): the hooks were
renderer **internals**, so Invariant #96 kept every game out of them and the feature had no
caller outside its own tests. F74 closes that with a sixth public barrel,
**`@chimera-engine/renderer/audio`** — `useSound`, `useMusicTrack`, `useAudioManager`, an
`AudioManagerProvider` a game's tests can mount, and the cue/fade option types — which moves
Invariant #96, mechanical check 17, the `no-game-renderer-internals` rule, and the package
exports contract in step. Tactics then adopts the surface for real —
two loop-cued ambience beds authored through `audioClipEntry`, crossfaded as the turn
passes — which also gives Invariant #125's build gate its first production input (before
this, no in-repo manifest carried `metadata`, so `pnpm validate:assets` exercised it
vacuously).

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
| `useSound` keys + the `useMusicTrack` live-handle hook                    | [#921](https://github.com/jindrichruzicka/Chimera/issues/921) |
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

Makes the `validate-assets` build-time guard (Invariants #52/#22, and #20 by living outside `simulation/`) reachable by standalone games — the third sibling of the M10 dev-tooling-reachability arc after the fonts downloader (F75) and alongside the harness (§4.32). The tool relocates from the never-published repo-root `tools/` into `electron/dev-tools/validate-assets/` inside the already-published `@chimera-engine/electron`, and ships as the `chimera-validate-assets` bin exactly as `chimera-dev-mp` does. Two distribution facts drive the work. First, the relocated tool has a genuine runtime dependency on the `typescript` package (it uses `createSourceFile`/`forEachChild`/`isCallExpression` values for its on-demand-load AST scan) that `electron/package.json` did not declare — it worked only via root-devDep hoisting, the exact under-declaration `verify:pack` exists to catch. In the event that dependency had to land with the RELOCATION rather than with the bin: electron’s build emits every non-test `.ts` under it and `files: ["dist"]` publishes the result, so the moment the tool moved in, its runtime import shipped and `verify:publish` went red. Second, and contrary to first appearances, there is no layout problem to solve: a standalone project scaffolded by `create-chimera-game` is not flat — it places the game at `apps/<kebab>` under an `apps/*` pnpm workspace — so the existing monorepo discovery, pointed at the project root, already scans `apps/*`, finds the single game, and resolves `<root>/apps/<kebab>/assets/…` byte-for-byte.

The feature therefore adds no `ProjectLayout` or flat-mode abstraction. The only new surface is a scaffolded **app-level** `validate:assets` script, `chimera-validate-assets ../..`, which from cwd = `apps/<kebab>` resolves the positional workspace root to the project root and reuses the unmodified discovery. The script is app-level for two concrete reasons — a standalone root carries no `@chimera-engine/electron` for pnpm to link the bin from, and app-level cwd makes `../..` point at the project root (a root-cwd run would resolve above the project entirely). Building it surfaced two silent-success defects worth more than the relocation itself. The tool carried the same naive `isDirectInvocation` F75 had just removed from the fonts downloader, so under a pnpm bin shim the published validator would have exited 0 printing nothing — measured, and invisible to the direct-`node dist/…` smoke. And pointed at a root with no `apps/` it reported `Checked 0 asset refs; all files exist.` — success about a tree it never read, reachable by running the bin bare from a game package. It now refuses, naming the cause and the fix. The F76 gate extends `verify:scaffold` end-to-end: the scaffolded game passes with good refs, fails non-zero the moment a broken ref is planted (the non-vacuity proof), and the installed package carries `typescript` in its own declared dependencies (read off the manifest, since under pnpm no resolution can distinguish that from a root hoist). This authors no new invariant — #52/#22/#20 are already enforced — so the gate roll-calls them upheld rather than graduating anything.

| Task                                                                                                                       | Issue                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Relocate validate-assets into electron/dev-tools/ and repoint every LIVE reference                                         | [#931](https://github.com/jindrichruzicka/Chimera/issues/931) |
| Expose the chimera-validate-assets bin and declare electron's runtime typescript dependency                                | [#932](https://github.com/jindrichruzicka/Chimera/issues/932) |
| Wire the blank scaffold: an app-level validate:assets script pointing discovery at the project root                        | [#933](https://github.com/jindrichruzicka/Chimera/issues/933) |
| Finalize docs, roadmap F76 entry, and the F76 feature-review gate (verify-scaffold broken/good + typescript-clean-install) | [#934](https://github.com/jindrichruzicka/Chimera/issues/934) |

Feature issue: [#930](https://github.com/jindrichruzicka/Chimera/issues/930).

**Out of scope (deferred):** No new published package. A dedicated `@chimera-engine/cli` home is rejected (multiple enforcement-list + Changesets `fixed`-array edits for one dev script); the tool rides electron's existing bin/version/verify surface — the F75 precedent; No `ProjectLayout`/flat-mode abstraction, and no `--flat`/`--game-root`/`--game-id` flags. The scaffold keeps the `apps/<kebab>` shape under an `apps/*` workspace, so the existing monorepo discovery pointed at the project root (via the app-level script's `../..`) validates the game non-vacuously with zero new tool code; a flat mode is a follow-up only if a future scaffold ever drops the `apps/` prefix; No root-level `validate:assets` script. App-level only, because pnpm links the bin into `apps/<kebab>/node_modules/.bin` (not the project root's) AND app-level cwd = `apps/<kebab>` makes `../..` resolve to the project root; a root-cwd run would resolve above the project and is now refused rather than passing vacuously; No `readFlagValue` hardening. No new flags are introduced; the naive positional `argv[0]` workspace-root parsing is untouched — a robust arg parser stays a follow-up; No migration of existing games. `apps/tactics` keeps the monorepo default (`pnpm validate:assets`, cwd = repo root) — all candidates for a follow-up.

### F77 — Standalone-Reachable Platform Icon-Set Generation

The platform icon-set generator derives the whole set — loose PNGs, the `chimera.png` runtime default, and the `.icns`/`.ico` containers — from one master logo, but it lived in the unpublished root package, so a standalone game that ships its own master had no way to run it. F77 relocates the generator into `electron/dev-tools/generate-icons/` inside the already-published `@chimera-engine/electron` and exposes it as a `chimera-generate-icons` bin, reusing the `chimera-dev-mp` BIN pattern — including the package's `isDirectInvocation` entry gate, which realpath-canonicalizes both the module URL and `argv[1]` so the bin actually runs when a scaffolded game invokes it through its `node_modules/.bin` symlink rather than silently no-opping. The distinguishing concern is dependency weight: the tool's `sharp` codec (a large native binary) must not become a runtime dependency of electron, or every game install — most of which never regenerate icons — would drag it in.

The fix keeps the codec OUT of electron's `dependencies`, declares it as an OPTIONAL peer dependency (which package managers do not auto-install), and lazily `await import()`s it inside the generate path with a clear actionable error when they are absent — the lazy load being the load-bearing half, since a module-top import throws while the module is loading, before any message can be printed, in exactly the install the design exists to support. Building it turned up three silent-failure modes worth more than the relocation itself. The relocation alone reddened `verify:publish`: moving into a published package ships the tool's imports, so the codec had to be declared with the MOVE rather than with the bin. The tool carried the same naive `isDirectInvocation` F75 and F76 had already removed twice — measured against the built artifact, through a symlink the naive gate exits 0 having written **zero** files while the shared gate writes eleven. And the CLI derived its default paths from its own module location, which is correct only from source: from `dist/dev-tools/generate-icons/` the same walk lands on the installed package root, pointing the published bin at paths no consumer has. It now takes them from cwd, like every sibling dev-tool.

The blank scaffold gains an opt-in `icons:generate` script naming both flags — only one of the two omissions is loud, and it is not the dangerous one — and documents the real icon-consumption path honestly: replacing the single committed `assets/icons/icon.png` is the whole rebrand for both icons a player sees, while the generated set feeds only the `resolveAppIcon` fallback, reached through a `from:` repoint. The F77 gate extends `verify:scaffold` end-to-end, and earned its place on its first real run: it found that every scaffolded game was installing the codec anyway, because the frozen toolchain snapshot the scaffold's root manifest inherits is derived from the monorepo's root devDeps — where it lives for the engine's own `icons:generate`. The optional-peer declaration was correct and was being defeated upstream of itself. The snapshot now excludes it explicitly, and the gate asserts the whole chain against a real installed probe: the bin resolves under the app's `node_modules/.bin`, the codec appears in neither the app's nor the project's own `node_modules`, the installed manifest declares it as an optional peer and not a dependency, and a run **through the script** either writes the set or refuses with the actionable message. (That last arm originally required a non-zero exit, which only held while a second codec, `png2icons`, was also needed; once container assembly moved in-tool and that codec was dropped, the arm was regraded on work done — an exit 0 having written nothing is the failure it exists to catch. See the F77 follow-up in the CHANGELOG.) This authors no new invariant — #5, #27 (spirit) and #20 are roll-called upheld.

| Task                                                                                                | Issue                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Relocate generate-icons into electron/dev-tools/ and repoint every reference                        | [#936](https://github.com/jindrichruzicka/Chimera/issues/936) |
| Lazy-import sharp as an optional peer dep with an actionable missing-dep error                      | [#937](https://github.com/jindrichruzicka/Chimera/issues/937) |
| Expose the tool as the chimera-generate-icons bin with a symlink-safe isDirectInvocation entry gate | [#938](https://github.com/jindrichruzicka/Chimera/issues/938) |
| Wire the blank scaffold icons:generate script and document the real icon-consumption path           | [#939](https://github.com/jindrichruzicka/Chimera/issues/939) |
| Finalize docs, roadmap F77 entry, and the F77 verify-scaffold feature-review gate                   | [#940](https://github.com/jindrichruzicka/Chimera/issues/940) |

Feature issue: [#935](https://github.com/jindrichruzicka/Chimera/issues/935).

**Out of scope (deferred):** No new published package. A dedicated `@chimera-engine/cli` home is rejected (five enforcement-list edits + a Changesets `fixed`-array edit for a single dev script); the tool rides electron's existing bin/version/verify surface, exactly as `chimera-dev-mp` and `chimera-fetch-fonts`; No `--basename` flag. The generated stem stays `chimera` so a game that repoints `electron-builder.yml` `from: assets/icons` at its own generated set gets a branded fallback under the `chimera.png` filename the host's `resolveAppIcon` resolves; a configurable basename is a follow-up; No auto-generation on scaffold and no auto-installed codecs. The `icons:generate` script and the `sharp` install are opt-in; forcing either onto every scaffold would re-impose the native-binary cost on games that never regenerate icons; No auto-rewiring of the consumer's icon fields. The tool writes the engine-shaped set; the scaffold documents which fields a game repoints (electron-builder top-level `icon:`, manifest `icon`, the `from: assets/icons` fallback) to actually consume it — rewriting them at generate time is out of scope; No `readFlagValue` hardening. The naive positional `--source`/`--out` parser is preserved as-is; a robust parser is a shared follow-up with the sibling tooling features; No migration of existing games. The engine and `apps/tactics` keep their committed icon sets; this feature does not re-generate them — all candidates for a follow-up.

### F78 — Standalone-Reachable Architectural-Invariant Lint Preset

Standalone games shipped with the published `@chimera-engine/*` packages and nothing of the repo-root `tools/` tree, so the seven architectural-invariant ESLint rules — the executable form of the determinism, design-token, and engine-boundary invariants — never reached a scaffolded game. A fresh game's `eslint .` was a hard error (no flat config was emitted, and the ESLint extension was deliberately unrecommended because there was nothing for it to run), which meant a `fromFloat()` in a game's `simulation/` reducer or a hardcoded colour in a screen passed review unflagged. F78 closed that gap the way F75 closed it for fonts: it relocated the rules into the already-published `@chimera-engine/electron` package, compiled them so the plugin ships as real JS (retiring the `plugin.cjs` runtime-tsx hack), and exposed both the plugin and a curated flat-config preset at a new `@chimera-engine/electron/eslint` subpath — the SUBPATH-EXPORT pattern proven by `verify-packaged-bundle`, not a bin.

The scaffold gained — in standalone mode only, since a game inside the monorepo inherits the stricter root config and a file in the app directory would resolve before it without merging — an `eslint.config.mjs` composing the preset as a focused overlay onto a game's zones (`simulation/`, `ai/`, `screens/`, plus the CSS arms), leaving the game to own its base config, along with a `styles/tokens-override.css` stub and a screen `*.module.css` stub so both token guardrails are live from the first commit and a project-root `lint` forward so the command is reachable where a developer stands. The monorepo's own root config was repointed at the same compiled subpath, so the engine and every standalone game run one implementation. The merge-readiness gate is a `verify:scaffold` assertion that a freshly scaffolded game lints GREEN clean AND that a planted violation of every curated rule — including both arms of the design-value rule — is reported by its own rule id in its own file, proving the rules FIRE outside the monorepo rather than merely resolving.

Three defects are worth recording, because each was invisible from a green unit suite. An unscoped ESLint base applied to a CSS-language block does not false-fire, it ABORTS the whole run — and `typescript-eslint`'s untyped `recommended` is clean while every TYPE-CHECKED set crashes, so measuring only the first reads as proof. `parserOptions.projectService` reds a fresh scaffold on the four files outside its TypeScript program, which is why the scaffolded config ships type-aware linting off and documents how to turn it on. And a flat-config `ignores` entry anchors to its own directory rather than matching at any depth the way `.gitignore` does, so the first list missed `renderer/.next` and the `next-env.d.ts` Next owns beside it. A 414 KB Playwright `report.js` left unignored turns a single `pnpm lint` into 1348 errors, which is the scale of what a missed entry costs. Five of the nine entries are now paired in test against the config that declares the path; the other four — including both that were missed — are declared by no config and are named as literals, which is exactly why they are the four that can rot.

This authors no new invariant — #76, #85, #86, #91, #96, #47, #80, #93 and #94 are already enforced — so the gate roll-calls them upheld rather than graduating anything. Invariant #76's guard reaches a game's `simulation/` and `ai/` with the test-file relaxation preserved; #85/#86/#91 reach a game's screens and stylesheets with the base token set resolved through the published renderer subpath; #96 is the games-side barrel enforcement; and #47/#80/#93/#94 stay behind with the three withheld rules, each for its own reason — `curated-rules.ts` records them as data rather than prose.

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

### F79 — Games-Reachable Asset Barrel & Per-Instance Model Instancing

The release-candidate audit filed this as "gltf models lack a per-instance clone seam", but the real defect sat one layer deeper: **no game could obtain any loaded asset at all.** The renderer package's `exports` map had no asset entry, Invariant #96 named asset managers a renderer internal, and the games-side lint pinned a screen importing `AssetManager` as a hard error — `apps/` had zero `useAsset` call sites because the call was impossible, not unwanted. The whole gltf story was theoretical: zero `.glb` files existed anywhere in the repo, `loadGltf()` had never executed, and a 43,945-byte GLTFLoader chunk shipped in the tactics static export as unreachable dead weight.

F79 minted `@chimera-engine/renderer/assets` as the **seventh** public barrel, mirroring the audio precedent file-for-file — `useAsset`, `useAssetManager`, `useModelInstance`, an `AssetManagerProvider` a game's tests can mount, and the asset/error types those calls take, with every artifact that describes the barrel set (exports map, contract test, ESLint predicate and message, Check 17 regex, Invariant #96's count, the verify:pack probe list) moved in the same commit so no guard ever described a set that no longer existed. Underneath it landed the model seam itself: a headless `cloneModelInstance`/`releaseModelInstance` module that refuses the four unsafe shapes with a named `MalformedModelAssetError`, a commit-phase `useModelInstance` keyed on the RESOLVED asset object (render-phase `useMemo` allocation leaks under StrictMode, which double-invokes memo factories and discards one result), and a Canvas-bound `useModelAnimation` in the r3f barrel that subscribes at the default render priority — a non-zero priority makes a subscriber responsible for `gl.render`, and F80 later showed that `internal.priority` is a counter rather than a lock, so co-presenters cannot suppress one another. The manifest moved to `AssetManager` CONSTRUCTION because React flushes passive mount effects children-first: a child's first load beat every parent-level registration effect and latched `UnknownAssetManifestEntryError` permanently. Around the seam, `validate-assets` widened its on-demand scan to both hooks and to every Invariant #96 surface (anchored at `apps/<name>/<surface>` so an ancestor directory named `apps` cannot skew the match), the `chimera://` protocol gained real model content types (`model/gltf-binary`, `model/gltf+json`, and a deliberately pinned octet-stream `.bin`), `verify:scaffold` planted a compile-only seam probe proving a standalone install can name both barrels from a real game screen, and `apps/tactics` adopted the seam with a committed 2.3 KB self-contained rigged `.glb`, two board-mounted instances of the one ref, and a Playwright spec against the static export — the first code path ever to pull a webpack async chunk over the custom protocol.

Defects worth recording, each invisible from a green unit suite: a nested `<StrictMode>` under a provider does not double-invoke effects under RTL, so a wrapper can certify coverage that does not exist; `AssetRef` is a branded STRING, so effect deps compare it by value and the "inline ref costs a clone per render" instinct is simply false — only a value change re-clones; Vite rewrites the `new URL(<relative>, import.meta.url)` pattern differently per form (dynamic-template → a `--dir`-rooted file URL, static-literal → an http URL) while raw `import.meta.url` stays truthful; and the two known hand-rolled failure shapes — mounting the cached scene twice (the first mount silently vanishes) and `.clone()`'s shared skeleton (posing one poses both) — are exactly what the adoption e2e pins via scene-graph observables.

This authors no new invariant. Invariant #21 gained the carve-out the seam requires — the hook-owned clone is component-scoped and never touches what it shares with the cache — plus the provider-ownership sentence; #96 went six-to-seven in the barrel task with its guards; #52's scan now names both hooks and every #96 surface; #83/#84 are what make the hooks reachable at all; and the renderer-local animation rules a new number would have stated are already implied by #4, #42/#43, #53 and #56–#58, so they landed as §6.2/§6.3 bullets instead.

| Task                                                                                 | Issue                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Derive verify:pack probe completeness from the packed exports map                    | [#949](https://github.com/jindrichruzicka/Chimera/issues/949) |
| Repair the games-facing asset examples to real, resolvable surfaces                  | [#950](https://github.com/jindrichruzicka/Chimera/issues/950) |
| Tighten LoadedGltfAsset and pin gltf cache-identity and disposal                     | [#951](https://github.com/jindrichruzicka/Chimera/issues/951) |
| Add the headless model clone/release module with named refusal errors                | [#952](https://github.com/jindrichruzicka/Chimera/issues/952) |
| Add useModelInstance with commit-phase clone allocation                              | [#953](https://github.com/jindrichruzicka/Chimera/issues/953) |
| Add useModelAnimation to the components/r3f barrel                                   | [#954](https://github.com/jindrichruzicka/Chimera/issues/954) |
| Register the asset manifest at AssetManager construction                             | [#955](https://github.com/jindrichruzicka/Chimera/issues/955) |
| Mint the renderer/assets public barrel and move every barrel-set guard               | [#956](https://github.com/jindrichruzicka/Chimera/issues/956) |
| Scan useModelInstance and every Invariant #96 game surface in validate-assets        | [#957](https://github.com/jindrichruzicka/Chimera/issues/957) |
| Serve model and buffer files with real content types over chimera://                 | [#958](https://github.com/jindrichruzicka/Chimera/issues/958) |
| Plant a compile-only asset-seam probe in verify:scaffold                             | [#959](https://github.com/jindrichruzicka/Chimera/issues/959) |
| Adopt the model seam in apps/tactics with a static-export e2e                        | [#960](https://github.com/jindrichruzicka/Chimera/issues/960) |
| Docs, the Invariant #21 and #96 amendments, roadmap F79, and the feature-review gate | [#961](https://github.com/jindrichruzicka/Chimera/issues/961) |

Feature issue: [#948](https://github.com/jindrichruzicka/Chimera/issues/948).

**Out of scope (deferred):** No packaged-app harness. Nothing in the repo launches an electron-builder packaged app; the adoption e2e exercises the `.e2e-build` static-export layout over `chimera://`, and packaging remains a manual gate item; No animation wrapper verbs. `useModelAnimation` returns the raw `AnimationMixer` — actions, crossfades, loop modes, and completion events are the caller's, and a completion event that could gate an `EngineAction` is deliberately impossible on this surface; No widening of the validate-assets receiver heuristic. `const { load } = useAssetManager()` stays a documented false-negative rather than a fuzzier matcher; No multi-file gltf reference asset. The committed rig is a single self-contained `.glb`; a `.gltf` + `.bin` + texture triple exercises MIME paths the protocol now serves but no harness asserts; No StrictMode-root disposal reconciliation. A real dev double mount re-latches the manifest error through `GameShell`'s unconditional dispose effect — filed as its own bug ([#971](https://github.com/jindrichruzicka/Chimera/issues/971)) with the measured probe evidence — all candidates for follow-ups.

### F80 — Frame-Rate Cap as Loop Pacing, Not Frame Presentation

`FrameRateLimiter` implemented `display.targetFps` by **taking over frame presentation** — a `useFrame(cb, 1)` subscriber calling `gl.render` — and R3F allows exactly one presenter per canvas only if `internal.priority` is a lock. It is not: `subscribe` does `internal.priority = internal.priority + (priority > 0 ? 1 : 0)`, and `update()` suppresses only R3F's own automatic render while calling every subscriber unconditionally. A second `useFrame(cb, 1)` presenter — a post-processing composer, a portal/scissor renderer, any hand-rolled render-target pipeline — therefore ran every native frame alongside the cap, and **neither could suppress the other**. Subscribers sort ascending with a stable sort, so with `GameCanvas` mounting the limiter before `{children}` the engine presented first and the composer's present overwrote it: the cap did nothing, and the engine added a wasted full-scene draw at the target rate on top. Writing an engine composer would have fixed one instance of a general defect while itself becoming a competing presenter.

F80 makes the cap **pace the loop instead of presenting the frame**. `frameloop="never"` on the `<Canvas>` plus a self-driven `requestAnimationFrame` chain calling the store-bound `advance()`: the limiter registers zero `useFrame` subscribers, `internal.priority` returns to 0 in the uncontested case, and whoever _does_ present — R3F's automatic render or any third-party pass — runs only on the frames the engine allows. Three consequences beyond the collision, each measured rather than argued: the cap previously saved almost nothing, since every other `useFrame` in the workspace is priority 0 and ticked at the panel's refresh regardless; the perf HUD lied whenever a cap was active, reporting ~120 for a 30 fps cap on a 120 Hz panel; and `SettingsSchema.ts` defaults `targetFps` to `60`, so this was the **default** path on every machine, not an edge case.

The cap is now two halves that must both be wired, and `useEngineFrameloop()` joined the r3f barrel so a game owning its own `<Canvas>` can wire the first. Wiring one is a defect in each direction and only one is detectable: a driver under `'always'` is a silently uncapped loop, reported once per cap change and never per frame as a named `FrameloopWiringError` — **logged, not thrown**, because that direction degrades to the behaviour that existed before any cap and R3F's `ErrorBoundary` re-throws outward past the `<Canvas>`, taking down more than the canvas at exactly the moment an author is wiring up. The mirror case, `'never'` with no driver, is a permanently black canvas and is **documented rather than detected**: nothing of the limiter is mounted to notice it, a registration check from `useEngineFrameloop` cannot see a child R3F renders into a separate reconciler root after `configure()` resolves, and a frame-counting watchdog cannot tell a missing driver from a backgrounded window.

Defects worth recording, each invisible from a green unit suite. `advance(t)` takes **seconds relative to the R3F clock**, and the origin must be read from that clock rather than restarted at 0 — `setFrameloop` runs only on a _frameloop_ transition, so a `targetFps` change re-runs the driver against a mid-session clock and an unconditional `advance(0)` hands `update()` minus the whole elapsed session as one delta, straight into `PerfProbe`, `useTween` and `mixer.update()`. The half-wiring report had to be **deferred a frame and cancelled on resolve**: the cap and the `<Canvas>` prop reach their consumers through two different React roots, so a correctly wired canvas is transiently mismatched on every cap change including the boot hydration from 0 to the default — reporting synchronously fired on every healthy game. And `invalidate()` is inert on **both** engine frameloops, not just the capped one: under `'never'` it early-returns, and under `'always'` R3F renders every frame regardless of the counter it writes — so "load-bearing when uncapped" was measurably false, and deleting all 14 call sites in `useTween`/`useTweenCallback` leaves every tween outcome green. They are kept as the correct contract for a `frameloop="demand"` canvas, which only a game can create.

This authors no new invariant. F80 changes what `PerfProbe` _measures_, never where the HUD lives or how it toggles (§4.16); `useEngineFrameloop` joins the existing `components/r3f` barrel, so Invariant #96's barrel set is unchanged; no `setState` reaches the hot path, since the driver's pacing state lives in its effect closure and the rAF callback touches no React state; and the render loop stays presentation-only — `advance()` drives no simulation (§7.1), because `SimulationClock` forbids host I/O and `InputManager` owns its own rAF.

| Task                                                                       | Issue                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Replace the limiter's render takeover with a paced advance() driver        | [#963](https://github.com/jindrichruzicka/Chimera/issues/963) |
| Drive the Canvas frameloop prop from the cap and export useEngineFrameloop | [#964](https://github.com/jindrichruzicka/Chimera/issues/964) |
| Refuse the half-wired canvas with a named frameloop-wiring error           | [#965](https://github.com/jindrichruzicka/Chimera/issues/965) |
| Guard that a third-party presenter is the sole presenter under a cap       | [#966](https://github.com/jindrichruzicka/Chimera/issues/966) |
| Pin the perf HUD to the presented frame rate at unit and e2e level         | [#967](https://github.com/jindrichruzicka/Chimera/issues/967) |
| Audit demand-render invalidate() call sites against the default cap        | [#968](https://github.com/jindrichruzicka/Chimera/issues/968) |
| Docs, roadmap F80, Changeset, and the F80 feature-review gate              | [#969](https://github.com/jindrichruzicka/Chimera/issues/969) |

Feature issue: [#962](https://github.com/jindrichruzicka/Chimera/issues/962).

**Out of scope (deferred):** No `<PostProcessing>` wrapper and no `@react-three/postprocessing` dependency. A settings-driven quality-tier wrapper is ergonomics, not the fix — the collision is solved for _every_ third-party presenter, including a hand-rolled composer, without the engine taking a dependency; a published subpath would also cost an `exports` key, a barrel-set guard sweep across the ESLint predicate, Check 17 and `package-exports-contract`, an optional peer declaration, and a `verify:pack`/`verify:publish`/`verify:scaffold` pass, inside the RC window, for a surface with zero adopters. Recommended as its own feature after 1.0.0 and purely additive under the locked 1.X.Y scheme; No engine-authored composer, effect stack, or render-target pipeline — an engine composer is itself a competing presenter; No delta clamping for `useFrame` consumers. A 30 fps cap gives tweens ~3 samples per 100 ms instead of ~12, and one long stall still yields one large delta, exactly as `clock.getDelta()` does under `'always'` — changing tween sampling semantics is a §4.21 decision; No new invariant number, no `targetFps` value-set change, and no demand-render mode. Restoring `invalidate()`-driven rendering for static scenes is a real opportunity — `frameloop="demand"` would cost nothing on a menu — but it is a separate capability with its own dirty-tracking contract and cannot coexist with a cap in the same branch; No traceability-matrix backfill. F80 appends its own rows and does not repair the index's stale Feature-to-Milestone range.

---

## Cross-References

- [Versioning Policy](../versioning-policy.md) — the canonical `1.X.Y` lock-step rules and enforcement.
- [Product Roadmap (Index Hub)](../ROADMAP.md) — milestone/version overview.
- [M9 — Package Extraction & Game Scaffolding (v0.9.0)](m9-package-extraction-v0.9.0.md) — the package hierarchy this scheme locks together.
