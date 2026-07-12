'use client';

import React from 'react';
import {
    Badge,
    Button,
    Caption,
    Panel,
    type BadgeVariant,
    type CaptionTone,
} from '@chimera-engine/renderer/components/ui';
import {
    resolveGameResultOutcome,
    type GameScreenProps,
    type GameResultOutcome,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    CURRENT_MATCH_REPLAY_PATH,
    type PerspectiveReplayExportBridge,
    type ReplayExportBridge,
} from '@chimera-engine/simulation/foundation/replay-bridge-contract.js';
import styles from './TacticsPostGameSummary.module.css';

interface SummaryCopy {
    readonly badgeLabel: string;
    readonly badgeVariant: BadgeVariant;
    readonly captionTone: CaptionTone;
    readonly message: string;
}

const SUMMARY_COPY = {
    win: {
        badgeLabel: 'Victory',
        badgeVariant: 'success',
        captionTone: 'success',
        message: 'Mission accomplished. Your formation controls the field.',
    },
    loss: {
        badgeLabel: 'Defeat',
        badgeVariant: 'error',
        captionTone: 'error',
        message: 'Operation failed. Regroup and prepare a new strategy.',
    },
    draw: {
        badgeLabel: 'Stalemate',
        badgeVariant: 'warning',
        captionTone: 'neutral',
        message: 'No decisive winner. Tactical parity achieved.',
    },
    unknown: {
        badgeLabel: 'Concluded',
        badgeVariant: 'neutral',
        captionTone: 'muted',
        message: 'Game completed. Final battlefield report is available.',
    },
} as const satisfies Readonly<Record<GameResultOutcome, SummaryCopy>>;

function resolveOutcome(
    snapshot: GameScreenProps['snapshot'],
    localPlayerId?: GameScreenProps['localPlayerId'],
): GameResultOutcome {
    if (snapshot.gameResult === null) {
        return 'unknown';
    }
    return resolveGameResultOutcome(snapshot.gameResult, localPlayerId);
}

/**
 * Async status for the post-game **Replay** action. Modelled as a discriminated
 * union so no impossible intermediate state can be represented: the button is
 * disabled while `working` (the brief export-then-navigate round-trip), and the
 * terminal `error` surface renders only if that fails. Saving has moved into the
 * replay player's own compact save icon, so there is no `saved` state here.
 */
type ReplayActionStatus =
    | { readonly kind: 'idle' }
    | { readonly kind: 'working' }
    | { readonly kind: 'error'; readonly message: string };

const REPLAY_ACTION_IDLE: ReplayActionStatus = { kind: 'idle' };

const MISSING_BRIDGE_ERROR = 'Chimera replay API not available';

/**
 * The export / open-in-player slice of the Chimera preload replay bridge, read
 * off `globalThis` (≡ `window.__chimera` at runtime). A game screen
 * (`apps/<name>/screens/*.tsx`) may import only `simulation/`, `ai/`,
 * `shared/`, and its own files (§3 Module Boundary Table; Invariant #96), so it
 * may not reach the canonical `ReplayAPI` (`electron/*`) nor the `useReplayApi`
 * hook (`renderer/*`); instead it reads the bridge off `globalThis`, typed
 * against the shared {@link ReplayExportBridge} contract — the same pattern the
 * Replays main-menu surface uses for `replay.perspective`.
 */
function requireReplayBridge(): ReplayExportBridge {
    const bridge = (globalThis as { __chimera?: { replay?: ReplayExportBridge } }).__chimera
        ?.replay;
    if (bridge === undefined) {
        throw new Error(MISSING_BRIDGE_ERROR);
    }
    return bridge;
}

/**
 * The perspective slice of the bridge (`window.__chimera.replay.perspective`),
 * read off `globalThis` and typed against the shared
 * {@link PerspectiveReplayExportBridge} — the privacy-safe replay a joined client
 * may export (the deterministic one stays host-only, Invariants #71 / #98).
 */
function requirePerspectiveReplayBridge(): PerspectiveReplayExportBridge {
    const bridge = (
        globalThis as {
            __chimera?: { replay?: { perspective?: PerspectiveReplayExportBridge } };
        }
    ).__chimera?.replay?.perspective;
    if (bridge === undefined) {
        throw new Error(MISSING_BRIDGE_ERROR);
    }
    return bridge;
}

/**
 * Uniform open-in-player surface for the post-game Replay action, resolved by
 * role. Opening the just-finished match previews it straight from the host's/
 * client's in-memory recording ({@link CURRENT_MATCH_REPLAY_PATH}) — the match is
 * NOT written to disk here; the replay player's save icon is the sole persistence
 * gate. Selecting by role only decides which player surface opens:
 *
 * - **host** → the authoritative deterministic replay player.
 * - **client** → its OWN perspective replay player. The deterministic replay
 *   re-runs the full simulation from `seed` + `actions` and would reveal every
 *   player's hidden information, so it never reaches a client (Invariants #71/#98).
 */
interface PostGameReplayBridge {
    openInPlayer(path: string, saveable: boolean): Promise<void>;
}

function requirePostGameReplayBridge(isHost: boolean): PostGameReplayBridge {
    const bridge = isHost ? requireReplayBridge() : requirePerspectiveReplayBridge();
    return { openInPlayer: (path, saveable) => bridge.openInPlayer(path, saveable) };
}

/**
 * Replay action. Mounted only once the match has resolved
 * (`gameResult !== null`), so its `useState` hook runs unconditionally within
 * this component. Replay access reads the preload bridge off `globalThis`
 * (Invariant #96 — no renderer hook/IPC bridge import); feedback is inline, with
 * fixed user-facing copy so raw main-process error text never reaches the UI,
 * because game code may not reach the renderer toast store.
 *
 * Saving is not a button here: **Replay** previews the just-finished match from
 * the in-memory recording (nothing is written to disk) with `saveable = true`, and
 * the player itself surfaces a compact save icon — the sole path that persists the
 * replay. `isHost` selects which replay opens — the host's authoritative
 * deterministic replay, or a joined client's own perspective replay.
 */
function PostGameReplayActions({ isHost }: { readonly isHost: boolean }): React.ReactElement {
    const [status, setStatus] = React.useState<ReplayActionStatus>(REPLAY_ACTION_IDLE);
    const busy = status.kind === 'working';

    const handleReplay = React.useCallback(async (): Promise<void> => {
        setStatus({ kind: 'working' });
        try {
            const bridge = requirePostGameReplayBridge(isHost);
            // Preview the just-finished match from the in-memory recording — nothing
            // is written to disk (no export). `saveable = true`: the player shows its
            // save icon (the navigate push forwards the flag), which is the only path
            // that persists the replay.
            await bridge.openInPlayer(CURRENT_MATCH_REPLAY_PATH, true);
            // Success navigates to the replay player via the main-pushed
            // `chimera:replay:navigate`; the summary unmounts, so no terminal
            // status is set here.
        } catch {
            setStatus({ kind: 'error', message: 'Could not open replay.' });
        }
    }, [isHost]);

    return (
        <div className={styles['actions']} data-testid="post-game-actions">
            {status.kind === 'error' && (
                <Caption
                    className={styles['status']}
                    data-testid="post-game-replay-error"
                    tone="error"
                >
                    {status.message}
                </Caption>
            )}
            <Button
                data-testid="post-game-replay-btn"
                disabled={busy}
                onClick={() => void handleReplay()}
                size="sm"
                variant="primary"
            >
                Replay
            </Button>
        </div>
    );
}

export function TacticsPostGameSummary({
    snapshot,
    localPlayerId,
    isHost,
}: GameScreenProps): React.ReactElement {
    const outcome = resolveOutcome(snapshot, localPlayerId);
    const summary = SUMMARY_COPY[outcome];
    // An absent role means no networked lobby (a purely local game), where the
    // local player is effectively the host that recorded the authoritative replay.
    const isHostPlayer = isHost ?? true;

    return (
        <section className={styles['root']} data-testid="post-game-summary" data-outcome={outcome}>
            <Panel
                className={styles['panel']}
                data-testid="post-game-summary-panel"
                title="Post-Game Summary"
                variant="raised"
            >
                <div className={styles['header']}>
                    <Badge
                        className={styles['badge']}
                        data-testid="post-game-summary-badge"
                        variant={summary.badgeVariant}
                    >
                        {summary.badgeLabel}
                    </Badge>
                    <Caption
                        className={styles['message']}
                        data-testid="post-game-summary-message"
                        tone={summary.captionTone}
                    >
                        {summary.message}
                    </Caption>
                </div>
                {snapshot.gameResult !== null && <PostGameReplayActions isHost={isHostPlayer} />}
            </Panel>
        </section>
    );
}

export default TacticsPostGameSummary;
