'use client';

// renderer/components/debug/SnapshotInspectorPanel.tsx
//
// Inspector Snapshot panel (§4.12 — Runtime Debug Layer, F47 T8, #697).
// Renders the FULL authoritative snapshot at the selected tick — no
// projection applied ("full truth — debug only", Invariant #3 exception).
// The payload is treated as an opaque JSON value end to end; the simulation
// snapshot type is never named in the renderer (invariant check 6).

import React, { useEffect, useState } from 'react';
import type { ChimeraDebugApi } from '@chimera/electron/preload/debug-api-types.js';
import { Caption } from '../ui/Caption';
import { ScrollArea } from '../ui/ScrollArea';
import { Spinner } from '../ui/Spinner';
import { JsonTree } from './JsonTree';
import styles from './SnapshotInspectorPanel.module.css';

export interface SnapshotInspectorPanelProps {
    readonly api: ChimeraDebugApi;
    readonly selectedTick: number | null;
}

type SnapshotState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly tick: number; readonly snapshot: unknown }
    | { readonly kind: 'error'; readonly message: string };

export function SnapshotInspectorPanel({
    api,
    selectedTick,
}: SnapshotInspectorPanelProps): React.ReactElement {
    const [state, setState] = useState<SnapshotState>({ kind: 'idle' });

    useEffect(() => {
        if (selectedTick === null) {
            setState({ kind: 'idle' });
            return undefined;
        }

        let active = true;
        setState({ kind: 'loading' });
        api.getSnapshot(selectedTick)
            .then((result) => {
                if (active) {
                    setState({ kind: 'ready', tick: result.tick, snapshot: result.snapshot });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setState({
                        kind: 'error',
                        message: error instanceof Error ? error.message : 'Failed to load snapshot',
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [api, selectedTick]);

    return (
        <div className={styles['root']} data-testid="snapshot-panel">
            {state.kind === 'idle' && (
                <Caption tone="muted">Select a tick to inspect its snapshot.</Caption>
            )}

            {state.kind === 'loading' && <Spinner label="Loading snapshot" />}

            {state.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {state.message}
                </p>
            )}

            {state.kind === 'ready' && (
                <>
                    <Caption tone="muted">{`Tick ${state.tick} — full truth, no projection applied.`}</Caption>
                    <ScrollArea aria-label="Snapshot tree" className={styles['scroll']}>
                        <JsonTree label="snapshot" value={state.snapshot} />
                    </ScrollArea>
                </>
            )}
        </div>
    );
}
