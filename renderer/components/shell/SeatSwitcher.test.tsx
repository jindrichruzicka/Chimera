// renderer/components/shell/SeatSwitcher.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeatSwitcher } from './SeatSwitcher';

const switchSeat = vi.fn(async () => undefined);

vi.mock('./useSeatSwitch', () => ({
    useSeatSwitch: () => ({
        switchSeat,
    }),
}));

interface MockLobbyStoreState {
    readonly localSeatIds: readonly string[];
}

let mockLocalSeatIds: readonly string[] = [];

vi.mock('../../state/lobbyUiStore', () => ({
    useLobbyUiStore: (selector: (state: MockLobbyStoreState) => unknown) =>
        selector({ localSeatIds: mockLocalSeatIds }),
}));

describe('SeatSwitcher', () => {
    beforeEach(() => {
        mockLocalSeatIds = [];
        switchSeat.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders one button per local seat', () => {
        mockLocalSeatIds = ['p1', 'p2', 'p3'];

        render(<SeatSwitcher />);

        expect(screen.getByTestId('seat-switcher')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-p1')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-p2')).toBeTruthy();
        expect(screen.getByTestId('seat-btn-p3')).toBeTruthy();
    });

    it('calls useSeatSwitch().switchSeat with the selected playerId', () => {
        mockLocalSeatIds = ['p1', 'p2'];

        render(<SeatSwitcher />);

        fireEvent.click(screen.getByTestId('seat-btn-p2'));

        expect(switchSeat).toHaveBeenCalledWith('p2');
    });

    it('does not render when there is one or fewer local seats', () => {
        mockLocalSeatIds = ['p1'];
        const rendered = render(<SeatSwitcher />);
        expect(screen.queryByTestId('seat-switcher')).toBeNull();

        rendered.rerender(<SeatSwitcher />);
        mockLocalSeatIds = [];
        rendered.rerender(<SeatSwitcher />);

        expect(screen.queryByTestId('seat-switcher')).toBeNull();
    });
});
