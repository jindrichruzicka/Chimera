---
'@chimera-engine/electron': minor
'create-chimera-game': minor
'@chimera-engine/renderer': patch
---

Publish asset-fact readers for game tests at a new
`@chimera-engine/electron/test-support` subpath, and ship a wired asset manifest plus a
full-bleed scene host in the blank scaffold template.

**`@chimera-engine/electron/test-support`.** `chimera-validate-assets` checks that a
declared ref resolves to a file that EXISTS (Invariant #52 is membership-only) and that a
cue sheet is internally coherent (Invariant #125). Neither opens the file. So the class of
defect where a manifest and its bytes disagree — an authored `durationSeconds` that is not
the clip's real length, a re-exported model that dropped the bone a screen poses by name, a
container truncated by a bad copy — is invisible to the build and surfaces as a mis-timed
cue or an empty scene at runtime. Binary assets make this worse than ordinary drift: a
`.wav` or `.glb` cannot be diffed or grepped, so every claim about one is prose until
something parses it.

```ts
import { assetPathForRef, readWavFacts } from '@chimera-engine/electron/test-support';

const wav = readWavFacts(assetPathForRef(here, myAudioRefs.theme));
expect(wav.durationSeconds).toBe(myMusicCues.durationSeconds);
```

`assetPathForRef` maps a declared ref onto its path under the game's own `assets/`
(Invariant #97), resolving the grammar through the engine's own `parseAssetRef` so it
cannot drift from the runtime resolver — including the traversal rules. `readWavFacts`
walks the RIFF chunk list rather than assuming the canonical 44-byte layout (a re-encode
may splice `LIST`/`fact` ahead of `data`) and refuses to hand back samples for an encoding
it cannot read, instead of quietly pairing bytes into a plausible number.
`readGlbDocument` parses the glTF JSON chunk at its declared length, never to
end-of-file. A malformed container raises `MalformedAssetFileError` naming the path and
what disagreed.

The module imports no test framework: `expect` would make it unpublishable, since
`verify:publish`'s depcheck fails a published `.js` importing an undeclared runtime
dependency and `vitest` is a root devDependency only. Tactics adopts it as the reference
consumer, and now asserts what `showcase-rig.glb` actually declares — its unlit extension,
the `top` bone its showcase poses by name, its embedded buffer and its authored quad
extents. The model-instances e2e already reddened on three of those four, by launching
Electron and comparing a pose attribute or a pixel; these read the fact off the bytes and
name it.

**The blank template now ships `asset-manifest.ts`.** Empty (`entries: []`), with a
commented worked example, and — the part that matters — already forwarded through
`renderer/loaders.ts`. `LoadedRendererGame.assetManifest` is optional, so a game that never
returns one compiles, typechecks, lints and passes `validate:assets` clean, then rejects
every asset load at runtime with `UnknownAssetManifestEntryError`. Wiring it from the start
means an author's first asset is one array entry. It ships with a manifest test written as
loops over `entries`, so it costs nothing while empty and starts checking refs, scoping and
container validity at the first declared asset — rather than pinning the manifest empty and
reddening the moment someone follows its instructions.

`verify:scaffold` grew the matching non-vacuity arm: `Checked 0 asset refs` is
byte-identical to what a tree with no manifest reports, so the gate now plants one valid
entry into the scaffolded manifest and requires the count to move — proving discovery at
the exact basename, that `entries` is a literal the tool can walk, and that the ref
resolves into the app's own asset directory.

**The scaffold ships `ai/`, `data/` and `components/`, held open by a `.gitkeep`.** These are three
of the canonical game directories `apps/tactics` grew into that previously carried no day-one
file, so a scaffolded game simply did not have them — the copier emits files, and an empty
directory is not a file. Shipping them costs nothing at build time (a directory holding only
`.gitkeep` is invisible to ESLint and to `tsc`, which select by extension) and it puts an
author's first agent policy, content payload or reusable component where the guards already
expect it: an `ai/` module is inside the `chimera/no-fromfloat-in-simulation` zone from its
first line — in both scaffold modes — rather than after someone notices the directory should
have existed. (A `--workspace` game inherits more than that from the monorepo's root config;
the standalone preset is the narrower of the two, and `curated-rules.ts` records which
`chimera/*` rules it withholds, with a reason per rule.)

`components/` carries one split worth stating, now documented in the scaffold README:
`screens/` holds only what the screen registry names, and everything those screens are built
from — shared React, shared hooks and stores, and the in-Canvas `three` / `@react-three/fiber`
primitives — goes in `components/`. The `<GameCanvas>` itself stays in the screen, which
renders the primitives as its children.

**The scaffolded playfield is now a full-bleed scene host.** `position: absolute; inset: 0`
on the screen's root element, which is where a `<GameCanvas>` goes. This fixes a real
failure: sized the obvious way, with `block-size: 100%`, the canvas renders into a short
strip at the top of a full-screen window — no error, no warning, and it reads as a broken
camera rather than a broken layout. The mechanism is written out in
`docs/core-components/camera-system.md` §4.22 "Sizing the wrapper"; the host geometry it
turns on is now pinned by `GameShell.test.tsx`.

The renderer change is documentation: `GameCanvas`'s `className` JSDoc described the
failure as "zero-height", which understates the common case, and
`docs/core-components/camera-system.md` stated the wrapper requirement only under its
multi-canvas/overlay heading. Both now state the rule and the real failure for every canvas
role, as does the `PlayfieldScreen` example in `docs/architecture-overview.md` — which
showed `<GameCanvas>` as a bare screen root and reproduced the strip verbatim if copied.
