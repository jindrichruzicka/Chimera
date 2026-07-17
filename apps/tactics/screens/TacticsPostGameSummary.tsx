'use client';

import React from 'react';
import {
    Badge,
    Button,
    Caption,
    Icon,
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
} from '@chimera-engine/simulation/foundation/replay-bridge-contract.js';
import { useTranslate, type TranslateFn, type TranslationKey } from '@chimera-engine/renderer/i18n';
import { SUMMARY_KEYS } from '../shell/translations/keys.js';
import styles from './TacticsPostGameSummary.module.css';

interface SummaryCopy {
    readonly badgeLabel: string;
    readonly badgeVariant: BadgeVariant;
    readonly captionTone: CaptionTone;
    readonly message: string;
}

// The presentation (badge variant + caption tone) is fixed per outcome; the badge
// label and message are tokens resolved at render through `t`, so the copy stays
// localisable while the non-text styling stays a plain const.
const SUMMARY_PRESENTATION = {
    win: { badgeVariant: 'success', captionTone: 'success' },
    loss: { badgeVariant: 'error', captionTone: 'error' },
    draw: { badgeVariant: 'warning', captionTone: 'neutral' },
    unknown: { badgeVariant: 'neutral', captionTone: 'muted' },
} as const satisfies Readonly<
    Record<GameResultOutcome, { badgeVariant: BadgeVariant; captionTone: CaptionTone }>
>;

const SUMMARY_BADGE_KEYS = {
    win: SUMMARY_KEYS.badgeVictory,
    loss: SUMMARY_KEYS.badgeDefeat,
    draw: SUMMARY_KEYS.badgeStalemate,
    unknown: SUMMARY_KEYS.badgeConcluded,
} as const satisfies Readonly<Record<GameResultOutcome, TranslationKey>>;

const SUMMARY_MESSAGE_KEYS = {
    win: SUMMARY_KEYS.messageWin,
    loss: SUMMARY_KEYS.messageLoss,
    draw: SUMMARY_KEYS.messageDraw,
    unknown: SUMMARY_KEYS.messageUnknown,
} as const satisfies Readonly<Record<GameResultOutcome, TranslationKey>>;

// The crest emblem shares the heraldic game.tactics.result-* family with the
// end-of-match banner, tying the two surfaces into one house (Invariant #113).
// It is decorative here — the badge already announces the outcome as text — so
// the glyph carries no accessible name.
const SUMMARY_ICON_NAMES = {
    win: 'game.tactics.result-victory',
    loss: 'game.tactics.result-defeat',
    draw: 'game.tactics.result-draw',
    unknown: 'game.tactics.result-concluded',
} as const satisfies Readonly<Record<GameResultOutcome, string>>;

function resolveSummaryCopy(outcome: GameResultOutcome, t: TranslateFn): SummaryCopy {
    return {
        badgeLabel: t(SUMMARY_BADGE_KEYS[outcome]),
        message: t(SUMMARY_MESSAGE_KEYS[outcome]),
        ...SUMMARY_PRESENTATION[outcome],
    };
}

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
 * The perspective slice of the bridge (`window.__chimera.replay.perspective`),
 * read off `globalThis` and typed against the shared
 * {@link PerspectiveReplayExportBridge} — the privacy-safe replay every player
 * (host and client alike) previews and saves from its own point of view. A game
 * screen (`apps/<name>/screens/*.tsx`) may import only `simulation/`, `ai/`,
 * `shared/`, and its own files (§3 Module Boundary Table; Invariant #96), so it
 * may not reach the canonical `PerspectiveReplayAPI` (`electron/*`) nor the
 * `useReplayApi` hook (`renderer/*`); instead it reads the bridge off
 * `globalThis`.
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
 * Uniform open-in-player surface for the post-game Replay action. Every player —
 * host and client alike — previews its OWN perspective replay of the just-finished
 * match, straight from the in-memory recording ({@link CURRENT_MATCH_REPLAY_PATH});
 * the match is NOT written to disk here (the replay player's save icon is the sole
 * persistence gate).
 *
 * There is no longer a role branch: the deterministic replay re-runs the full
 * simulation from `seed` + `actions` and would reveal every seat's hidden
 * information, so the renderer never opens or saves it. The build-specific
 * decision to co-save a deterministic debug copy lives entirely in the trusted
 * main process (keyed on `app.isPackaged`), so this screen stays build-agnostic
 * (Invariants #71/#98).
 */
interface PostGameReplayBridge {
    openInPlayer(path: string, saveable: boolean): Promise<void>;
}

function requirePostGameReplayBridge(): PostGameReplayBridge {
    const bridge = requirePerspectiveReplayBridge();
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
 * replay. Every player previews and saves its OWN perspective replay; the
 * deterministic decision lives entirely in main, so this screen is role- and
 * build-agnostic.
 */
function PostGameReplayActions(): React.ReactElement {
    const t = useTranslate();
    const [status, setStatus] = React.useState<ReplayActionStatus>(REPLAY_ACTION_IDLE);
    const busy = status.kind === 'working';

    const handleReplay = React.useCallback(async (): Promise<void> => {
        setStatus({ kind: 'working' });
        try {
            const bridge = requirePostGameReplayBridge();
            // Preview the just-finished match from the in-memory recording — nothing
            // is written to disk (no export). `saveable = true`: the player shows its
            // save icon (the navigate push forwards the flag), which is the only path
            // that persists the replay.
            await bridge.openInPlayer(CURRENT_MATCH_REPLAY_PATH, true);
            // Success navigates to the replay player via the main-pushed
            // `chimera:replay:navigate`; the summary unmounts, so no terminal
            // status is set here.
        } catch {
            setStatus({ kind: 'error', message: t(SUMMARY_KEYS.replayError) });
        }
    }, [t]);

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
                {t(SUMMARY_KEYS.replayButton)}
            </Button>
        </div>
    );
}

export function TacticsPostGameSummary({
    snapshot,
    localPlayerId,
}: GameScreenProps): React.ReactElement {
    const t = useTranslate();
    const outcome = resolveOutcome(snapshot, localPlayerId);
    const summary = resolveSummaryCopy(outcome, t);

    return (
        <section className={styles['root']} data-testid="post-game-summary" data-outcome={outcome}>
            <Panel
                className={styles['panel']}
                data-testid="post-game-summary-panel"
                title={t(SUMMARY_KEYS.panelTitle)}
                variant="raised"
            >
                {/* Crest lockup: the heraldic emblem, a gold "pale" hairline, and
                    the outcome word restyled as an engraved ghost badge. */}
                <div className={styles['crest']}>
                    <span
                        aria-hidden="true"
                        className={styles['emblem']}
                        data-testid="post-game-summary-emblem"
                    >
                        <Icon name={SUMMARY_ICON_NAMES[outcome]} />
                    </span>
                    <span aria-hidden="true" className={styles['pale']} />
                    <Badge
                        className={styles['badge']}
                        data-testid="post-game-summary-badge"
                        variant={summary.badgeVariant}
                    >
                        {summary.badgeLabel}
                    </Badge>
                </div>
                <span aria-hidden="true" className={styles['baserule']} />
                <Caption
                    className={styles['message']}
                    data-testid="post-game-summary-message"
                    tone={summary.captionTone}
                >
                    {summary.message}
                </Caption>
                {snapshot.gameResult !== null && <PostGameReplayActions />}
            </Panel>
        </section>
    );
}

export default TacticsPostGameSummary;
