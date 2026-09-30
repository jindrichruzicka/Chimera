---
'create-chimera-game': patch
---

Stop the blank template's shell manifest from saying a game that wants both shell fields must point
both at that one file.

The template still forwards `shell-asset-manifest.ts` as both `shellAudioAssets` and
`shellBackgroundAssets`, and that remains a valid shape. What was wrong is the claim that it is the
required one: `validate:assets` finds a `shell-asset-manifest.ts` by its file name at any depth under
`apps/`, so a game can also forward a separate, background-only inventory as `shellBackgroundAssets`.
The comment now describes the two fields and leaves the choice open. Comment only; the scaffolded
files are otherwise unchanged.
