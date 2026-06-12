// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonTree } from './JsonTree';

afterEach(() => {
    cleanup();
});

describe('JsonTree', () => {
    it('renders primitive leaves as key/value rows including null, boolean, number, string', () => {
        render(<JsonTree value={{ count: 3, name: 'alpha', missing: null, armed: true }} />);

        expect(screen.getByText('count')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('name')).toBeInTheDocument();
        expect(screen.getByText('"alpha"')).toBeInTheDocument();
        expect(screen.getByText('missing')).toBeInTheDocument();
        expect(screen.getByText('null')).toBeInTheDocument();
        expect(screen.getByText('armed')).toBeInTheDocument();
        expect(screen.getByText('true')).toBeInTheDocument();
    });

    it('renders a primitive root value as a single leaf row', () => {
        render(<JsonTree value={42} label="answer" />);

        expect(screen.getByText('answer')).toBeInTheDocument();
        expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('collapses composite children beyond the default expanded depth', () => {
        render(<JsonTree value={{ nested: { hidden: 1 } }} />);

        const toggle = screen.getByRole('button', { name: /nested/ });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    });

    it('expands and collapses a node when its toggle is clicked', async () => {
        const user = userEvent.setup();
        render(<JsonTree value={{ nested: { hidden: 1 } }} />);

        const toggle = screen.getByRole('button', { name: /nested/ });
        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('hidden')).toBeInTheDocument();

        await user.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    });

    it('renders arrays with index keys and an item-count summary', async () => {
        const user = userEvent.setup();
        render(<JsonTree value={{ items: ['a', 'b'] }} />);

        const toggle = screen.getByRole('button', { name: /items/ });
        expect(toggle).toHaveTextContent('[2]');

        await user.click(toggle);
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.getByText('"a"')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
        expect(screen.getByText('"b"')).toBeInTheDocument();
    });

    it('expands nested levels independently, one level at a time', async () => {
        const user = userEvent.setup();
        render(<JsonTree value={{ outer: { inner: { leaf: 7 } } }} />);

        await user.click(screen.getByRole('button', { name: /outer/ }));
        expect(screen.queryByText('leaf')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /inner/ }));
        expect(screen.getByText('leaf')).toBeInTheDocument();
        expect(screen.getByText('7')).toBeInTheDocument();
    });

    it('honours defaultExpandedDepth for the initial expansion state', () => {
        render(<JsonTree defaultExpandedDepth={2} value={{ outer: { inner: 1 } }} />);

        expect(screen.getByText('inner')).toBeInTheDocument();
        expect(screen.getByText('1')).toBeInTheDocument();
    });
});
