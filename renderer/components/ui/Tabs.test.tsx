// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { Tabs } from './Tabs';
import tabsCss from './Tabs.module.css?raw';

function renderTabs(onActiveTabChange = vi.fn()): ReturnType<typeof vi.fn> {
    render(
        <Tabs
            ariaLabel="Inspector panels"
            defaultActiveTabId="overview"
            onActiveTabChange={onActiveTabChange}
            tabs={[
                {
                    id: 'overview',
                    label: 'Overview',
                    panel: <p>Summary panel</p>,
                },
                {
                    disabled: true,
                    id: 'assets',
                    label: 'Assets',
                    panel: <p>Assets panel</p>,
                },
                {
                    id: 'logs',
                    label: 'Logs',
                    panel: <p>Logs panel</p>,
                },
            ]}
        />,
    );

    return onActiveTabChange;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Tabs', () => {
    it('renders tablist, tab, and tabpanel semantics', () => {
        renderTabs();

        expect(screen.getByRole('tablist', { name: 'Inspector panels' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(screen.getByRole('tabpanel', { name: 'Overview' })).toHaveTextContent(
            'Summary panel',
        );
        expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(3);
        expect(screen.getByText('Assets panel').closest('[role="tabpanel"]')).toHaveAttribute(
            'hidden',
        );
        expect(screen.getByText('Logs panel').closest('[role="tabpanel"]')).toHaveAttribute(
            'hidden',
        );
    });

    it('marks the active tab selected and associates it with the active panel', () => {
        renderTabs();

        const activeTab = screen.getByRole('tab', { name: 'Overview' });
        const activePanel = screen.getByRole('tabpanel', { name: 'Overview' });

        expect(activeTab).toHaveAttribute('aria-selected', 'true');
        expect(activeTab).toHaveAttribute('aria-controls', activePanel.id);
        expect(activePanel).toHaveAttribute('aria-labelledby', activeTab.id);
        expect(activePanel).not.toHaveAttribute('hidden');
    });

    it('activates a clicked tab and notifies the caller', async () => {
        const user = userEvent.setup();
        const onActiveTabChange = renderTabs();

        await user.click(screen.getByRole('tab', { name: 'Logs' }));

        expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tabpanel', { name: 'Logs' })).toHaveTextContent('Logs panel');
        expect(onActiveTabChange).toHaveBeenCalledWith('logs');
    });

    it('does not activate disabled tabs', async () => {
        const user = userEvent.setup();
        const onActiveTabChange = renderTabs();

        await user.click(screen.getByRole('tab', { name: 'Assets' }));

        expect(screen.getByRole('tab', { name: 'Assets' })).toBeDisabled();
        expect(screen.getByRole('tab', { name: 'Assets' })).toHaveAttribute(
            'aria-selected',
            'false',
        );
        expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(onActiveTabChange).not.toHaveBeenCalled();
    });

    it('supports ArrowLeft, ArrowRight, Home, and End keyboard navigation', async () => {
        const user = userEvent.setup();
        renderTabs();

        const overviewTab = screen.getByRole('tab', { name: 'Overview' });
        const logsTab = screen.getByRole('tab', { name: 'Logs' });

        overviewTab.focus();
        await user.keyboard('{ArrowRight}');

        expect(logsTab).toHaveFocus();
        expect(logsTab).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{ArrowLeft}');

        expect(overviewTab).toHaveFocus();
        expect(overviewTab).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{End}');

        expect(logsTab).toHaveFocus();
        expect(logsTab).toHaveAttribute('aria-selected', 'true');

        await user.keyboard('{Home}');

        expect(overviewTab).toHaveFocus();
        expect(overviewTab).toHaveAttribute('aria-selected', 'true');
    });

    it('uses tokenized styling for invariant #86', () => {
        const css = tabsCss;

        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        const hardcodedPixelValues = css.replace(/var\([^)]+\)/g, '').match(/\b\d+px\b/g);
        expect(hardcodedPixelValues).toBeNull();
        expect(css).toContain(':focus-visible');
        expect(css).toContain('var(--ch-focus-ring-color)');
    });

    it('keeps tab bottom corners square and masks the tablist rule under active and hovered tabs', () => {
        const css = tabsCss;

        expect(css).toMatch(
            /border-radius:\s*var\(--ch-radius-md\)\s+var\(--ch-radius-md\)\s+var\(--ch-space-none\)\s+var\(--ch-space-none\);/,
        );
        expect(css).toContain('position: relative;');
        expect(css).toContain('.tab-active::after,');
        expect(css).toContain('.tab:not(:disabled):hover::after');
        expect(css).toMatch(
            /\.tab-active\s*\{[^}]*background-color:\s*var\(--ch-color-surface-raised\);[^}]*\}/,
        );
        expect(css).toMatch(
            /\.tab-active::after,\s*\.tab:not\(:disabled\):hover::after\s*\{[^}]*background-color:\s*inherit;[^}]*\}/,
        );
        expect(css).toContain('bottom: calc(var(--ch-border-width-sm) * -1);');
        expect(css).toContain("content: '';");
        expect(css).toContain('height: var(--ch-border-width-sm);');
        expect(css).toContain('inset-inline: var(--ch-space-none);');
    });

    it('lets the active panel fill and scroll inside a height-constrained tabs container', () => {
        const tabsRule = /\.tabs\s*\{[^}]*\}/s.exec(tabsCss)?.[0] ?? '';
        const panelRule = /\.tabpanel\s*\{[^}]*\}/s.exec(tabsCss)?.[0] ?? '';

        expect(tabsRule).toContain('min-block-size: var(--ch-space-none)');
        expect(panelRule).toContain('flex: 1 1 auto');
        expect(panelRule).toContain('min-block-size: var(--ch-space-none)');
        expect(panelRule).toContain('overflow: auto');
    });

    it('keeps the tablist at its natural height when the panel overflows', () => {
        const tablistRule = /\.tablist\s*\{[^}]*\}/s.exec(tabsCss)?.[0] ?? '';

        expect(tablistRule).toContain('flex: none');
    });

    it('follows the controlled activeTabId prop across re-renders', () => {
        const controlledTabs: ComponentProps<typeof Tabs>['tabs'] = [
            { id: 'overview', label: 'Overview', panel: <p>Overview panel</p> },
            { id: 'logs', label: 'Logs', panel: <p>Logs panel</p> },
        ];

        const { rerender } = render(
            <Tabs ariaLabel="Test panels" activeTabId="overview" tabs={controlledTabs} />,
        );

        expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
            'aria-selected',
            'true',
        );
        expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'false');

        rerender(<Tabs ariaLabel="Test panels" activeTabId="logs" tabs={controlledTabs} />);

        expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
            'aria-selected',
            'false',
        );
        expect(screen.getByRole('tabpanel', { name: 'Logs' })).not.toHaveAttribute('hidden');
        expect(screen.getByText('Overview panel').closest('[role="tabpanel"]')).toHaveAttribute(
            'hidden',
        );
    });
});
