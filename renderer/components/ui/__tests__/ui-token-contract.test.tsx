// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EscapeStackProvider } from '../../shell/EscapeStack';
import { I18nProvider } from '../../../i18n/I18nProvider';
import {
    Badge,
    Card,
    Divider,
    Drawer,
    Modal,
    Panel,
    Popover,
    ProgressBar,
    ScrollArea,
    Slider,
    Spinner,
    Tooltip,
} from '../index';

// Modal/Drawer route Escape-to-close through the shared overlay stack AND
// resolve their default close labels through useTranslate(), so the wrapper
// supplies both providers; it is applied to rerenders too, so the Modal/Drawer
// cases are covered.
function UiContractProviders({
    children,
}: {
    readonly children: React.ReactNode;
}): React.ReactElement {
    return (
        <I18nProvider>
            <EscapeStackProvider>{children}</EscapeStackProvider>
        </I18nProvider>
    );
}

const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: UiContractProviders });

afterEach(() => {
    cleanup();
});

describe('ui primitive runtime contract', () => {
    it('renders each primitive with its basic semantic role', () => {
        const { rerender } = render(<Badge>Ready</Badge>);
        expect(screen.getByText('Ready')).toBeInTheDocument();

        rerender(<Card>Mission summary</Card>);
        expect(screen.getByText('Mission summary')).toBeInTheDocument();

        rerender(<Divider orientation="vertical" />);
        expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical');

        rerender(
            <Drawer open title="Inventory" onClose={() => undefined}>
                Drawer content
            </Drawer>,
        );
        expect(screen.getByRole('dialog', { name: 'Inventory' })).toBeInTheDocument();

        rerender(
            <Modal open title="Settings" onClose={() => undefined}>
                Modal content
            </Modal>,
        );
        expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();

        rerender(<Panel title="Loadout">Panel body</Panel>);
        expect(screen.getByRole('region', { name: 'Loadout' })).toBeInTheDocument();

        rerender(
            <Popover defaultOpen content="Popover content" label="Quick actions">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Actions
                    </button>
                )}
            </Popover>,
        );
        expect(screen.getByRole('dialog', { name: 'Quick actions' })).toBeInTheDocument();

        rerender(<ProgressBar label="Loading" value={25} max={100} />);
        expect(screen.getByRole('progressbar', { name: 'Loading' })).toHaveAttribute(
            'aria-valuenow',
            '25',
        );

        rerender(<ScrollArea aria-label="Combat log">Log entry</ScrollArea>);
        expect(screen.getByRole('region', { name: 'Combat log' })).toBeInTheDocument();

        rerender(<Slider label="Music volume" min={0} max={100} value={40} />);
        expect(screen.getByRole('slider', { name: 'Music volume' })).toBeInTheDocument();

        rerender(<Spinner label="Loading assets" />);
        expect(screen.getByRole('status', { name: 'Loading assets' })).toBeInTheDocument();

        rerender(
            <Tooltip content="Open settings">
                {(triggerProps) => (
                    <button type="button" {...triggerProps}>
                        Settings
                    </button>
                )}
            </Tooltip>,
        );
        expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    });

    it('does not set inline styles by default', () => {
        render(
            <>
                <Badge>Ready</Badge>
                <Card>Mission summary</Card>
                <Panel title="Loadout">Panel body</Panel>
                <ProgressBar label="Loading" value={25} max={100} />
                <ScrollArea aria-label="Combat log">Log entry</ScrollArea>
                <Spinner label="Loading assets" />
            </>,
        );

        expect(screen.getByText('Ready')).not.toHaveAttribute('style');
        expect(screen.getByText('Mission summary')).not.toHaveAttribute('style');
        expect(screen.getByRole('region', { name: 'Loadout' })).not.toHaveAttribute('style');
        expect(screen.getByRole('progressbar', { name: 'Loading' })).not.toHaveAttribute('style');
        expect(screen.getByRole('region', { name: 'Combat log' })).not.toHaveAttribute('style');
        expect(screen.getByRole('status', { name: 'Loading assets' })).not.toHaveAttribute('style');
    });
});
