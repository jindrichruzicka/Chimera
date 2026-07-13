---
title: 'M10 — First Public Release (v1.0.0)'
description: 'The first public 1.0.0 release of Chimera. Introduces the locked 1.X.Y versioning scheme: every @chimera-engine/* package and create-chimera-game share one version, kept in sync per milestone and re-published together on every patch. Carries F71 — an opt-in, renderer-only internationalization (i18n) system.'
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
    ]
---

# M10 — First Public Release (v1.0.0)

> **Goal**: Cut Chimera's first public **`1.0.0`** release and adopt the **locked `1.X.Y` versioning scheme** across the whole published surface. From this milestone on, every `@chimera-engine/*` package and the `create-chimera-game` initializer ship at **one shared version**.
>
> **Status**: Open. Carries **F71 — Internationalization / i18n** (see Features below); further features may be added as work is planned.

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

---

## Cross-References

- [Versioning Policy](../versioning-policy.md) — the canonical `1.X.Y` lock-step rules and enforcement.
- [Product Roadmap (Index Hub)](../ROADMAP.md) — milestone/version overview.
- [M9 — Package Extraction & Game Scaffolding (v0.9.0)](m9-package-extraction-v0.9.0.md) — the package hierarchy this scheme locks together.
