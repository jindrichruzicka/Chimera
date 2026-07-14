// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { ReplayControls } from './ReplayControls';
import css from './ReplayControls.module.css?raw';

// The controls render their labels through `useTranslate()`, which throws
// outside an I18nProvider; wrap every render. The save affordance's name dialog
// (a shared Modal) routes Escape through the overlay stack, so an
// EscapeStackProvider is required too (useEscapeLayer throws otherwise).
function render(
    ui: React.ReactElement,
    gameOverride?: Record<string, string>,
): ReturnType<typeof baseRender> {
    return baseRender(
        <I18nProvider {...(gameOverride === undefined ? {} : { gameOverride })}>
            <EscapeStackProvider>{ui}</EscapeStackProvider>
        </I18nProvider>,
    );
}

interface Handlers {
    onPlay: ReturnType<typeof vi.fn>;
    onPause: ReturnType<typeof vi.fn>;
    onStep: ReturnType<typeof vi.fn>;
    onSeek: ReturnType<typeof vi.fn>;
    onSpeedChange: ReturnType<typeof vi.fn>;
}

function makeHandlers(): Handlers {
    return {
        onPlay: vi.fn(),
        onPause: vi.fn(),
        onStep: vi.fn(),
        onSeek: vi.fn(),
        onSpeedChange: vi.fn(),
    };
}

function renderControls(
    props: Partial<{
        currentTick: number;
        totalTicks: number;
        isPlaying: boolean;
        playbackSpeed: number;
        kind: 'deterministic' | 'perspective';
        save: { onSave: (name: string) => void; saving: boolean; saved: boolean };
    }> = {},
    handlers: Handlers = makeHandlers(),
    gameOverride?: Record<string, string>,
): Handlers {
    render(
        <ReplayControls
            currentTick={props.currentTick ?? 0}
            totalTicks={props.totalTicks ?? 10}
            isPlaying={props.isPlaying ?? false}
            playbackSpeed={props.playbackSpeed ?? 1}
            kind={props.kind ?? 'deterministic'}
            onPlay={handlers.onPlay}
            onPause={handlers.onPause}
            onStep={handlers.onStep}
            onSeek={handlers.onSeek}
            onSpeedChange={handlers.onSpeedChange}
            {...(props.save === undefined ? {} : { save: props.save })}
        />,
        gameOverride,
    );
    return handlers;
}

afterEach(() => {
    cleanup();
});

describe('ReplayControls', () => {
    it('labels a transport button from its engine.replays token', () => {
        renderControls({}, makeHandlers(), { 'engine.replays.play': 'Resume' });
        expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    });

    it('shows the current and total ticks', () => {
        renderControls({ currentTick: 4, totalTicks: 10 });
        expect(screen.getByText(/4\s*\/\s*10/)).toBeDefined();
    });

    describe('play / pause toggle', () => {
        it('renders Play (not Pause) when paused and calls onPlay', async () => {
            const handlers = renderControls({ isPlaying: false, currentTick: 2 });
            expect(screen.queryByRole('button', { name: /pause/i })).toBeNull();

            await userEvent.click(screen.getByRole('button', { name: /play/i }));
            expect(handlers.onPlay).toHaveBeenCalledOnce();
        });

        it('renders Pause (not Play) when playing and calls onPause', async () => {
            const handlers = renderControls({ isPlaying: true, currentTick: 2 });
            expect(screen.queryByRole('button', { name: /^play$/i })).toBeNull();

            await userEvent.click(screen.getByRole('button', { name: /pause/i }));
            expect(handlers.onPause).toHaveBeenCalledOnce();
        });
    });

    describe('step / seek buttons', () => {
        it('steps backward and forward by one tick', async () => {
            const handlers = renderControls({ currentTick: 5, totalTicks: 10 });

            await userEvent.click(screen.getByRole('button', { name: /step back/i }));
            expect(handlers.onStep).toHaveBeenCalledWith(-1);

            await userEvent.click(screen.getByRole('button', { name: /step forward/i }));
            expect(handlers.onStep).toHaveBeenCalledWith(1);
        });

        it('seeks to start and end', async () => {
            const handlers = renderControls({ currentTick: 5, totalTicks: 10 });

            await userEvent.click(screen.getByRole('button', { name: /seek to start/i }));
            expect(handlers.onSeek).toHaveBeenCalledWith(0);

            await userEvent.click(screen.getByRole('button', { name: /seek to end/i }));
            expect(handlers.onSeek).toHaveBeenCalledWith(10);
        });

        it('seeks via the scrubber', () => {
            const handlers = renderControls({ currentTick: 5, totalTicks: 10 });
            const scrubber = screen.getByRole('slider');

            fireEvent.change(scrubber, { target: { value: '8' } });
            expect(handlers.onSeek).toHaveBeenCalledWith(8);
        });
    });

    describe('playback speed', () => {
        it('reflects the current speed and reports a new selection', () => {
            const handlers = renderControls({ playbackSpeed: 1 });
            const speed = screen.getByRole('combobox', { name: /speed/i });

            expect(speed).toHaveValue('1');

            fireEvent.change(speed, { target: { value: '2' } });
            expect(handlers.onSpeedChange).toHaveBeenCalledWith(2);
        });

        it('shows the selected speed when not 1x', () => {
            renderControls({ playbackSpeed: 4 });
            expect(screen.getByRole('combobox', { name: /speed/i })).toHaveValue('4');
        });
    });

    describe('disabled states at the boundaries', () => {
        it('disables back/start (and the scrubber stays at 0) at tick 0', () => {
            renderControls({ currentTick: 0, totalTicks: 10 });
            expect(screen.getByRole('button', { name: /step back/i })).toBeDisabled();
            expect(screen.getByRole('button', { name: /seek to start/i })).toBeDisabled();
        });

        it('disables forward/end/play at the final tick', () => {
            renderControls({ currentTick: 10, totalTicks: 10, isPlaying: false });
            expect(screen.getByRole('button', { name: /step forward/i })).toBeDisabled();
            expect(screen.getByRole('button', { name: /seek to end/i })).toBeDisabled();
            expect(screen.getByRole('button', { name: /play/i })).toBeDisabled();
        });
    });

    describe('E2E test ids', () => {
        it('tags the Play button, tick counter and scrubber when paused', () => {
            renderControls({ isPlaying: false, currentTick: 4, totalTicks: 10 });

            expect(screen.getByTestId('replay-play-btn')).toBeInTheDocument();
            expect(screen.getByTestId('replay-tick-counter')).toHaveTextContent('4 / 10');
            expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument();
            expect(screen.queryByTestId('replay-pause-btn')).toBeNull();
        });

        it('tags the Pause button when playing', () => {
            renderControls({ isPlaying: true, currentTick: 2, totalTicks: 10 });

            expect(screen.getByTestId('replay-pause-btn')).toBeInTheDocument();
            expect(screen.queryByTestId('replay-play-btn')).toBeNull();
        });
    });

    describe('save affordance', () => {
        it('renders no save icon when the `save` prop is absent', () => {
            renderControls();
            expect(screen.queryByRole('button', { name: /save replay/i })).toBeNull();
            expect(screen.queryByTestId('replay-save-btn')).toBeNull();
        });

        it('renders a save icon that opens the name dialog and calls onSave on confirm', async () => {
            const onSave = vi.fn();
            renderControls({ save: { onSave, saving: false, saved: false } });

            const button = screen.getByRole('button', { name: /save replay/i });
            expect(button).toBeEnabled();
            expect(screen.getByTestId('replay-save-btn')).toBeInTheDocument();

            // The affordance is the registry save glyph, not an emoji fallback.
            expect(button.querySelector('svg[data-ch-icon="save"]')).not.toBeNull();

            // Clicking opens the name dialog (it does NOT save directly);
            // confirming then persists with the entered (here empty) name.
            await userEvent.click(button);
            expect(screen.getByTestId('replay-save-name-dialog')).toBeInTheDocument();
            expect(onSave).not.toHaveBeenCalled();

            await userEvent.click(screen.getByTestId('replay-save-name-confirm'));
            expect(onSave).toHaveBeenCalledOnce();
            expect(onSave).toHaveBeenCalledWith('');
        });

        it('disables the save icon while saving', () => {
            renderControls({ save: { onSave: vi.fn(), saving: true, saved: false } });
            expect(screen.getByRole('button', { name: /save replay/i })).toBeDisabled();
        });

        it('marks the icon saved and disables it once saved', () => {
            const onSave = vi.fn();
            renderControls({ save: { onSave, saving: false, saved: true } });

            // The accessible name switches to the saved state and the control is inert.
            const button = screen.getByRole('button', { name: /replay saved/i });
            expect(button).toBeDisabled();
            expect(screen.queryByRole('button', { name: /^save replay$/i })).toBeNull();
        });

        it('CSS carries no hardcoded colour values (invariant #86)', () => {
            expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        });
    });

    describe('replay kind', () => {
        it('labels the controls group for the deterministic player by default', () => {
            renderControls();
            expect(
                screen.getByRole('group', { name: /^replay playback controls$/i }),
            ).toBeInTheDocument();
        });

        it('labels the controls group for the perspective player', () => {
            renderControls({ kind: 'perspective' });
            expect(
                screen.getByRole('group', { name: /perspective replay playback controls/i }),
            ).toBeInTheDocument();
        });

        it('renders no seat or viewer switcher in the perspective player', () => {
            renderControls({ kind: 'perspective' });
            expect(screen.queryByRole('combobox', { name: /seat|viewer/i })).toBeNull();
            // The transport controls remain available — only seat switching is absent.
            expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
            expect(screen.getByRole('combobox', { name: /speed/i })).toBeInTheDocument();
        });
    });
});
