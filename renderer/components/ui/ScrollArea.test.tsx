// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollArea } from './ScrollArea';

afterEach(() => {
    cleanup();
});

describe('ScrollArea', () => {
    it('renders children inside a scrollable region', () => {
        render(
            <ScrollArea aria-label="Combat log" data-testid="scroll-area">
                Log entry
            </ScrollArea>,
        );

        expect(screen.getByRole('region', { name: 'Combat log' })).toHaveAttribute(
            'data-ch-scroll-area',
            'true',
        );
        expect(screen.getByText('Log entry')).toBeInTheDocument();
    });
});
