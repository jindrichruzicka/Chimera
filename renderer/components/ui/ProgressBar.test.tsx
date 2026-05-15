// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressBar } from './ProgressBar';

afterEach(() => {
    cleanup();
});

describe('ProgressBar', () => {
    it('renders progressbar semantics with bounded values', () => {
        render(<ProgressBar label="Loading" value={120} max={100} />);

        const progress = screen.getByRole('progressbar', { name: 'Loading' });
        expect(progress).toHaveAttribute('aria-valuemin', '0');
        expect(progress).toHaveAttribute('aria-valuemax', '100');
        expect(progress).toHaveAttribute('aria-valuenow', '100');
    });
});
