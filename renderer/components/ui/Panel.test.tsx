// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Panel } from './Panel';

afterEach(() => {
    cleanup();
});

describe('Panel', () => {
    it('renders children inside a named region', () => {
        render(
            <Panel title="Loadout" data-testid="panel">
                Panel body
            </Panel>,
        );

        expect(screen.getByRole('region', { name: 'Loadout' })).toBeInTheDocument();
        expect(screen.getByText('Panel body')).toBeInTheDocument();
        expect(screen.getByTestId('panel')).toHaveAttribute('data-ch-panel-variant', 'surface');
    });
});
