---
title: 'Internationalization (i18n)'
description: 'The renderer-only i18n runtime: I18nProvider, useTranslate(), the ICU-subset message formatter, the game override → engine English → raw fallback chain, the manifest languages opt-in, the registry translations seam, <LanguageSelector>, the gameplay.language settings field, and the debug token-mode toggle.'
tags: [i18n, localization, translation, icu, renderer, invariants]
---

# Internationalization (i18n)

> §4.39 of the Chimera architecture.
> Related: [Settings System](settings-system.md) · [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) · [Chat System](chat-system.md) · [Renderer State Stores](renderer-state-stores.md) · [Runtime Debug Layer](runtime-debug-layer.md)

---

## Overview

Chimera ships an **in-house, renderer-only** i18n runtime (F71) — deliberately chosen over
`react-i18next` (or an equivalent library) to keep zero external runtime dependencies, a tiny ICU
subset scoped to what the UI actually uses, and a fallback chain that lets a game relabel engine
strings without forking the engine bundle.

Three properties define the design:

- **Simulation is language-agnostic.** Game logic emits stable identifiers, never user-facing
  strings. The runtime lives entirely under `renderer/i18n/`; `simulation/`, `ai/`, and
  `networking/` never import it (Invariant #110). The only i18n surface in `simulation/` is the
  declarative language _contract_ on the manifest — a declaration, not a runtime.
- **Opting in is strictly additive.** A game that declares no `languages` (or fewer than two) is
  fully inert: no selector renders, no settings Language row appears, and the provider resolves
  pure engine English at zero measurable cost (Invariant #111).
- **The engine ships English only.** There is a single engine bundle (`engine-bundle.en.ts`).
  Other locales come from a game's contributed bundles, which supply `game.<id>.*` tokens and may
  **re-key** engine tokens (e.g. `engine.chat.title`) per locale. Un-overridden engine strings stay
  English via the fallback chain (Invariant #112).

## Design Patterns

| Pattern                           | Where used                                                            | Why                                                                                    |
| --------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Layered override / merge**      | `resolveTranslation()` (`translation-bundle.ts`)                      | Game override → engine English → raw key; override wins, never deletes                 |
| **Provider + context hook**       | `<I18nProvider>` + `useTranslate()`                                   | One provider high in the tree; consumers read a stable `t` by context                  |
| **Registry indirection**          | `GameTranslations` via `LoadedRendererGameShell.translations`         | Game bundles reach the provider by prop, never a `games/*` import (Invariants #80/#94) |
| **Pure presentational + wrapper** | `<LanguageSelector>` (ui barrel) + `SettingsLanguageSelector` (shell) | Keeps the `components/ui` barrel side-effect-free (Invariant #96)                      |

---

## The runtime — `renderer/i18n/`

### `<I18nProvider>` and `useTranslate()`

`<I18nProvider>` (`I18nProvider.tsx`) mounts once high in the renderer tree (under `AppShell`, via
`TokenModeI18nProvider`) and publishes a stable `t` function through React context. Its props are
**inert by default** so a single-language game mounts it with no props and still gets engine
English:

```typescript
interface I18nProviderProps {
    readonly locale?: string; // persisted gameplay.language; default 'en-US'
    readonly languages?: readonly GameLanguage[]; // declared list; [] ⇒ single-language
    readonly gameOverride?: TranslationBundle; // game's bundle for the active locale
    readonly showTokens?: boolean; // debug token-mode; default false
    readonly children: ReactNode;
}
```

It (a) resolves the **effective locale** — the persisted `locale` if it matches a declared
`language.code`, else the first declared language, else `'en-US'` (exact-code match, no `Intl`
normalization); (b) merges the engine base bundle with the game override for that locale; and
(c) threads the `showTokens` flag into resolution.

`useTranslate()` (`useTranslate.ts`) returns `t`. It (and `useI18n()`) **throws** outside an
`<I18nProvider>` (Invariant #83) — tests that render a translating component must wrap it in the
provider (jsdom included).

### The ICU-subset formatter — `format-message.ts`

`formatMessage(template, params?, locale)` is a pure formatter supporting the subset the UI uses:
named `{param}` interpolation, `{{`/`}}` escapes, `{n, plural, …}` (with `#` bound to the innermost
count and `=N` exact categories taking precedence over `Intl.PluralRules` keywords), and
`{g, select, …}`. It never throws on a well-formed template; a malformed template is caught,
`console.warn`ed, and returned raw; an unknown param renders empty with a dev warning.

### The fallback chain — `translation-bundle.ts`

`resolveTranslation(bundles, key, showTokens)` is the heart of Invariant #112:

```
showTokens === true   → raw key           (source: 'token-mode')  — checked first
game override has key → override template  (source: 'game')
engine default has key → engine template   (source: 'engine')
otherwise             → raw key            (source: 'missing')
```

A game override **wins** for a token but **never deletes** the engine default — every
un-overridden engine token still resolves to its English default; a token missing from every layer
resolves to its **raw key**, surfacing the gap rather than rendering blank. `t` runs `formatMessage`
on the resolved template unless the source is `missing`/`token-mode` (raw passthrough).

### The engine bundle and token catalogue

`engine-bundle.en.ts` (`engineBundleEn`) is the engine's base English bundle — the single source of
truth for every engine-shipped string, kept in exact key-parity with the token catalogue
`engine-keys.ts` (the grouped `*_KEYS` maps under the `engine.<area>.<name>` namespace) by a parity
test. This is the only engine locale; games localise the engine by re-keying these exact tokens.

---

## The manifest `languages` opt-in

The declarative contract lives in `simulation/foundation/game-manifest-contract.ts` (pure data +
resolvers, no runtime — Invariant #110):

```typescript
interface GameLanguage {
    readonly code: string; // BCP-47, e.g. 'en-US'
    readonly label: string; // endonym, e.g. 'Čeština'
}

interface GameManifest {
    // …
    readonly languages?: readonly GameLanguage[]; // absent or <2 ⇒ single-language
}
```

`resolveGameLanguages(manifest)` validates each entry (drops non-string `code`/`label`, never
throws), dedupes by `code` (first wins), and returns the list **only when ≥2 entries survive**
(else `undefined`). `firstLanguageCode(manifest)` is the game default —
`resolveGameLanguages(manifest)?.[0]?.code`.

---

## The registry `translations` seam

A game contributes its bundles as registration payload through the renderer shell seam
(`renderer/game/rendererGameRegistry.ts`), never a direct `games/*`/`apps/*` import (Invariants
#80/#94), exactly like `cursor`:

```typescript
interface GameTranslations {
    readonly languages: readonly GameLanguage[]; // mirrors resolved manifest.languages
    readonly bundles: Readonly<Record<string, TranslationBundle>>; // locale code → token map
}

// LoadedRendererGameShell.translations?: GameTranslations
```

`warnOnUndeclaredTranslationLocales()` is a dev-time typo guard: it `console.warn`s (never throws)
for any bundle locale that matches no declared `GameLanguage.code`. `useActiveGameTranslations()`
resolves the active game from the URL `?gameId=` (falling back to `settingsStore.activeGameId`),
lazy-loads the shell to get `translations`, reads the persisted locale reactively, and picks
`gameOverride = bundles[locale]` — so a locale change **live-switches without a reload**.

The Tactics reference wiring (`apps/tactics/renderer/loaders.ts`) contributes EN + CS bundles. The
Czech bundle re-keys the **full engine token catalogue** — every `engine.*` token gets a Czech
template, so the whole engine UI (settings chrome, saves, lobby, replays, toasts, HUD scaffold)
renders Czech under `cs-CZ`; the parity test
(`apps/tactics/shell/translations/translations.test.tsx`) locks that coverage against the real
catalogue, so an engine token added later fails the reference game's tests until translated. The EN
bundle re-keys only `engine.chat.title` ("Match chat") — un-overridden engine tokens fall through to
the engine's own English, so engine copy edits reach the EN locale without touching the game bundle.

---

## `<LanguageSelector>`, the settings field, and persistence

`<LanguageSelector>` (`renderer/components/ui/LanguageSelector.tsx`, the public **ui barrel**) is a
pure presentational control: it renders the supplied `languages` (endonym labels), shows `value`,
and calls `onLanguageChange` with the chosen BCP-47 code. It **self-hides** (returns `null`) for
fewer than two languages, so a game can drop it in unconditionally. Variants: `'select'` (default,
native `<select>`) and `'inline'` (segmented `role="radiogroup"` toggles). It reads only the i18n
React context (its label via `useTranslate()`), never a store — keeping the barrel side-effect-free
(Invariant #96).

The store coupling lives in the shell wrapper `SettingsLanguageSelector.tsx`: it resolves the game
context, loads declared languages through the `translations.languages` seam, reads the persisted
`gameplay.language`, and writes the chosen locale through `settingsStore.updateSettings(gameId, {
gameplay: { language: code } })` → `chimera:settings:update` IPC → the main-process settings
repository. The settings page (`renderer/app/settings/page.tsx`) special-cases the
`gameplay.language` field to render `<SettingsLanguageSelector>` in place of a generic control, so
the row disappears entirely for single-language games (§4.13, Invariant #111). The control carries
the stable `settings-language` testid because its accessible name is itself translated.

**Cold-boot application:** `SettingsBootstrap` (`renderer/app/SettingsBootstrap.tsx`) hydrates the
URL `?gameId=` shell game's persisted settings into `settingsStore` on every navigation (pathname-
keyed, mirroring `useActiveGameTranslations`' URL resolution), so the persisted locale applies the
moment the main menu boots — not only after a lobby starts or the settings page is opened. The
URL-only context is hydration **only**: the lobby effect remains the sole owner of `activeGameId`
and input-action registration.

---

## Debug token-mode

The Runtime Debug Layer (§4.12) exposes a **"Show translation tokens"** Inspector toggle that makes
every `t()` call render its raw token in the game window — a translator-facing coverage audit. The
round-trip is a cross-layer push:

1. Inspector toggle → `bridge.api.setI18nTokenMode(enabled)` (`chimera:debug`, `SET_I18N_TOKEN_MODE`
   — boolean only, Invariant #28; relayed bridge-level as a display concern, inheriting the
   sender-validation of Invariant #29 and the debug gate of Invariant #27).
2. Main pushes `chimera:system:i18n-token-mode` to the game window.
3. `DebugI18nBootstrap` updates `debugI18nStore.showTranslationTokens`.
4. `TokenModeI18nProvider` forwards the flag to `<I18nProvider showTokens>` →
   `resolveTranslation(..., showTokens=true)` returns each raw key.

In production the debug bridge never starts, so the whole graph is idle (Invariant #27).

---

## Module Tree

```
renderer/
├── i18n/                            # Renderer-only i18n runtime; internals reached only via the public @chimera-engine/renderer/i18n barrel (§4.39)
│   ├── index.ts                     # Public barrel @chimera-engine/renderer/i18n (re-export only)
│   ├── translation-bundle.ts        # TranslationKey/Bundle, resolveTranslation() fallback chain (§4.39)
│   ├── format-message.ts            # Pure ICU-subset formatter (param, plural, select) (§4.39)
│   ├── engine-keys.ts               # engine.<area>.<name> token catalogue (grouped *_KEYS maps)
│   ├── engine-bundle.en.ts          # engineBundleEn — the sole engine (English) bundle
│   ├── i18n-context.ts              # I18nContext, TranslateFn, I18nContextValue
│   ├── I18nProvider.tsx             # Pure React binding: locale resolve + bundle merge + t (§4.39)
│   ├── TokenModeI18nProvider.tsx    # Store-connected wrapper (debugI18nStore + active-game bundle)
│   ├── useTranslate.ts              # useI18n()/useTranslate() — throw outside I18nProvider (#83)
│   └── useActiveGameTranslations.ts # Resolves active game's locale/languages/override bundle
└── components/ui/
    └── LanguageSelector.tsx         # PUBLIC ui-barrel selector; self-hides <2 languages (§4.39)
renderer/shell/
    └── SettingsLanguageSelector.tsx # Store-connected wrapper for the settings Language field
simulation/foundation/
    └── game-manifest-contract.ts    # GameLanguage, GameManifest.languages, resolveGameLanguages (declaration only)
```

---

## Invariants

| #    | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #110 | The simulation is language-agnostic: game logic emits identifiers, never user-facing strings, and the i18n **runtime** (`renderer/i18n/`) is never imported by `simulation/`, `ai/`, or `networking/`. The only i18n surface in `simulation/` is the declarative language contract (`GameLanguage`, `GameManifest.languages`, `resolveGameLanguages`/`firstLanguageCode`) — a declaration, not a runtime (§4.39, §3 mechanical check 18). |
| #111 | Opting into i18n is strictly additive: a game with no `languages` (or <2) is behaviour-neutral — `<LanguageSelector>`/`SettingsLanguageSelector` render `null` (no selector, no settings Language row), the locale never switches, and `<I18nProvider>` resolves pure engine English at zero cost (§4.39, §4.13).                                                                                                                         |
| #112 | Token resolution is `game override → engine English default → raw key`. An override wins but never deletes the engine default (un-overridden engine tokens stay English); a token missing from every layer resolves to its raw key. Debug token-mode short-circuits every key to its raw token without mutating any bundle (§4.39, §4.12).                                                                                                |

---

## Cross-References

- [Settings System](settings-system.md) — §4.13 `gameplay.language`, the settings merge, and IPC lifecycle
- [Renderer Shell Pages UI Contract](renderer-shell-pages-ui-contract.md) — §4.37 settings page definition + `SettingsLanguageSelector` mounting
- [Chat System](chat-system.md) — §4.29 `ChatPanel`, whose `engine.chat.title` label a game re-keys per locale
- [Runtime Debug Layer](runtime-debug-layer.md) — §4.12 the debug bridge behind the token-mode toggle
- [Architecture Invariants](../executive-architecture/architecture-invariants.md) — invariants #110–#112
- [M10 First Public Release](../roadmap-sections/m10-first-public-release-v1.0.0.md) — F71 feature and task breakdown
