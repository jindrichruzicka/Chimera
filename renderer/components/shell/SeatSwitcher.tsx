// renderer/components/shell/SeatSwitcher.tsx
//
// Pass-and-play seat switcher. Renders one button per local profile slot and
// calls profile.updateLocal() to attest the newly selected profile.

import React from 'react';
import { useProfileSwitcher } from './useProfileSwitcher';

export function SeatSwitcher() {
    const { slots, switchToProfile } = useProfileSwitcher();

    if (slots.length <= 1) {
        return null;
    }

    return (
        <div data-testid="seat-switcher" style={{ marginBottom: '1rem' }}>
            <h2>Switch Seat</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {slots.map((slot) => (
                    <button
                        key={slot.localProfileId}
                        data-testid={`seat-btn-${slot.localProfileId}`}
                        onClick={() => {
                            void switchToProfile(slot.localProfileId);
                        }}
                        style={{ padding: '0.5rem 0.75rem' }}
                    >
                        {slot.displayName}
                    </button>
                ))}
            </div>
        </div>
    );
}
