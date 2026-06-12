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
 * The selected tick is shared across all panels; it is seeded to the
 * newest tick from the Action Log backfill and re-pointed by
 * double-clicking a log row. `Tabs` keeps every panel mounted (hidden,
 * not unmounted), so the Performance panel's live subscription survives
 * tab switches.
 *
 * The page is height-constrained to the viewport (no document scrollbar):
 * the Tabs flex-fill it, the active tabpanel takes the remaining height,
 * and each panel's own scroll region stretches to the window bottom.
 *
 * Engine shell page: imports no `games/*` or `electron/` runtime modules
 * (Invariants #94/#1); design tokens only (Invariant #91).
 */

import React, { useCallback, useEffect, useState } from 'react';
import type {
    ActionHistoryEntry,
    ChimeraDebugApi,
} from '@chimera/electron/preload/debug-api-types.js';
import { getDebugBridge } from '../../bridge/debug-bridge';
import { ActionLogPanel } from '../../components/debug/ActionLogPanel';
import { DiffViewPanel } from '../../components/debug/DiffViewPanel';
import { PerformancePanel } from '../../components/debug/PerformancePanel';
import { ProjectionExplorerPanel } from '../../components/debug/ProjectionExplorerPanel';
import { Caption, Tabs } from '../../components/ui';

type BridgeState =
    | { readonly kind: 'pending' }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'ready'; readonly api: ChimeraDebugApi };

const pageStyle: React.CSSProperties = {
    blockSize: '100vh',
    boxSizing: 'border-box',
    color: 'var(--ch-color-text-primary)',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--ch-font-ui)',
    gap: 'var(--ch-space-md)',
    overflow: 'hidden',
    padding: 'var(--ch-space-md)',
};

const tabsStyle: React.CSSProperties = {
    flex: '1 1 auto',
    minBlockSize: 0,
};

export default function DebugInspectorPage(): React.ReactElement {
    const [bridge, setBridge] = useState<BridgeState>({ kind: 'pending' });
    const [selectedTick, setSelectedTick] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState('actions');

    useEffect(() => {
        const api = getDebugBridge();
        setBridge(api ? { kind: 'ready', api } : { kind: 'unavailable' });
    }, []);

    // Default the shared selection to the state the newest logged action
    // produced, once; a functional update keeps this race-free against an
    // earlier user click. The log records pre-action ticks, so the newest
    // resolvable state is tickApplied + 1 — the pre-action tick of the very
    // first action is never captured by the post-action ring buffer.
    const handleEntriesLoaded = useCallback((entries: readonly ActionHistoryEntry[]) => {
        const newest = entries[entries.length - 1];
        setSelectedTick((prev) => prev ?? (newest === undefined ? null : newest.tickApplied + 1));
    }, []);

    // Double-click in the Action Log → jump to the Snapshot tab at that tick.
    const handleNavigateToSnapshot = useCallback((tick: number) => {
        setSelectedTick(tick);
        setActiveTab('snapshot');
    }, []);

    return (
        <main data-testid="debug-inspector-page" style={pageStyle}>
            {bridge.kind === 'pending' && <Caption tone="muted">Connecting…</Caption>}

            {bridge.kind === 'unavailable' && (
                <Caption tone="muted">
                    Inspector bridge unavailable — this page only works inside the Inspector window
                    (toggle it with F9 in a debug-mode session).
                </Caption>
            )}

            {bridge.kind === 'ready' && (
                <Tabs
                    activeTabId={activeTab}
                    ariaLabel="Inspector panels"
                    onActiveTabChange={setActiveTab}
                    style={tabsStyle}
                    tabs={[
                        {
                            id: 'actions',
                            label: 'Action Log',
                            panel: (
                                <ActionLogPanel
                                    api={bridge.api}
                                    onEntriesLoaded={handleEntriesLoaded}
                                    onNavigateToSnapshot={handleNavigateToSnapshot}
                                    selectedTick={selectedTick}
                                />
                            ),
                        },
                        {
                            id: 'snapshot',
                            label: 'Snapshot',
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
