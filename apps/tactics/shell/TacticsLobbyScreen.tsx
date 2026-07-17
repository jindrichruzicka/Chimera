'use client';

/**
 * apps/tactics/shell/TacticsLobbyScreen.tsx
 *
 * Tactics' custom lobby screen (§4.37). Registry-loaded into
 * `LoadedRendererGameShell.LobbyScreen`, it replaces the engine-default
 * `ActiveLobbyPanel` when a Tactics lobby is hosted. Two side-by-side panels
 * (stacking on narrow viewports): Battle Setup — the host's shareable lobby
 * address plus the match settings — and the roster panel, which carries the
 * ready-progress chip and merges human seats, AI seats, and the host's
 * add-AI control into one list. Leave/Start are NOT rendered here: the lobby
 * page's Modal footer owns them, aligned with every other modal's button row.
 *
 * The local player's ready control is a single icon toggle (the pressed check
 * IS the indicator); a ready badge renders only for the seats the local player
 * cannot control.
 *
 * Authority split: the board-colour select is host-authored — editable
 * only for the host (a client sees it `disabled`) and routed through
 * `setMatchSetting`. Each per-player colour select is owner-authored — editable
 * only on the local player's OWN row (every other seat is `disabled`) and routed
 * through `setPlayerAttribute`, which `main` accepts only for the caller's own
 * seat. The screen performs no privileged writes itself.
 *
 * Module boundary (§3 / Invariant #96): game shell components import the shared
 * component library only through the public `components/ui` barrel; the colour
 * palette is interpreted from the generic `content` prop (loaded from the content
 * database) by this game's own `content/tacticsContent.ts`.
 *
 * Architecture: §4.37 — Renderer Shell Pages UI Contract; §4.4 — Lobby State Sync
 */

import React from 'react';
import {
    Badge,
    Heading,
    Icon,
    IconButton,
    Select,
    Toggle,
    ToggleButton,
} from '@chimera-engine/renderer/components/ui';
import { useTranslate } from '@chimera-engine/renderer/i18n';
import {
    ALLOW_SPECTATORS_SETTING,
    readAllowSpectators,
    type GameLobbyScreenProps,
} from '@chimera-engine/simulation/foundation/game-lobby-contract.js';
import {
    readTacticsTurnMode,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera-engine/tactics/simulation/constants.js';
import {
    DEFAULT_BOARD_COLOR,
    DEFAULT_PLAYER_COLOR,
    TACTICS_MAX_PLAYERS,
} from '../lobby/lobby-setup.js';
import { paletteFromCollections } from '../content/tacticsContent.js';
import { LOBBY_KEYS } from './translations/keys.js';
import styles from './TacticsLobbyScreen.module.css';

/**
 * Copy the joinable lobby address to the clipboard so the host can paste it to
 * the other player. Mirrors `NetworkPanel`'s copy affordance; the optional chain
 * keeps the call a no-op where `navigator.clipboard` is absent (e.g. jsdom).
 */
function copyLobbyAddress(value: string): void {
    void navigator.clipboard?.writeText(value);
}

export function TacticsLobbyScreen({
    lobbyState,
    localPlayerId,
    content,
    isHost,
    pendingAction,
    setMatchSetting,
    setPlayerAttribute,
    addAiPlayer,
    removeAiPlayer,
    onToggleReady,
}: GameLobbyScreenProps): React.ReactElement {
    const t = useTranslate();
    // The selectable colours come from the content database (delivered as the
    // generic `content` prop); interpret them into this game's palette. Empty
    // until content loads, so the Selects fall back to the seeded default names.
    const palette = paletteFromCollections(content ?? {});
    const readyCount = lobbyState.players.filter((player) => player.ready).length;
    const allReady = lobbyState.players.length > 0 && readyCount === lobbyState.players.length;
    const boardColor = lobbyState.matchSettings?.['boardColor'] ?? DEFAULT_BOARD_COLOR;
    // Commitment battle mode is a host-authored synced match setting: the toggle
    // writes the shared `turnMode` key, off (`sequential`) by default, and rides
    // `snapshot.setup` into the match.
    const commitmentEnabled = readTacticsTurnMode(lobbyState.matchSettings) === 'commitment';
    // AI agent slots come synced in the lobby state. The lobby is "full" on total
    // occupancy — humans + AI together against maxPlayers — matching the host's
    // auto-remove-on-overflow rule. The AI caption row renders for the host (to
    // add/remove) or whenever any AI slot exists (read-only for clients).
    const agentSlots = lobbyState.agentSlots ?? [];
    const isFull = lobbyState.players.length + agentSlots.length >= TACTICS_MAX_PLAYERS;
    const showAiSection = isHost || agentSlots.length > 0;

    // Gate the host AI controls while an add/remove round-trip is in flight so a
    // rapid double-click cannot fire two `addAi`/`removeAi` invocations from one
    // gesture. The synced state arrives via the lobby update, so we clear the
    // flag when the round-trip settles.
    const [aiActionPending, setAiActionPending] = React.useState(false);
    const runAiAction = (action: () => Promise<void>): void => {
        setAiActionPending(true);
        void action().finally(() => {
            setAiActionPending(false);
        });
    };

    return (
        <div className={styles['lobby']} data-testid="tactics-lobby-screen">
            <section className={styles['panel']}>
                <div className={styles['heading-row']}>
                    <Heading level={2} size="lg">
                        {t(LOBBY_KEYS.battleSetup)}
                    </Heading>
                </div>
                {isHost ? (
                    <div className={styles['address']}>
                        <span className={styles['address-label']}>
                            {t(LOBBY_KEYS.addressLabel)}
                        </span>
                        <div className={styles['address-row']}>
                            <code className={styles['address-code']} data-testid="lobby-address">
                                {lobbyState.info.sessionId}
                            </code>
                            <IconButton
                                aria-label={t(LOBBY_KEYS.copyAddressAriaLabel)}
                                data-testid="lobby-address-copy"
                                onClick={() => {
                                    copyLobbyAddress(lobbyState.info.sessionId);
                                }}
                                variant="ghost"
                            >
                                <Icon name="copy" />
                            </IconButton>
                        </div>
                    </div>
                ) : null}
                <Select
                    className={styles['board-color-select']}
                    data-testid="tactics-board-color-select"
                    disabled={!isHost}
                    label={t(LOBBY_KEYS.boardColour)}
                    onValueChange={(value) => {
                        setMatchSetting('boardColor', value);
                    }}
                    options={palette.boardColors}
                    value={boardColor}
                />
                <Toggle
                    checked={commitmentEnabled}
                    data-testid="tactics-commitment-scheme-toggle"
                    disabled={!isHost}
                    label={t(LOBBY_KEYS.simultaneousTurns)}
                    onCheckedChange={(next) => {
                        setMatchSetting(
                            TACTICS_TURN_MODE_SETTING,
                            next ? 'commitment' : 'sequential',
                        );
                    }}
                />
                <Toggle
                    checked={readAllowSpectators(lobbyState.matchSettings)}
                    data-testid="tactics-allow-spectators-toggle"
                    disabled={!isHost}
                    label={t(LOBBY_KEYS.allowSpectators)}
                    onCheckedChange={(next) => {
                        setMatchSetting(ALLOW_SPECTATORS_SETTING, next ? 'true' : 'false');
                    }}
                />
            </section>

            <section className={styles['panel']}>
                <div className={styles['heading-row']}>
                    <Heading level={3} size="md">
                        {t(LOBBY_KEYS.players)}
                    </Heading>
                    <Badge
                        data-testid="tactics-ready-summary"
                        variant={allReady ? 'success' : 'neutral'}
                    >
                        {t(LOBBY_KEYS.readySummary, {
                            ready: readyCount,
                            total: lobbyState.players.length,
                        })}
                    </Badge>
                </div>
                <ul className={styles['roster']}>
                    {lobbyState.players.map((player) => {
                        const color = player.attributes?.['color'] ?? DEFAULT_PLAYER_COLOR;
                        const isLocal = player.playerId === localPlayerId;
                        return (
                            <li
                                className={styles['roster-row']}
                                data-player-id={player.playerId}
                                data-ready={String(player.ready)}
                                data-testid="tactics-lobby-player"
                                key={player.playerId}
                            >
                                <span
                                    aria-hidden="true"
                                    className={styles['swatch']}
                                    data-testid={`tactics-player-swatch-${player.playerId}`}
                                    style={{ backgroundColor: palette.playerColorHex[color] }}
                                />
                                <span className={styles['player-name']}>
                                    {player.displayName}
                                    {isLocal ? (
                                        <span className={styles['you']}> {t(LOBBY_KEYS.you)}</span>
                                    ) : null}
                                </span>
                                {isLocal ? null : (
                                    <Badge
                                        className={styles['status-badge']}
                                        variant={player.ready ? 'success' : 'warning'}
                                    >
                                        {player.ready ? <Icon name="check" /> : null}
                                        {player.ready
                                            ? t(LOBBY_KEYS.ready)
                                            : t(LOBBY_KEYS.notReady)}
                                    </Badge>
                                )}
                                <Select
                                    data-testid={`tactics-player-color-select-${player.playerId}`}
                                    disabled={!isLocal}
                                    hideLabel
                                    label={t(LOBBY_KEYS.playerColourAriaLabel, {
                                        name: player.displayName,
                                    })}
                                    onValueChange={(value) => {
                                        setPlayerAttribute(player.playerId, 'color', value);
                                    }}
                                    options={palette.playerColors}
                                    value={color}
                                />
                                {isLocal ? (
                                    <ToggleButton
                                        aria-label={t(LOBBY_KEYS.readyToggle)}
                                        className={styles['ready-toggle']}
                                        data-testid="tactics-ready-toggle"
                                        disabled={pendingAction === 'updating-ready'}
                                        onPressedChange={(next) => {
                                            void onToggleReady(next);
                                        }}
                                        pressed={player.ready}
                                    >
                                        <Icon name="check" />
                                    </ToggleButton>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>

                {showAiSection ? (
                    <>
                        <div className={styles['ai-heading-row']}>
                            <span className={styles['ai-caption']}>{t(LOBBY_KEYS.aiPlayers)}</span>
                            {isHost ? (
                                <IconButton
                                    aria-label={t(LOBBY_KEYS.addAiAriaLabel)}
                                    data-testid="tactics-add-ai"
                                    disabled={isFull || aiActionPending}
                                    onClick={() => {
                                        runAiAction(addAiPlayer);
                                    }}
                                    type="button"
                                    variant="ghost"
                                >
                                    <Icon name="plus" />
                                </IconButton>
                            ) : null}
                        </div>
                        {agentSlots.length === 0 ? null : (
                            <ul className={styles['roster']}>
                                {agentSlots.map((slot) => (
                                    <li
                                        className={styles['roster-row']}
                                        data-slot-index={slot.slotIndex}
                                        data-testid="tactics-lobby-ai-player"
                                        key={`ai-${slot.slotIndex}`}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={styles['ai-badge']}
                                            data-testid={`tactics-ai-badge-${slot.slotIndex}`}
                                        >
                                            {t(LOBBY_KEYS.aiBadge)}
                                        </span>
                                        <span className={styles['player-name']}>
                                            {t(LOBBY_KEYS.aiPlayerName, { n: slot.slotIndex })}
                                        </span>
                                        {isHost ? (
                                            <IconButton
                                                aria-label={t(LOBBY_KEYS.removeAiAriaLabel, {
                                                    n: slot.slotIndex,
                                                })}
                                                data-testid={`tactics-remove-ai-${slot.slotIndex}`}
                                                disabled={aiActionPending}
                                                onClick={() => {
                                                    runAiAction(() =>
                                                        removeAiPlayer(slot.slotIndex),
                                                    );
                                                }}
                                                type="button"
                                                variant="ghost"
                                            >
                                                <Icon name="minus" />
                                            </IconButton>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                ) : null}
            </section>
        </div>
    );
}
