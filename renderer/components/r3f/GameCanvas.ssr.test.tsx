// renderer/components/r3f/GameCanvas.ssr.test.tsx
//
// The canvas root reads the display's device-pixel ratio through
// `useSyncExternalStore`, which throws on the server unless it is given a
// server snapshot — and a server render has no window to read a ratio from.
// A regression there fails a server render, not any jsdom test, which is why
// this file runs in the node environment (no jsdom header), mirroring
// `renderer/app/providers.ssr.test.tsx`.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameCanvas } from './GameCanvas';

describe('GameCanvas (server render)', () => {
    it('renders where there is no window', () => {
        expect(typeof window).toBe('undefined');

        expect(() =>
            renderToStaticMarkup(
                <GameCanvas camera="free">
                    <mesh />
                </GameCanvas>,
            ),
        ).not.toThrow();
    });
});
