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

import React, { useCallback, useState } from 'react';
import { toSlotId } from '@chimera/electron/preload/api-types.js';
import type { SaveSlotMeta, SlotId } from '@chimera/electron/preload/api-types.js';
import { useSaveStore } from '../../state/saveStore.js';
import { useSavesApi } from './useSavesApi.js';

// ── SaveSlotRow ───────────────────────────────────────────────────────────────

interface SaveSlotRowProps {
    readonly slot: SaveSlotMeta;
    readonly onSave: (slot: SaveSlotMeta) => void;
    readonly onLoad: (slotId: SlotId) => void;
    readonly onDelete: (slotId: SlotId) => void;
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

// ── NewSaveForm ───────────────────────────────────────────────────────────────

interface NewSaveFormProps {
    readonly gameId: string;
    readonly onNewSave: (gameId: string, slotId: SlotId | undefined) => void;
}

function NewSaveForm({ gameId, onNewSave }: NewSaveFormProps): React.ReactElement {
    const [slotId, setSlotId] = React.useState('');

    const handleSubmit = (e: React.FormEvent): void => {
        e.preventDefault();
        const trimmed = slotId.trim();
        onNewSave(gameId, trimmed !== '' ? toSlotId(trimmed) : undefined);
        setSlotId('');
    };

    return (
        <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}
        >
            <label htmlFor="new-save-slot-id" style={{ whiteSpace: 'nowrap' }}>
                Slot ID
            </label>
            <input
                id="new-save-slot-id"
                type="text"
                value={slotId}
                onChange={(e) => {
                    setSlotId(e.target.value);
                }}
                placeholder="optional — auto-generated if blank"
                style={{ flex: 1 }}
            />
            <button type="submit">New Save</button>
        </form>
    );
}

// ── SavesPage ─────────────────────────────────────────────────────────────────

export default function SavesPage(): React.ReactElement {
    const slots = useSaveStore((s) => s.slots);
    const isLoading = useSaveStore((s) => s.isLoading);
    const savesApi = useSavesApi();
    // Surface IPC failures (BLOCK-3 wiring rejects when no session is active,
    // load can throw SaveNotFoundError, etc.) so users see what went wrong.
    const [error, setError] = useState<string | null>(null);

    const runSavesAction = useCallback(
        async (op: string, fn: () => Promise<unknown>): Promise<void> => {
            try {
                setError(null);
                await fn();
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                setError(`${op} failed: ${message}`);
            }
        },
        [],
    );

    const handleSave = useCallback(
        (slot: SaveSlotMeta): void => {
            void runSavesAction('Save', () =>
                savesApi.save({ gameId: slot.gameId, slotId: slot.slotId }),
            );
        },
        [savesApi, runSavesAction],
    );

    const handleLoad = useCallback(
        (slotId: SlotId): void => {
            void runSavesAction('Load', () => savesApi.load(slotId));
        },
        [savesApi, runSavesAction],
    );

    const handleDelete = useCallback(
        (slotId: SlotId): void => {
            void runSavesAction('Delete', () => savesApi.delete(slotId));
        },
        [savesApi, runSavesAction],
    );

    const handleNewSave = useCallback(
        (gameId: string, slotId: SlotId | undefined): void => {
            const request = slotId !== undefined ? { gameId, slotId } : { gameId };
            void runSavesAction('Save', () => savesApi.save(request));
        },
        [savesApi, runSavesAction],
    );

    const activeGameId = slots[0]?.gameId ?? 'tactics';

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
            {error !== null && (
                <div
                    role="alert"
                    style={{
                        padding: '0.75rem 1rem',
                        marginBottom: '1rem',
                        background: '#fdecea',
                        border: '1px solid #f5c2c0',
                        borderRadius: 4,
                        color: '#611a15',
                    }}
                >
                    {error}
                </div>
            )}
            {slots.length === 0 ? (
                <>
                    <NewSaveForm gameId={activeGameId} onNewSave={handleNewSave} />
                    <p>No save slots found.</p>
                </>
            ) : (
                <>
                    <NewSaveForm gameId={activeGameId} onNewSave={handleNewSave} />
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
                </>
            )}
        </main>
    );
}
