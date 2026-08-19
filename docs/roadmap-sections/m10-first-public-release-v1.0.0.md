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

### F71 — Internationalization / i18n `§4.39, §4.37, Appendix D.4`

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

### F72 — Spectator Mode `§4.14, §4.6, Appendix D.3`

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

### F74 — Audio Cues, Fades & Crossfade `§4.25`

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

**Out of scope (deferred):** a higher-level `MusicDirector` layer, per-cue DSP
effects / filters / EQ / reverb, streaming (`MediaElementAudioSource`) playback,
resizing the 32-voice pool or reshaping the three-stage bus graph, and cross-clip /
global cue registries — all candidates for a follow-up.

Three entries this list originally carried were **taken up inside M10 rather than
deferred past it**, and are recorded here so the deferral and the milestone do not
tell two different stories. **3D / spatial panning** **landed** as **F84** — with
**HRTF** specifically still deferred, since `panningModel` is pinned to
`'equalpower'`, and with source cones, occlusion and reverb zones still out with the
rest of the DSP list. The **cue-reactive half of `MusicDirector`** is **F85**, still
_designed, not implemented_ per its section below: it adds the primitive that layer
would have been built on — a music transition that waits for an authored cue — while
the layer itself (named slots, stem stacks, in-flight retarget, a global cue
registry) stays deferred either way. And **variable playback rate** is **F86**, also
_designed, not implemented_, as resampling, so rate and pitch move together;
pitch-**preserving** time-stretch and live mid-voice rate changes stay deferred, and
the option is named `rate` rather than `pitch` so the type does not promise the one
it does not do.

### F75 — Standalone-Reachable Font Self-Hosting Tooling `§4.37`

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

### F76 — Standalone-Reachable Asset-Reference Validation `§4.10`

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

### F77 — Standalone-Reachable Platform Icon-Set Generation `§4.32`

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

### F78 — Standalone-Reachable Architectural-Invariant Lint Preset `§4.32`

Standalone games shipped with the published `@chimera-engine/*` packages and nothing of the repo-root `tools/` tree, so the seven architectural-invariant ESLint rules — the executable form of the determinism, design-token, and engine-boundary invariants — never reached a scaffolded game. A fresh game's `eslint .` was a hard error (no flat config was emitted, and the ESLint extension was deliberately unrecommended because there was nothing for it to run), which meant a `fromFloat()` in a game's `simulation/` reducer or a hardcoded colour in a screen passed review unflagged. F78 closed that gap the way F75 closed it for fonts: it relocated the rules into the already-published `@chimera-engine/electron` package, compiled them so the plugin ships as real JS (retiring the `plugin.cjs` runtime-tsx hack), and exposed both the plugin and a curated flat-config preset at a new `@chimera-engine/electron/eslint` subpath — the SUBPATH-EXPORT pattern proven by `verify-packaged-bundle`, not a bin.

The scaffold gained — in standalone mode only, since a game inside the monorepo inherits the stricter root config and a file in the app directory would resolve before it without merging — an `eslint.config.mjs` composing the preset as a focused overlay onto a game's zones (`simulation/`, `ai/`, `screens/`, plus the CSS arms), leaving the game to own its base config, along with a `styles/tokens-override.css` stub and a screen `*.module.css` stub so both token guardrails are live from the first commit and a project-root `lint` forward so the command is reachable where a developer stands. The monorepo's own root config was repointed at the same compiled subpath, so the engine and every standalone game run one implementation. The merge-readiness gate is a `verify:scaffold` assertion that a freshly scaffolded game lints GREEN clean AND that a planted violation of every curated rule — including both arms of the design-value rule — is reported by its own rule id in its own file, proving the rules FIRE outside the monorepo rather than merely resolving.

Three defects are worth recording, because each was invisible from a green unit suite. An unscoped ESLint base applied to a CSS-language block does not false-fire, it ABORTS the whole run — and `typescript-eslint`'s untyped `recommended` is clean while every TYPE-CHECKED set crashes, so measuring only the first reads as proof. `parserOptions.projectService` reds a fresh scaffold on the four files outside its TypeScript program, which is why the scaffolded config ships type-aware linting off and documents how to turn it on. And a flat-config `ignores` entry anchors to its own directory rather than matching at any depth the way `.gitignore` does, so the first list missed `renderer/.next` and the `next-env.d.ts` Next owns beside it. A 414 KB Playwright `report.js` left unignored turns a single `pnpm lint` into 1348 errors, which is the scale of what a missed entry costs. Five of the nine entries are now paired in test against the config that declares the path; the other four — including both that were missed — are declared by no config and are named as literals, which is exactly why they are the four that can rot.

This authors no new invariant — #76, #85, #86, #91, #96, #47, #80, #93 and #94 are already enforced — so the gate roll-calls them upheld rather than graduating anything. Invariant #76's guard reaches a game's `simulation/` and `ai/` with the test-file relaxation preserved; #85/#86/#91 reach a game's screens and stylesheets with the base token set resolved through the published renderer subpath; #96 is the games-side barrel enforcement; and #47/#80/#93/#94 stay behind with the withheld rules, each for its own reason — `curated-rules.ts` records them as data rather than prose.

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

### F79 — Games-Reachable Asset Barrel & Per-Instance Model Instancing `§4.10`

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

**Out of scope (deferred):** No packaged-app harness. Nothing in the repo launches an electron-builder packaged app; the adoption e2e exercises the `.e2e-build` static-export layout over `chimera://`, and packaging remains a manual gate item; No animation wrapper verbs. `useModelAnimation` returns the raw `AnimationMixer` — actions, crossfades, loop modes and completion events are the caller's — and F82 took that deferral up in `useClipPlayer`; No widening of the validate-assets receiver heuristic. `const { load } = useAssetManager()` stays a documented false-negative rather than a fuzzier matcher; No multi-file gltf reference asset. The committed rig is a single self-contained `.glb`; a `.gltf` + `.bin` + texture triple exercises MIME paths the protocol now serves but no harness asserts; No StrictMode-root disposal reconciliation. A real dev double mount re-latched the manifest error through `GameShell`'s then-unconditional dispose effect — filed as its own bug ([#971](https://github.com/jindrichruzicka/Chimera/issues/971)) with the measured probe evidence, and since fixed by the deferred-cancelable dispose pinned by the "GameShell — StrictMode-root remount safety (registry mode)" tests in `renderer/components/shell/GameShell.test.tsx` — all candidates for follow-ups.

### F80 — Frame-Rate Cap as Loop Pacing, Not Frame Presentation `§4.22, §4.16`

`FrameRateLimiter` implemented `display.targetFps` by **taking over frame presentation** — a `useFrame(cb, 1)` subscriber calling `gl.render` — and R3F allows exactly one presenter per canvas only if `internal.priority` is a lock. It is not: `subscribe` does `internal.priority = internal.priority + (priority > 0 ? 1 : 0)`, and `update()` suppresses only R3F's own automatic render while calling every subscriber unconditionally. A second `useFrame(cb, 1)` presenter — a post-processing composer, a portal/scissor renderer, any hand-rolled render-target pipeline — therefore ran every native frame alongside the cap, and **neither could suppress the other**. Subscribers sort ascending with a stable sort, so with `GameCanvas` mounting the limiter before `{children}` the engine presented first and the composer's present overwrote it: the cap did nothing, and the engine added a wasted full-scene draw at the target rate on top. Writing an engine composer would have fixed one instance of a general defect while itself becoming a competing presenter.

F80 makes the cap **pace the loop instead of presenting the frame**. `frameloop="never"` on the `<Canvas>` plus a self-driven `requestAnimationFrame` chain calling the store-bound `advance()`: the limiter registers zero `useFrame` subscribers, `internal.priority` returns to 0 in the uncontested case, and whoever _does_ present — R3F's automatic render or any third-party pass — runs only on the frames the engine allows. Three consequences beyond the collision, each measured rather than argued: the cap previously saved almost nothing, since every other `useFrame` in the workspace is priority 0 and ticked at the panel's refresh regardless; the perf HUD lied whenever a cap was active, reporting ~120 for a 30 fps cap on a 120 Hz panel; and `SettingsSchema.ts` defaults `targetFps` to `60`, so this was the **default** path on every machine, not an edge case.

The cap is now two halves that must both be wired, and `useEngineFrameloop()` joined the r3f barrel so a game owning its own `<Canvas>` can wire the first. Wiring one is a defect in each direction and only one is detectable: a driver under `'always'` is a silently uncapped loop, reported once per cap change and never per frame as a named `FrameloopWiringError` — **logged, not thrown**, because that direction degrades to the behaviour that existed before any cap and R3F's `ErrorBoundary` re-throws outward past the `<Canvas>`, taking down more than the canvas at exactly the moment an author is wiring up. The mirror case, `'never'` with no driver, is a permanently black canvas and is **documented rather than detected**: nothing of the limiter is mounted to notice it, and a registration check from `useEngineFrameloop` cannot see a child R3F renders into a separate reconciler root after `configure()` resolves.

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

### F81 — GameCanvas-Only Rendering Surface & Multi-Canvas Overlays `§4.22, §4.16`

The own-`<Canvas>` escape hatch was documented but **unused** — no `<Canvas>` existed outside `GameCanvas.tsx` and renderer-internal tests — yet it cost on three axes. Three of the r3f barrel's five runtime exports (`PerfProbe`, `FrameRateLimiter`, `useEngineFrameloop`) existed only so a game owning its own root could re-wire what `GameCanvas` already wires. The undetectable `frameloop="never"`-with-no-driver black canvas (F80's documented-not-detected defect) exists only because a game can own the root. And the canvas root is the sole seam where engine-wide display settings can ever apply — the `display.targetFps` cap today, any future settings-driven knob tomorrow — so every game-owned root is a canvas the engine cannot manage.

F81 closes the hatch inside the RC window, before 1.0.0 makes the narrowing a major. `GameCanvas` gained the curated props the hatch existed to provide — `className` (canvas chrome; r3f pins position/size as inline styles on its wrapper div, so placement lives on a game-owned wrapper element) and `onPointerMissed` (deselect-on-empty-click) — as two explicit optional fields, no `CanvasProps` rest-spread, with per-key `@ts-expect-error` pins rejecting `gl`/`dpr`/`shadows`/`style`/`frameloop` pass-through by construction. Multi-canvas became first-class: `role="main" | "overlay"` (default `main`), where an overlay mounts no `PerfProbe` (the singleton perfStore's last-writer-wins `setPerfFrame` is never contended), every role mounts `FrameRateLimiter` and takes `frameloop={useEngineFrameloop()}`, and two concurrent mains produce a named `DuplicateMainGameCanvasError` through the renderer logger — logged, not thrown, deferred one frame and cancelled on resolve. The barrel narrowed to `GameCanvas` + `useModelAnimation` + the curated types with every barrel-set guard moved in the same commit, and Invariant #127 landed with two arms: `chimera/no-raw-r3f-canvas` (name-based — the binding, not the specifier, since `useFrame`/`useThree`/`type ThreeEvent` share it; catches named/aliased/string-named/re-export forms plus namespace reaches resolved order-independently at `Program:exit`) and mechanical Check 32 (a statement-joining import scan with an every-run negative control). The tactics demo board adopted the seam: a corner minimap as a second `<GameCanvas role="overlay">` rendering ground plus living-unit markers from the same parsed units array the main scene renders, pinned by object identity.

Defects worth recording, each caught by measurement rather than review instinct. The issue prose claimed a synchronous duplicate-main check "false-fires on every healthy game" via StrictMode — measured false: React runs a remount's cleanup before its re-setup, so the count never transiently exceeds one and only the same-frame main-to-main handover justifies the deferral. r3f types `onPointerMissed` without `| undefined`, so under `exactOptionalPropertyTypes` the key must be conditionally spread, not forwarded as explicit `undefined`. The first rule id with a digit (`no-raw-r3f-canvas`) outran a `[a-z-]+` rule-id regex in the scaffold verifier's manifest parser. And a pure line grep goes blind on prettier-split multi-line imports — Check 32 joins statements per file before matching, and its negative control feeds known-bad single-line AND multi-line fixtures through the real pipeline every run.

Invariant #96's r3f clause narrowed to the new surface (barrel count unchanged at seven); Invariant #127 is new and deliberately **name-based** where #96 is specifier-based — one bans a binding whose legitimate siblings share the specifier, the other bans specifiers wholesale — with the enforcement split recorded once in the invariant: namespace member access is invisible to the grep and caught by ESLint; dynamic `import()` destructuring is visible to neither arm.

| Task                                                                                       | Issue                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Add curated className and onPointerMissed props to GameCanvas                              | [#976](https://github.com/jindrichruzicka/Chimera/issues/976) |
| Add the overlay role and main-canvas PerfProbe exclusivity to GameCanvas                   | [#977](https://github.com/jindrichruzicka/Chimera/issues/977) |
| Narrow the public r3f barrel to GameCanvas and useModelAnimation                           | [#978](https://github.com/jindrichruzicka/Chimera/issues/978) |
| Add chimera/no-raw-r3f-canvas across the plugin, workspace zones, and standalone preset    | [#979](https://github.com/jindrichruzicka/Chimera/issues/979) |
| Add Invariant #127 and mechanical Check 32 to the invariant checker                        | [#980](https://github.com/jindrichruzicka/Chimera/issues/980) |
| Adopt a minimap overlay GameCanvas in tactics with an e2e                                  | [#981](https://github.com/jindrichruzicka/Chimera/issues/981) |
| Docs, the Invariant #96 amendment, roadmap F81, changeset, and the F81 feature-review gate | [#982](https://github.com/jindrichruzicka/Chimera/issues/982) |

Feature issue: [#975](https://github.com/jindrichruzicka/Chimera/issues/975).

**Out of scope (deferred):** No post-processing wrapper and no `@react-three/postprocessing` dependency (F80's non-goal restated — the pacing fix already caps every third-party presenter). No `gl` / `dpr` / `shadows` / `style` pass-through: graphics-quality knobs are reserved for a future settings-driven quality feature — owning the root is precisely what makes engine-wide display settings possible — and `style` is withheld for token discipline (`className` + module CSS only). No demand-render (`frameloop="demand"`) mode. No removal of `FrameRateLimiter`'s half-wiring detection — the half-wired states remain physically possible inside the engine, so the self-check stays with its docs reframed as engine-internal. Renderer-**internal** tests keep using raw or fake `<Canvas>`: Invariant #127 scopes game surfaces only.

### F82 — Animation Clip Sheets, Marker Scheduling & Time Dilation `§4.40`

**Status: implemented across #993–#1007 and reviewed by the feature gate (#1071), whose run is recorded in the [invariant roll-call](../executive-architecture/invariant-roll-call.md).** The engine now offers clip selection, play/stop, a loop mode and a three-layer speed stack: `useClipPlayer` on the `components/r3f` barrel takes a declarative `clip` / `loop` / `speed` and drives one `ClipPlayer` over one owned `AnimationMixer`. `useModelAnimation` is still there and still hands back a bare mixer — a game that wants to drive actions itself keeps that route — but it is no longer the only one. A root carrying BOTH is not refused: `mixerBindingRegistry` counts the claims and REPORTS a duplicate through the log bridge one frame later, while both hooks keep running. That nothing is torn down is measured in `renderer/components/r3f/__tests__/one-mixer-per-root.test.tsx`.

What landed is the layer a game animates against: **clip sheets** (authored notify points and sub-passages), a pure **marker scheduler** turning a stream of playhead samples into `notify` / `passage-start` / `passage-tick` / `passage-end` / `clip-end` emissions, a **three-layer multiplicative speed stack**, and **authoritative time dilation** that re-paces the simulation heartbeat and every clip together. Each task authored the invariant rows its own change required — Invariant #89 obliges any task adding a `ReduceContext` field to land one — and #1007 authored the rest: the set is #128 (`beatReducer`), #129 (host-only beat-owned windows), #130 (one derivation site for the dilation multiplier), #131 (`TimeScaleBridge` as the dilation store's sole writer) and #132 (no animation event may gate an `EngineAction`).

**§4.40 is [`docs/core-components/animation-system.md`](../core-components/animation-system.md)**, written under [#1096](https://github.com/jindrichruzicka/Chimera/issues/1096) after F89 had added a second feature's worth of surface under the same number. It carries the contract — the vocabulary, the seam, the player's verbs, the bindings, the named rules and the invariants. What stays here is the design record: why the mixer is frame-driven, what was measured to decide it, and what each feature deferred.

**Two clocks, and they never touch.** The RENDERER clock is float seconds and normalized phase, driven by one `useFrame` at default priority; it owns clip position, marker firing, passage open/close and playback speed. The SIMULATION clock is the integer BEAT — one outer `engine:tick` — and it owns hit windows, damage, cooldowns, AI, saves and replays. Playback is **frame-driven**, every gameplay consequence is **beat-driven**, and the two meet only at authoring time: the visual passage and the mechanical window are written twice and verified against each other when content loads, rather than either being converted into the other at runtime, so a host pacing knob never determines a gameplay window's length. `chimera/no-animation-derivation-in-reduce` (#1005) is the lint leg of that separation: the verifier is a content-load call. What the rule does and does not catch — it matches by NAME at the call site, so an aliased import goes unreported — is measured in its own suite.

One consequence is worth stating because it caught prose across the repo: `GameSnapshot.tick` counts ACTIONS, not beats. A tick that fires a timer dispatches children through the same `ActionPipeline.process()`, and each advances the counter — so a beat is one outer `engine:tick`, and reading a beat off a `tick` DIFFERENCE is wrong on exactly the ticks a timer fired.

**Six measured reasons the mixer stays frame-driven**, in descending force. (1) A tick-driven mixer would not move at all in the repo today: `apps/tactics/manifest.ts` and the blank scaffold template both declare `realtime: false`, so `resolveTickerHz` returns `null`, `electron/main/index.ts` constructs no `RealtimeTicker` outside its e2e-only forced-hz seam, and every idle loop and menu character would freeze between inputs. (2) There is no delta to drive it with — `SimulationClock.now()` reads `snapshot.tick` and nothing else, and `EngineTickPayload` declares `seed` as its only field. (3) Clip time held as snapshot state would be forced into the shared `bigint` Q32.32 `FixedPoint` representation by Invariants #44/#75, per clip per frame, only to feed `AnimationMixer.update(deltaSeconds)`, which takes a float anyway. (4) `DEFAULT_TICK_RATE_MS = 50` puts the default beat at 20 Hz — six panel frames per beat at 120 Hz — and would make animation smoothness a function of a balance constant. (5) The seam already exists and the floats are already sanctioned: F80 made the engine pace its own render loop, and §4.2.1 Rule 3 permits floats inside the renderer provided they never flow back into `GameSnapshot` or `EngineAction.payload`. (6) The inverse — frames driving gameplay — is a correctness failure: under the `display.targetFps` cap a 30 fps client samples a swing roughly four times less densely than a 120 fps one, so an action whose EXISTENCE depended on a marker would make two clients emit different action streams from the same snapshot, `ActionPipeline` throws `StaleActionError` on any action whose `tick` does not equal the host snapshot's, and a replay would reproduce one machine's stutter rather than the match.

**Two requirements ship differently from how they were asked, stated here rather than buried in a non-goal list.** Requirement 6 asked that a hit slow the whole game; delivered: a hit slows simulation pacing and clip playback; camera tweens, `useTween`, CSS motion, particles, shader uniforms and the HUD are opt-in through the exported scalar, and tick pacing dilates only for `realtime: true` games, of which none ship. The R3F clock also feeds `PerfProbe`, so scaling it would make the perf HUD report a dilated frame rate — precisely the defect F80 repaired. Requirement 5 asked that the renderer invoke an action to process a weapon hit; delivered inverted: no renderer-initiated call exists; the simulation owns the hit window and the game sweeps it in `GameDefinition.onBeat`. That prohibition is now **Invariant #132**, authored in #1007 rather than left to be inferred from one hook's signature — and it is still held **by a missing parameter** rather than by the rule: the marker-handler records carry no dispatcher, no `SendAction`, no `PlayerId` and no tick, because a parameter that does not exist cannot be `eslint-disable`d. The invariant says so; the shape is what enforces it. Feedback returns to the renderer through the existing one-way `snapshot.events` channel.

**Three measurements constrain the rest.** `engine:tick.reduce` already dispatches its fired timer actions through `ctx.dispatch`, and `ReplayPlayer.step()` throws `DeterminismError` unless an action advances `tick` by exactly one — so F82 performs zero nested dispatch, and the beat pass closes windows and restores dilation as pure state passes inside the one reduce — pinned by `beat-pass-replay.integration.test.ts`, which drives a match using `onBeat` through `ReplayPlayer`. `ActionPipeline`'s clock-only-tick branch returns false when any key other than `tick` differs by reference or when the key count changes, so an absolute beat counter would permanently defeat the clock-only broadcast path; beat durations are countdowns the engine decrements once per outer tick instead. And the wire is the highest-risk surface: `PlayerSnapshot` in `simulation/foundation/messages-schemas.ts` is a plain `z.object` with neither `.strict()` nor `.passthrough()`, and the installed zod 4 parses `{ a: 1, extra: 42 }` against such a schema into `{ a: 1 }` with `success: true` — while `validateSnapshotCrc` runs on the pre-zod bytes, so a missed projection sweep would leave the host dilated and every joined client at full speed with no error, no warning and a matching checksum.

| Task                                                                                                                                               | Issue                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Add the clip-sheet vocabulary, the shared time-scale arithmetic and the content-load window verifier                                               | [#993](https://github.com/jindrichruzicka/Chimera/issues/993)   |
| Extend BaseGameSnapshot with the dilation and window fields and sweep the one projected drop point                                                 | [#994](https://github.com/jindrichruzicka/Chimera/issues/994)   |
| Implement the two pure per-beat state layers: AnimationWindowManager and TimeScale                                                                 | [#995](https://github.com/jindrichruzicka/Chimera/issues/995)   |
| Compose the per-beat pass into engine:tick.reduce and give games the pure onBeat vehicle                                                           | [#996](https://github.com/jindrichruzicka/Chimera/issues/996)   |
| Compile the clip timeline: ClipPosition, ClipTimeline and the ClipBackend seam                                                                     | [#997](https://github.com/jindrichruzicka/Chimera/issues/997)   |
| Implement the marker scheduler and the ClipPlayer speed stack, with clip-end owned by stepScheduler                                                | [#998](https://github.com/jindrichruzicka/Chimera/issues/998)   |
| Add the fail-soft sheet readers, the internal sprite atlas parser and useAnimationSheet                                                            | [#999](https://github.com/jindrichruzicka/Chimera/issues/999)   |
| Implement MeshClipBackend, SpriteClipBackend and discharge LSP with a shared conformance suite                                                     | [#1000](https://github.com/jindrichruzicka/Chimera/issues/1000) |
| Extract useOwnedMixer, bind the mesh useClipPlayer and sweep the r3f barrel                                                                        | [#1001](https://github.com/jindrichruzicka/Chimera/issues/1001) |
| Land the dilation bridge and the one-mixer-per-root claim/release registry                                                                         | [#1002](https://github.com/jindrichruzicka/Chimera/issues/1002) |
| Re-pace RealtimeTicker by timeScalePermille without letting a throw kill the chain                                                                 | [#1003](https://github.com/jindrichruzicka/Chimera/issues/1003) |
| Gate animation sheets at build time with the validate-assets invalidAnimationSheets bucket                                                         | [#1004](https://github.com/jindrichruzicka/Chimera/issues/1004) |
| Add chimera/no-animation-derivation-in-reduce and sweep the full plugin registration surface                                                       | [#1005](https://github.com/jindrichruzicka/Chimera/issues/1005) |
| Generate the animated glb fixture, widen the glTF reader and adopt the clip player on the tactics showcase                                         | [#1006](https://github.com/jindrichruzicka/Chimera/issues/1006) |
| Author the F82 invariant rows not already landed by an earlier task, sweep the falsified prose and the roll-call, cut the changeset, open the gate | [#1007](https://github.com/jindrichruzicka/Chimera/issues/1007) |
| Refresh this section's status and present-tense prose against the shipped tree                                                                     | [#1011](https://github.com/jindrichruzicka/Chimera/issues/1011) |
| F82 feature review and merge gate                                                                                                                  | [#1071](https://github.com/jindrichruzicka/Chimera/issues/1071) |

Feature issue: [#991](https://github.com/jindrichruzicka/Chimera/issues/991). This roadmap section is itself [#992](https://github.com/jindrichruzicka/Chimera/issues/992), refreshed against the shipped tree by [#1011](https://github.com/jindrichruzicka/Chimera/issues/1011).

**Out of scope (deferred):** No cross-client clip phase anchoring. The seek formula needs an absolute beat counter (eliminated above) and a renderer-visible tick rate, which no renderer registry slot supplies; two clients therefore see a swing at phases differing by network latency and a client joining mid-swing starts the clip at zero, both cosmetic by construction, and the anchor is purely additive later; No repair of the pre-existing one-action-one-tick replay assumption. A match containing a timer-firing `engine:tick`, or an `engine:undo`/`engine:redo`, is already unreplayable, and the correct fix — replacing the derived tick expectation with the recorded one — moves `ReplayPlayer.seek()`, the playback manager's tick accounting and the renderer scrub semantics together; F82's obligation is only to add no new inflation; No sprite React binding, sprite component or atlas reader in the public barrels. That clause held only until the sprite half of the feature landed: `useSpriteClipPlayer` and `AnimatedSprite` ship from the `components/r3f` barrel, and the atlas reader from `assets`, so the export it defers already happened inside F82 itself. What remains true is the adoption half — no game in the repo or the scaffold has any sprite content, and #1006 adopted the MESH half only — and the versioning consequence, which is why the clause is worth keeping rather than deleting: an additive export is additive, while narrowing a shipped frame shape is a break — see `docs/versioning-policy.md` for what each costs under the locked `1.X.Y` scheme. F89 narrowed `UseSpriteClipPlayerOptions` for exactly that reason, before `blendSeconds` ever shipped on it; No shipping realtime game. Reason (1)'s manifests did not change, so the entire simulation half — windows, the dilation countdown, `onBeat` — shipped unit-tested with no end-to-end adopter. The tactics clip-player adoption (#1006) is the RENDERER half only: tactics is `realtime: false`, so no `engine:tick` is ever dispatched on that route and the clip free-runs off the frame clock. The demonstration remains a named follow-up rather than a forced ticker; No `@chimera-engine/renderer/animation` subpath and no public barrel from F82 itself. The wider commitment this clause originally made — that the exports map, the package-exports contract, the pack probe list, Check 17's barrel regex, the games-side lint predicate and Invariant #96's count all stay unchanged inside the RC window — was **superseded by an explicit decision** to land the eighth barrel, `@chimera-engine/renderer/input` (issue #1008), before the 1.0.0 tag rather than after it; every one of those artifacts moved with it. A new subpath is additive, so the bump stays minor under the locked `1.X.Y` scheme; No `engine:set_time_scale` action and no dilation restore timer — one optional integer field plus one pure countdown, so overlapping requests are last-write-wins and nothing can stack or leak un-restored; No projection of the window registry or the restore countdown into `PlayerSnapshot`, since an open attack window reveals that an entity exists and is attacking; No reverse or ping-pong playback: nothing on the clip-backend seam models a reversing playhead, so both are refused with `RangeError` rather than clamped; No blending beyond a single crossfade verb, no state-machine or blend-tree authoring layer, and no engine-level animation-event registry slot. The first of those three was **superseded by an explicit decision** to reach that verb before the 1.0.0 tag rather than after it: F89 makes a blend declarable at a call site and once per clip in the manifest, on the same single crossfade seam. The other two stand; No trimmed or rotated atlas frames, no billboarding, and no engine-owned sprite geometry; No sub-beat gameplay windows — at the default 20 Hz the finest expressible mechanical window is one beat, and a narrower authored window is floored at one rather than zero; No `SaveFile` schema-version bump and no migration, since every new snapshot field is optional; No settings-driven animation speed, no dilation of `turnClock.deadlineMs` (which is millisecond-denominated, so slow-mo does not extend a turn timer), and no ticker catch-up or missed-tick recovery beyond an absolute next-fire target — all candidates for follow-ups.

### F83 — Asset-Gated Scene Reveal, the Per-Transition Preload Arm & the Opt-In Per-Screen Loading Cover `§4.10, §4.18–§4.19, §4.33–§4.36`

`SceneDescriptor.requiredAssets` was a declaration that `validate-assets` checked and no code read at runtime. A game could name every ref a scene needed, ship it, and still watch the assets pop in after the fade — the declaration bought a build-time guarantee that the refs resolved on disk and nothing else. F83 gave it two runtime consumers and, with them, the first thing an adopter can put in front of the wait.

**The declaration now travels on two carriers, because a scene is entered two ways.** A scene being ENTERED carries it on `SceneTransitionState.requiredAssets`, copied off the host-side descriptor at `engine:scene_prepare`; `startScenePreload` promotes those refs through `markRequiredAssetsCritical` and awaits its bounded run before `useFadeTransition` dispatches `engine:scene_ready`. A scene already COMMITTED carries it on the new `BaseGameSnapshot.sceneRequiredAssets`, written beside `sceneId` by every reducer that sets one; `useCriticalAssetPreloadGate` promotes that list for a route entered mid-scene — a restore, a replay — so that path is gated rather than only a live transition. `MainGameContribution.registerScenes` gave the arm its first producer, and the tactics `tactics:asset-demo` scene its first adopter.

**Fail-open is the guarantee, not the fallback.** Both arms settle on four independent paths — the load resolving, the load REJECTING, an elapsed budget, and a nothing-to-load short-circuit. The ack fires on all four deliberately. The host barrier waits for every player and evaluates `timeoutTicks` only when an action is applied, and a turn-based game has no ticker to apply one, so a client withholding its ack on a bad disk would freeze the match rather than degrade it. That reasoning is now **Invariant #133**, together with the rule it rests on: a preload gates a REVEAL and never a MOUNT, because `GameShell` is the unique disposer of a page-injected `AssetManager` (Invariant #21) and a caller that withheld its mount while waiting would orphan the very manager it was preloading into.

**The covers are opt-in.** `GameScreenRegistry` gained `loadingScreen` and a per-screen-key `loadingScreens` map; either accepts a component, a static `{ message }`, a static `{ image }`, the `'spinner'` / `'progress'` presets, or `'none'` to opt one key out of a registry-wide cover. One cascade resolves them and three sites render them — a suspended code-split chunk, a scene transition, and a route entry — always as a SIBLING of the transition overlay. A game that declares neither gets the engine's own empty placeholder — visually nothing, and what the Suspense site rendered before the slots existed. Invariant #88 was amended to say so, since the §4.36 Suspense boundary is now the render site of a registry-resolved fallback rather than a fixed one.

**Defects worth recording**, because each was found by a test that did not exist when the code was written. The **StrictMode `mountedRef` hang**: a cleanup-only effect leaves `mountedRef` permanently `false` after React's simulated remount runs cleanup → setup on the same instance with refs preserved, so `dispatchReadyIfNeeded` bails for the rest of the mount — a barrier that never acks, in exactly the mode `pnpm dev` runs. The fix is a setup that re-arms the flag, not a cleanup that clears it. The **second `wireDefaultSceneActions` call site**: dropping its second argument compiles and starts, and the game simply has no scenes; the failure surfaces only when a snapshot names one, which is why `electron/main/index.test.ts` pins the contribution routing rather than the call. The **`aria-hidden` cover trap**: `TransitionOverlay` carries `aria-hidden="true"`, so a cover rendered as its CHILD has its preset's `role="status"` stripped out of the accessibility tree — the cover is a sibling for that reason and not for layout. And the **transition-effect cleanup trap**: that effect depends on the freshly parsed `sceneTransition` OBJECT and therefore re-runs on every state frame, so using its cleanup to cancel a run would let a remote player's ack kill the local preload; cancellation is scoped to an unmount-only effect and an explicit transition-identity check instead.

**Invariants.** #133 was authored here: a client-side preload gates no mount and no host barrier, with the four settle paths and both budgets named, and with its scope limit stated rather than claimed away — a seat in `state.players` with no mounted `SceneRouter` could stall the barrier, and F83 did not fix that. Since closed by #1110: the host measures its own budget and dispatches `engine:scene_expire`, so #133's scoping sentence now names that release instead. #52 was amended to name its first runtime consumers on both carriers while keeping the limit that survives the wiring: a runtime FETCH failure is still something `validate-assets` cannot see. #88 was amended for the registry-resolved fallback and its empty-placeholder default.

| Task                                                                                         | Issue                                                           |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Carry a scene's declared required assets to clients on the snapshot                          | [#1017](https://github.com/jindrichruzicka/Chimera/issues/1017) |
| Extend the game-screen contract with preload progress and the loading-cover slots            | [#1018](https://github.com/jindrichruzicka/Chimera/issues/1018) |
| fix: RootErrorBoundary renders its crash fallback behind the opaque app-level screen fade    | [#1019](https://github.com/jindrichruzicka/Chimera/issues/1019) |
| Give the scene preload arm a producer via registerScenes and a tactics demo scene            | [#1020](https://github.com/jindrichruzicka/Chimera/issues/1020) |
| Add startScenePreload, the fail-open budgeted run for a scene's required assets              | [#1021](https://github.com/jindrichruzicka/Chimera/issues/1021) |
| Resolve the loading cover and render it at the Suspense boundary                             | [#1022](https://github.com/jindrichruzicka/Chimera/issues/1022) |
| Gate the route reveal on the asset preload and cover it while it waits                       | [#1023](https://github.com/jindrichruzicka/Chimera/issues/1023) |
| Wire the scene preload into the two-phase transition and surface its progress                | [#1024](https://github.com/jindrichruzicka/Chimera/issues/1024) |
| Prove both gates and the opt-in cover end-to-end                                             | [#1025](https://github.com/jindrichruzicka/Chimera/issues/1025) |
| Author the F83 invariant row, sweep the falsified prose, cut the changeset and open the gate | [#1026](https://github.com/jindrichruzicka/Chimera/issues/1026) |

Feature issue: [#1016](https://github.com/jindrichruzicka/Chimera/issues/1016).

**Out of scope (deferred):** At F83's close, no budget on `loadRendererGame`'s warm-up, which is awaited BEFORE either preload budget starts, so a wait that never settled held the route in a state neither budget could reach — Invariant #133's promise was scoped to the preload for exactly that reason. Since measured and half closed ([#1109](https://github.com/jindrichruzicka/Chimera/issues/1109)): the shell's own fonts/images/cursor warm-up now runs on `GAME_SHELL_WARMUP_BUDGET_MS` and fails open, while the game's dynamic `import()` above it stays unbounded on its stylesheet channel and cannot fail open at all — see [Asset Reference System](../core-components/asset-reference-system.md); No host-side barrier re-evaluation for a seat with no mounted `SceneRouter`. `areAllPlayersReady` requires an ack from every key of `state.players`, `engine:scene_ready` has one producer and it runs only inside a mounted router, so a disconnect mid-transition or an AI seat stalled the barrier — reachable on `main` before F83, widened by it only within the budgets. Since measured and closed: an AI seat does land in `state.players`, and no engine action removes a disconnected one, so the host now expires a transition its own budget outlasts ([#1110](https://github.com/jindrichruzicka/Chimera/issues/1110)); No settle-all in `preloadCritical`, which awaited its entries in sequence and stopped at the first rejection, leaving later critical entries to load on demand. Since measured and closed ([#1111](https://github.com/jindrichruzicka/Chimera/issues/1111)): the degradation is reachable past `validate-assets`, which checks a ref's file for existence only and so passes a present-but-undecodable one, and the shipped game carries two critical entries, so one failing first cost the other its warm-up. The run now attempts every critical entry and rejects, once they have all settled, with the refs that failed named on the error; No new public barrel subpath and no new exported symbol, so `renderer/__tests__/package-exports-contract.test.ts`, the barrel side-effect module counts and Invariant #96's count word are asserted UNCHANGED rather than moved.

#### Scope decisions

| Asked                                                 | Delivered                                                                                                                                                        | Why                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A cover that reports elapsed time as well as progress | `elapsedMs` was not added. A cover receives `progress` — a measured fraction, or `null` where nothing measures — alongside the rest of `GameLoadingScreenProps`. | An elapsed count would tick on the frame clock, making the cover re-render for a wait nothing measured — and a code-split `import()` exposes no progress channel at all, so the honest value there is `null`, which an elapsed counter would paper over with a moving number. |
| An `{ image }` cover form taking an `AssetRef`        | `{ image }` takes a URL string.                                                                                                                                  | The cover renders while the asset system is the thing being waited on. Resolving the cover's own image through `AssetManager` would make the explanation for a slow load depend on a load.                                                                                    |
| Tactics adopting the cover slots as a demonstration   | Tactics adopts the motionless `{ message }` form on one screen key, and declares NO registry-wide `loadingScreen`.                                               | A screenshot of a motionless cover is deterministic; a spinner or a component is not, and the e2e case that proves the cover exists asserts its rendered text. Declaring one key and no fallback is also what makes "covers this key and no other" falsifiable.               |
| A cold direct-`/game` boot gated on the same preload  | The gate is a deliberate no-op on that path.                                                                                                                     | A cold boot straight to `/game` has no loaded game yet, so there is no manifest to preload and the gate's blank-manager short-circuit returns ready on the first render. Making it wait would be waiting on a run that never starts.                                          |

### F84 — Spatial Audio: Listener Pose, Distance Falloff & Moving Sources `§4.25`

**Status: implemented across #1030–#1036; the feature gate is
[#1133](https://github.com/jindrichruzicka/Chimera/issues/1133).** Before F84 the voice
graph's `PannerNode` — `source → voiceGain (1) → [panner] →
busGain (2) → masterGain (3) → destination`, created by `connectVoice` — had never been
usable: the position was written once, at `startVoice`, nothing in the repo had ever set
`AudioContext.listener`, and every positioned voice played panned relative to the world
origin under Chrome's `createPanner()` defaults. There was no way to move a source after it
started, no way to say how far full volume reached, and no way to say where the ears were.
F84 turned that stub into an authored spatial layer (`PlayOptions.spatial`) and stayed
deliberately small: HRTF, source cones, occlusion, reverb zones and doppler are all
non-goals, and `panningModel` is pinned to `'equalpower'`.

**The listener is not the camera, and that is the load-bearing decision rather than an
omission.** `apps/tactics` renders its board with `TACTICS_CAMERA_POSITION = [1, 12, 0]` — a
top-down camera twelve units above the action. A listener bound to it would put every board
sound roughly twelve units away and pan the whole board through a near-vertical axis, so a
unit one tile left of another would be nearly indistinguishable from it. The pose is always
supplied by the game, which knows what the player is _listening from_ (the focused unit, the
board centre, the cursor) as distinct from what the camera is _looking at from_. There is one
listener per app, shared by every canvas, so an F81 `role="overlay"` minimap must not move it;
the default pose is the Web Audio default, so a game that sets nothing keeps today's
behaviour exactly.

Distances are authored as a full-volume radius and a falloff radius with a curve between them
(`fullVolumeDistance` / `falloffDistance` / `falloff`), mapping onto `refDistance` /
`maxDistance` / `distanceModel` with no arithmetic of the engine's own. **The default curve is
`'linear'`, deliberately diverging from the platform default of `'inverse'`**: only the linear
model reaches zero at `maxDistance`, while `inverse` and `exponential` clamp the _distance_
there and hold a non-zero gain at every distance beyond it — so shipping the platform default
would make `falloffDistance` name a radius that silences nothing. Inverted distances are a
**static reject at `play()`**, invalid handle and no voice reserved, reusing the exact tier
Invariant #117 established for `to <= from`; distances never reach the dynamic tier because
they never need a decode. Equal distances are an authored hard cutoff, realised as the
narrowest band the continuous model can express through a named constant.

Invariant **#116 is untouched, by construction**: the panner sits _between_ stage 1 and stage
2, so spatial attenuation is its own gain and nothing in this feature writes any of the three
stages. A spatial voice therefore still ducks, still follows its bus volume, and still fades
exactly as a non-spatial one does — where the obvious wrong implementation, computing
attenuation in JS and multiplying it into stage 1, would break #116 and make every fade fight
the distance curve. One event-side seam lands here too: `EventAudioBinding` is a static
`{ ref, bus?, volume? }` map, so it gains an optional per-event options resolver. It receives
the `GameEvent` the contract actually has — `{ readonly type: string }` and nothing else — so
it can vary volume, priority and bus (`rate` is typed and reserved, dropped by the player
until F86 lands a consumer) but **cannot** produce a position; widening
`GameEvent` with an opaque payload would push uninspected data through
`StateProjector.project()`, which is a projection-contract change (Invariants #3/#8/#98) and
not an audio one. Positioned event SFX therefore use explicit call sites, and **Tactics** is
the reference adopter, with the listener anchored at the board focus and a comment saying why
it is not the camera.

| Task                                                                                       | Issue                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Add the spatial option types and the static distance-validation tier                       | [#1030](https://github.com/jindrichruzicka/Chimera/issues/1030) |
| Configure the PannerNode from the resolved spatial spec                                    | [#1031](https://github.com/jindrichruzicka/Chimera/issues/1031) |
| Add AudioManager.setListener with a feature-detected param path                            | [#1032](https://github.com/jindrichruzicka/Chimera/issues/1032) |
| Add AudioManager.setVoicePosition for moving sources                                       | [#1033](https://github.com/jindrichruzicka/Chimera/issues/1033) |
| Add useSpatialAudio and export the spatial surface from the audio barrel                   | [#1034](https://github.com/jindrichruzicka/Chimera/issues/1034) |
| Add the per-event options resolver to the event-audio binding                              | [#1035](https://github.com/jindrichruzicka/Chimera/issues/1035) |
| Adopt spatial audio in tactics with a positioned SFX and a non-camera listener             | [#1036](https://github.com/jindrichruzicka/Chimera/issues/1036) |
| Author Invariant #134, sweep the docs and roadmap F84, cut the changeset and open the gate | [#1037](https://github.com/jindrichruzicka/Chimera/issues/1037) |

Feature issue: [#1027](https://github.com/jindrichruzicka/Chimera/issues/1027).

**Out of scope (deferred):** No HRTF panning — `panningModel` is pinned to `'equalpower'`,
which costs no convolution against a 32-voice pool and buys little for the top-down and
side-on cameras in the repo; No source cones (`coneInnerAngle` / `coneOuterAngle` /
`coneOuterGain`) and no source orientation — sources are omnidirectional; No occlusion,
obstruction, reverb zones or any DSP, which keeps F74's filters/EQ/reverb deferral intact; No
doppler, which is no longer in the Web Audio spec and has nothing to implement; No
camera-derived listener pose and no engine-owned r3f binding component — the pose is the
game's, for the reason the section above measures; No typed, projection-gated `GameEvent`
payloads, so the event-options resolver cannot produce a position — widening the event
contract is a projection change, not an audio one. What that deferral **cost**, measured at
the F84 tree rather than predicted: `filterEvents` in `apps/tactics` returns every event to
every seat, so the two entries the adoption removed from `TACTICS_EVENT_AUDIO_BINDING` had
been playing on **both** clients, and playing them at the intent site instead made an
opponent's move and attack **silent** — audible positioning bought for one seat at the price
of the other's feedback. That loss was repaid in
[#1134](https://github.com/jindrichruzicka/Chimera/issues/1134) **without** taking the
deferral back: the board now derives each positioned SFX from the delta between the
projections it receives, so both seats play from what they actually got, the event contract
is untouched, and a cue is owed per changed unit rather than per indistinguishable
`{ type }`. What that costs against the intent site, each pinned in
`apps/tactics/screens/TacticsDemoBoard.test.tsx` or
`apps/tactics/components/tacticsSfxDelta.test.ts`: a hit is positioned on the defender, a unit
entering the projection through a proximity reveal is silent, and every seat now hears its own
action when the projection returns rather than at the click. `reveal` stays event-driven and
audible to both throughout; No game adopter for
`setVoicePosition`. The moving-source verb ships unit-tested and reachable from the barrel,
but nothing in `apps/tactics` moves a live voice — the board's units teleport between tiles —
so that third of the feature has tests but no production evidence, unlike the listener pose
and the distance band; No pool resize and no bus-graph reshape, unchanged from F74 — all
candidates for a follow-up.

### F85 — Music Cue Observation & Cue-Aligned Transitions `§4.25`

**Status: designed, not implemented.** F74 gave music transitions everything except a sense of
_when_. A game can crossfade two beds, but only **now**, so a swap driven by gameplay — the
last enemy dies, the turn passes — cuts across whatever the music was in the middle of. F85
adds the ability to say "do this at the next musical boundary", and it does so in two halves
whose separation **is** the feature: **observe to decide**, a frame-sampled cue stream
(`cue` / `loop` / `end`) with one frame of jitter by construction, for HUD, VFX and
decision-making; and **schedule to execute**, `crossfadeAtCue` / `fadeOutAtCue`, armed now and
executed sample-accurately at the cue through native `AudioBufferSourceNode` scheduling. A
callback that fires a frame late and _then_ starts a crossfade would put the transition a
frame off the beat, which is precisely the artifact the feature exists to remove — so neither
mechanism is built out of the other.

**Most of the arithmetic already exists.** `nextCueContextTime()` answers "when does this
voice's playhead next reach cue X", loop-period-aware, with the entry-pass asymmetry worked
out and the window treated as closed at `loopEnd` because that is where the playhead wraps; it
is what `fadeOut({ toCue })` already runs on, and cue-aligned scheduling is largely a second
consumer of it. What does not exist is its **dual** — where the playhead is _now_ — which is
what a sampler needs, and the two directions are tested against each other rather than each
against a hand-computed table. The enabling change on the scheduling side is likewise small,
because `startVoice` is already shaped for it: it reads `audioContext.currentTime` **once** and
threads that single `t0` through the gain floor, `source.start`, the stop maths and every
pending ramp, with a comment saying that "applied atomically at t0" is only true if there is a
single `t0` to apply them at. That local becomes a parameter, and the existing `linkedFadeOut`
slot already takes `startedAt` as its argument, so crossfade linkage anchors at the cue with no
change at all. Getting the anchoring wrong is silent rather than loud: a fade-in anchored at
the call rather than at the scheduled start runs to completion **before the voice is audible**,
so the bed simply appears at full volume.

**Observation is inert by a missing parameter.** The cue-handler record carries no dispatcher,
no `SendAction`, no `PlayerId`, no `EngineAction` and no tick — the discipline F82 used for
`clipMarkerScheduler`, and for the same reason: a parameter that does not exist cannot be
`eslint-disable`d. The pure scheduler is that module's **sibling** rather than a reuse of it;
the rules carry over (half-open `(last, next]` crossing, close-before-wrap, once-per-step,
ascending-then-lexicographic order) but the timeline does not, because audio cues are absolute
buffer **seconds** with an asymmetric entry pass into a loop window that need not be the whole
buffer, where a clip timeline is normalized **phase** in `[0, 1]` with cycles. The sampler is
one `requestAnimationFrame` chain owned by `AudioManager`, started on the first subscription
and cancelled on the last, so a game that never observes a cue pays no frame cost; it is not
`useFrame`, because the audio barrel is not r3f-bound and cue observation has to work on a menu
screen with no `<Canvas>` mounted. **Tactics** is the reference adopter and needs no new
content: both ambience beds already declare `loopStart`/`loopEnd`, so the turn-driven swap
becomes a `crossfadeAtCue` at the same `loopEnd` the loop already uses, and the e2e's claim
becomes a **timing** one — the mirrored bed marker must not change at the turn boundary and
must change afterwards.

| Task                                                                                                       | Issue                                                           |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Add the voice playhead reader and secondsUntilCue                                                          | [#1038](https://github.com/jindrichruzicka/Chimera/issues/1038) |
| Add the pure cue marker scheduler                                                                          | [#1039](https://github.com/jindrichruzicka/Chimera/issues/1039) |
| Wire the on-demand rAF cue sampler and AudioManager.observeCues                                            | [#1040](https://github.com/jindrichruzicka/Chimera/issues/1040) |
| Let startVoice start a voice at a future context time                                                      | [#1041](https://github.com/jindrichruzicka/Chimera/issues/1041) |
| Add crossfadeAtCue and fadeOutAtCue with their fail-soft branches                                          | [#1042](https://github.com/jindrichruzicka/Chimera/issues/1042) |
| Add useAudioCues and export the cue surface from the audio barrel                                          | [#1043](https://github.com/jindrichruzicka/Chimera/issues/1043) |
| Adopt the cue-aligned ambience swap in tactics with an e2e                                                 | [#1044](https://github.com/jindrichruzicka/Chimera/issues/1044) |
| Author the cue-observation invariants, sweep the docs and roadmap F85, cut the changeset and open the gate | [#1045](https://github.com/jindrichruzicka/Chimera/issues/1045) |

Feature issue: [#1028](https://github.com/jindrichruzicka/Chimera/issues/1028).

**Out of scope (deferred):** No `MusicDirector` layer — named slots, stem stacks, in-flight
retarget and a global cue registry stay deferred exactly as F74 left them; F85 lands the
primitive that layer would have needed, not the layer; No cue events reaching the simulation.
No dispatcher on the handler record and no `EngineAction` gated on a cue, held by a missing
parameter rather than by a rule; No beat/tempo inference and no musical time — cues are the
authored seconds already in `AudioClipMetadata`, and nothing derives bars, BPM or a grid; No
new `'scheduled'` voice phase. A voice awaiting a future start stays `'playing'` with a future
`startedAtContextTime`, because a fourth `VoicePhase` would move `voiceLoops` and Invariant
#123's four-key ranking for a state lasting at most one bar; the consequence — such a voice
ranks as playing for preemption while still inaudible — is documented rather than engineered
away; No cue-authoring change, so `validate-assets` and Invariant #125 are untouched and the
existing sheets pass as they stand; No sample-accurate observation. Observation is
frame-sampled on purpose, and anything needing sample accuracy is a _scheduled_ op — all
candidates for a follow-up.

### F86 — Variable Playback Rate `§4.25`

**Status: designed, not implemented.** Every voice in the engine plays at exactly rate `1`, and
Invariant #122 states the constraint outright — cue-relative fade timing is derived "at a fixed
`playbackRate` of 1". The practical cost is the machine-gun effect: `apps/tactics` plays `step`
for every move and `swordHit` for every attack it can see, whichever seat acted, and each replay
is bit-identical, which is what makes repeated SFX read as a defect rather than as a footstep. F86 adds `PlayOptions.rate`,
**immutable for the life of the voice**, plus a `rateFromSemitones` helper so the `2 ** (n/12)`
constant appears in one place. This is resampling, so **rate and pitch move together**, and the
option is named `rate` rather than `pitch` so the type does not promise a time-stretch it does
not perform.

**Rate turns a buffer-seconds quantity into a wall-clock one, so the whole feature is the four
places that conversion happens** — `nextCueContextTime`'s entry-pass offset and loop-period
advance, the looping `to` bound's `source.stop`, and the non-looping voice's implicit end — plus
one portability rule for the fourth. The non-looping **bounded** play today passes its duration
as `start(when, offset, duration)`'s third argument, which is buffer-relative; the code already
calls the analogous meaning "not portable" for the looping branch, which is why that branch
schedules `source.stop()` instead. So when the rate is not `1`, the play is bounded the same
way — `source.stop(startedAt + seconds / rate)`, unambiguous, with `onended` still the single
release path of Invariant #119. That rule matters more than it looks, because the unit suite
runs against a Web Audio double that **cannot observe** the ambiguity at all: it is held by the
code shape and by a test that a rate-shifted bounded play passes no third argument, never by an
assertion about a duration the double would satisfy either way. Fade windows are authored in
wall-clock milliseconds and are **not** divided — mixing the two axes is the defect this change
most plausibly introduces.

The rate's **immutability is what keeps the arithmetic a single division rather than an integral
of rate over time**, which is why it lands as an amendment to Invariant #122 rather than as a new
number: it is not a separate rule but the precondition that makes #122's own claim true. F85's
playhead reader converts on the same axis, so whichever of the two lands second sweeps the
other's arithmetic; neither blocks the other. **Tactics** adopts it through F84's per-event
options resolver, with the jitter authored **by the game** — the engine supplies no randomness,
so replays and tests stay under the game's control and nothing non-deterministic enters engine
code.

| Task                                                                                               | Issue                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Add PlayOptions.rate and the rateFromSemitones helper                                              | [#1046](https://github.com/jindrichruzicka/Chimera/issues/1046) |
| Make the voice timeline arithmetic rate-aware and bound a rate-shifted play by stop()              | [#1047](https://github.com/jindrichruzicka/Chimera/issues/1047) |
| Export the rate surface and adopt pitch-jittered footsteps in tactics                              | [#1048](https://github.com/jindrichruzicka/Chimera/issues/1048) |
| Amend Invariant #122, sweep the rate-1 claims and roadmap F86, cut the changeset and open the gate | [#1049](https://github.com/jindrichruzicka/Chimera/issues/1049) |

Feature issue: [#1029](https://github.com/jindrichruzicka/Chimera/issues/1029).

**Out of scope (deferred):** No pitch-preserving time-stretch and no independent pitch shift —
both need a phase vocoder or a WASM library, and rate and pitch are one knob here; No live rate
changes (`setVoiceRate`). Every cached timeline anchor on `VoiceRecord` assumes a constant rate,
so a mid-flight change would make cue timing a piecewise integral of rate over time — a different
feature with a different invariant; the rate is read once, at `startVoice`; No `detune` option, a
second spelling of the same quantity that `rateFromSemitones` already covers musically; No rate on
the bus or master — rate is per-voice and the three-stage graph is unchanged; No engine-supplied
per-play jitter. A game authors its own through the event-options resolver or its own call site,
so nothing non-deterministic enters engine code; No new invariant number — #122 is amended, and
the roll-call total does not move — all candidates for a follow-up.

### F89 — Blended Clip Transitions, Finished-Clip Pose Retention & Authored Blend Durations `§4.40`

Two defects sat under F82's animation layer, and the second is the reason the first was worth
fixing properly. Changing `clip` on `useClipPlayer` was a **hard cut** — the crossfade seam
existed, was tested, and had no caller — and a finished `'once'` clip did not even hold its last
frame: the player stopped the action on the terminating tick, three restored the model's original
state synchronously, and a one-shot ended in a **bind-pose flash** on the very tick its
`clip-end` handler ran. F89 lands both, plus one authoring surface, in the order that makes each
cheap: repair the backend seam, give the player a verb that means _become the only clip_, then
make a blend length declarable at a call site and once per clip in the manifest.

**Mark ownership: the incoming clip owns the stream from the instant the transition starts.**
Every open passage on every outgoing clip closes synchronously inside the call, and the outgoing
clip then fires no `notify`, no `passage-tick` and no `clip-end` however long its action keeps
posing. The two other candidate answers — "the outgoing clip keeps emitting until its fade ends"
and "both emit while they overlap" — are not merely undesirable, they are **unreachable without
un-freezing the backend**: a released playback's handle answers a frozen sample by construction,
so a player that wanted to keep stepping the outgoing clip would have to re-open a terminal
record. Worse, an outgoing entry left active in the player emits a **fabricated `clip-end`** on
the next tick, because the scheduler reads `ended` off that frozen sample — including for a
`'loop'` clip, which can never end. Ownership by the incoming clip is therefore the only answer
whose failure mode is silence rather than fiction.

**The `'stopped'` → `'clip-changed'` reason flip is unconditional.** A clip prop that moved, a
`loop` change and a `sheet` change all close the outgoing playback as `'clip-changed'`, whether
or not a blend was asked for. Gating the reason on `blendSeconds > 0` would make a game's
`switch (event.reason)` mean two different things depending on a duration, which is exactly the
sort of coupling a public enum should not have. `'stopped'` keeps its own meaning: it is what a
caller **asking** for a stop gets — `player.stop(name)`, `stopAll()`, and the hook's `clip → null`
arm. `'released'` still means the player or its backend was disposed.

**A blend length is wall-clock seconds and does not compose with the dilation multiplier.** The
mesh backend drives its ramps from the raw delta `ClipPlayer.tick` hands `advance`, so a 0.3 s
blend takes 0.3 s in a scene running at a quarter speed. That is a decision, not an accident:
the multiplier paces _content_, and a transition between two states of the UI reads as broken
when it stretches with the slow-motion it is announcing. Invariant #130's single derivation site
is untouched, and the duration is a duration everywhere — never a multiplier.

**The weight ramps are the backend's own, not three's.** `fadeIn` and `fadeOut` schedule a
multiplier interpolant between **hardcoded** endpoints — out from 1, in from 0 — regardless of
where the action's weight actually is, and three exposes no public way to ramp from an arbitrary
current weight. Three visible artefacts follow: a blend interrupted a quarter of the way in snaps
back to nearly full weight, a blend with nothing outgoing dissolves the model out of its rest
pose, and a clip still fading out cannot be brought back without restarting it at phase 0. So a
ramp is a `(from, to, duration)` on the record, stepped once per `advance` before the mixer
update; this layer schedules no three fade interpolant at all, and `crossfadeTo(name, 0)` is a
real cut rather than the degenerate ramp three produces, whose action reaches weight 0 without
ever being deactivated.

**A terminal playback is not necessarily an invisible one.** `ClipPlayback.hold()` joins `stop()`
on the seam: both freeze the playhead and latch `ended`, and only `stop()` hands the resources
back. That distinction is what lets a finished `'once'` clip stay on its last frame, and it is
why the player keeps two maps rather than one — the poses a clip **end** left standing, and
whatever a **blend** is fading out, which is the clip it replaced plus any pose it is fading out
of. Reading one map for both looks tidy and breaks an A→B→A alternation into blend, cut, blend,
because a clip whose fade has ended is still listed as posing while a clip that ended and is
merely standing there is exactly the one a blend must not resume.

**The sprite asymmetry is deliberate.** The runtime option is narrowed **off** the sprite hook
(`UseSpriteClipPlayerOptions` omits `blendSeconds`, and `AnimatedSpriteProps` with it), while the
authored `blendInSeconds` sits on the **shared** track sheet and a sprite clip may carry it. A
React prop that typechecks and silently does nothing is a trap sprung at the call site; an
authored sheet field is data the compile half already treats uniformly, one validator
range-checks in one place, and `supportsBlending` declines at runtime. Narrowing a published type
later would be a removal; narrowing before it ships costs nothing.

**Three layers read the sheet field and each failed silently in isolation** — the `validate-assets`
gate read a fixed set of member names, the renderer parser is an allow-list that drops unknown
keys with no warning, and the compiled timeline had no slot. That is why they are three tasks with
three owners, and why the gate and the parser both range-check: one is a static AST read that
refuses what it cannot read, the other a predicate over runtime values. Neither may be dropped on
the grounds that the other covers it. Both accept exactly `0`, which is what an animator writes to
say _this clip cuts in_.

| Task                                                                                             | Issue                                                           |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Hoist checkedFade onto the clip-backend seam and make a zero-length crossfade a real cut         | [#1082](https://github.com/jindrichruzicka/Chimera/issues/1082) |
| Own the released-but-posing action in MeshClipBackend and remove crossfadeTo's weight artefacts  | [#1083](https://github.com/jindrichruzicka/Chimera/issues/1083) |
| Add ClipPlayback.hold() and hold a finished 'once' clip's action instead of stopping it          | [#1084](https://github.com/jindrichruzicka/Chimera/issues/1084) |
| Implement ClipPlayer.transitionTo and ClipPlayer.stopAll                                         | [#1085](https://github.com/jindrichruzicka/Chimera/issues/1085) |
| Drive the playback effect through transitionTo and give clip → null its own stop                 | [#1086](https://github.com/jindrichruzicka/Chimera/issues/1086) |
| Add blendSeconds, narrow the sprite options alias and route a positive blend through crossfadeTo | [#1087](https://github.com/jindrichruzicka/Chimera/issues/1087) |
| Add blendInSeconds to the AnimationTrackSheet authoring vocabulary                               | [#1088](https://github.com/jindrichruzicka/Chimera/issues/1088) |
| Read and resolve blendInSeconds through parseTrackSheet, the compiled timeline and ClipPlayer    | [#1089](https://github.com/jindrichruzicka/Chimera/issues/1089) |
| Range-check blendInSeconds in the validate-assets animation gate                                 | [#1090](https://github.com/jindrichruzicka/Chimera/issues/1090) |
| Sweep the falsified prose, write the F89 roadmap section and cut the changeset                   | [#1091](https://github.com/jindrichruzicka/Chimera/issues/1091) |
| F89 feature review and merge gate                                                                | [#1092](https://github.com/jindrichruzicka/Chimera/issues/1092) |

Feature issue: [#1081](https://github.com/jindrichruzicka/Chimera/issues/1081).

**Out of scope (deferred):** No layered or masked blending, no blend trees or parametric blends,
and no inertialisation — F82 defers all three and F89 adds none of them; No blend verb on
`ClipPlayerHandle`. The declarative option covers the known cases and the handle stays at one
method, with the consequence worth naming: a game cancels an in-flight blend by asking the
player for another change — declaring a different clip, or none — rather than by naming
the blend; No fade-out on `clip → null`. The seam has no fade-to-nothing
primitive, so declaring no clip stays a hard cut with the original-state restore — documented
rather than discovered; No dilation of the blend duration, recorded on the option rather than
changed; No tactics adoption of a blend and no animation e2e spec — F89's end-to-end proof is
`renderer/animation/__tests__/blended-transition.test.ts`, driving a real `ClipPlayer` over a real
`MeshClipBackend` against real `three`. Adopting it meant regenerating the byte-gated
`showcase-rig-animated.glb` around a second clip, re-authoring its sheet and extending the game's
window verification, so it was filed as a follow-up and landed under
[#1095](https://github.com/jindrichruzicka/Chimera/issues/1095); No §4.40 core-component section — that
section was F82's outstanding follow-up, not F89's scope, and it landed afterwards under
[#1096](https://github.com/jindrichruzicka/Chimera/issues/1096) as
[`docs/core-components/animation-system.md`](../core-components/animation-system.md), covering both
features' surface; No new numbered invariant — the posing-action release rule ships as a named
module-header rule, the way Rule SPEED-NON-NEGATIVE and Rule STEP-BOUNDED already do; No
`@chimera-engine/renderer/animation` subpath — both blend surfaces ride already-exported types,
so the exports map, the package-exports contract and Invariant #96's eight-barrel count are
unchanged; No docs-site sync, since the published docs live in a separate repository — all
candidates for a follow-up.

### F90 — Minimum Visible Time for Loading Covers `§4.36, §4.18–§4.19, §4.10`

**Status: implemented across #1127–#1131; the feature gate is #1132.** The contract field,
resolver and registration warns landed with #1127, the `useMinimumVisibleHold` latch with
#1128, the visibility-gated route-entry arms with #1129, `SceneRouter`'s held layer with
#1130, and tactics' 400 ms adoption plus the Invariant #133/#88 amendments with #1131.
A loading cover that appears and vanishes inside
~100 ms reads as a flicker, not an explanation. F83 made every cover's lifetime exactly the
wait it stands in for, and on fast hardware that wait is often shorter than the time a
player needs to register that anything was shown — a spinner that flashes for two frames is
worse UX than no spinner at all. F90 adds one optional registry knob,
`GameScreenRegistry.loadingScreenMinVisibleMs`: once a cover has actually been shown, it
stays on screen at least that long; a load that outlives the minimum changes nothing.
Absent or `0` arms no hold — not even a `setTimeout(0)` whose flush would reorder the
reveal.

**The knob is a minimum VISIBLE time, not a minimum wait, and visibility is the arming
condition.** The hold arms only at the moment a cover the player can actually see renders:
the F83 cascade must resolve a game-declared form — a component, a preset, `{ message }`
or `{ image }` — and the cover must not be occluded. It never forces a cover onto a path
that would not have shown one (the route-entry gate's skipped short-circuit settles on
first render, coverless, and stays instant), it never arms on `'none'` or on the engine's
empty placeholder, and it never arms on a cover nobody sees: on the faded lobby→game
entry the app-level screen-fade scrim paints OVER the route cover — `AppShell` wraps every
route's content in its own `z-index: var(--ch-z-raised)` stacking context, so the cover's
`--ch-z-loading-hud` is local to that context while the scrim is a sibling at
`--ch-z-screen-fade` — which means the player watches the scrim, not the cover, for as
long as the scrim is there, and a mount-stamped hold would extend a black screen. The
route arm therefore stamps `shown` only where the cover is actually visible — a direct
`/game` boot with no opaque scrim, `/replays/player`, whose entry has no fade at all, and
(since the reveal grace below) a faded `/game` entry from the moment it clears its own
scrim. One visual wait gets one clock: a hold never arms for a cover
occluded by the scrim or by another cover layer, so stacked surfaces cannot chain two
minimums onto one wait. The `restoreWaiting` widening is untouched: a save-restore parked
on `/game` must surface its abortable overlay, and a cosmetic hold does not get to delay a
modal the player has to see.

**Amended after RC testing: the faded entry now reaches that arming condition instead of
being excluded from it.** As shipped, F90's guard was correct and its consequence was that
`loadingScreen` and `loadingScreenMinVisibleMs` were structurally inert on lobby→game — the
only path a player takes into a match — because the fade-in that clears the entry scrim was
itself gated on the reveal, so the scrim stayed opaque for the whole wait and `shown` never
rose. Measured on 1.0.0-rc.7 with a scaffolded game declaring `'spinner'` and a 2000 ms
minimum: the cover mounted, dropped 476 ms later at the settle, and the scrim read opacity 1
at every sample across its life. The fix does not remove the guard — a mount-stamped hold
really would extend a black screen. It decides visibility on how long the wait turns out to
be: `ROUTE_COVER_REVEAL_GRACE_MS` (350 ms, `renderer/assets/criticalAssetPreload.ts`) runs a
fixed timer over a wait spent under an opaque scrim, and if the wait is still going when it
fires the route eases its own scrim off — the entry's one fade-in, brought forward — and the
floor stamps from that clear. A wait that settles first still pays nothing the player can
see: the scrim stays black, the cover is dropped unseen, and the entry spends its one
fade-in at the reveal exactly as before. The minimum is what opts an entry in, so a declared cover
with no declared minimum stays on the unchanged path, and since the floor itself collapses
under `NEXT_PUBLIC_CHIMERA_E2E` the grace is disarmed there by its own arming condition, so
the unit suites are what carry it. A cover the player saw then
leaves on a fade over the scene beneath it rather than a cut, which costs one fade instead
of returning through black for two.

**Nothing host-visible moves, by construction rather than by discipline.** The
scene-transition arm dispatches `engine:scene_ready`, and the host barrier waits for every
player — a minimum inserted before the ack would serialize one client's cosmetic
preference onto every seat in the match and falsify the retry cadence's meaning ("fade-out
done, preload settled"). F90 never edits that path at all: `useFadeTransition`, the ack,
both fade channels and the progress protocol (`0` at a measured start, `null` at the end)
ship unchanged, pinned by their existing suites passing unmodified. The deferral cannot
live there anyway — the transition cover's unmount is driven by `sceneTransition` leaving
the snapshot (`readEnteringScene` answers `null` before it ever reads the progress
fraction), a host-side event this feature does not delay. So the hold is a **held copy at
the render site**: when the commit would drop a cover whose minimum has not elapsed,
`SceneRouter` keeps rendering the same resolved cover with its last measured fraction as
its own state, at `--ch-z-loading-hud`, over the scene fade-in already running beneath it,
until the remainder elapses. A new transition supersedes a held copy immediately — the
incoming fade-out owns the screen, and the superseded cover simply drops. On the
route-entry arm everything is client-local already: the gate settles on its four paths
untouched, and the hold sits in the consumer between `criticalAssets.ready` and the
reveal — the gate hook itself does not learn to lie about `ready`.

**The Suspense site shares the same held-layer machinery, and it is the site that flashes
most.** A code-split screen chunk on a warm disk resolves in tens of milliseconds, and a
plain `<Suspense fallback>` unmounts the instant it does — nothing outside the fallback
knows the cover was ever up. So a mount-report wrapper around the fallback stamps the
cover's lifetime, and when the chunk resolves early, the same one held-layer slot
`SceneRouter` uses for the transition arm keeps the resolved cover up for the remainder,
`reason="code"`, over a screen that mounts and runs underneath. At most one cover layer
renders at a time: an entering-scene cover supersedes a lingering code hold, and a code
hold never arms while another cover or the opaque scrim sits above the fallback (the
lobby→game playfield chunk suspends behind the route cover, and that wait already has its
clock). A component-form cover that is itself lazy stamps at wrapper mount regardless —
the inner placeholder frame it may paint first is accepted and documented. Every site
keeps F83's rule: the hold covers the sight of a screen, it never gates a mount
(Invariants #21, #133), and the held layer renders the SAME cascade resolution the
fallback rendered — a one-clause Invariant #88 amendment sanctions the re-render site.

**Under `NEXT_PUBLIC_CHIMERA_E2E` the minimum collapses to `0`, following the reveal
delays and not the budgets.** Invariant #133 forbids the four release budgets to collapse
under e2e because they are what guarantees a gate releases; the minimum is the opposite
object — a floor on cover visibility rather than a release budget, a deliberate delay like
`screenFadeMs()`, which already returns `0` there so that specs on a frozen-clock window
never wait on cosmetics. It does NOT collapse under `prefers-reduced-motion`: a motionless
cover holding for half a second is not motion, and reduced motion already zeroes the
fades — which makes the flash it exists to fix strictly worse there. The resolver reads
the env at call time, so the collapse is testable with a stubbed env at the use site.
Validation is warn-never-throw at registration, like the existing `loadingScreens` key
checks: a negative or non-finite value warns and holds nothing, and a value above
`SCENE_PRELOAD_BUDGET_MS` warns and is honored — the knob is the game's own foot-gun, but
the honest bound must be stated where #133 states the budgets': with a minimum declared,
the reveal lands at `max(settle-or-budget, shown + minimum)`, both terms finite, a fixed
timer that always fires. #133's liveness story gains one self-contained amending sentence
rather than a new number.

| Task                                                                                           | Issue                                                           |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Add loadingScreenMinVisibleMs to the game-screen contract with its resolver and validation     | [#1127](https://github.com/jindrichruzicka/Chimera/issues/1127) |
| Implement the useMinimumVisibleHold latch primitive                                            | [#1128](https://github.com/jindrichruzicka/Chimera/issues/1128) |
| Arm the visibility-gated hold on the route-entry reveal's two consumers                        | [#1129](https://github.com/jindrichruzicka/Chimera/issues/1129) |
| Hold the transition and Suspense covers past their release as SceneRouter's held layer         | [#1130](https://github.com/jindrichruzicka/Chimera/issues/1130) |
| Adopt the minimum in tactics, amend Invariants #133 and #88, sweep the docs, cut the changeset | [#1131](https://github.com/jindrichruzicka/Chimera/issues/1131) |
| F90 feature review and merge gate                                                              | [#1132](https://github.com/jindrichruzicka/Chimera/issues/1132) |

Feature issue: [#1126](https://github.com/jindrichruzicka/Chimera/issues/1126).

**Out of scope (deferred):** No per-key minimum map — one registry-wide knob; a per-key
override mirroring `loadingScreens` is purely additive later; No delay-before-show. The
classic anti-flash pair is "show only if the wait exceeds X, then hold at least Y"; F90
lands only the hold, because a delayed show re-opens the question of what stands in front
of the wait meanwhile — that is a second feature with its own blank-screen trade-off; No
hold on the engine's empty placeholder or `'none'`, and no hold on an occluded cover —
stated above as rules rather than listed here as options; No hold on the engine-owned
loading surfaces outside the cover cascade — the replay player's pre-ready "Loading
replay…" status block is a loading screen that can flash, and it is deliberately outside
the registry knob's reach; No clamp of an over-budget minimum — warned, honored, and the
`max(settle-or-budget, shown + minimum)` bound documented where the budgets are; No change
to tactics' cover topology — the per-key-only declaration is what keeps F83's "covers this
key and no other" falsifiable and the `hud-layout` negative control green, so the adoption
exercises the `asset-demo` covers and leaves the rest of the game coverless on purpose; No
dilation interplay — the minimum is wall-clock milliseconds, like every fade and budget on
these paths, and the F82 time-scale multiplier paces content, not chrome; No e2e spec
observing the hold, which collapses under `NEXT_PUBLIC_CHIMERA_E2E` by design — the proof
is fake-timer unit and integration coverage, and the existing preload-gate and scene-cover
specs stay green unmodified as the no-regression control; No change to any of the four
release budgets, to any settle path, or to the `engine:scene_ready` dispatch timing — all
candidates for a follow-up.

### F91 — Tween, Camera & Pointer-Interaction Surface on the r3f Barrel `§4.21, §4.22, §4.23`

**Status: implemented across #1137–#1138; the feature issue is
[#1136](https://github.com/jindrichruzicka/Chimera/issues/1136).** RC testing found six
documented engine APIs that no adopter could import. The code all shipped —
`renderer/tsconfig.build.json` includes the whole package, so `dist/hooks/useCamera.js` and
`dist/utils/curves.js` were already in the tarball — but the `exports` map lists eight
barrels plus `./shell/*` and `./styles/*.css`, with no `./hooks`, no `./utils` and no
wildcard. `useTween`, `useTweenCallback`, `useCamera`, the curve primitives,
`useGameInteraction` and `InteractionBlocker` were documented as engine API in §4.21–§4.23,
the traceability matrix and the changelog, and unreachable from every installed package.

**The door, not the code.** Nothing about the six modules changed. What changed is that
`components/r3f` now names them. That barrel rather than a ninth, because Invariant #96
names `renderer/hooks/` as an internal **and** states the escape in the same sentence —
"whatever a barrel re-exports is legal through that barrel". A `./hooks` subpath would have
contradicted a named clause of #96; re-exporting through `components/r3f` is the mechanism
#96 blesses, and that barrel already did it for `useAnimationTimeScale`. The four hooks are
also useless away from a canvas, so it is where a caller is already looking; the five curve
functions are **not** Canvas-bound — `renderer/utils/curves.ts` imports nothing and calls no
React hook, which `r3f-barrel-side-effects.test.ts` measures — and ride along because they
are what a caller passes to the hooks, which is the whole reason they ship as values and not
only as the `EasingFn` type. So the barrel set stays at **eight** and the specifier-keyed guards — the exports
map, `package-exports-contract`, Check 17's `RENDERER_BARREL_RE`, the
`no-game-renderer-internals` predicate, `PROBE_SUBPATHS` — are all untouched, because every
one of them already names `components/r3f`.

Opening a symbol cannot open a path, because `no-game-renderer-internals` compares the import
SOURCE and never sees the imported names. `renderer/utils/curves.js` joined
`renderer/hooks/useCamera.js` as an invalid fixture. No fixture had named `renderer/utils/`
before, so that one case is what closes `renderer/utils/*` against a rule that mistakenly
allowed the prefix. Which fixtures kill which mutants is the rule test's business and is not restated
here.

**Two of the six were worse than unreachable.** `useGameInteraction` calls
`useInteractionContext`, which throws without an `<InteractionBlocker>` ancestor
(Invariant #83) — and nothing in the repo mounted one: not the shell, not `GameCanvas`, not
tactics. The hook had zero non-test importers and would have thrown for every caller,
so exporting it alone would have shipped a hook that cannot be called. `GameCanvas` now
mounts the provider on every role, from **inside** its `<Canvas>`: the children that call
the hook are r3f children, so providing the context there needs no assumption about whether
React context crosses the r3f reconciler boundary.

**What that cost, stated rather than absorbed.** The barrel's import graph went 34 → 43
modules and its store edges three → four. The fourth is `state/gameStore.ts`, which the
side-effect test's own header had recorded as deliberately avoided — it builds its singleton
at module scope, so an edge constructs the game store in every consumer of the barrel. That
paragraph is rewritten rather than renumbered, because what it prices is a CHOICE between
two homes for one float (the dilation multiplier, which is why it was written) and not a
prohibition: `snapshot.sceneTransition` lives in `gameStore` and has no cheaper home. The
module-scope cost is real and unchanged; it buys a `useGameInteraction` that does not throw.
`react-dom` is the one new external, and it is `useCamera`'s alone — `animateTo` calls
`flushSync` so the tween re-renders with the new duration before `start()` runs. It was
already a peer dependency.

**Claims the sweep caught, including one already false.**
[`camera-system.md`](../core-components/camera-system.md) said the r3f barrel "exports no
other runtime component" — written 2026-08-05 in `bb413348`, while `AnimatedSprite`, a
runtime component, was exported 2026-08-12 in `091a05f5`. Stale on `main` before F91 touched
it; its intent was "no other canvas **root**", and it now says that. Two further sentences —
in the same file and in
[`performance-hud-device-info.md`](../core-components/performance-hud-device-info.md) —
inferred "`GameCanvas` mounts it, THEREFORE it is not exported", an inference
`InteractionBlocker` now falsifies by being both. Both are restated on the real reason: a
second `PerfProbe` double-publishes and a second `FrameRateLimiter` fights over one clock,
whereas nesting a second `InteractionBlocker` is a legitimate way to narrow blocking.

**Not in scope.** No ninth barrel and no `exports` key, per the above; No raw
`InteractionContext` export — the `assets` and `input` barrels publish a provider plus its
`useX()` accessor and never the context object, and this one follows them, so a nested
provider still gets its value from a component; No re-export of `Vector3Tuple` from
`useCamera`, since it and `GameCanvas` re-export the one declaration in
`renderer/types/r3f-types.ts` and a second statement is a duplicate identifier rather than a
widening; No tactics gameplay adoption — the adopter proof is `verify:scaffold`'s
compile-only seam plant, which names the new symbols from a real standalone install and so
proves resolution through the packed `exports` map rather than through the workspace, which
a tactics screen would not; No e2e spec, the pointer-gating proof being the three-snapshot
`GameCanvas` unit test (the unblocked read on mount is the store's initial state, which a
provider that never subscribed would report just as well — the transition back is what
proves the subscription is live); No `useFadeTransition` export, which is shell-only and
stays internal — all candidates for a follow-up.

### F92 — Unconditional Loading Beat for Game-Load Presentation `§4.36, §4.10, §4.18–§4.19, §4.33`

**Status: planned; the feature issue is
[#1145](https://github.com/jindrichruzicka/Chimera/issues/1145).** Measured on 1.0.0-rc.7
with a scaffolded game declaring `'spinner'` and a 5000 ms minimum over one critical 464 KB
model, the pair could not deliver the thing it exists for. On a normal run the beat did not
happen: the model settled in ~150 ms, the route cover mounted at ~180 ms and was dropped
unseen at ~340 ms, and the floor never armed. Delaying the fetch by three seconds made the
cover appear and serve its full minimum. So the mechanism was working as written, and what
it was written to do is the wrong thing: a loading screen carries the tips a player reads
while waiting, and on the hardware that reads them fastest it did not appear.

**The floor's arming condition and the cover's opacity are one defect wearing two faces.**
The cover layer paints no background — neither `RouteEntryLoadingCover`'s layer nor the
engine presets declare one — so what the engine renders is a glyph over whatever stands
behind it. The black a player sees during a load is the app-level scrim, a sibling above the
whole route subtree. F90 then made visibility the floor's arming condition, correctly, since
flooring a cover nobody can see only extends a black screen; and the route-cover reveal grace
made a faded entry reach that condition by easing the scrim off mid-wait. But the scrim is
what hides everything — so the act that made the cover visible also revealed the canvas, the
HUD and, at the settle, the model, which is why the reported sequence is spinner, then
spinner beside the model, then no spinner. A cover that paints nothing cannot be shown
without showing the scene it was meant to stand in for. F92 therefore replaces both
mechanisms rather than tuning either: the cover becomes an opaque surface, and the beat
becomes unconditional on a RESOLVED cover instead of conditional on a visible one.

**The curtain never opens for the beat.** The presentation is four legs — black, the cover,
black, the reveal — and the app scrim holds opacity 1 across all of them. The loading cover
is an opaque full-viewport layer that fades in ABOVE that held curtain, holds, and fades back
out to it; the curtain's single closing fade-in is the reveal, and it reveals the scene and
the HUD together. The property `screen-fade-overlay` at opacity 0 means REVEALED survives
untouched — the e2e waits already written against it keep their meaning instead of going
green over a screen the beat is still covering. A cover that fades around a curtain would
have inverted that predicate silently, and tactics declares no route cover, so the regression
would have shipped invisible until the first adopter game.

**The HUD mounts at the reveal.** The deferral covers the HUD row and the in-game menu host —
what a player would otherwise watch assemble itself beside a spinner.
`PerfHud`, the debug toggle, input-action registration, the time-scale bridge and
the audio delegate keep their current mount timing: deferring the delegate re-opens the
silent-music-bed defect its own comment records, and the shell itself mounts on the commit it
mounts on today, because it is the unique disposer of a page-injected `AssetManager`
(Invariant #21). The canvas subtree mounts under the curtain on purpose, so shader compile
and the first GPU upload are paid while the screen is black rather than at the reveal. The
HUD row mounts one commit BEFORE the closing fade-in, so the grid re-layout it causes settles
while the curtain is still opaque.

**Nothing host-visible moves, and the proof becomes a pin rather than a non-edit.** F90
shipped without editing `useFadeTransition` at all; F92 edits it, because the
scene-transition surface adopts the beat too and the reveal fade-in is what moves. What does
not move is everything upstream of it: the fade-out, the preload run, the four-outcome ack,
the retry cadence and the progress protocol. A minimum inserted before `engine:scene_ready`
would serialise one client's cosmetic preference onto every seat in the match, so the
dispatch is asserted identical with a zero floor, a large floor, and a reveal that never
fires. The beat reads `gate.ready` rather than the settle outcome, so the four paths,
failures included, reveal alike.

**The knob keeps its name and loses its condition.** `loadingScreenMinVisibleMs` still sets
how long the cover stays up, but it no longer decides WHETHER a beat happens — declaring a
cover form is what does that. A cover declared with no minimum resolves to an engine default
floor rather than to nothing, since a beat bounded only by its own fades would flash under
reduced motion, where the fades collapse to cuts; a declared `0` remains the explicit
opt-down to gate-settle-only. The collapse asymmetry Invariant #133 states is unchanged:
every deliberate delay in the beat arrives through `screenFadeMs()` or
`resolveLoadingCoverHoldMs`, both of which return `0` under `NEXT_PUBLIC_CHIMERA_E2E`, and
the sequencer takes both as inputs rather than reading the environment itself — while the
release budgets keep their no-collapse rule. This takes up the "delay-before-show" pair F90
deferred as a second feature with its own blank-screen trade-off, and answers that trade-off
with the black legs: what stands in front of the wait meanwhile is the curtain already there.

**And it reverses F90's unit-only posture.** F90 recorded that no e2e spec observes the hold,
because the hold collapses under the flag. What survives that collapse is not duration but
structure — which layers are mounted while the gate runs, and in what order the phases commit
— so the beat is observable in the recorded reveal timeline with every delay at zero. The
specs whose predicates the beat abolishes are rewritten; `scene-transition` and `hud-layout`
stay as the surviving no-regression controls, the latter because tactics' playfield stays
coverless on purpose and so keeps "a game gets no cover it did not ask for" falsifiable.

| Task                                                                                     | Issue                                                           |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Author the F92 roadmap section and traceability rows                                     | [#1146](https://github.com/jindrichruzicka/Chimera/issues/1146) |
| Implement the useLoadingBeat sequencer, FadeControl claim sessions and the default floor | [#1147](https://github.com/jindrichruzicka/Chimera/issues/1147) |
| Add the GameShell hudMounted seam with the game-hud-slot and reveal-phase markers        | [#1148](https://github.com/jindrichruzicka/Chimera/issues/1148) |
| Adopt the loading beat on the /game entry and decommission the reveal grace              | [#1149](https://github.com/jindrichruzicka/Chimera/issues/1149) |
| Adopt the loading beat on the replay player and delete the cover exit ramp               | [#1150](https://github.com/jindrichruzicka/Chimera/issues/1150) |
| Adopt the loading beat on scene transitions and delete the held-layer machinery          | [#1151](https://github.com/jindrichruzicka/Chimera/issues/1151) |
| Sweep docs, scaffold and registry warns to the beat semantics and finalize the changeset | [#1152](https://github.com/jindrichruzicka/Chimera/issues/1152) |
| F92 feature review and merge gate                                                        | [#1153](https://github.com/jindrichruzicka/Chimera/issues/1153) |

Feature issue: [#1145](https://github.com/jindrichruzicka/Chimera/issues/1145).

**Out of scope (deferred):** No change to `engine:scene_ready` dispatch timing, to the host
barrier, or to any of the four release budgets — the beat sits strictly downstream of the ack
and adds no release path; No per-key minimum map, unchanged from F90 — one registry-wide
knob, with the per-key `'none'` opt-out already able to subtract a surface from the beat; No
beat on the engine-owned loading surfaces outside the cover cascade, so the replay player's
pre-ready status block stays outside the registry knob's reach exactly as F90 left it; No
change to tactics' cover topology — the playfield stays coverless so the `hud-layout` negative
control keeps proving a game gets no cover it did not ask for, and the `asset-demo` key stays
the game's declared cover; No new `GameScreenRegistry` field, since the arming change is what
the existing slots now mean; No deferral of the canvas mount behind the curtain, which would
trade the warm-up this feature buys for a stutter at the
reveal; No Escape-openable menu during the beat — the in-game menu host is deferred with the
HUD, and the gate's own budget bounds how long it can be unavailable; No dilation interplay,
unchanged from F90 — every leg is wall-clock milliseconds, like the fades and the budgets
beside them — all candidates for a follow-up.

---

## Cross-References

- [Versioning Policy](../versioning-policy.md) — the canonical `1.X.Y` lock-step rules and enforcement.
- [Product Roadmap (Index Hub)](../ROADMAP.md) — milestone/version overview.
- [M9 — Package Extraction & Game Scaffolding (v0.9.0)](m9-package-extraction-v0.9.0.md) — the package hierarchy this scheme locks together.
