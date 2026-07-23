---
'@chimera-engine/simulation': minor
'@chimera-engine/electron': patch
---

Restored the mandated structured-logger wiring across the main-process composition root
and removed a dead `UndoPolicy` field.

- `buildHostSessionPipeline` now forwards its injected `Logger` into both
  `InMemoryActionHistory` and `ActionPipeline`, so the `action-history:overflow` warn
  (Invariant #45) and the `engine:tick` timer-rejection warn (Invariant #90, §4.20) are
  reachable in production instead of being swallowed by a noop logger.
- `SettingsManager.getSettings()` now emits the mandated warn when called for an
  unregistered `gameId` before degrading to engine defaults (Invariant #34).
- `ProfileManager` is now constructed with an injected `Logger` child — the last
  main-process manager that was missing one (Invariant #67).
- Removed `UndoPolicy.requireConsentFrom`, a field with no enforcement anywhere in the
  engine. Multi-player undo consent is not a supported policy dimension (§4.5, §7).
