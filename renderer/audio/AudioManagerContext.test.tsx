// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AudioManagerContext, useAudioManager } from './AudioManagerContext.js';
import { createAudioManagerStub } from './__test-support__/AudioManagerStubs.js';

afterEach(() => {
    cleanup();
});

describe('AudioManagerContext', () => {
    it('throws a descriptive error when used outside the provider', () => {
        expect(() => renderHook(() => useAudioManager())).toThrow(
            'useAudioManager() must be used inside <GameShell>.',
        );
    });

    it('returns the injected AudioManager instance inside the provider', () => {
        const manager = createAudioManagerStub();
        const wrapper = ({
            children,
        }: {
            readonly children: React.ReactNode;
        }): React.ReactElement => (
            <AudioManagerContext.Provider value={manager}>{children}</AudioManagerContext.Provider>
        );

        const { result } = renderHook(() => useAudioManager(), { wrapper });

        expect(result.current).toBe(manager);
    });
});
