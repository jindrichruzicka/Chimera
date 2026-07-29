---
'@chimera-engine/electron': patch
---

The icon generator now loads its codec on demand instead of importing it at module
top, so a run without it reports what to do instead of failing at module load.

`sharp` is an optional peer, which only means anything if nothing touches it until a
caller actually asks for icons: a static import throws while the module is being loaded,
before any message can be printed. The load moved inside the one function that needs it,
and the failures it can hit are now told apart:

- **Not resolvable** — recognised by the resolver's own code, in either its ESM or CJS
  spelling, and answered with one line naming the package and `pnpm add -D sharp`.
- **The import failed for some other reason** — `sharp` ships prebuilt native bindings,
  and a platform or Node-ABI mismatch fails the import of a package that is present.
  That case reports the failure instead of advising an install that would change
  nothing, and deliberately claims nothing about whether the package is on disk: a
  rejection carrying no code could be either, and a guess printed as a fact is what the
  install advice was doing wrong in the first place.
- **Imported but unusable** — a codec that loads without the API this tool drives names
  itself and what it lacked.

Both import failures keep the original error as the thrown error's `cause`, so a failure
that is not a missing install stays diagnosable.

Both interop shapes `sharp` can arrive in are accepted, because one of them yields
`undefined` rather than failing: it is CJS `module.exports = fn`, so ESM presents the
function under `default` while a CJS transform hands back the function itself.

The codec load and the master read both happen before the output directory is created,
so neither an absent codec nor an unreadable `--source` leaves an empty directory behind.
A master that reads but does not decode still does — that failure lives inside the write
loop.
