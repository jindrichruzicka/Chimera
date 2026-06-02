'use client';

// renderer/components/shell/RootErrorBoundary.tsx
//
// React class-based error boundary (§4.27). On catch:
//   1. Renders <CrashFallback /> with crash ID, "Return to Main Menu",
//      and "Restart Application" buttons.
//   2. "Restart Application" calls globalThis.__chimera?.system.relaunch().
//
// ToastHost MUST be mounted as a SIBLING, not a child — see §4.27
// shell-root mount ordering.

import React from 'react';
import { emitRendererError } from '../../logging/rendererLogger';

// ── types ──────────────────────────────────────────────────────────────────────

interface State {
    readonly hasError: boolean;
    readonly crashId: string;
}

interface Props {
    readonly children: React.ReactNode;
}

// ── CrashFallback ──────────────────────────────────────────────────────────────

interface CrashFallbackProps {
    readonly crashId: string;
    readonly onReturnToMenu: () => void;
    readonly onRestart: () => void;
}

function CrashFallback({
    crashId,
    onReturnToMenu,
    onRestart,
}: CrashFallbackProps): React.ReactElement {
    return (
        <div role="alert" aria-live="assertive">
            <h1>An unexpected error occurred.</h1>
            <p>Crash ID: {crashId}</p>
            <button type="button" onClick={onReturnToMenu}>
                Return to Main Menu
            </button>
            <button type="button" onClick={onRestart}>
                Restart Application
            </button>
        </div>
    );
}

// ── RootErrorBoundary ──────────────────────────────────────────────────────────

export class RootErrorBoundary extends React.Component<Props, State> {
    public constructor(props: Props) {
        super(props);
        this.state = { hasError: false, crashId: '' };
    }

    public static getDerivedStateFromError(_error: unknown): State {
        // Use the same ISO timestamp format as the crash dump filename
        // (crash-reporter.ts: crash-${isoTimestamp}.json) so the UI crash ID
        // can be correlated with a dump file on disk.
        const isoTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const crashId = `crash-${isoTimestamp}`;
        return { hasError: true, crashId };
    }

    public override componentDidCatch(error: Error, info: React.ErrorInfo): void {
        const logsApi = (
            globalThis as Record<string, unknown> & {
                __chimera?: { logs?: Parameters<typeof emitRendererError>[0] };
            }
        ).__chimera?.logs;
        emitRendererError(
            logsApi,
            '[RootErrorBoundary] Uncaught error in React tree',
            error,
            { componentStack: info.componentStack },
            'RootErrorBoundary',
        );
    }

    private handleReturnToMenu = (): void => {
        // Navigate to root so React re-renders from a clean tree. Simply
        // setting hasError:false re-renders the broken subtree and immediately
        // re-throws. window.location.replace avoids a history entry so the
        // user cannot navigate "back" to the broken page (F18/§4.19 will
        // replace this with a proper router call).
        window.location.replace('/');
    };

    private handleRestart = (): void => {
        (
            globalThis as Record<string, unknown> & {
                __chimera?: { system?: { relaunch?: () => void } };
            }
        ).__chimera?.system?.relaunch?.();
    };

    public override render(): React.ReactNode {
        if (this.state.hasError) {
            return (
                <CrashFallback
                    crashId={this.state.crashId}
                    onReturnToMenu={this.handleReturnToMenu}
                    onRestart={this.handleRestart}
                />
            );
        }
        return this.props.children;
    }
}
