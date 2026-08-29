'use client';

// renderer/components/shell/RootErrorBoundary.tsx
//
// React class-based error boundary (§4.27). On catch, unordered — the fallback
// is already committed to the DOM by the time componentDidCatch runs:
//   • Renders <CrashFallback /> with crash ID, "Return to Main Menu",
//     and "Restart Application" buttons.
//   • Forwards the error through emitRendererError().
//   • Clears the nearest screen fade, so the fallback is not left painted
//     under an opaque scrim.
// "Restart Application" calls the preload system bridge's relaunch().
//
// ToastHost MUST be mounted as a SIBLING, not a child — see §4.27
// shell-root mount ordering.

import React from 'react';
import { CRASH_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger';
import { FadeContext } from './FadeContext';

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
    // CrashFallback is a function component, so useTranslate() is legal here (the
    // boundary class below must not call hooks). In production AppShell mounts the
    // i18n provider above the boundary, so the fallback resolves after a catch.
    const t = useTranslate();
    return (
        // Stated, not inherited. `pointer-events` inherits, and the app-level
        // `ShellContentLayer` sets it to `none` for the whole frame while a
        // game's shell background is interactive (§4.37.9) — this fallback is a
        // direct child of that frame, and a player who crashes there must still
        // be able to reach a way out.
        <div role="alert" aria-live="assertive" style={{ pointerEvents: 'auto' }}>
            <h1>{t(CRASH_KEYS.heading)}</h1>
            <p>{t(CRASH_KEYS.crashId, { crashId })}</p>
            <button type="button" onClick={onReturnToMenu}>
                {t(CRASH_KEYS.returnToMenu)}
            </button>
            <button type="button" onClick={onRestart}>
                {t(CRASH_KEYS.restart)}
            </button>
        </div>
    );
}

// ── RootErrorBoundary ──────────────────────────────────────────────────────────

export class RootErrorBoundary extends React.Component<Props, State> {
    /**
     * The nearest screen fade, reached through legacy `contextType` because a
     * class component cannot call hooks. `null` when no `FadeProvider` sits
     * above — see the read in `componentDidCatch`.
     */
    public static override contextType = FadeContext;

    declare public context: React.ContextType<typeof FadeContext>;

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
        const logsApi = readRendererLogsApi();
        emitRendererError(
            logsApi,
            '[RootErrorBoundary] Uncaught error in React tree',
            error,
            { componentStack: info.componentStack },
            'RootErrorBoundary',
        );

        // Clear the screen fade, or a crash caught mid-hop leaves the fallback
        // painted under an opaque black scrim. Zero duration, not the default
        // 300 ms: a crashed app must be readable in this commit, not after an
        // animation. Optional because the boundary must survive with no
        // provider above it — a throw here escapes the boundary and blanks the
        // app, which is the failure this repairs, not a second copy of it.
        void this.context?.fadeIn(0);
    }

    private handleReturnToMenu = (): void => {
        // Navigate to root so React re-renders from a clean tree. Simply
        // setting hasError:false re-renders the broken subtree and immediately
        // re-throws. window.location.replace avoids a history entry so the
        // user cannot navigate "back" to the broken page.
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
