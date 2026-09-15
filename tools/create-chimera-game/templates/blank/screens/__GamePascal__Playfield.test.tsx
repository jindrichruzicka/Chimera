// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import __GamePascal__Playfield from './__GamePascal__Playfield.js';

// The canvas is stood in for. react-three-fiber's canvas measures its box with
// ResizeObserver, which jsdom does not provide, so a real one throws on render
// here. The stand-in renders the canvas children as plain elements, which is
// enough to see WHAT the playfield puts inside its canvas.
vi.mock('@chimera-engine/renderer/components/r3f', () => ({
    GameCanvas: ({ children }: { readonly children: React.ReactNode }) => (
        <div data-testid="game-canvas">{children}</div>
    ),
    LightingRig: () => <span data-testid="lighting-rig" />,
}));

// Screen render smoke — proves the one required game screen mounts.
// The playfield renders through the renderer's public barrels only
// (@chimera-engine/renderer/components/ui and components/r3f), so this
// exercises that boundary. It surfaces the game's display name once, as the
// panel title. Replace with assertions on your real playfield as it grows.
describe('__GamePascal__Playfield', () => {
    // Vitest runs without globals here, so Testing Library installs no cleanup
    // of its own: without this, a query finds every earlier test's render too.
    afterEach(() => {
        cleanup();
    });

    it('renders the playfield through the renderer public component barrels', () => {
        render(<__GamePascal__Playfield />);

        expect(screen.getByText('__Game Title__')).toBeInTheDocument();
    });

    it('mounts the engine light rig inside the playfield canvas', () => {
        render(<__GamePascal__Playfield />);

        expect(screen.getByTestId('game-canvas')).toContainElement(
            screen.getByTestId('lighting-rig'),
        );
    });

    it('makes the scene host the screen root', () => {
        // The full-bleed rule only reaches the host section if it is on the
        // OUTERMOST element: any in-flow wrapper between them re-introduces the
        // auto-height link the absolute positioning exists to skip, and a canvas
        // mounted inside collapses to a strip. jsdom computes no layout, so the
        // element identity is the only part of that this can assert.
        const { container } = render(<__GamePascal__Playfield />);

        expect(container.firstElementChild?.className).toContain('sceneHost');
    });
});
