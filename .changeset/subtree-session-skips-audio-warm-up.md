---
'@chimera-engine/renderer': patch
---

Stop `GameAssetSession` from warming audio clips, so a game forwarding one shell inventory to both
shell payload fields no longer decodes its menu audio twice.

`shellAudioAssets` and `shellBackgroundAssets` each open their own session over their own manager,
and each session ran the critical preload over the whole inventory it was handed. Forwarding one
inventory to both fetched and decoded every critical clip once per session, and the background
session kept its copy for as long as the background was mounted. `AudioManager` loads a clip through
the app-level delegate, and a `GameAssetSession` never registers as that delegate, so the copy it
decoded was not one `AudioManager` played.

A `GameAssetSession` now treats every `audio-clip` entry as `deferred` for its warm-up. The entry is
still registered, so a subtree that loads the clip directly still resolves it, on demand. The shell
audio session is unchanged and still warms every critical entry, clips included. Other critical
entries in a shared inventory are still warmed by both sessions.
