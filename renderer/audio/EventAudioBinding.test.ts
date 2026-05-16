import { describe, expectTypeOf, it } from 'vitest';
import type { AssetRef, AudioClipAsset } from '@chimera/simulation/content/AssetRef.js';
import type { EventAudioBinding } from './EventAudioBinding.js';

describe('EventAudioBinding', () => {
    it('maps event types to audio clip refs with optional playback metadata', () => {
        interface ExpectedEntry {
            readonly ref: AssetRef<AudioClipAsset>;
            readonly bus?: 'master' | 'music' | 'sfx' | 'voice';
            readonly volume?: number;
        }

        expectTypeOf<EventAudioBinding>().toMatchTypeOf<Readonly<Record<string, ExpectedEntry>>>();
    });
});
