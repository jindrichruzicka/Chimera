---
'@chimera-engine/electron': patch
---

The Invariant #35 settings-registration refusal now reports through the injected `Logger` instead of
`console.error`, every refusal raised after the logger exists shares one enforced code path, and the
`console.*` ban itself became a ratchet.

`main()` refuses to start in four places. The Invariant #27/#77 startup guard genuinely cannot use
the logger: it must be the first statement in `main()` so no debug surface initialises before an
illegal production+debug combination is caught, which is before the root logger is constructed. The
other three run after it — the Invariant #14 content load, the Invariant #35 settings registration,
and the dev-harness bootstrap failure — and all three did something different. #35 was still on
`console.error`, sanctioned as an explicitly not-yet-migrated site; this migrates it. #14 had the
right shape but hand-rolled. The harness site logged and exited with no drain at all, so its reason
died in the buffer.

All three now call one helper, `refuseToStart(logger, sink, message, err)`: report through the
injected logger at **`fatal`**, drain the sink, `app.exit(1)`. Callers rethrow after it returns where
an awaiting caller needs the error. The shape is a property of the code rather than of three copies
of a comment, which is what makes it checkable. Both steps are guarded so neither can cost the exit —
the drain because an unflushable sink must not become a hang, the report as defence in depth, since
the exit must not depend on every layer of the logging stack staying total. `fatal` rather than
`error` because the level is what makes these findable in the log file a packaged binary leaves
behind, and it is the level `handleUncaughtException` already uses for the comparable event; the
messages lost their now-redundant `fatal:` prefix. The Invariant #35 refusal keeps its two existing
behaviours: the `err.name` discriminator, so it is never reported under the same label as an
unrelated bug in a game's `registerSettings` callback, and the deliberate absence of
`dialog.showErrorBox`, which is modal and would hang a non-interactively launched binary.

Each of the three sites is pinned by a test asserting the drain lands before the exit, the harness
one included — it is reachable only under `CHIMERA_DEV_HARNESS` with an auto-flow flag, so nothing
else in the suite goes near it, and its drain matters most: the periodic harness flush runs on a 1s
interval that `app.exit(1)` beats.

The crash path now holds the same property by the same means, without the helper.
`handleUncaughtException` reported the fatal entry _above_ the `try` whose `finally` owns
`proc.exit(1)`, and drained the sink inside that `finally` unguarded — so a logging stack that
failed while handling a crash could skip the exit and leave the crashed process alive and
windowless, the very outcome the exit exists to force. Both calls are now guarded individually,
exactly as `refuseToStart` guards its own.

**A dev launch keeps its terminal output.** The migration alone would have moved the reason off the
console and into the log file only: the production Pino sink writes nowhere else, and the stdout
sink is wired solely under `CHIMERA_DEV_HARNESS`. `pnpm start` against a bad settings schema would
have exited 1 in apparent silence. So an unpackaged, non-harness launch now also gets a **stderr
mirror sink** (`createStderrSink`) in the fan-out, wrapped in a new `createMinLevelSink('error', …)`
— the root logger applies no threshold of its own, so an unfiltered mirror would put every startup
`info` entry on the terminal. It is mutually exclusive with the harness stdout sink, whose
orchestrator prefixes and relays that stream. A sink is transport, not a `console.*` call site, so this is not a
new Invariant #67 exception; the refusal reason is now both durable (log file) and immediately
visible (terminal), where before it was only ever one of the two.

**The sink fan-out no longer lets one transport speak for the others.** `main()` composed its
fan-out by hand, writing to the Pino sink first and unguarded — so a single `EBADF` there (a date
rollover, a destroyed SonicBoom) took the in-memory ring buffer and whichever console mirror was wired down with
it, and a fatal refusal exited 1 having written nothing to the log file _and_ nothing to the
terminal. That is now `createFanOutSink`, which isolates each leg: a failing transport loses its own
line and nothing else.

Isolating a leg is not the same as noticing it. No sink reports its own failures — `createPinoSink`
throws on a bad fd or an unserialisable `context` and returns nothing — and in production the
fan-out is their only caller, so swallowing would mean the durable record could stop working with no
signal on any channel. Each failure is therefore announced on the legs that still work, carrying the
underlying error, after they have taken the entry that provoked it. The legs are named for this
reason: an ordinal would mean the harness stdout sink under `dev:mp`, the stderr mirror under
`pnpm start`, and nothing at all in a packaged build.

Announced once per _run_ of failures — not once per entry, and not once per session. Both bounds
matter, because the file sink fails in two unrelated ways: a dead fd recurs on every write and would
turn the survivors into a firehose, while an entry it cannot serialise is transient and leaves the
sink healthy. Latching for the session would let one bad `context` spend that leg's only
announcement and then swallow the genuine `EBADF` behind it, so the latch clears as soon as the leg
writes again.

Both console sinks additionally swallow a failing write **and** an entry they cannot format (a
circular reference in `context`), so that a `Logger` call never throws into its call site because a
convenience mirror could not write. That is defence in depth rather than the enforcement — the
fan-out is, and every production wiring of these sinks goes through it — and it is what keeps them
safe when a caller hands one straight to `createLogger`, as this module's tests do. It also decides
_where_ a line is lost: a swallowing mirror loses one echo, whereas the same failure surfacing at
the fan-out would spend the leg's one announcement on a convenience stream.

**Invariant #67's `console.*` ban is now machine-enforced** (the refusal shape above is not — it
holds because there is one helper, not because a rule rejects a second implementation). A
`no-console` ESLint zone covers `electron/main/**` and
each consumer composition root (`apps/*/electron/main.ts`) — with no `ignores`, test files included,
since none of them call `console.*` — and the #27/#77 guard is the single `eslint-disable-next-line`
in that tree. A `--workspace` scaffold is covered, because it lands in `apps/`; a **standalone**
scaffold is not, and cannot be from here — it ships no eslint flat config at all.

The zone is pinned by `electron/main/__tests__/eslint-no-console.test.ts`, which checks three
independent things, because each is defeatable alone. Fixtures prove the rule _discriminates_. The
zone object itself is asserted to configure `no-console` exactly once, at `error`, with no
`ignores` — behaviour alone was not enough, since narrowing the zone that way disables the rule
where it matters while every fixture assertion still passes, and `pnpm lint` stays green either way
because the orphaned `eslint-disable` is only a _warning_ and no package sets `--max-warnings`.
Finally `eslint --print-config` proves ESLint _resolves_ the rule at error severity for a file from
every subtree the zone claims — shape is not enough either, because the config's **global**
`ignores` sit outside the zone object, so exempting a whole subtree there leaves the zone reading
exactly as documented. That probe list is walked out of the filesystem recursively, so a subtree
added later is covered the day it appears, and nesting one inside another does not hide it. Every
evasion above was measured, not hypothesised.

The zone stops short of two neighbours. `apps/*/electron/build-main.ts` and the app-level verify
scripts are the principled exclusion: Node build tooling that never runs in the app, whose console
output _is_ its interface. Preload is only a scope call — it would ratchet identically, having one
sanctioned `console.*` call site (`electron/preload/shared/listener.ts`, exception (b)) and so
needing one targeted disable, but it is a different layer with a different logging story and belongs
to its own change.

Adopter-visible only in where a refusal reason appears. A packaged binary that refuses to start over
a settings schema now leaves its reason in `<userData>/logs/chimera-<date>.log` instead of on a
stderr stream no user of a GUI app was reading; a dev launch shows it in the terminal as before, via
the mirror rather than `console.error`. Nothing changes for a game whose schema registers cleanly.
