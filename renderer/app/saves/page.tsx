'use client';

/**
 * renderer/app/saves/page.tsx
 *
 * SaveScreen page: lists save slots from `saveStore.slots` and exposes
 * Save, Load, and Delete actions routed through `window.__chimera.saves.*`.
 *
 * Architecture reference: §4.11 — Save / Load Persistence
 * Task: issue #374
 *
 * Invariants:
 *   #1 — GameSnapshot never leaves the main process; this page reads only
 *         SaveSlotMeta from saveStore, never raw SaveFile or GameSnapshot.
 *   #4 — The renderer reads state; all writes go through `window.__chimera`.
 *
 * Rules:
 *   - Subscribes to saveStore through narrow typed selectors only.
 *   - All save/load/delete operations dispatched through `window.__chimera.saves`.
 *   - Must NOT import from: electron/main/, simulation/engine/, networking/.
 */

import React, { useCallback } from 'react';
import type { SaveSlotMeta } from '@chimera/electron/preload/api-types.js';
import { useSaveStore } from '../../state/saveStore.js';
import { useSavesApi } from './useSavesApi.js';

// ── SaveSlotRow ───────────────────────────────────────────────────────────────

interface SaveSlotRowProps {
    readonly slot: SaveSlotMeta;
    readonly onSave: (slot: SaveSlotMeta) => void;
    readonly onLoad: (slotId: string) => void;
    readonly onDelete: (slotId: string) => void;
}

function SaveSlotRow({ slot, onSave, onLoad, onDelete }: SaveSlotRowProps): React.ReactElement {
    const savedAtDate = new Date(slot.savedAt).toLocaleString();

    return (
        <li
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '0.75rem 1rem',
                borderBottom: '1px solid #ddd',
            }}
        >
            <span style={{ minWidth: '8rem', fontWeight: 'bold' }}>{slot.slotId}</span>
            <span style={{ minWidth: '4rem' }}>{slot.tick}</span>
            <span
                data-testid={`slot-saved-at-${slot.slotId}`}
                style={{ minWidth: '12rem', color: '#555' }}
            >
                {savedAtDate}
            </span>
            {slot.label !== undefined && (
                <span style={{ flex: 1, fontStyle: 'italic' }}>{slot.label}</span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <button
                    type="button"
                    aria-label={`Save ${slot.slotId}`}
                    onClick={() => {
                        onSave(slot);
                    }}
                >
                    Save
                </button>
                <button
                    type="button"
                    aria-label={`Load ${slot.slotId}`}
                    onClick={() => {
                        onLoad(slot.slotId);
                    }}
                >
                    Load
                </button>
                <button
                    type="button"
                    aria-label={`Delete ${slot.slotId}`}
                    onClick={() => {
                        onDelete(slot.slotId);
                    }}
                >
                    Delete
                </button>
            </span>
        </li>
    );
}

// ── SavesPage ─────────────────────────────────────────────────────────────────

export default function SavesPage(): React.ReactElement {
    const slots = useSaveStore((s) => s.slots);
    const isLoading = useSaveStore((s) => s.isLoading);
    const savesApi = useSavesApi();

    const handleSave = useCallback(
        (slot: SaveSlotMeta): void => {
            void savesApi.save({ gameId: slot.gameId, slotId: slot.slotId });
        },
        [savesApi],
    );

    const handleLoad = useCallback(
        (slotId: string): void => {
            void savesApi.load(slotId);
        },
        [savesApi],
    );

    const handleDelete = useCallback(
        (slotId: string): void => {
            void savesApi.delete(slotId);
        },
        [savesApi],
    );

    if (isLoading) {
        return (
            <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
                <h1>Saves</h1>
                <div role="status" aria-label="Loading save slots">
                    Loading…
                </div>
            </main>
        );
    }

    return (
        <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
            <h1>Saves</h1>
            {slots.length === 0 ? (
                <p>No save slots found.</p>
            ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {slots.map((slot) => (
                        <SaveSlotRow
                            key={slot.slotId}
                            slot={slot}
                            onSave={handleSave}
                            onLoad={handleLoad}
                            onDelete={handleDelete}
                        />
                    ))}
                </ul>
            )}
        </main>
    );
}
