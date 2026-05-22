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
import { Button } from '../../components/ui/Button';
import { Caption } from '../../components/ui/Caption';
import { Heading } from '../../components/ui/Heading';
import { Label } from '../../components/ui/Label';
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
                gap: 'var(--ch-space-md)',
                padding: 'calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
                borderBottom: 'var(--ch-border-width-sm) solid var(--ch-color-border-subtle)',
            }}
        >
            <span
                style={{
                    minWidth: 'calc(var(--ch-space-md) * 8)',
                    fontWeight: 'var(--ch-font-weight-semibold)',
                }}
            >
                {slot.slotId}
            </span>
            <span style={{ minWidth: 'calc(var(--ch-space-md) * 4)' }}>{slot.tick}</span>
            <span
                data-testid={`slot-saved-at-${slot.slotId}`}
                style={{
                    minWidth: 'calc(var(--ch-space-md) * 12)',
                    color: 'var(--ch-color-text-disabled)',
                }}
            >
                {savedAtDate}
            </span>
            {slot.label !== undefined && (
                <span style={{ flex: 1, fontStyle: 'italic' }}>{slot.label}</span>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--ch-space-sm)' }}>
                <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Save ${slot.slotId}`}
                    onClick={() => {
                        onSave(slot);
                    }}
                >
                    Save
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Load ${slot.slotId}`}
                    onClick={() => {
                        onLoad(slot.slotId);
                    }}
                >
                    Load
                </Button>
                <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Delete ${slot.slotId}`}
                    onClick={() => {
                        onDelete(slot.slotId);
                    }}
                >
                    Delete
                </Button>
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
            style={{
                display: 'flex',
                gap: 'var(--ch-space-sm)',
                alignItems: 'center',
                marginBottom: 'var(--ch-space-md)',
            }}
        >
            <Label htmlFor="new-save-slot-id" style={{ whiteSpace: 'nowrap' }}>
                Slot ID
            </Label>
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
            <Button type="submit" variant="secondary" size="sm">
                New Save
            </Button>
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
            <main
                style={{ fontFamily: 'var(--ch-font-ui)', padding: 'calc(var(--ch-space-md) * 2)' }}
            >
                <Heading level={1} size="xl">
                    Saves
                </Heading>
                <div role="status" aria-label="Loading save slots">
                    Loading…
                </div>
            </main>
        );
    }

    return (
        <main style={{ fontFamily: 'var(--ch-font-ui)', padding: 'calc(var(--ch-space-md) * 2)' }}>
            <Heading level={1} size="xl">
                Saves
            </Heading>
            {error !== null && (
                <div
                    role="alert"
                    style={{
                        padding: 'calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
                        marginBottom: 'var(--ch-space-md)',
                        background: 'var(--ch-color-error-surface-muted)',
                        border: 'var(--ch-border-width-sm) solid var(--ch-color-error-border-muted)',
                        borderRadius: 'var(--ch-radius-sm)',
                        color: 'var(--ch-color-error-text-muted)',
                    }}
                >
                    {error}
                </div>
            )}
            {slots.length === 0 ? (
                <>
                    <NewSaveForm gameId={activeGameId} onNewSave={handleNewSave} />
                    <Caption tone="muted">No save slots found.</Caption>
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
