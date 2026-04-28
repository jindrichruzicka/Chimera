// renderer/components/shell/SeatSwitcher.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeatSwitcher } from './SeatSwitcher';
import type { LocalProfileSlot, ProfileSwitcherApi } from './useProfileSwitcher';

const switchToProfile = vi.fn(async () => undefined);
let mockSlots: readonly LocalProfileSlot[] = [];

vi.mock('./useProfileSwitcher', () => ({
    useProfileSwitcher: (): ProfileSwitcherApi => ({
        slots: mockSlots,
        switchToProfile,
    }),
}));

describe('SeatSwitcher', () => {
    beforeEach(() => {
        mockSlots = [];
        switchToProfile.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders one button per local profile slot returned by listLocalSlots', () => {
        mockSlots = [
            { localProfileId: 'local-a', displayName: 'Alice' },
            { localProfileId: 'local-b', displayName: 'Bob' },
            { localProfileId: 'local-c', displayName: 'Charlie' },
        ];

        render(<SeatSwitcher />);

        expect(screen.getByTestId('seat-switcher')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-local-a')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-local-b')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-local-c')).toBeTruthy();
    });

    it('renders each slot button with its displayName', () => {
        mockSlots = [
            { localProfileId: 'local-a', displayName: 'Alice' },
            { localProfileId: 'local-b', displayName: 'Bob' },
        ];

        render(<SeatSwitcher />);

        expect(screen.getByText('Alice')).toBeTruthy();
        expect(screen.getByText('Bob')).toBeTruthy();
    });

    it('calls switchToProfile with the selected localProfileId on click', () => {
        mockSlots = [
            { localProfileId: 'local-a', displayName: 'Alice' },
            { localProfileId: 'local-b', displayName: 'Bob' },
        ];

        render(<SeatSwitcher />);

        fireEvent.click(screen.getByTestId('seat-btn-local-b'));

        expect(switchToProfile).toHaveBeenCalledWith('local-b');
    });

    it('does not render when only one local slot exists', () => {
        mockSlots = [{ localProfileId: 'local-a', displayName: 'Alice' }];

        render(<SeatSwitcher />);

        expect(screen.queryByTestId('seat-switcher')).toBeNull();
    });

    it('does not render when there are no slots', () => {
        mockSlots = [];

        render(<SeatSwitcher />);

        expect(screen.queryByTestId('seat-switcher')).toBeNull();
    });
});
