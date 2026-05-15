// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Slider } from './Slider';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Slider', () => {
    it('renders a labelled range input and forwards changes', () => {
        const onChange = vi.fn();

        render(<Slider label="Music volume" min={0} max={100} value={40} onChange={onChange} />);

        const slider = screen.getByRole('slider', { name: 'Music volume' });
        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '100');
        expect(slider).toHaveValue('40');

        fireEvent.change(slider, { target: { value: '65' } });

        expect(onChange).toHaveBeenCalledWith(65);
    });
});
