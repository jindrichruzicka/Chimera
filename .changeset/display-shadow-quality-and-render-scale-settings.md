---
'@chimera-engine/simulation': patch
'@chimera-engine/renderer': patch
'@chimera-engine/tactics': patch
---

Add `display.shadowQuality` and `display.renderScale` engine settings.

Graphics quality becomes a **player** setting, not only an author setting — the same class of knob
as the existing `display.targetFps`. `shadowQuality` is a tier name (`off` | `low` | `medium` |
`high`); `renderScale` is a fraction of the display's own pixel ratio (`0.5` | `0.75` | `1`), so `1`
is native. Both defaults reproduce what the canvas rendered before either existed: shadow mapping
off, native scale.

Both values are engine-owned names and scalars. Per Invariant #1 nothing stored in `simulation/` may
name a `three` symbol, so the tier becomes a shadow-map type on the renderer side alone.

The three halves of a `display` field have to agree and only one of them is self-checking:
`engineSettingsZodShape` carries no type annotation, so a field added to the `EngineSettings`
interface and to `ENGINE_DEFAULTS` but forgotten in the Zod shape compiles, and
`SettingsMerger.validatePatch` then strips it — discarding the player's stored override on every
load. The red-first test for this task drives a stored override through `validatePatch` against the
REAL shape and failed with `{ display: {} }` before the Zod half existed.

`apps/tactics` supplies its own settings-page definition, so it opts out of
`ENGINE_DEFAULT_SETTINGS_DEFINITION` and would have silently lost both rows. Its definition carries
them and its own field-list pin names them, which is the test that catches this class. `apps/action`
and the blank template ship no settings-page definition and pick the rows up from the engine default
tab set; all three spread `ENGINE_DEFAULTS` and `engineSettingsZodShape` into their schemas, so they
inherit persistence and validation.

`display.renderScale` is the first display field whose stored value is fractional. Its descriptor
parses with a numeric parser rather than `display.targetFps`'s `parseIntegerValue`, which would
truncate `0.75` to `0` — a value the schema rejects, so the override would be refused rather than
stored.

Tokens are added to the engine key catalogue, the English bundle and the Czech bundle, and the
documented surfaces that enumerate the engine field set name both fields.
