// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReplayControls } from './ReplayControls';

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
    }> = {},
    handlers: Handlers = makeHandlers(),
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
        />,
    );
    return handlers;
}

afterEach(() => {
    cleanup();
});

describe('ReplayControls', () => {
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
