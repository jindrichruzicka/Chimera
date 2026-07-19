// renderer/app/providers.ssr.test.tsx
//
// Next static-export prerender executes Providers in Node, where window and
// the Web Audio API do not exist. The prerender pass must stay silent — no
// per-route console noise from environment-dependent init.

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from './providers';

describe('Providers (server prerender)', () => {
    it('renders children without console noise when the Web Audio API is unavailable', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        const markup = renderToStaticMarkup(
            <Providers>
                <div data-testid="prerendered-child" />
            </Providers>,
        );

        expect(markup).toContain('data-testid="prerendered-child"');
        expect(warn).not.toHaveBeenCalled();
    });
});
