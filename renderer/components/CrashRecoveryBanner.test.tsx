// renderer/components/CrashRecoveryBanner.test.tsx
// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrashRecoveryStatus } from '@chimera-engine/simulation/bridge/api-types.js';
import { toSlotId } from '@chimera-engine/simulation/bridge/api-types.js';
import { CrashRecoveryBanner } from './CrashRecoveryBanner';

interface SavesBridgeFixture {
    readonly loadSpy: ReturnType<typeof vi.fn<(slotId: string) => Promise<void>>>;
}

function installSavesBridge(result: CrashRecoveryStatus): SavesBridgeFixture {
    const loadSpy = vi.fn<(slotId: string) => Promise<void>>(() => Promise.resolve());
    const saves = {
        checkCrashRecovery: vi.fn<() => Promise<CrashRecoveryStatus>>(() =>
            Promise.resolve(result),
        ),
        load: loadSpy,
    };

    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { saves },
    });

    return { loadSpy };
}

afterEach(() => {
    Reflect.deleteProperty(window, '__chimera');
    cleanup();
    vi.restoreAllMocks();
});

describe('CrashRecoveryBanner', () => {
    it('renders the banner when checkCrashRecovery resolves with needsRecovery: true', async () => {
        installSavesBridge({ needsRecovery: true, slotId: toSlotId('slot-crash-1') });

        render(<CrashRecoveryBanner />);

        await waitFor(() => {
            expect(screen.getByTestId('crash-recovery-banner')).toBeDefined();
        });
    });

    it('does not render the banner when checkCrashRecovery resolves with needsRecovery: false', async () => {
        installSavesBridge({ needsRecovery: false, slotId: null });

        render(<CrashRecoveryBanner />);

        // Wait a tick for the async check to resolve
        await waitFor(() => {
            expect(screen.queryByTestId('crash-recovery-banner')).toBeNull();
        });
    });

    it('"Resume last session" button calls window.__chimera.saves.load with the correct slot ID', async () => {
        const slotId = toSlotId('slot-crash-42');
        const { loadSpy } = installSavesBridge({ needsRecovery: true, slotId });

        render(<CrashRecoveryBanner />);

        const button = await screen.findByRole('button', { name: /resume last session/i });
        await userEvent.click(button);

        expect(loadSpy).toHaveBeenCalledOnce();
        expect(loadSpy).toHaveBeenCalledWith(slotId);
    });

    it('"Start fresh" button dismisses the banner without calling load', async () => {
        const { loadSpy } = installSavesBridge({
            needsRecovery: true,
            slotId: toSlotId('slot-crash-1'),
        });

        render(<CrashRecoveryBanner />);

        const button = await screen.findByRole('button', { name: /start fresh/i });
        await userEvent.click(button);

        expect(screen.queryByTestId('crash-recovery-banner')).toBeNull();
        expect(loadSpy).not.toHaveBeenCalled();
    });

    it('banner is dismissed after "Resume last session" is clicked', async () => {
        installSavesBridge({ needsRecovery: true, slotId: toSlotId('slot-crash-1') });

        render(<CrashRecoveryBanner />);

        const button = await screen.findByRole('button', { name: /resume last session/i });
        await userEvent.click(button);

        expect(screen.queryByTestId('crash-recovery-banner')).toBeNull();
    });
});
