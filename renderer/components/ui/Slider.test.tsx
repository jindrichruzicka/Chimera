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

    it('exposes the fill percent to the track paint as a private custom property', () => {
        render(<Slider label="Music volume" min={0} max={200} value={50} />);

        const slider = screen.getByRole('slider', { name: 'Music volume' });
        expect(slider.style.getPropertyValue('--_ch-slider-fill')).toBe('25%');
    });

    it('defaults the fill percent to the native 0-100 range when min/max are omitted', () => {
        render(<Slider label="Music volume" value={40} />);

        const slider = screen.getByRole('slider', { name: 'Music volume' });
        expect(slider.style.getPropertyValue('--_ch-slider-fill')).toBe('40%');
    });

    it('collapses a zero-span range to a 0% fill instead of dividing by zero', () => {
        render(<Slider label="Music volume" min={5} max={5} value={5} />);

        const slider = screen.getByRole('slider', { name: 'Music volume' });
        expect(slider.style.getPropertyValue('--_ch-slider-fill')).toBe('0%');
    });

    it('skins the native range input from the slider tokens instead of accent-color', () => {
        expect(sliderCss).not.toContain('accent-color');
        expect(sliderCss).toContain('appearance: none');
        expect(sliderCss).toContain('::-webkit-slider-runnable-track');
        expect(sliderCss).toContain('::-webkit-slider-thumb');
        expect(sliderCss).toContain('::-moz-range-track');
        expect(sliderCss).toContain('::-moz-range-progress');
        expect(sliderCss).toContain('::-moz-range-thumb');
        expect(sliderCss).toContain('var(--ch-slider-track-size)');
        expect(sliderCss).toContain('var(--ch-slider-track-color)');
        expect(sliderCss).toContain('var(--ch-slider-fill-color)');
        expect(sliderCss).toContain('var(--ch-slider-thumb-size)');
        expect(sliderCss).toContain('var(--ch-slider-thumb-color)');
        expect(sliderCss).toContain('var(--ch-slider-thumb-border-color)');
        expect(sliderCss).toContain('var(--_ch-slider-fill, 0%)');
    });
});
