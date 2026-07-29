// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import __GamePascal__Playfield from './__GamePascal__Playfield.js';

// Screen render smoke — proves the one required game screen (Invariant #81) mounts.
// The playfield renders through the renderer's public component barrels only
// (@chimera-engine/renderer/components/ui), so this exercises the Invariant #96 boundary.
// It surfaces the game's display name once, as the panel title. Replace with
// assertions on your real playfield as it grows.
describe('__GamePascal__Playfield', () => {
    it('renders the playfield through the renderer public component barrels', () => {
        render(<__GamePascal__Playfield />);

        expect(screen.getByText('__Game Title__')).toBeInTheDocument();
    });
});
