---
'create-chimera-game': patch
---

Close F88 in the documentation: extend §4.41 with what a LIVE shell surface may do, amend the four
invariants the feature moved, and tell a scaffolded game about the two capabilities its background
gained.

§4.41 keeps pointing at the owner docs rather than restating them — the background's two opt-ins are
§4.37.9's, the shell audio session is §4.25's, action registration is §4.26's, and the second asset
manifest is §4.10's — so what it gains is the part none of those owns alone. The capability table and
the one rule it exists to restate at the point where it is easiest to break: everything F88 adds
changes what the player sees, hears and points at, and none of it changes how a match is born. A key
press on a menu is the sharpest case now that one is possible: what a shell surface does with an
action stays renderer-local — it moves a ring or names a pick in `draft` — and the pick becomes
authoritative when `useQuickStart().start()` hands that draft to `chimera:lobby:quick-start`. Then
the three lifetimes a live surface holds — the background's own `AssetManager` keyed to its mount,
the app-level delegate binding opened across the audio surfaces and handed back at the arm, and an
app-lifetime action table with no unregister — with why each differs. And the ordered handover into
a match, which is the fact no single owner doc states. Its two writers are §4.37.18's —
`underArmedTransition` around the quick-start and continue IPC calls, and
the snapshot gate when a match snapshot lands on a shell surface, which is how the lobby's own Start
reaches `/game` — and what they share is the property the handover rests on: the arm lands while the
shell route is still current. From there the audio session lets go on that arm's own
commit, `GameShell` registers during render on the `/game` commit, and the surface flip disposes the
background a commit after that. Two spellings are wrong the obvious way and the section says why: the
release is by IDENTITY because step 4 lands after step 3, and the session's effect keys on
`kind === 'to-match'` so that only a match ENTRY runs the teardown.

§4.22 gains the mount question the multi-canvas section never had to answer: neither role names a
place, so a `GameCanvas role="overlay"` is a game's canvas root on a shell surface exactly as it is
in a match. Three things differ on a shell mount and each follows from a rule already stated — no
`PerfProbe` because it is an overlay, a host wrapper that is `position: fixed; inset: 0` so the
collapsing-height trap cannot arise, and pointer input off until the game opts in. A `backdrop` role
was considered and not minted: behaviourally identical to `overlay` today, and the union is a quoted
contract.

Four invariants amended, none minted. **#21** gains what a live shell surface adds: the engine
mounting `GameAssetSession` under `ShellBackgroundHost` around a declared background — the same
component, so the same one-effect lifecycle and the same refusal of the delegate — and
`ShellAudioSession` as a second writer of the app-level delegate, opening on the shell surfaces,
publishing to no subtree, releasing by identity and disposing what it built. Neither clause counts
the sites: nothing in the tree enumerates them, and a count no guard reads is falsified by the next
mount. The identity release is load-bearing rather than defensive, because the
surface flip that tears the session down lands a commit after `GameShell` has registered. **#52**
gains the second manifest basename and what follows from it: both names go through one reader into
one workspace-wide declared-ref union, Invariant #22's coverage check is deliberately not widened to
the shell name, discovery is a whole-basename match so a game's test doubles are never read as
inventories it ships, and a const name two of a game's manifests disagree about resolves to nothing.
**#65** gains the registration contract — at shell load, into the app-lifetime registry, through one
registrar that leaves a held id alone and throws on differing metadata, with no unregister and the
cost of that stated. **#127** gains the clarifying sentence that an `overlay` canvas may mount on a
shell surface, with the role union unchanged. The shell-audio scoping statement was authored as part
of #21 rather than as a new row, because what it states is who may bind the app-level asset delegate
— #21's subject and no other row's. The ledger therefore stays at 140 and the roll-call's coverage
table, total, numbering line and automatic share are byte-unchanged across the whole arc.

The stale-phrasing sweep converged every sentence it found by pointer or by deletion, never by
narrowing; the F88 gate record in the invariant roll-call lists what it repaired. The claim the issue
predicted would be stale — that the background host "passes no props" — measured TRUE at this tree:
`renderBackground` renders `<Background />` in both arms, so the sentence stands and only its
neighbour moved.

The blank scaffold's shell loader gains growth comments for `shellBackgroundInteractive` and for
`inputActions` on the shell payload. The interactive one states the whole construction an adopter
needs, because the engine's layers standing aside is only half of it: a surface inside the frame
works because it declares `pointer-events: auto` for itself, and a game's own page is one of those.
The input one says to hand both payloads the one array rather than restating it, since a
re-registration with different metadata throws rather than winning. No invariant, section, or issue
reference (the template-only rule), and the list's stale "two of those" count came out with them.
