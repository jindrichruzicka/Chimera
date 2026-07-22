---
'@chimera-engine/renderer': patch
'@chimera-engine/electron': patch
---

The renderer logging bridge is now installed before the **first** renderer log, and an `Error` handed
to it keeps its stack. Both defects made diagnostics the renderer already emits either vanish or
arrive unusable in the log file a packaged binary leaves behind (§4.27, Invariant #67).

The renderer has no injected `Logger`. Unlike `electron/main` — where the invariant is backed by a
`no-console` ESLint zone — `installRendererLogger` _patches_ `console.warn` and `console.error` and
forwards over `window.__chimera.logs`. In `renderer/**` those two methods therefore **are** the
sanctioned channel, and the interception model has failure modes the main-process rule has no
equivalent for: a call the bridge never saw, and a call it saw but could not carry.

**Installed before the first render-phase log.** The install ran in a `useEffect` in `LoggingBootstrap`,
which `AppShell` mounted _inside_ `<Providers>`. React runs a parent's render strictly before any
child's effect, so everything `Providers` logged while rendering escaped the patch entirely. That
was not hypothetical: `createAudioManagerForEnvironment` warns from a `useMemo` initializer when Web
Audio init fails, then falls back to a noop audio manager. The fallback protects the app, so a player
whose audio failed ran a silent game — and the one line saying why reached devtools and never the log
file. Nothing in the record said the app had gone quiet.

Hoisting alone would not have fixed it: React commits _all_ effects after the whole tree has
rendered, so an effect-scoped install is late wherever it is mounted. `<LoggingBootstrap />` is now
`AppShell`'s **first child**, outside `<Providers>`, and installs **during its render**. Because the
install left effect scope it also has to survive React's StrictMode remount — every Next host in the
tree sets `reactStrictMode: true` (`apps/<game>/renderer/next.config.ts` and the scaffold template),
which runs mount → cleanup → mount, and the render-phase call does not run a second time — so the
effect re-arms the bridge as well as owning its teardown. The install stays idempotent, is
refcounted across multiple mounts, and its teardown stays exact (console methods restored, window
listeners removed).

The guarantee is bounded at React: client-bundle **module evaluation** — including the
`chimera-game-registration` side-effect import that runs an adopter's `register.ts` as the bundle
loads — precedes every render and sits outside the bridge. Module-scope code must not log expecting
forwarding; anything it emits reaches devtools only.

Ownership is single-sourced. `installRendererLogger` returns `null` — not a no-op teardown — when
the bridge is already installed, so a caller can never claim (and later run) a teardown it did not
create. A no-op return would read as ownership, and a stale claim to it survives Fast Refresh
(`LoggingBootstrap.tsx` re-evaluates, resetting its module-scope claim, while `rendererLogger.ts`
keeps its `installed` latch) and would block every future re-install while reporting success. The
bootstrap also clears its claim before invoking the teardown, so a throwing teardown cannot leave a
stale claim behind — pinned by `LoggingBootstrap.guard.test.tsx`.

**An `Error` argument keeps its stack.** `argsToMessage` mapped every non-string argument through
`String()`, and `makeEntry` was called with no `error`, so `console.error('…', err)` produced a
`LogEntry` with `error: undefined` and a message ending in a bare `Error: <message>`. The stack — the
one thing that makes a renderer error actionable — was gone before the entry left the renderer. The
first `Error` among the arguments is now threaded into `LogEntry.error` as `{ name, message, stack }`
and **removed from the composed `message`** — its detail travels once, in the `error` field, so the
main-process logger does not print the same text twice. The remaining arguments compose `message`
unchanged (string-only call sites read exactly as before), and an `Error` that is the only argument
becomes the message (`name: message`). This also brings a path that was already built for it to
life: the main-process `chimera:logs:emit` handler reconstructs an `Error` from `entry.error` for
`error`/`fatal` levels, which until now only `RootErrorBoundary`'s direct `emitRendererError` call
ever populated.

**Oversized fields cost characters, never the entry.** The `chimera:logs:emit` handler drops an
entry that fails schema validation rather than truncating it, so the renderer truncates first:
`serialiseError` caps `error.name`/`error.message`/`error.stack` at 256/4096/8192 characters, the
composed `message` at the schema's existing 4096, and `source.module` at 256. On the electron side
`LogErrorInfoSchema` and `RendererLogSourceSchema` now enforce the same caps, so every string field
the schema **names** is bounded at the boundary (§9.1) — `error` previously arrived only from
`RootErrorBoundary`, once per crash; now every patched console call carrying an `Error` sends one,
so the unbounded fields became reachable at volume. On the renderer channel an oversized field at
the boundary means a producer that bypassed the bridge, and the entry is dropped like any other
malformed payload. The two cap sets cannot share a constant across the electron/renderer boundary,
so an e2e spec (`renderer-logging.spec.ts`) drives an entry with every page-drivable capped field
oversized — composed message, `error.name`, `error.message`, `error.stack` — through the real chain
and asserts it arrives truncated, never dropped. Each side's unit tests pin its own literals, so a
unilateral cap edit fails that side's suite; the e2e is what catches a **coordinated** edit — a cap
moved together with the literals in its own test — which otherwise leaves the two sides disagreeing
with everything green. `source.module` is the exception: no page-reachable route produces a
caller-supplied module (the console routes pass the `'global'` literal, and `emitRendererError` is
not on `window`), so its agreement rests on the two unit suites and the coordinated-edit gap stays
open for that field alone. `context` is the one field left unbounded, and stays so deliberately: it carries arbitrary
structured diagnostics, and a size budget would mean serialising every entry to measure it. The
schema bounds its shape and not its extent, so an oversized `context` cannot cost an entry — but the
window handlers' `context.stack` is truncated to the same 8192 regardless, so every string the
bridge itself composes is bounded, not only the ones a validator would reject. The shape half has a
consequence worth stating, since it is the drop rule read backwards: a `context` that is not a
record costs the **whole entry**, silently. §9.1's `logs` row now records all of this, caps and
exception both.

`console.log` remains deliberately **unforwarded** (PII/volume hygiene). A call site that needs a
durable record moves up to `warn`/`error`; it does not get `console.log` hooked. The regression test
pinning that policy predates this change and stays in place; §4.27 now cites it explicitly so a
later "the bridge should catch everything" change has to fail a test rather than quietly reverse it.

Ordering is pinned by test rather than by comment, since the defect _was_ an unpinned parent/child
ordering assumption: `renderer/app/AppShell.test.tsx` runs the real patch and asserts that
`Providers`' render-phase AudioManager warn reaches a `logsApi` stub, and separately that a log
emitted _after_ StrictMode's remount still forwards — the render-phase warn fires before any
StrictMode cleanup, so only a post-render log can prove the re-arm. Moving `<LoggingBootstrap />`
back inside a provider, or back into an effect, fails a test instead of silently dropping logs
again. `renderer/app/LoggingBootstrap.ssr.test.tsx` additionally pins that the render-phase install
stays inert during the static-export prerender, where `window` does not exist — a regression there
would fail `next build`, which no jsdom test observes.

Adopter-visible in what the log file contains. A game whose renderer never warns before its
providers settle sees no change in coverage; one that does now has the entry, with its stack. Log
_format_ changes in one respect: an `Error` passed to `console.warn`/`console.error` no longer
appears stringified inside `message` — its text lives in the entry's `error` field (and, for
`error`/`fatal` levels, in the reconstructed `Error` the main logger receives), so lines that
previously ended in `… Error: <message>` now carry that detail structurally.
