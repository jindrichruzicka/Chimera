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
import { IconButton } from '../ui/IconButton.js';
import { Icon } from '../ui/icons/index.js';

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
    const hintText = t(SPECTATE_KEYS.switchHint, { key: keyLabel });

    return (
        <div data-testid="spectator-hud" role="status" style={capsuleStyle}>
            <span aria-hidden="true" style={eyeStyle}>
                <Icon name="eye" />
            </span>
            <span style={modeLabelStyle}>{t(SPECTATE_KEYS.modeLabel)}</span>
            <span data-testid="spectator-following" style={nameStyle} title={followedName}>
                {followedName}
            </span>
            <span aria-hidden="true" style={dividerStyle} />
            <IconButton
                data-testid="spectator-switch"
                variant="ghost"
                onClick={cycleFollowedSeat}
                aria-label={t(SPECTATE_KEYS.switchAction)}
                aria-keyshortcuts={keyLabel}
                title={t(SPECTATE_KEYS.switchAction)}
            >
                <Icon name="swap" />
            </IconButton>
            <kbd
                data-testid="spectator-hint"
                aria-label={hintText}
                title={hintText}
                style={keycapStyle}
            >
                {keyLabel}
            </kbd>
        </div>
    );
}

// ── Styles — a slim top-center "broadcast" capsule, every value a --ch-* token
// (Invariants #86/#91). Top placement cedes the bottom edge to the game's own
// HUD bar, so the two never collide. Height = the 36px IconButton + 2×space-xs.

const capsuleStyle: React.CSSProperties = {
    position: 'fixed',
    top: 'var(--ch-space-md)',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 'var(--ch-z-tooltip)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--ch-space-sm)',
    background: 'var(--ch-color-surface-overlay)',
    // A seam, not a frame: the muted border keeps the pill quiet; a themed game
    // retints it through the same token.
    border: 'var(--ch-border-width-sm) solid var(--ch-color-border-muted)',
    borderRadius: 'var(--ch-radius-pill)',
    padding: 'var(--ch-space-xs) var(--ch-space-xs) var(--ch-space-xs) var(--ch-space-md)',
    fontFamily: 'var(--ch-font-ui)',
    fontSize: 'var(--ch-font-size-sm)',
    color: 'var(--ch-color-text-primary)',
    boxShadow: 'var(--ch-shadow-sm)',
    userSelect: 'none',
};

// The Icon fills from currentColor, so the wrapper's colour token tones the glyph.
const eyeStyle: React.CSSProperties = {
    display: 'inline-flex',
    color: 'var(--ch-color-text-secondary)',
    flex: 'none',
};

// Uppercased via CSS so the translated string keeps its own casing rules.
const modeLabelStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-secondary)',
    fontSize: 'var(--ch-font-size-sm)',
    fontWeight: 'var(--ch-font-weight-semibold)',
    textTransform: 'uppercase',
    lineHeight: 'var(--ch-line-height-none)',
    whiteSpace: 'nowrap',
};

// The one prominent text. Long names truncate; the title attribute recovers them.
const nameStyle: React.CSSProperties = {
    color: 'var(--ch-color-text-primary)',
    fontSize: 'var(--ch-font-size-md)',
    fontWeight: 'var(--ch-font-weight-semibold)',
    lineHeight: 'var(--ch-line-height-none)',
    whiteSpace: 'nowrap',
    maxWidth: 'calc(var(--ch-space-xl) * 5)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
};

// A 20px hairline tick fencing the status text from the controls. Coloured
// --ch-color-border (not border-muted, which vanishes on surface-overlay).
const dividerStyle: React.CSSProperties = {
    flex: 'none',
    width: 'var(--ch-border-width-sm)',
    height: 'var(--ch-size-icon)',
    background: 'var(--ch-color-border)',
    borderRadius: 'var(--ch-radius-pill)',
};

// A recessed keycap: darker surface + strong bottom border reads as key depth
// without a shadow. Shows only the bound key; the full formatted hint stays on
// aria-label/title.
const keycapStyle: React.CSSProperties = {
    fontFamily: 'var(--ch-font-mono)',
    fontSize: 'var(--ch-font-size-sm)',
    lineHeight: 'var(--ch-line-height-none)',
    color: 'var(--ch-color-text-secondary)',
    background: 'var(--ch-color-surface)',
    border: 'var(--ch-border-width-sm) solid var(--ch-color-border)',
    borderBottomColor: 'var(--ch-color-border-strong)',
    borderRadius: 'var(--ch-radius-sm)',
    padding: 'var(--ch-space-xs) var(--ch-space-sm)',
    marginRight: 'var(--ch-space-xs)',
    whiteSpace: 'nowrap',
};
