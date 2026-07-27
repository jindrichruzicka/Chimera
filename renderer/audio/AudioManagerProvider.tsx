'use client';

import React from 'react';

import type { AudioManager } from './AudioManager';
import { AudioManagerContext } from './AudioManagerContext.js';

export interface AudioManagerProviderProps {
    readonly audioManager: AudioManager;
    readonly children: React.ReactNode;
}

/**
 * Publishes the app-level {@link AudioManager} to `useAudioManager()` consumers.
 *
 * The app root mounts exactly one (`renderer/app/providers.tsx`), which is also the
 * unique owner of the manager's `dispose()` lifecycle (Invariant #64) — this
 * component only publishes, it never constructs or disposes.
 *
 * It exists as a component rather than a bare exported context because it is part
 * of the public `@chimera-engine/renderer/audio` barrel: an adopting game's tests
 * have to mount whatever provides the manager in order to render a screen that
 * calls `useAudioManager()`, `useSound()`, or `useMusicTrack()`, and shipping a
 * provider keeps the context object itself internal — the same shape as
 * `<I18nProvider>` and `<IconProvider>`. Nothing here weakens the throwing-hook
 * contract of Invariant #83: outside a provider `useAudioManager()` still throws.
 */
export function AudioManagerProvider({
    audioManager,
    children,
}: AudioManagerProviderProps): React.ReactElement {
    return (
        <AudioManagerContext.Provider value={audioManager}>{children}</AudioManagerContext.Provider>
    );
}
