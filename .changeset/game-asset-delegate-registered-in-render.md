---
'@chimera-engine/renderer': patch
---

Fixed the music bed going silent in every match after the first one of a session.
`GameShell` now registers the match-level `AssetManager` with the app-level
`DelegatingAssetManager` **during render** rather than only in a passive effect.
React flushes mount effects children-first, so a screen that starts a voice in its
own mount effect — which is what `useSound` is for — reached the delegating manager
while the delegate was still `null`; the load rejected `NoActiveGameSessionError`,
and `AudioManager.play()` swallows a rejected load, so the bed was silent with
nothing in the log. A `React.lazy` screen hid this on the first match only: it
suspends once and mounts a commit late, by which time the effect has run, then
renders synchronously from the resolved payload for every match after that.

The effect still owns the binding for the life of the mount — it re-registers on
setup, because StrictMode's simulated remount runs cleanup → setup with no render
between them, and clears the delegate on unmount as before.
