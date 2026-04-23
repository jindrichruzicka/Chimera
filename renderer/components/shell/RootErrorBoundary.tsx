// renderer/components/shell/RootErrorBoundary.tsx
//
// React class-based error boundary (§4.27). On catch:
//   1. Renders <CrashFallback /> with crash ID, "Return to Main Menu",
//      and "Restart Application" buttons.
//   2. "Restart Application" calls globalThis.__chimera?.system.quit().
//
// ToastHost MUST be mounted as a SIBLING, not a child — see §4.27
// shell-root mount ordering.

import React from 'react';

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
        const crashId = `crash-${Date.now().toString(36)}`;
        return { hasError: true, crashId };
    }

    public override componentDidCatch(error: Error, info: React.ErrorInfo): void {
        // Forward to console so the renderer logger hooks pick it up
        console.error(
            '[RootErrorBoundary] Uncaught error in React tree',
            error,
            info.componentStack,
        );
    }

    private handleReturnToMenu = (): void => {
        this.setState({ hasError: false, crashId: '' });
    };

    private handleRestart = (): void => {
        (
            globalThis as Record<string, unknown> & {
                __chimera?: { system?: { quit?: () => void } };
            }
        ).__chimera?.system?.quit?.();
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
