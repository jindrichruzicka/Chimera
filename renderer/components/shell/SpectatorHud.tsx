'use client';

/**
 * renderer/components/shell/SpectatorHud.tsx
 *
 * Read-only spectator overlay (Invariant #114). When the local session is a
 * spectator, it names the followed seat and offers a switch affordance plus a
 * hotkey that cycles the followed seat through the out-of-band spectate IPC
 * (Invariant #115 — never an EngineAction). Self-gates to `null` for players.
 *
 * Rules:
 *  - 'use client' — renderer component.
 *  - useInputAction / useInputManager are called unconditionally, before any
 *    early return (React hooks rules).
 *  - The followed player's display name is read from the lobby roster
 *    (profile-sourced), never from the snapshot (Invariant #62). The seated set
 *    to cycle through IS the live snapshot (ids only).
 *  - All visual values use var(--ch-*) design tokens (Invariants #86/#91).
 */

import React, { useCallback, useMemo } from 'react';

import type { PlayerId } from '@chimera-engine/simulation/bridge/api-types.js';
import { SPECTATE_KEYS } from '../../i18n/engine-keys.js';
import { useTranslate } from '../../i18n/useTranslate.js';
import type { InputEvent } from '../../input/InputAction.js';
import type { KeyBinding } from '../../input/InputBindingSchema.js';
import { useInputManager } from '../../input/InputManagerContext.js';
import { useInputAction } from '../../input/useInputAction.js';
import { useGameStore } from '../../state/gameStore.js';
import { useLobbyStore } from '../../state/lobbyStore.js';
import { useIsSpectator } from '../../state/lobbyUiStore.js';
import { Button } from '../ui/Button.js';

/** Human label for a binding (mirrors the Controls settings formatting). */
function formatBinding(binding: KeyBinding | undefined): string {
    if (binding === undefined) {
        return '';
    }
    const modifiers = (binding.modifiers ?? []).map((modifier) => `${modifier}+`).join('');
    return `${modifiers}${binding.primary}`;
}

/**
 * Ask the host to follow `targetPlayerId`. Fire-and-forget and out-of-band
 * (Invariant #115): the switch is observed via the next projected snapshot, not
 * a return value. A non-seated / unknown target is ignored host-side.
 */
function requestFollow(targetPlayerId: PlayerId): void {
    window.__chimera?.spectate?.setFollowedTarget(targetPlayerId);
}

export function SpectatorHud(): React.ReactElement | null {
    const t = useTranslate();
    const isSpectator = useIsSpectator();
    // Narrow selectors: `viewerId` is the followed seat; `players` is the live
    // seated set (stable ref per snapshot) used to compute the next target.
    const followedId = useGameStore((state) => state.snapshot?.viewerId ?? null);
    const players = useGameStore((state) => state.snapshot?.players ?? null);
    // Roster is profile-sourced (not the snapshot) — the display-name source
    // per Invariant #62. Stable ref until the lobby state changes.
    const roster = useLobbyStore((state) => state.lobbyState?.players ?? null);
    const inputManager = useInputManager();

    const seatedIds = useMemo<readonly PlayerId[]>(
        () => (players === null ? [] : (Object.keys(players) as PlayerId[])),
        [players],
    );

    const cycleFollowedSeat = useCallback((): void => {
        // The hotkey subscription is live for players too (hooks run before the
        // early return), so gate on the role: only a spectator may re-point.
        if (!isSpectator || followedId === null || seatedIds.length === 0) {
            return;
        }
        const currentIndex = seatedIds.indexOf(followedId);
        const next = seatedIds[(currentIndex + 1) % seatedIds.length];
        if (next !== undefined) {
            requestFollow(next);
        }
    }, [isSpectator, followedId, seatedIds]);

    // oneShot engine hotkey: act on key-down only — the InputManager also
    // dispatches the key-up, which must not double-fire the switch.
    const handleCycleKey = useCallback(
        (event: InputEvent): void => {
            if (!event.pressed) {
                return;
            }
            cycleFollowedSeat();
        },
        [cycleFollowedSeat],
    );

    useInputAction('engine:spectate-cycle', handleCycleKey);

    if (!isSpectator || followedId === null) {
        return null;
    }

    const followedName =
        roster?.find((entry) => entry.playerId === followedId)?.displayName ?? followedId;
    const keyLabel = formatBinding(inputManager.getBinding('engine:spectate-cycle'));

    const overlayStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: 'var(--ch-space-md)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--ch-z-tooltip)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--ch-space-md)',
        background: 'var(--ch-color-surface-overlay)',
        border: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
        borderRadius: 'var(--ch-radius-md)',
        padding: 'var(--ch-space-sm) var(--ch-space-md)',
        fontFamily: 'var(--ch-font-ui)',
        fontSize: 'var(--ch-font-size-sm)',
        color: 'var(--ch-color-text-primary)',
        boxShadow: 'var(--ch-shadow-md)',
        userSelect: 'none',
    };

    return (
        <div data-testid="spectator-hud" role="status" style={overlayStyle}>
            <span data-testid="spectator-following">
                {t(SPECTATE_KEYS.following, { name: followedName })}
            </span>
            <Button
                data-testid="spectator-switch"
                variant="secondary"
                size="sm"
                onClick={cycleFollowedSeat}
                aria-label={t(SPECTATE_KEYS.switchAction)}
            >
                {t(SPECTATE_KEYS.switchAction)}
            </Button>
            <span data-testid="spectator-hint" style={{ color: 'var(--ch-color-text-secondary)' }}>
                {t(SPECTATE_KEYS.switchHint, { key: keyLabel })}
            </span>
        </div>
    );
}
