---
'@chimera-engine/simulation': patch
---

Fix player colours (and other host-authored seat attributes) flashing their default value at the start of a replay before snapping to the chosen value.

Seat setup — chosen player colours, names, team, etc. — is match-initialization data carried on the `engine:start_game` payload, not a gameplay action. A replay's `gameConfig` is frozen at lobby-start, before that setup exists, so `createBaseReplayInitialSnapshot` reconstructed the initial frame without any `setup`; the value only appeared once the recorded `engine:start_game` action replayed, producing a one-frame default → chosen flash. The reconstruction now lifts `setup` from the replay's first `engine:start_game` action (validated via the same `parseSetup` sanitiser the live pipeline uses) and seeds it into the initial snapshot, so the first frame already carries the correct attributes. Determinism is preserved — the replayed `engine:start_game` re-applies the identical value, leaving every post-action frame bit-identical — and the fix is self-healing for already-recorded replays (no file-format change).
