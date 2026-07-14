// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sliderCss from './Slider.module.css?raw';
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

    it('stretches the range input to align with sibling form controls', () => {
        expect(sliderCss).toContain('inline-size: 100%');
        expect(sliderCss).not.toContain('width: var(--ch-button-min-width-lg)');
    });

    it('draws an inset keyboard focus ring on the range input', () => {
        expect(sliderCss).toContain('.input:focus-visible');
        expect(sliderCss).toContain(
            'outline: var(--ch-focus-ring-width) solid var(--ch-focus-ring-color)',
        );
    });

    it('keeps the label as the accessible name but hides it visually when hideLabel is set', () => {
        render(<Slider label="Music volume" min={0} max={100} value={40} hideLabel />);

        // Still the field's accessible name…
        expect(screen.getByRole('slider', { name: 'Music volume' })).toBeInTheDocument();
        // …but the label element carries the visually-hidden class (jsdom applies
        // no CSS, so the presence of the class is the testable signal).
        expect(screen.getByText('Music volume').className).toContain('labelHidden');
    });

    it('leaves the label visible by default', () => {
        render(<Slider label="Music volume" min={0} max={100} value={40} />);
        expect(screen.getByText('Music volume').className).not.toContain('labelHidden');
    });

    it('defines a tokenized, visually-hidden label rule', () => {
        expect(sliderCss).toContain('.labelHidden');
        expect(sliderCss).toContain('position: absolute');
        expect(sliderCss).toContain('overflow: hidden');
        expect(sliderCss).toContain('var(--ch-space-screen-reader)');
    });
});
