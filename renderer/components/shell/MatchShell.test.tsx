// renderer/components/shell/MatchShell.test.tsx
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchShell } from './MatchShell';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('MatchShell page object locators', () => {
    it('renders the §13.6 match HUD locator surface', () => {
        render(
            <MatchShell tick={42} canUndo={true} canRedo={false} isGameOver={true}>
                <div>Board slot</div>
            </MatchShell>,
        );

        expect(screen.getByTestId('match-canvas').textContent).toContain('Board slot');
        expect(screen.getByTestId('undo')).toBeTruthy();
        expect(screen.getByTestId('redo')).toBeTruthy();
        expect(screen.getByTestId('end-turn')).toBeTruthy();
        expect(screen.getByTestId('game-over-banner')).toBeTruthy();
        expect(screen.getByTestId('hud-tick').textContent).toBe('42');
    });

    it('wires HUD controls through game-agnostic callbacks', () => {
        const onUndo = vi.fn();
        const onRedo = vi.fn();
        const onEndTurn = vi.fn();

        render(
            <MatchShell
                tick={7}
                canUndo={true}
                canRedo={true}
                onUndo={onUndo}
                onRedo={onRedo}
                onEndTurn={onEndTurn}
            />,
        );

        fireEvent.click(screen.getByTestId('undo'));
        fireEvent.click(screen.getByTestId('redo'));
        fireEvent.click(screen.getByTestId('end-turn'));

        expect(onUndo).toHaveBeenCalledOnce();
        expect(onRedo).toHaveBeenCalledOnce();
        expect(onEndTurn).toHaveBeenCalledOnce();
    });
});
