// renderer/app/LoggingBootstrap.ssr.test.tsx
//
// The install runs during LoggingBootstrap's render, so it executes on every
// Next static-export prerender in Node, where `window` does not exist. A
// regression in the environment guard fails `next build`, not any jsdom test,
// which is why this file runs in the node environment (no jsdom header),
// mirroring providers.ssr.test.tsx.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoggingBootstrap } from './LoggingBootstrap';

describe('LoggingBootstrap (server prerender)', () => {
    it('renders without throwing and without touching the console when window is absent', () => {
        const warnBefore = console.warn;
        const errorBefore = console.error;

        expect(() => renderToStaticMarkup(<LoggingBootstrap />)).not.toThrow();

        expect(console.warn).toBe(warnBefore);
        expect(console.error).toBe(errorBefore);
    });
});
