// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { createAudioManagerSpy } from './__test-support__/AudioManagerStubs';
import { AudioManagerProvider } from './AudioManagerProvider';
import { useAudioManager } from './AudioManagerContext';

afterEach(cleanup);

function ManagerProbe(): React.ReactElement {
    const audioManager = useAudioManager();
    return <span data-testid="probe">{String(audioManager.play !== undefined)}</span>;
}

describe('AudioManagerProvider', () => {
    it('publishes the manager to useAudioManager() consumers', () => {
        const audioManager = createAudioManagerSpy();

        render(
            <AudioManagerProvider audioManager={audioManager}>
                <ManagerProbe />
            </AudioManagerProvider>,
        );

        expect(screen.getByTestId('probe')).toHaveTextContent('true');
    });

    it('hands consumers the SAME instance it was given', () => {
        const audioManager = createAudioManagerSpy();
        let seen: unknown;

        function Capture(): null {
            seen = useAudioManager();
            return null;
        }

        render(
            <AudioManagerProvider audioManager={audioManager}>
                <Capture />
            </AudioManagerProvider>,
        );

        // Identity, not shape: `useAudioManager` is how Invariant #84 routes every
        // consumer to the ONE app-level manager, and a provider that wrapped or copied
        // it would hand out a second manager owning a second voice pool.
        expect(seen).toBe(audioManager);
    });

    it('leaves the throwing-hook contract intact outside it (Invariant #83)', () => {
        // The provider is the only thing that satisfies the hook; mounting the probe
        // without one must still throw rather than degrade to a null manager.
        expect(() => render(<ManagerProbe />)).toThrow(/useAudioManager/u);
    });
});
