// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyAPI,
    ProfileRejection,
    SystemAPI,
} from '@chimera/simulation/bridge/api-types.js';
import { ProfileRejectedToastBridge } from './ProfileRejectedToastBridge';
import { useToastStore } from '../../state/toastStore';

const noopSystem = {
    onConnectionStatus: vi.fn(() => () => undefined),
} as unknown as SystemAPI;

function installLobbyBridge(lobby: Partial<LobbyAPI>): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { lobby, system: noopSystem },
    });
}

/** A no-op-returning `onProfileRejected` whose registered listener is captured. */
function captureRejectionListener(): {
    onProfileRejected: LobbyAPI['onProfileRejected'];
    fire: (rejection: ProfileRejection) => void;
} {
    let listener: ((rejection: ProfileRejection) => void) | undefined;
    const onProfileRejected = vi.fn((cb: (rejection: ProfileRejection) => void) => {
        listener = cb;
        return () => undefined;
    }) as unknown as LobbyAPI['onProfileRejected'];
    return { onProfileRejected, fire: (rejection) => listener?.(rejection) };
}

beforeEach(() => {
    useToastStore.getState().dismissAll();
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('ProfileRejectedToastBridge', () => {
    it('subscribes to onProfileRejected and pushes an error toast with friendly copy', () => {
        const { onProfileRejected, fire } = captureRejectionListener();
        installLobbyBridge({ onProfileRejected });

        render(<ProfileRejectedToastBridge />);
        expect(onProfileRejected).toHaveBeenCalledOnce();

        fire({ reason: 'profile:AVATAR_TOO_LARGE' });

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.severity).toBe('error');
        expect(queue[0]!.title).toBe('Profile rejected: avatar image is too large');
    });

    it('maps the rate_limit reason to friendly copy', () => {
        const { onProfileRejected, fire } = captureRejectionListener();
        installLobbyBridge({ onProfileRejected });

        render(<ProfileRejectedToastBridge />);
        fire({ reason: 'rate_limit' });

        expect(useToastStore.getState().queue[0]!.title).toBe(
            'Profile rejected: updating too quickly',
        );
    });

    it('falls back to the raw reason for an unmapped code', () => {
        const { onProfileRejected, fire } = captureRejectionListener();
        installLobbyBridge({ onProfileRejected });

        render(<ProfileRejectedToastBridge />);
        fire({ reason: 'profile:SOMETHING_NEW' });

        expect(useToastStore.getState().queue[0]!.title).toBe(
            'Profile rejected: profile:SOMETHING_NEW',
        );
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        installLobbyBridge({ onProfileRejected: vi.fn(() => unsubscribe) });

        const { unmount } = render(<ProfileRejectedToastBridge />);
        expect(unsubscribe).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('renders nothing and no-ops when the bridge is absent', () => {
        const { container } = render(<ProfileRejectedToastBridge />);
        expect(container).toBeEmptyDOMElement();
        expect(useToastStore.getState().queue).toHaveLength(0);
    });
});
