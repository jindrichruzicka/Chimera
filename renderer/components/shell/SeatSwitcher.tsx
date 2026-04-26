// renderer/components/shell/SeatSwitcher.tsx
//
// Pass-and-play seat switcher. Renders one button per local seat and invokes
// the typed preload bridge to switch active seat.

import React from 'react';
import { useLobbyUiStore } from '../../state/lobbyUiStore';
import { useSeatSwitch } from './useSeatSwitch';

export function SeatSwitcher() {
    const localSeatIds = useLobbyUiStore((state) => state.localSeatIds);
    const seatSwitchApi = useSeatSwitch();

    if (localSeatIds.length <= 1) {
        return null;
    }

    return (
        <div data-testid="seat-switcher" style={{ marginBottom: '1rem' }}>
            <h2>Switch Seat</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {localSeatIds.map((playerId) => (
                    <button
                        key={playerId}
                        data-testid={`seat-btn-${playerId}`}
                        onClick={() => {
                            void seatSwitchApi.switchSeat(playerId);
                        }}
                        style={{ padding: '0.5rem 0.75rem' }}
                    >
                        {playerId}
                    </button>
                ))}
            </div>
        </div>
    );
}
