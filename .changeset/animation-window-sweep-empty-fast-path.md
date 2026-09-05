---
'@chimera-engine/simulation': patch
---

Skip the per-beat animation-window sweep, and the entity key set it builds, when the registry is
empty.

`engine:tick` built `new Set(Object.keys(nextState.entities))` and spread the snapshot on every beat
whenever `animationWindows` was merely present. The field is sticky — the close paths leave `{}`
behind rather than deleting the key — so a game that had ever opened one window paid an O(entities)
walk on every later beat, and `AnimationWindowManager.advance` discovered the registry was empty
only after the caller had paid it. `apps/action` never touches the field; this was armed for the
next realtime game.

`AnimationWindowManager.isEmpty(registry)` probes the registry without allocating (a guarded
`for...in`, so a polluted `Object.prototype` cannot make an empty registry look occupied), the beat
pass checks it before building the key set, and `advance` uses the same probe for its own fast
path. A beat with an empty registry now leaves `animationWindows` as the same reference by never
writing it, which keeps the pipeline's clock-only broadcast engaged, as before.
