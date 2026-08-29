---
'@chimera-engine/renderer': minor
'create-chimera-game': patch
---

The shell now has a voice. `useSound` and `useMusicTrack` resolve a game's clips through
the app-level `AudioManager`, which loads through the app-level `DelegatingAssetManager` —
and with nothing bound to that manager every load rejected `NoActiveGameSessionError`,
which `play()` swallows. A menu bed or a select blip outside a match was therefore silent,
with nothing in the log. `ShellAudioSession`, mounted by `AppShell`, is the binding for the
shell surfaces.

A game declares two new optional fields on its shell payload. `shellAudioAssets` is the
inventory the session builds its manager over — the same `shell-asset-manifest.ts` a
background may already use, which the asset validator discovers by name, so it needs no
gate of its own. `shellMusicBed: { ref, volume?, fadeInMs? }` is a menu bed the engine
plays for the session's whole life as a looping `music`-bus voice at `MUSIC_PRIORITY`; it
is a declaration rather than a hook call because the bed outlives every individual shell
screen. Volumes and mute need nothing new: the bed plays through the app-level manager's
`music` bus, which already carries `EngineSettings.audio.*`.

The session runs on `SHELL_AUDIO_SURFACES` — the menu, settings, lobby, saves, replays and
every declared game page. That is deliberately its own set and wider than the background's,
which skips saves and replays: a bed that cut out on the way to the save browser would read
as a bug. The two match surfaces sit outside it, and the session is non-spatial — it never
touches the listener pose, because a menu is not a place.

The menu→match handoff is defined behaviour. The entry flows arm a `to-match` transition
before they navigate, and on it the bed leaves through the cue-aligned fade when its clip
declares an `'outro'` cue, and over the screen fade when it does not. The check is on the
CUE rather than on the sheet: an unknown cue name resolves to the clip's decoded end, so a
sheet-exists check would arm the transition against an instant the game never authored.
Either way the fade schedules the voice's own stop, so the session lets go of a bed that is
still sounding rather than cutting it — and because a cue-aligned ramp is booked at the cue
rather than run from the call, the session remembers that voice and ends it before starting
the next one. Otherwise a cancelled entry or an ordinary quit to the menu would lay a second
copy of the same loop over the first.

`DelegatingAssetManager` gains `releaseDelegate(manager)`, which clears the binding only
while it is still the caller's, and `SetGameAssetManagerContext` now carries the register
and release verbs as one object. `GameShell` is unaffected — a match owns the binding for
its whole life — but a shell-scoped registrant does not: a session driven by the shell-state
store tears down on a store update that lands after the router's own commit — the commit in
which `GameShell` already registered the match manager, during render — so an unconditional
clear there could silence the match it just handed over to. The arm-time release runs while
the shell route is still current, ahead of that registration; releasing by identity is what
covers every entry the arm does not.

The `NoActiveGameSessionError` message no longer names `GameShell` as the registrant, since
it is no longer the only one.
