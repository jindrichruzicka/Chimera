'use client';

/**
 * Display-only playback controls for the replay player (§4.28).
 *
 * Holds NO state of its own — `currentTick`, `totalTicks`, and `isPlaying` are
 * props, and every interaction is reported through a callback so the parent
 * page owns playback state. All buttons come from the `<Button>` UI primitive
 * (Invariant #92) and all spacing uses design tokens (Invariant #91).
 */

import React from 'react';
import { Button, Caption, Select, Slider, type SelectOption } from '../ui';
import { REPLAYS_KEYS } from '../../i18n/engine-keys';
import type { TranslationKey } from '../../i18n/translation-bundle';
import { useTranslate } from '../../i18n/useTranslate';
import type { ReplayKind } from './replayKind';
import { SaveReplayButton } from './SaveReplayButton';
import styles from './ReplayControls.module.css';

/** The selectable playback rates and the token that labels each speed option. */
const SPEED_OPTION_KEYS: readonly { readonly value: string; readonly key: TranslationKey }[] = [
    { value: '0.5', key: REPLAYS_KEYS.speed05 },
    { value: '1', key: REPLAYS_KEYS.speed1 },
    { value: '2', key: REPLAYS_KEYS.speed2 },
    { value: '4', key: REPLAYS_KEYS.speed4 },
];

/** The token that labels the accessible controls group per replay kind. */
const GROUP_LABEL_KEY: Record<ReplayKind, TranslationKey> = {
    deterministic: REPLAYS_KEYS.controlsGroupDeterministic,
    perspective: REPLAYS_KEYS.controlsGroupPerspective,
};

/**
 * Optional save affordance for the replay player. Present only when the player
 * was opened for the just-finished match (the post-game **Replay** action); the
 * parent owns the state so these controls stay display-only. Absent for
 * library-opened replays, which are already on disk.
 */
export interface ReplaySaveControl {
    /**
     * Save (finalise + keep) the current match's replay under the user-entered
     * `name` (trimmed; `''` when the name dialog was left blank).
     */
    readonly onSave: (name: string) => void;
    /** A save round-trip is in flight — the icon is disabled. */
    readonly saving: boolean;
    /** The replay has been saved — the icon stays disabled so it can't repeat. */
    readonly saved: boolean;
}

export interface ReplayControlsProps {
    /**
     * Which replay kind these controls drive. Perspective playback is locked to
     * a single recorded viewer, so no seat switcher is ever rendered (Invariant
     * #98); the deterministic player has none today either. The prop is the seam
     * that keeps seat UI off the perspective player and labels the group.
     */
    readonly kind?: ReplayKind;
    /** Current playback tick (0..totalTicks). */
    readonly currentTick: number;
    /** Highest tick in the replay. */
    readonly totalTicks: number;
    /** Whether playback is advancing. */
    readonly isPlaying: boolean;
    /** Current playback speed multiplier (1 = one tick per second). */
    readonly playbackSpeed: number;
    /** Start advancing playback. */
    readonly onPlay: () => void;
    /** Pause playback. */
    readonly onPause: () => void;
    /** Step by `delta` ticks (e.g. -1 / +1). */
    readonly onStep: (delta: number) => void;
    /** Jump to an absolute tick. */
    readonly onSeek: (tick: number) => void;
    /** Change the playback speed multiplier. */
    readonly onSpeedChange: (speed: number) => void;
    /**
     * When provided, renders a compact save icon at the far left of the bar (the
     * just-finished match opened from the post-game summary). Omitted for
     * library-opened replays, which render no save icon.
     */
    readonly save?: ReplaySaveControl;
}

export function ReplayControls({
    kind = 'deterministic',
    currentTick,
    totalTicks,
    isPlaying,
    playbackSpeed,
    onPlay,
    onPause,
    onStep,
    onSeek,
    onSpeedChange,
    save,
}: ReplayControlsProps): React.ReactElement {
    const t = useTranslate();
    const atStart = currentTick <= 0;
    const atEnd = currentTick >= totalTicks;

    const speedOptions = React.useMemo<readonly SelectOption[]>(
        () => SPEED_OPTION_KEYS.map(({ value, key }) => ({ value, label: t(key) })),
        [t],
    );

    return (
        <div className={styles['root']} role="group" aria-label={t(GROUP_LABEL_KEY[kind])}>
            {save !== undefined && (
                <SaveReplayButton onSave={save.onSave} saving={save.saving} saved={save.saved} />
            )}
            <Button
                size="sm"
                variant="ghost"
                aria-label={t(REPLAYS_KEYS.seekStart)}
                disabled={atStart}
                onClick={() => onSeek(0)}
            >
                ⏮
            </Button>
            <Button
                size="sm"
                variant="ghost"
                aria-label={t(REPLAYS_KEYS.stepBack)}
                disabled={atStart}
                onClick={() => onStep(-1)}
            >
                ◀
            </Button>
            {isPlaying ? (
                <Button
                    size="sm"
                    variant="primary"
                    aria-label={t(REPLAYS_KEYS.pause)}
                    data-testid="replay-pause-btn"
                    onClick={onPause}
                >
                    {t(REPLAYS_KEYS.pause)}
                </Button>
            ) : (
                <Button
                    size="sm"
                    variant="primary"
                    aria-label={t(REPLAYS_KEYS.play)}
                    data-testid="replay-play-btn"
                    disabled={atEnd}
                    onClick={onPlay}
                >
                    {t(REPLAYS_KEYS.play)}
                </Button>
            )}
            <Button
                size="sm"
                variant="ghost"
                aria-label={t(REPLAYS_KEYS.stepForward)}
                disabled={atEnd}
                onClick={() => onStep(1)}
            >
                ▶
            </Button>
            <Button
                size="sm"
                variant="ghost"
                aria-label={t(REPLAYS_KEYS.seekEnd)}
                disabled={atEnd}
                onClick={() => onSeek(totalTicks)}
            >
                ⏭
            </Button>
            <Slider
                className={styles['scrubber']}
                label={t(REPLAYS_KEYS.scrubberLabel)}
                data-testid="replay-scrubber"
                min={0}
                max={totalTicks}
                step={1}
                value={currentTick}
                onChange={onSeek}
            />
            <Caption
                tone="muted"
                data-testid="replay-tick-counter"
            >{`${currentTick} / ${totalTicks}`}</Caption>
            <Select
                className={styles['speed']}
                label={t(REPLAYS_KEYS.speedLabel)}
                options={speedOptions}
                value={String(playbackSpeed)}
                onValueChange={(value) => onSpeedChange(Number(value))}
            />
        </div>
    );
}
