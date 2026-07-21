---
'@chimera-engine/electron': patch
---

`SettingsManager.registerSchema()` now enforces the engine settings namespace guard (§4.13, Invariant #35).

The collision check was structurally dead: it derived `gameSpecificKeys` by removing the reserved
engine namespace keys, then filtered that already-cleaned list _for_ those same keys, so the result
was always empty and `SettingsNamespaceCollisionError` could only ever fire for a duplicate `gameId`.
A game whose defaults shadowed `audio`, `display`, `gameplay` or `controls` registered silently.

Matching on the key name alone cannot express the invariant. `GameSettingsSchema<T extends
EngineSettings>` means every game's `defaults` legitimately _contains_ all four reserved keys —
games spread `...ENGINE_DEFAULTS` — so a name match would reject every real game, including the
shipped tactics schema. The guard instead requires each reserved namespace to arrive **intact**:
present, a plain object, owning every engine sub-key for that namespace. Hijacking the name for a
game-specific value, supplying a partial namespace, and omitting one are all rejected by the same
rule, at registration, instead of degrading silently at merge time. Omission previously left a
registered game strictly worse off than an unregistered one: `deepMergeStripped` seeds from
`{...base}` and walks `Object.keys(base)`, so a missing namespace both vanished from the resolved
settings and silently discarded the user's stored overrides for it, whereas an unregistered game
still falls back to `ENGINE_DEFAULTS`. Sub-key **ownership** is what is checked (`Object.hasOwn`),
matching the merge's own-key semantics — a sub-key inherited through the prototype chain satisfies
`in` but still merges to `{}`.

The check is structural — sub-key ownership only, never sub-value types or ranges. Validating
`defaults` against `engineSettingsZodShape` would have been wrong here: its refinements
(`.min(0).max(1)`, `.int()`) are stricter than the plain `number` the `EngineSettings` type promises,
so a type-legal default such as `audio.masterVolume = 1.5` would be rejected as a namespace
collision. Game `defaults` are trusted first-party input and are range-validated on no runtime path;
`getSettings()`/`updateSettings()` validate stored user overrides and incoming patches, never
`schema.defaults`. Graceful degradation for an unregistered `gameId` (Invariant #34) is unchanged.

The engine composition root now wraps the registration loop, logs the reason, and calls
`app.exit(1)` before rethrowing. Consumer roots launch the engine as `void main(...)` and this runs
before `app.whenReady()`, so a bare throw would otherwise surface only as an unhandled rejection and
leave a live, windowless process — the guard would reject the schema without refusing to start.

Every in-repo and scaffolded schema registers unaffected: `apps/tactics` and the
`create-chimera-game` blank template both spread `ENGINE_DEFAULTS`, and the engine's own IPC handler
fixtures pass `ENGINE_DEFAULTS` directly. A game that had been relying on the guard's silence to
ship a hijacked, partial, or missing reserved namespace will now fail at registration with a message
naming the offending key(s), and the app will refuse to start.
