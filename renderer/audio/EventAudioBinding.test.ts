import { describe, expectTypeOf, it } from 'vitest';
import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { GameEvent } from '@chimera-engine/simulation/bridge/api-types.js';
import type { EventAudioOverrides } from '@chimera-engine/simulation/foundation/game-screen-contract.js';

import type { AudioBusId } from './AudioManager.js';
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

    it('carries an optional per-occurrence resolver over sim-safe primitives only', () => {
        // The overrides type is defined SIM-side and must name no renderer type —
        // this closed shape is the pin. Every member is a primitive; `bus` is a
        // string-literal union that happens to coincide with the renderer's, checked
        // next, and the sim side never names `AudioBusId` itself.
        interface ExpectedOverrides {
            readonly bus?: 'master' | 'music' | 'sfx' | 'voice';
            readonly volume?: number;
            readonly priority?: number;
            readonly rate?: number;
        }
        expectTypeOf<EventAudioOverrides>().toEqualTypeOf<ExpectedOverrides>();

        expectTypeOf<NonNullable<EventAudioBinding[string]>['options']>().toEqualTypeOf<
            ((event: GameEvent) => EventAudioOverrides) | undefined
        >();

        // The two unions must not drift apart: a bus the resolver can author has to
        // be a bus the renderer's play() accepts.
        expectTypeOf<NonNullable<EventAudioOverrides['bus']>>().toEqualTypeOf<AudioBusId>();
    });
});
