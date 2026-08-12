'use client';

// renderer/components/scene/SceneLoadingFallback.tsx
//
// The loading cover (§4.36): what the engine renders in place of a screen that
// is not mountable yet. Resolves the registry cascade
// (`loadingScreens[key] ?? loadingScreen`), narrows the declared form, and
// renders it — with the default staying exactly what it has always been, an
// empty `scene-screen-loading` div, so a game declaring no slot is unchanged
// (Invariant #81).
//
// A game-supplied cover is wrapped in BOTH its own Suspense boundary and an
// error boundary. At the `SceneRouter` site this renders inside a Suspense
// fallback, where a suspension bubbles to GameShell's outer `fallback={null}`
// and blanks the whole scene; at every site a throw would escalate a missing
// cover into a missing game.

import React from 'react';
import type {
    GameScreenRegistry,
    SceneLoadingReason,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { emitRendererError, readRendererLogsApi } from '../../logging/rendererLogger';
import { EngineLoadingPreset } from './EngineLoadingPreset';
import { resolveLoadingScreen } from './resolveLoadingScreen';

export interface SceneLoadingFallbackProps {
    /** The active game's screen registry — the sole coupling point (Invariant #80). */
    readonly registry: GameScreenRegistry;
    /** Screen key being waited for; the key the cascade resolves. */
    readonly screenKey: string;
    /** Scene the cover is shown inside, as carried on the snapshot. */
    readonly sceneId: string;
    /**
     * Which wait this cover stands in for. REPORTED by the call site, not proven:
     * React never says why it suspended. When an asset preload and a chunk load
     * are both outstanding, `'assets'` wins — it is the wait the engine measures,
     * so it is the one a cover can render a fraction for.
     */
    readonly reason: SceneLoadingReason;
    /** Fraction in `[0, 1]` of the wait that has settled, or `null` when unmeasured. */
    readonly progress: number | null;
}

export function SceneLoadingFallback({
    registry,
    screenKey,
    sceneId,
    reason,
    progress,
}: SceneLoadingFallbackProps): React.ReactElement {
    const cover = resolveLoadingScreen(registry, screenKey);

    if (cover === undefined || cover === 'none') {
        return <DefaultLoadingCover />;
    }
    // NARROWING ORDER is load-bearing, and inline so the COMPILER proves it
    // rather than a hand-written type predicate asserting it: `React.lazy`
    // returns an OBJECT, so a `typeof cover === 'function'` test for "is it a
    // component" sends every lazy cover down a static-form branch. String
    // sentinels first, then each static form by its own field — what is left is
    // a component.
    if (typeof cover === 'string' || 'message' in cover || 'image' in cover) {
        return <EngineLoadingPreset preset={cover} progress={progress} />;
    }

    const Cover = cover;
    return (
        <LoadingCoverBoundary>
            <React.Suspense fallback={<DefaultLoadingCover />}>
                <Cover
                    screenKey={screenKey}
                    sceneId={sceneId}
                    reason={reason}
                    progress={progress}
                />
            </React.Suspense>
        </LoadingCoverBoundary>
    );
}

/**
 * The unchanged engine default. Kept as the `scene-screen-loading` testid rather
 * than renamed: it is the one handle a test has on "what showed was the default".
 */
function DefaultLoadingCover(): React.ReactElement {
    return <div data-testid="scene-screen-loading" />;
}

interface LoadingCoverBoundaryProps {
    readonly children: React.ReactNode;
}

interface LoadingCoverBoundaryState {
    readonly hasError: boolean;
}

/**
 * Degrades a throwing game cover to the engine default and reports it once.
 *
 * Scoped to the cover alone rather than relying on `RootErrorBoundary`: a cover
 * is cosmetic, so its failure must cost the cover, never the match. The report
 * goes through the logs bridge so a swallowed cover still leaves a trace.
 */
class LoadingCoverBoundary extends React.Component<
    LoadingCoverBoundaryProps,
    LoadingCoverBoundaryState
> {
    public constructor(props: LoadingCoverBoundaryProps) {
        super(props);
        this.state = { hasError: false };
    }

    public static getDerivedStateFromError(_error: unknown): LoadingCoverBoundaryState {
        return { hasError: true };
    }

    public override componentDidCatch(error: Error, info: React.ErrorInfo): void {
        emitRendererError(
            readRendererLogsApi(),
            '[SceneLoadingFallback] game loading cover threw; showing the engine default cover',
            error,
            { componentStack: info.componentStack },
            'SceneLoadingFallback',
        );
    }

    public override render(): React.ReactNode {
        if (this.state.hasError) {
            return <DefaultLoadingCover />;
        }
        return this.props.children;
    }
}
