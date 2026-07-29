---
'@chimera-engine/electron': patch
'create-chimera-game': patch
---

Fix the generated `.icns` and `.ico`, whose power-of-two entries were each one pixel short
in height — which broke the Windows build outright and left the macOS icon stretched and
speckled.

The generator handed the whole master to `png2icons` and let it resize internally. That
resize derives each output height as `floor(srcHeight * (target / srcWidth))`, and for some
master widths the double round-trip through that ratio lands a hair below the integer, so
the floor drops a pixel. Which widths, and which target sizes within them, is not a tidy
rule — over the widths 256–2048 and this tool's ten target sizes, 292 of 1793 widths lose
at least one. The engine's master, at 1825, is one of them: `32 / 1825 * 1825` is
`31.999999999999996`, and every power-of-two target came out short — `.icns` at 32×31,
64×63, 128×127, 256×255, 512×511, 1024×1023, and `.ico` the same at its power-of-two sizes
while 24, 48, 72 and 96 stayed square. A 1024px test fixture divides evenly at every size,
which is why the suite never saw it.

Two consequences, the first of which was not cosmetic:

- **The Windows build failed.** electron-builder validates `win.icon` through its
  `app-builder` binary, which rejects an icon whose largest entry is under 256×256. At
  256×255 that is `ERR_ICON_TOO_SMALL` — a hard build failure, not a warning.
- **macOS rendered a stretched, aliased icon.** The shell scales a non-square entry back to
  square at display time. On top of that, `png2icons` decimated the 1825px master to 16–64px
  in a single bicubic step with no low-pass prefilter, which aliases hard and blows isolated
  pixels out at high-contrast edges.

Both containers are now assembled by the tool itself, byte by byte, around exact-size square
renders produced by `sharp` — the same renders the loose PNGs are written from, so a size
that appears in more than one output cannot be right in one and wrong in another. libvips
shrinks before it resamples, so the small entries are clean. Each render is verified against
its own PNG header before it is used: an off-by-one in a resize is invisible in every
downstream byte, since the container assembles perfectly well around a wrong-sized payload.

`png2icons` is gone — from the dependency tree, from `@chimera-engine/electron`'s optional
peers, and from the scaffold's opt-in instructions, which are now just `pnpm add -D sharp`.

The `.icns` carries `ic07`–`ic14`, all PNG, which is exactly the set electron-builder's own
generator emits. `ic04`/`ic05` are deliberately absent rather than overlooked: those slots
are raw `ARGB`, and macOS' IconServices — the path Finder and the Dock use, unlike `NSImage`
— rejects a PNG there and falls back to the generic application icon. Omitting them costs
nothing on a Retina display, where 16pt and 32pt render from `ic11`/`ic12`. The `.ico` ladder
is 16, 24, 32, 48, 64, 96, 128 and 256.

Also fixed in the same path: the resize padded with sharp's default background, which is
**opaque black**, so any game whose master is not square got black letterbox bars down two
edges of every loose PNG. (The containers escaped it only because they were built from the
raw master by a different code path — the one this change removes, which would have carried
the bars into every entry.) The pad is now explicitly transparent.

The `verify:scaffold` generate-icons arm no longer requires the run to fail. With `png2icons`
gone the only codec is `sharp`, which a Next-based scaffold already installs as a transitive
optional dependency — so the run there generates the set for real. Both outcomes are now
graded, and the arm asserts on work done rather than exit status: an exit 0 is a failure
unless the set is actually on disk, which is precisely the no-op-entry-guard defect the arm
was built to catch.
