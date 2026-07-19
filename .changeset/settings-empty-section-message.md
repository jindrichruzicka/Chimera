---
'@chimera-engine/renderer': minor
'@chimera-engine/tactics': patch
---

Settings sections with nothing to change now show an empty-state message
(`engine.settings.noSettings` → "No settings available."), mirroring the existing
`noControls` behaviour. `SettingsTabPanel` is now data-driven via a `settingsItemWillRender`
predicate — "empty" means every item renders null (e.g. the language selector self-hides
below two languages), not merely a zero-length item list. `useDeclaredLanguages` is now
ready-aware and exported so the section can gate without flashing.
