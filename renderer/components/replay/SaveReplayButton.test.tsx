// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SAVE_LABEL_LENGTH } from '@chimera-engine/simulation/bridge/api-types.js';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TranslationBundle } from '../../i18n/translation-bundle';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { SaveReplayButton } from './SaveReplayButton';
import css from './SaveReplayButton.module.css?raw';

// SaveReplayButton's name-prompt Modal routes Escape-to-close through the shared
// overlay stack, so every render must sit inside an EscapeStackProvider
// (useEscapeLayer throws otherwise). It also calls useTranslate(); the inert
// I18nProvider resolves engine English so the label assertions hold. A
// gameOverride exercises the translate-at-the-render-site path.
const render = (
    ui: React.ReactElement,
    gameOverride?: TranslationBundle,
): ReturnType<typeof baseRender> => {
    const providerProps = gameOverride !== undefined ? { gameOverride } : {};
    return baseRender(
        <I18nProvider {...providerProps}>
            <EscapeStackProvider>{ui}</EscapeStackProvider>
        </I18nProvider>,
    );
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function openDialog(): void {
    fireEvent.click(screen.getByTestId('replay-save-btn'));
}

function typeName(value: string): void {
    fireEvent.change(screen.getByTestId('replay-save-name-input'), { target: { value } });
}

describe('SaveReplayButton', () => {
    it('renders only the save icon with the name dialog closed by default', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />);

        expect(screen.getByTestId('replay-save-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('replay-save-name-dialog')).not.toBeInTheDocument();
    });

    it('opens the name dialog when the save icon is clicked', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />);

        openDialog();

        expect(screen.getByRole('dialog', { name: 'Save replay' })).toBeInTheDocument();
        expect(screen.getByTestId('replay-save-name-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('replay-save-name-input')).toHaveValue('');
    });

    it('resolves the dialog title through the active-locale translator', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />, {
            'engine.replays.saveDialogTitle': 'Store replay',
        });

        openDialog();

        expect(screen.getByRole('dialog', { name: 'Store replay' })).toBeInTheDocument();
    });

    it('bounds the name input to the shared save-label maximum', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />);

        openDialog();

        expect(screen.getByTestId('replay-save-name-input')).toHaveAttribute(
            'maxlength',
            String(MAX_SAVE_LABEL_LENGTH),
        );
    });

    it('reflects typing in the name input', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />);

        openDialog();
        typeName('  Alpha  ');

        expect(screen.getByTestId('replay-save-name-input')).toHaveValue('  Alpha  ');
    });

    it('calls onSave exactly once with the trimmed name and closes on Save', () => {
        const onSave = vi.fn();
        render(<SaveReplayButton onSave={onSave} saving={false} saved={false} />);

        openDialog();
        typeName('  Alpha  ');
        fireEvent.click(screen.getByTestId('replay-save-name-confirm'));

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('Alpha');
        expect(screen.queryByTestId('replay-save-name-dialog')).not.toBeInTheDocument();
    });

    it('passes an empty name through when the field is left blank', () => {
        const onSave = vi.fn();
        render(<SaveReplayButton onSave={onSave} saving={false} saved={false} />);

        openDialog();
        fireEvent.click(screen.getByTestId('replay-save-name-confirm'));

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('');
    });

    it('closes without saving on Cancel', () => {
        const onSave = vi.fn();
        render(<SaveReplayButton onSave={onSave} saving={false} saved={false} />);

        openDialog();
        typeName('Alpha');
        fireEvent.click(screen.getByTestId('replay-save-name-cancel'));

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.queryByTestId('replay-save-name-dialog')).not.toBeInTheDocument();
    });

    it('closes without saving on Escape', () => {
        const onSave = vi.fn();
        render(<SaveReplayButton onSave={onSave} saving={false} saved={false} />);

        openDialog();
        typeName('Alpha');
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.queryByTestId('replay-save-name-dialog')).not.toBeInTheDocument();
    });

    it('clears the previous name when reopened', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />);

        openDialog();
        typeName('Alpha');
        fireEvent.click(screen.getByTestId('replay-save-name-cancel'));
        openDialog();

        expect(screen.getByTestId('replay-save-name-input')).toHaveValue('');
    });

    it('does not open while a save is in flight', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving saved={false} />);

        const trigger = screen.getByTestId('replay-save-btn');
        expect(trigger).toBeDisabled();

        fireEvent.click(trigger);

        expect(screen.queryByTestId('replay-save-name-dialog')).not.toBeInTheDocument();
    });

    it('marks the icon saved and disables it once saved', () => {
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved />);

        // The accessible name switches to the saved state and the control is inert.
        const trigger = screen.getByRole('button', { name: /replay saved/i });
        expect(trigger).toBeDisabled();
        expect(screen.queryByRole('button', { name: /^save replay$/i })).toBeNull();

        fireEvent.click(trigger);
        expect(screen.queryByTestId('replay-save-name-dialog')).not.toBeInTheDocument();
    });

    it('renders as a ghost icon button so its hover matches the ghost transport keys', () => {
        // The ghost variant now owns the ghost-hover colour alignment centrally
        // (IconButton .ghost sets --ch-icon-button-color-hover), so the save icon
        // lights up like the ghost buttons beside it without a bespoke rule here.
        render(<SaveReplayButton onSave={vi.fn()} saving={false} saved={false} />);

        expect(screen.getByTestId('replay-save-btn')).toHaveAttribute(
            'data-ch-icon-button-variant',
            'ghost',
        );
        expect(css).not.toContain('.save:hover');
    });

    it('CSS carries no hardcoded colour values (invariant #86)', () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
});
