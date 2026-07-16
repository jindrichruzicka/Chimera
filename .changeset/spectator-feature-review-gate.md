---
'@chimera-engine/renderer': patch
---

Close out F72 Spectator Mode (feature-review gate). Land the carried-over
correctness fix from the #881 review: `renderer/app/game/page.tsx` now derives
`isHost = false` for a spectator, so a spectator that follows the host's seat
(and therefore projects `viewerId === hostId`) is no longer mistaken for the
host — keeping the deterministic-replay export host-only (Invariants #71 / #98 /
#114). Adds the end-to-end Playwright spec proving admit-as-spectator, the
read-only followed view, the out-of-band perspective switch, and both mid-match
reject reasons (`spectators_disabled`, `match_in_progress`), plus the new
Spectator Mode Contract doc and the ratified invariants #114 (read-only viewers)
and #115 (out-of-band `SPECTATE_TARGET_UPDATE`).
