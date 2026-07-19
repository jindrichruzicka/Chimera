# @chimera-engine/tactics

## 0.9.1-rc.0

### Patch Changes

- Modernized the multiplayer lobby UI: seats now toggle ready via an icon control (backed by
  a new `check` glyph in the engine icon set), AI seats are merged into the roster, and the
  lobby banner and summary gain a frosted backdrop. Tactics adopts a two-column lobby layout
  on top of the shared renderer changes.
- 4ce48c4: The shared `Modal` overlay now supports a token-driven backdrop blur. A new `--ch-overlay-backdrop-blur` design token feeds `backdrop-filter: blur(...)` on the overlay; it defaults to `0` (no blur, unchanged plain scrim). Tactics overrides it to `8px`, frosting the shell that shows through its semi-transparent modal scrim.
- Settings sections with nothing to change now show an empty-state message
  (`engine.settings.noSettings` → "No settings available."), mirroring the existing
  `noControls` behaviour. `SettingsTabPanel` is now data-driven via a `settingsItemWillRender`
  predicate — "empty" means every item renders null (e.g. the language selector self-hides
  below two languages), not merely a zero-length item list. `useDeclaredLanguages` is now
  ready-aware and exported so the section can gate without flashing.

## 0.9.0

### Minor Changes

- Initial extraction into a standalone consumer app (M9, F57–F66). The tactics reference
  game that exercises the packaged `@chimera-engine/*` builds end to end. Private — never
  published; versioned alongside the engine packages it consumes.
