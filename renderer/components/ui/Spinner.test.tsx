// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Spinner } from './Spinner';

afterEach(() => {
    cleanup();
});

describe('Spinner', () => {
    it('renders a labelled status indicator', () => {
        render(<Spinner label="Loading assets" />);

        expect(screen.getByRole('status', { name: 'Loading assets' })).toBeInTheDocument();
    });

    it('renders an indicator element inside the status container', () => {
        render(<Spinner label="Loading assets" />);

        const status = screen.getByRole('status', { name: 'Loading assets' });
        expect(status.firstElementChild).toBeInTheDocument();
    });
});
