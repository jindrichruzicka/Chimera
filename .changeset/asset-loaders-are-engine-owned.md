---
'@chimera-engine/electron': patch
'create-chimera-game': patch
---

Record that asset loaders are engine-owned, and make `validate:assets` say so.

The asset docs promised that games register additional loaders and pass a composed registry into
`AssetManager`. Nothing in the tree did that: every construction site passes no registry, and the
public assets barrel publishes neither the loader types nor the manager factory, so there was
nothing to build a registry with and nowhere to hand one in. The decision recorded in §4.10 is that
the kinds the engine registers a loader for are the whole set, with the cost stated — a game that
wants a format the engine does not load waits for the engine.

`chimera-validate-assets` no longer widens its known-kind set by scanning game source for loader
declarations. That scan accepted a kind the runtime would then refuse. The set the gate checks
against is now the kinds the engine registers a loader for. No file in this repo was reached by the
scan, so nothing that passed for a real reason starts failing.

Declaration merging on `AssetKindRegistry` still types a distinct ref. What it never did was make
the kind loadable, and the gate above is where that is now said out loud.
