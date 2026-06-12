'use client';

// renderer/components/debug/ProjectionExplorerPanel.tsx
//
// Inspector Projection Explorer (§4.12 — Runtime Debug Layer, F47 T9, #698).
// Side-by-side view of the full debug-truth snapshot and the projection one
// player would receive at the selected tick, with the fields the projection
// hides, masks, or derives highlighted in both trees. Both payloads are
// treated as opaque JSON values — the simulation snapshot type is never
// named in the renderer (invariant check 6).

import React, { useEffect, useMemo, useState } from 'react';
import { playerId } from '@chimera/electron/preload/api-types.js';
import type { ChimeraDebugApi } from '@chimera/electron/preload/debug-api-types.js';
import { Badge } from '../ui/Badge';
import { Caption } from '../ui/Caption';
import { ScrollArea } from '../ui/ScrollArea';
import { Select } from '../ui/Select';
import { Spinner } from '../ui/Spinner';
import { JsonTree } from './JsonTree';
import { computeProjectionDiff } from './projectionDiff';
import styles from './ProjectionExplorerPanel.module.css';

export interface ProjectionExplorerPanelProps {
    readonly api: ChimeraDebugApi;
    readonly selectedTick: number | null;
}

type FullState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | {
          readonly kind: 'ready';
          readonly tick: number;
          readonly snapshot: unknown;
          readonly playerIds: readonly string[];
      }
    | { readonly kind: 'error'; readonly message: string };

type ProjectionState =
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly viewer: string; readonly snapshot: unknown }
    | { readonly kind: 'error'; readonly message: string };

/**
 * Player ids from an opaque snapshot value: keys of a `players` record.
 *
 * This is a shape heuristic, not a contract — if the snapshot ever stops
 * exposing a root `players` record, the panel degrades to its "no players"
 * message with no other signal. The durable fix is a `listPlayers`-style
 * query in the debug protocol (deferred follow-up to F47 T9, #698).
 */
function extractPlayerIds(snapshot: unknown): readonly string[] {
    if (typeof snapshot !== 'object' || snapshot === null) {
        return [];
    }
    const players = (snapshot as Record<string, unknown>)['players'];
    if (typeof players !== 'object' || players === null || Array.isArray(players)) {
        return [];
    }
    return Object.keys(players);
}

export function ProjectionExplorerPanel({
    api,
    selectedTick,
}: ProjectionExplorerPanelProps): React.ReactElement {
    const [full, setFull] = useState<FullState>({ kind: 'idle' });
    const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
    const [projection, setProjection] = useState<ProjectionState>({ kind: 'idle' });

    useEffect(() => {
        if (selectedTick === null) {
            setFull({ kind: 'idle' });
            return undefined;
        }

        let active = true;
        setFull({ kind: 'loading' });
        api.getSnapshot(selectedTick)
            .then((result) => {
                if (!active) {
                    return;
                }
                const playerIds = extractPlayerIds(result.snapshot);
                setFull({ kind: 'ready', tick: result.tick, snapshot: result.snapshot, playerIds });
                setSelectedPlayer((prev) =>
                    prev !== null && playerIds.includes(prev) ? prev : (playerIds[0] ?? null),
                );
            })
            .catch((error: unknown) => {
                if (active) {
                    setFull({
                        kind: 'error',
                        message: error instanceof Error ? error.message : 'Failed to load snapshot',
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [api, selectedTick]);

    const fullTick = full.kind === 'ready' ? full.tick : null;

    useEffect(() => {
        if (fullTick === null || selectedPlayer === null) {
            setProjection({ kind: 'idle' });
            return undefined;
        }

        let active = true;
        setProjection({ kind: 'loading' });
        api.getProjection(fullTick, playerId(selectedPlayer))
            .then((result) => {
                if (active) {
                    setProjection({
                        kind: 'ready',
                        viewer: selectedPlayer,
                        snapshot: result.snapshot,
                    });
                }
            })
            .catch((error: unknown) => {
                if (active) {
                    setProjection({
                        kind: 'error',
                        message:
                            error instanceof Error ? error.message : 'Failed to load projection',
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [api, fullTick, selectedPlayer]);

    const diff = useMemo(
        () =>
            full.kind === 'ready' && projection.kind === 'ready'
                ? computeProjectionDiff(full.snapshot, projection.snapshot)
                : null,
        [full, projection],
    );

    return (
        <div className={styles['root']} data-testid="projection-panel">
            {full.kind === 'idle' && (
                <Caption tone="muted">Select a tick to explore its projection.</Caption>
            )}

            {full.kind === 'loading' && <Spinner label="Loading full snapshot" />}

            {full.kind === 'error' && (
                <p className={styles['error']} role="alert">
                    {full.message}
                </p>
            )}

            {full.kind === 'ready' && full.playerIds.length === 0 && (
                <Caption tone="muted">No players in this snapshot to project.</Caption>
            )}

            {full.kind === 'ready' && full.playerIds.length > 0 && (
                <>
                    <div className={styles['controls']}>
                        <Select
                            label="Player"
                            onValueChange={setSelectedPlayer}
                            options={full.playerIds.map((id) => ({ label: id, value: id }))}
                            value={selectedPlayer ?? ''}
                        />
                        <div aria-hidden="true" className={styles['legend']}>
                            <Badge variant="error">hidden</Badge>
                            <Badge variant="warning">masked</Badge>
                            <Badge variant="success">projection-only</Badge>
                        </div>
                    </div>

                    <div className={styles['columns']}>
                        <section className={styles['column']}>
                            <Caption tone="muted">
                                {`Full snapshot (debug truth) — tick ${full.tick}`}
                            </Caption>
                            <ScrollArea
                                aria-label="Full snapshot tree"
                                className={styles['scroll']}
                            >
                                <JsonTree
                                    defaultExpandedDepth={2}
                                    highlights={diff?.fullHighlights}
                                    label="full"
                                    value={full.snapshot}
                                />
                            </ScrollArea>
                        </section>

                        <section className={styles['column']}>
                            {projection.kind === 'loading' && (
                                <Spinner label="Loading projection" />
                            )}

                            {projection.kind === 'error' && (
                                <p className={styles['error']} role="alert">
                                    {projection.message}
                                </p>
                            )}

                            {projection.kind === 'ready' && (
                                <>
                                    <Caption tone="muted">
                                        {`Projection for ${projection.viewer}`}
                                    </Caption>
                                    <ScrollArea
                                        aria-label="Projection tree"
                                        className={styles['scroll']}
                                    >
                                        <JsonTree
                                            defaultExpandedDepth={2}
                                            highlights={diff?.projectionHighlights}
                                            label="projection"
                                            value={projection.snapshot}
                                        />
                                    </ScrollArea>
                                </>
                            )}
                        </section>
                    </div>
                </>
            )}
        </div>
    );
}
