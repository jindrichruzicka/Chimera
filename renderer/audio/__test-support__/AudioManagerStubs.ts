import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import { vi } from 'vitest';

import type { AudioHandle, AudioManager } from '../AudioManager';

export function createAudioManagerSpy(): AudioManager {
    return {
        play: vi.fn((ref: AssetRef<AudioClipAsset>) => makeAudioHandle(ref)),
        stop: vi.fn(),
        stopAll: vi.fn(),
        duck: vi.fn(),
        dispose: vi.fn(),
    };
}

export function createAudioManagerStub(): AudioManager {
    return {
        play(): never {
            throw new Error('unused audio manager stub');
        },
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stop(): void {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        stopAll(): void {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        duck(): void {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        dispose(): void {},
    };
}

function makeAudioHandle(ref: AssetRef<AudioClipAsset>): AudioHandle {
    return {
        id: 'test-audio-handle',
        ref,
        bus: 'sfx',
        priority: 0,
        valid: true,
    };
}
