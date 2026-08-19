---
'@chimera-engine/renderer': minor
---

Add the primitives behind the unconditional loading beat (F92, §4.36): the presentation
sequencer that will run black → the loading cover → black → the reveal on a surface whose
cascade resolves a game-declared cover form, the fade-ownership sessions that keep two owners
of one curtain from stranding each other, and the floor that keeps an undeclared beat readable.

`useLoadingBeat` (`renderer/components/scene/useLoadingBeat.ts`) sequences one surface against
one curtain. Its loading leg is unconditional on a resolved cover: a gate that settles before
the first frame still gets the beat, which is what the knob was always for and what visibility
as an arming condition could not deliver on fast hardware. The floor is measured from the
moment the cover is fully visible rather than from its mount, so a fade is not spent out of the
time a player has to read. The beat reads `gate.ready` and never the settle outcome, so the
four settle paths reveal alike; it adds no release path of its own, and an unsettled gate is
never revealed by a timer of the beat's. `darkening` ends on the curtain being OBSERVED opaque,
which is what lets the same machine serve a route that commands its own fade-out and a scene
transition where `useFadeTransition` owns that fade because the ack awaits it. Durations arrive
as inputs and the module reads no environment of its own, so the e2e collapse keeps the
call-time readers it already had (Invariant #133). Nothing consumes the hook yet.

`FadeControl` gains `claim(owner)`, returning a `FadeSession` whose `fadeOut`/`fadeIn` go inert
once a later claim supersedes it, resolving rather than hanging so a superseded owner can
unwind. Starting a fade cancels the one in flight and resolves its promise early, which lets
two owners of one provider strand each other — a stale write repainting a screen an exit
blacked, or an exit's `await` returning mid-ramp and navigating over a half-faded screen. The
bare `fadeOut`/`fadeIn` pair is deliberately left driving the provider directly and is not
gated by a claim, so every existing caller is unchanged.

`resolveLoadingBeatFloorMs` joins `resolveLoadingCoverHoldMs` in
`renderer/components/scene/loadingCoverHold.ts` rather than replacing it, so no live path
changes behaviour in this change. It differs in one respect: an absent or unusable declaration
resolves to `DEFAULT_LOADING_BEAT_FLOOR_MS` instead of to nothing, because a beat bounded only
by its own two fades is sub-perceptual under `prefers-reduced-motion`, where those fades are
cuts. A declared `0` still resolves to `0` — the explicit opt-down to gate-settle-only. It
collapses to `0` under `NEXT_PUBLIC_CHIMERA_E2E` on every branch, default included, reading the
env at call time; like the hold, it does not collapse under reduced motion.

This supersedes clauses of the two entries above it, both of which are left as written — pre-release
mode retains their published text. From the reveal-grace entry: the mechanism it describes is
the one F92 replaces, so its statements that the declared minimum is what opts an entry in,
that a wait which settles first is unchanged, and that a seen cover leaves on one fade instead
of returning through black for two, all hold only until the surfaces adopt the beat. From the
F90 entry: visibility as the arming condition at every consumer, which becomes a resolved cover
form instead. No mount, ack, host barrier or release budget is affected by anything here.
