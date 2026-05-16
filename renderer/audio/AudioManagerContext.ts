'use client';

import { createContext, useContext } from 'react';

import type { AudioManager } from './AudioManager';

export const AudioManagerContext = createContext<AudioManager | null>(null);

export function useAudioManager(): AudioManager {
    const audioManager = useContext(AudioManagerContext);
    if (audioManager === null) {
        throw new Error('useAudioManager() must be used inside <GameShell>.');
    }

    return audioManager;
}
