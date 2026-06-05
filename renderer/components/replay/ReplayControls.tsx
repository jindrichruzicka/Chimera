'use client';

/**
 * renderer/components/replay/ReplayControls.tsx
 *
 * Display-only playback controls for the replay player (§4.28, F44 / T6, #660).
 *
 * Holds NO state of its own — `currentTick`, `totalTicks`, and `isPlaying` are
 * props, and every interaction is reported through a callback so the parent
 * page owns playback state. All buttons come from the `<Button>` UI primitive
 * (Invariant #92) and all spacing uses design tokens (Invariant #91).
 */

import React from 'react';
import { Button, Caption, Select, Slider, type SelectOption } from '../ui';
import type { ReplayKind } from './replayKind';
import styles from './ReplayControls.module.css';

/** Selectable wall-clock playback rates, as multiples of one tick per second. */
const SPEED_OPTIONS: readonly SelectOption[] = [
    { value: '0.5', label: '0.5×' },
    { value: '1', label: '1×' },
    { value: '2', label: '2×' },
    { value: '4', label: '4×' },
];

/** Accessible group label per replay kind. */
const GROUP_LABEL: Record<ReplayKind, string> = {
    deterministic: 'Replay playback controls',
    perspective: 'Perspective replay playback controls',
};

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
}: ReplayControlsProps): React.ReactElement {
    const atStart = currentTick <= 0;
    const atEnd = currentTick >= totalTicks;

    return (
        <div className={styles['root']} role="group" aria-label={GROUP_LABEL[kind]}>
            <Button
                size="sm"
                variant="ghost"
                aria-label="Seek to start"
                disabled={atStart}
                onClick={() => onSeek(0)}
            >
                ⏮
            </Button>
            <Button
                size="sm"
                variant="ghost"
                aria-label="Step back"
                disabled={atStart}
                onClick={() => onStep(-1)}
            >
                ◀
            </Button>
            {isPlaying ? (
                <Button
                    size="sm"
                    variant="primary"
                    aria-label="Pause"
                    data-testid="replay-pause-btn"
                    onClick={onPause}
                >
                    Pause
                </Button>
            ) : (
                <Button
                    size="sm"
                    variant="primary"
                    aria-label="Play"
                    data-testid="replay-play-btn"
                    disabled={atEnd}
                    onClick={onPlay}
                >
                    Play
                </Button>
            )}
            <Button
                size="sm"
                variant="ghost"
                aria-label="Step forward"
                disabled={atEnd}
                onClick={() => onStep(1)}
            >
                ▶
            </Button>
            <Button
                size="sm"
                variant="ghost"
                aria-label="Seek to end"
                disabled={atEnd}
                onClick={() => onSeek(totalTicks)}
            >
                ⏭
            </Button>
            <Slider
                className={styles['scrubber']}
                label="Replay position"
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
                label="Playback speed"
                options={SPEED_OPTIONS}
                value={String(playbackSpeed)}
                onValueChange={(value) => onSpeedChange(Number(value))}
            />
        </div>
    );
}
