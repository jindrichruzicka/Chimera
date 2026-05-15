// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Badge } from './Badge';

afterEach(() => {
    cleanup();
});

describe('Badge', () => {
    it('renders status text with a semantic variant marker', () => {
        render(<Badge variant="success">Ready</Badge>);

        expect(screen.getByText('Ready')).toHaveAttribute('data-ch-badge-variant', 'success');
    });
});
