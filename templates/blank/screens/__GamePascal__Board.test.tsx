// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import __GamePascal__Board from './__GamePascal__Board.js';

// Screen render smoke — proves the one required game screen (Invariant #81) mounts.
// The board renders through the renderer's public component barrels only
// (@chimera/renderer/components/ui), so this exercises the Invariant #96 boundary.
// It surfaces the game's display name in both the panel title and heading, hence
// getAllByText. Replace with assertions on your real board as it grows.
describe('__GamePascal__Board', () => {
    it('renders the board through the renderer public component barrels', () => {
        render(<__GamePascal__Board />);

        expect(screen.getAllByText('__Game Title__').length).toBeGreaterThan(0);
    });
});
