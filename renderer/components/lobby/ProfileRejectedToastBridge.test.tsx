// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    LobbyAPI,
    ProfileRejection,
    SystemAPI,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { ProfileRejectedToastBridge } from './ProfileRejectedToastBridge';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useToastStore } from '../../state/toastStore';

// The bridge calls useTranslate(), which throws outside I18nProvider; the inert
// provider resolves engine English so the existing toast-title assertions hold.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

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

    it('resolves both the prefix and the friendly reason through the active-locale translator', () => {
        const { onProfileRejected, fire } = captureRejectionListener();
        installLobbyBridge({ onProfileRejected });

        baseRender(
            <I18nProvider
                gameOverride={{
                    'engine.toast.profileRejectedPrefix': 'Rejected — {reason}',
                    'engine.toast.profileAvatarTooLarge': 'the avatar is huge',
                }}
            >
                <ProfileRejectedToastBridge />
            </I18nProvider>,
        );
        fire({ reason: 'profile:AVATAR_TOO_LARGE' });

        expect(useToastStore.getState().queue[0]!.title).toBe('Rejected — the avatar is huge');
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
