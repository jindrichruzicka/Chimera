import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

export const tacticsAudioRefs = {
    step: 'tactics/audio/sfx/step.wav' as AssetRef<AudioClipAsset>,
    swordHit: 'tactics/audio/sfx/sword-hit.wav' as AssetRef<AudioClipAsset>,
    reveal: 'tactics/audio/sfx/reveal.wav' as AssetRef<AudioClipAsset>,
} as const;

export const tacticsAssetManifest: AssetManifest = {
    gameId: 'tactics',
    entries: [
        {
            ref: 'tactics/audio/sfx/step.wav' as AssetRef<AudioClipAsset>,
            kind: 'audio-clip',
            priority: 'deferred',
        },
        {
            ref: 'tactics/audio/sfx/sword-hit.wav' as AssetRef<AudioClipAsset>,
            kind: 'audio-clip',
            priority: 'deferred',
        },
        {
            ref: 'tactics/audio/sfx/reveal.wav' as AssetRef<AudioClipAsset>,
            kind: 'audio-clip',
            priority: 'deferred',
        },
    ],
};
