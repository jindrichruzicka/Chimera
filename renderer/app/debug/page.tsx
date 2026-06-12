'use client';

/**
 * renderer/app/debug/page.tsx — Debug Inspector window (§4.12, F47 / T8, #697).
 *
 * Served at `chimera://localhost/debug/` inside the Inspector
 * `BrowserWindow` that `electron/main/debug-bridge.ts` opens on F9. All
 * data flows through `window.__chimeraDebug` (Invariant #28 — this page
 * never reads `window.__chimera`), resolved through the prerender-safe
 * `getDebugBridge()` accessor in a mount effect so the static-export pass
 * (no `window`) and first client render agree.
 *
 * The selected tick is shared across all panels; live mode follows the
 * newest tick in the Timeline and pauses when the user scrolls away or
 * picks a row. `Tabs` keeps every panel mounted (hidden, not unmounted),
 * so the Timeline's live subscription survives tab switches.
 *
 * Engine shell page: imports no `games/*` or `electron/` runtime modules
 * (Invariants #94/#1); design tokens only (Invariant #91).
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { ChimeraDebugApi, TickEntry } from '@chimera/electron/preload/debug-api-types.js';
import { getDebugBridge } from '../../bridge/debug-bridge';
import { ActionLogPanel } from '../../components/debug/ActionLogPanel';
import { DiffViewPanel } from '../../components/debug/DiffViewPanel';
import { PerformancePanel } from '../../components/debug/PerformancePanel';
import { ProjectionExplorerPanel } from '../../components/debug/ProjectionExplorerPanel';
import { SnapshotInspectorPanel } from '../../components/debug/SnapshotInspectorPanel';
import { TimelinePanel } from '../../components/debug/TimelinePanel';
import { Caption, Heading, Tabs } from '../../components/ui';

type BridgeState =
    | { readonly kind: 'pending' }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'ready'; readonly api: ChimeraDebugApi };

const pageStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-primary)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--ch-font-ui)',
    gap: 'var(--ch-space-md)',
    minBlockSize: '100vh',
    padding: 'var(--ch-space-md)',
};

export default function DebugInspectorPage(): React.ReactElement {
    const [bridge, setBridge] = useState<BridgeState>({ kind: 'pending' });
    const [selectedTick, setSelectedTick] = useState<number | null>(null);
    const [liveMode, setLiveMode] = useState(true);

    useEffect(() => {
        const api = getDebugBridge();
        setBridge(api ? { kind: 'ready', api } : { kind: 'unavailable' });
    }, []);

    // Default the shared selection to the newest backfilled tick, once; a
    // functional update keeps this race-free against an earlier user click.
    const handleTicksLoaded = useCallback((ticks: readonly TickEntry[]) => {
        setSelectedTick((prev) => prev ?? ticks[ticks.length - 1]?.tick ?? null);
    }, []);

    return (
        <main data-testid="debug-inspector-page" style={pageStyle}>
            <Heading level={1} size="lg">
                Debug Inspector
            </Heading>

            {bridge.kind === 'pending' && <Caption tone="muted">Connecting…</Caption>}

            {bridge.kind === 'unavailable' && (
                <Caption tone="muted">
                    Inspector bridge unavailable — this page only works inside the Inspector window
                    (toggle it with F9 in a debug-mode session).
                </Caption>
            )}

            {bridge.kind === 'ready' && (
                <Tabs
                    ariaLabel="Inspector panels"
                    tabs={[
                        {
                            id: 'timeline',
                            label: 'Timeline',
                            panel: (
                                <TimelinePanel
                                    api={bridge.api}
                                    liveMode={liveMode}
                                    onLiveModeChange={setLiveMode}
                                    onSelectTick={setSelectedTick}
                                    onTicksLoaded={handleTicksLoaded}
                                    selectedTick={selectedTick}
                                />
                            ),
                        },
                        {
                            id: 'snapshot',
                            label: 'Snapshot',
                            panel: (
                                <SnapshotInspectorPanel
                                    api={bridge.api}
                                    selectedTick={selectedTick}
                                />
                            ),
                        },
                        {
                            id: 'actions',
                            label: 'Action Log',
                            panel: <ActionLogPanel api={bridge.api} selectedTick={selectedTick} />,
                        },
                        {
                            id: 'projection',
                            label: 'Projection',
                            panel: (
                                <ProjectionExplorerPanel
                                    api={bridge.api}
                                    selectedTick={selectedTick}
                                />
                            ),
                        },
                        {
                            id: 'diff',
                            label: 'Diff',
                            panel: <DiffViewPanel api={bridge.api} selectedTick={selectedTick} />,
                        },
                        {
                            id: 'performance',
                            label: 'Performance',
                            panel: <PerformancePanel api={bridge.api} />,
                        },
                    ]}
                />
            )}
        </main>
    );
}
