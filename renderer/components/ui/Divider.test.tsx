// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Divider } from './Divider';

afterEach(() => {
    cleanup();
});

describe('Divider', () => {
    it('renders a separator with the requested orientation', () => {
        render(<Divider orientation="vertical" />);

        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');
    });
    it('defaults to horizontal orientation', () => {
        render(<Divider />);

        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
    });
});
