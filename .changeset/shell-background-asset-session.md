---
'@chimera-engine/renderer': minor
---

`LoadedRendererGameShell` gained `shellBackgroundAssets?: AssetManifest`, and
`ShellBackgroundHost` wraps a declared `shellBackground` in the existing
`GameAssetSession` when it is present. Until now a shell background rendered above
every asset owner there is: the manager in context on `main-menu`, `settings`,
`lobby` and a game's declared pages is the app-level `DelegatingAssetManager`, whose
delegate only `GameShell` sets, so a background's `useAsset` / `useModelInstance` /
`useAnimationSheet` rejected `NoActiveGameSessionError`. With the manifest declared
they resolve against the game's own manager, and that manifest's critical entries are
preloaded like a page's.

The session is reused, not rebuilt: `GameAssetSession` already owns the one-effect
allocate → preload → abandon → dispose lifecycle a manager with no `GameShell` above
it needs — the disposal and the commit-phase allocation are Invariant #21's, the
critical preload and its abandon are §4.10's — and already declines to register the
`SetGameAssetManagerContext` delegate, so a menu manifest never stands in for a
match's assets when the app-level `AudioManager` resolves a clip.

It is keyed to the mount. The shell-state surface flip off a background surface
unmounts the background and disposes the session in one render, so no background
session survives into a match and there is no warm cache across `/game`.

A game that declares nothing is untouched — the host builds no manager and emits
byte-identical markup — and a manifest declared without a `shellBackground` is inert,
since a session with no subtree to publish to is never built.
