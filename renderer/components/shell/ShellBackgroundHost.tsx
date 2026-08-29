'use client';

import React from 'react';
import type { ComponentType } from 'react';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import { GameAssetSession } from '../../app/gameAssetSession';
import { useShellState } from '../../shell/shellStateStore';
import { useShellBackgroundPayload } from '../../shell/useShellBackgroundPayload';

let nextShellBackgroundInstanceId = 1;

const hostStyle = {
    position: 'fixed',
    inset: 'var(--ch-space-none)',
    zIndex: 'var(--ch-z-base)',
    pointerEvents: 'none',
    overflow: 'hidden',
    backgroundColor: 'var(--ch-color-surface)',
} satisfies React.CSSProperties;

/**
 * The host under the interactive opt-in. One property differs, and the aria
 * attribute the caller drops alongside it is the other half of the same flip:
 * a region that takes pointer input must not be hidden from assistive tech.
 */
const interactiveHostStyle = {
    ...hostStyle,
    pointerEvents: 'auto',
} satisfies React.CSSProperties;

/**
 * The shell background mount (§4.37.9).
 *
 * It classifies nothing: `ShellStateBridge` publishes the surface and the game
 * context on the shell-state store, and this component decides on those two
 * alone (§4.37.18). Mounting on a set of SURFACES — the three engine screens
 * plus every game-declared page — is what keeps ONE pinned background instance
 * alive across `/main-menu → /<game page> → /settings`.
 */
export function ShellBackgroundHost(): React.ReactElement | null {
    const gameId = useShellState((state) => state.gameId);
    const instanceIdRef = React.useRef(String(nextShellBackgroundInstanceId++));
    const { Background, assets, isInteractive, isShellBackgroundSurface, isForThisContext } =
        useShellBackgroundPayload();

    if (!isShellBackgroundSurface) {
        return null;
    }

    // With a game in context, nothing is painted until that game's payload has
    // landed: an engine default drawn here would flash before the game's own
    // background replaced it a frame later.
    if (gameId !== null && !isForThisContext) {
        return null;
    }

    const backgroundKind = Background === null ? 'engine-default' : 'game';

    return (
        <div
            data-testid="shell-background"
            data-shell-background-kind={backgroundKind}
            data-shell-background-instance-id={instanceIdRef.current}
            data-shell-game-id={gameId ?? undefined}
            style={isInteractive ? interactiveHostStyle : hostStyle}
            {...(isInteractive ? {} : { 'aria-hidden': 'true' as const })}
        >
            {renderBackground(Background, assets)}
        </div>
    );
}

/**
 * The background subtree, with the game's asset session around it when the
 * shell payload declared one (§4.10).
 *
 * `GameAssetSession` is REUSED rather than re-implemented: it already owns the
 * one-effect allocate → preload → abandon → dispose lifecycle a manager with no
 * `GameShell` above it needs — the disposal and the commit-phase allocation are
 * Invariant #21's, the critical preload and its abandon are §4.10's — and it
 * already declines to register the app-level `SetGameAssetManagerContext`
 * delegate. A second session hook written for this mount would be a second
 * place to get all of it wrong.
 *
 * The session sits INSIDE the host element rather than around it, so the plate
 * — the fixed, surface-coloured layer the host is — lands on the commit its
 * payload lands on. The cost is that a declared background's own DOM arrives
 * one commit later than the plate, because the session renders `null` until
 * its manager is committed.
 *
 * A declared manifest with NO background component builds nothing: a session
 * publishes to a subtree, and there is none.
 */
function renderBackground(
    Background: ComponentType | null,
    assets: AssetManifest | null,
): React.ReactNode {
    if (Background === null) {
        return null;
    }
    if (assets === null) {
        return <Background />;
    }
    return (
        <GameAssetSession assetManifest={assets}>
            <Background />
        </GameAssetSession>
    );
}
