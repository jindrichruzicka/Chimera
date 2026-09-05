---
'@chimera-engine/simulation': patch
---

Walk the projector's entity and player records by `Object.keys` instead of `Object.entries`.

`DefaultStateProjector` ran `Object.entries(fullState.entities)` and `Object.entries(fullState.players)`
once per recipient per beat, materialising one `[key, value]` pair array per entry each time — the
O(entities × viewers) allocation on the broadcast path. `Object.keys` with an indexed lookup
enumerates the same own keys in the same order (integer-like keys ascending, then strings in
insertion order), so the projected records are deep-equal and serialise to the same bytes, which
keeps every downstream checksum unchanged.

`for...in` was measured as well and rejected: over the plain-object source record it also
enumerates any enumerable key added to `Object.prototype`, which `Object.entries` and
`Object.keys` never do, and it was no faster. A test pollutes the prototype for the duration of
one projection and asserts the polluted key is absent from both records. Measured on the
development machine (Node v25.9.0, 1000 entities, median of 5 runs of 2000 calls): a masking
projection pass took 0.126 ms with `Object.entries`, 0.061 ms with `for...in`, 0.054 ms with
`Object.keys`; the bare loop without masking took 0.092 ms, 0.026 ms and 0.021 ms respectively.
