// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

afterEach(() => {
    cleanup();
});

describe('Tooltip', () => {
    it('links trigger content to a tooltip description', () => {
        render(
            <Tooltip content="Open settings">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Settings
                    </button>
                )}
            </Tooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Settings' });
        const tooltip = screen.getByRole('tooltip', { hidden: true });

        expect(tooltip).toHaveTextContent('Open settings');
        expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    });

    it('shows tooltip content only while the trigger is hovered or focused', () => {
        render(
            <Tooltip content="Open settings">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Settings
                    </button>
                )}
            </Tooltip>,
        );

        const trigger = screen.getByRole('button', { name: 'Settings' });

        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        fireEvent.mouseEnter(trigger);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings');

        fireEvent.mouseLeave(trigger);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        fireEvent.focus(trigger);
        expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings');

        fireEvent.blur(trigger);
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
});
