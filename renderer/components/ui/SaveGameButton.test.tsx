// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render as baseRender, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SAVE_LABEL_LENGTH } from '@chimera-engine/simulation/bridge/api-types.js';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { TranslationBundle } from '../../i18n/translation-bundle';
import { EscapeStackProvider } from '../shell/EscapeStack';
import { SaveGameButton } from './SaveGameButton';

// SaveGameButton's name-prompt Modal routes Escape-to-close through the shared
// overlay stack, so every render must sit inside an EscapeStackProvider
// (useEscapeLayer throws otherwise). It also calls useTranslate(); the inert
// I18nProvider resolves engine English so the existing label assertions hold. A
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
    fireEvent.click(screen.getByTestId('save-trigger'));
}

function typeName(value: string): void {
    fireEvent.change(screen.getByTestId('save-name-input'), { target: { value } });
}

describe('SaveGameButton', () => {
    it('renders only the trigger with the name dialog closed by default', () => {
        render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} />);

        expect(screen.getByTestId('save-trigger')).toBeInTheDocument();
        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });

    it('opens the name dialog when the trigger is clicked', () => {
        render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} />);

        openDialog();

        expect(screen.getByRole('dialog', { name: 'Save game' })).toBeInTheDocument();
        expect(screen.getByTestId('save-name-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('save-name-input')).toHaveValue('');
    });

    it('resolves the dialog title through the active-locale translator', () => {
        render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} />, {
            'engine.saveGame.dialogTitle': 'Store game',
        });

        openDialog();

        expect(screen.getByRole('dialog', { name: 'Store game' })).toBeInTheDocument();
    });

    it('bounds the name input to the shared save-label maximum', () => {
        render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} />);

        openDialog();

        expect(screen.getByTestId('save-name-input')).toHaveAttribute(
            'maxlength',
            String(MAX_SAVE_LABEL_LENGTH),
        );
    });

    it('reflects typing in the name input', () => {
        render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} />);

        openDialog();
        typeName('  Alpha  ');

        expect(screen.getByTestId('save-name-input')).toHaveValue('  Alpha  ');
    });

    it('calls onSave exactly once with the trimmed label and closes on Save', () => {
        const onSave = vi.fn();
        render(<SaveGameButton data-testid="save-trigger" onSave={onSave} />);

        openDialog();
        typeName('  Alpha  ');
        fireEvent.click(screen.getByTestId('save-name-confirm'));

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('Alpha');
        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });

    it('passes an empty label through when the name is left blank', () => {
        const onSave = vi.fn();
        render(<SaveGameButton data-testid="save-trigger" onSave={onSave} />);

        openDialog();
        fireEvent.click(screen.getByTestId('save-name-confirm'));

        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith('');
    });

    it('closes without saving on Cancel', () => {
        const onSave = vi.fn();
        render(<SaveGameButton data-testid="save-trigger" onSave={onSave} />);

        openDialog();
        typeName('Alpha');
        fireEvent.click(screen.getByTestId('save-name-cancel'));

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });

    it('closes without saving on Escape', () => {
        const onSave = vi.fn();
        render(<SaveGameButton data-testid="save-trigger" onSave={onSave} />);

        openDialog();
        typeName('Alpha');
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });

    it('clears the previous label when reopened', () => {
        render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} />);

        openDialog();
        typeName('Alpha');
        fireEvent.click(screen.getByTestId('save-name-cancel'));
        openDialog();

        expect(screen.getByTestId('save-name-input')).toHaveValue('');
    });

    it('does not open while disabled', () => {
        render(<SaveGameButton data-testid="save-trigger" disabled onSave={vi.fn()} />);

        const trigger = screen.getByTestId('save-trigger');
        expect(trigger).toBeDisabled();

        fireEvent.click(trigger);

        expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
    });

    it('forwards style and testid to a compact trigger button', () => {
        render(
            <SaveGameButton
                data-testid="hud-save-btn"
                onSave={vi.fn()}
                style={{ marginTop: 'var(--ch-space-xs)' }}
            />,
        );

        const trigger = screen.getByTestId('hud-save-btn');
        expect(trigger).toHaveStyle({ marginTop: 'var(--ch-space-xs)' });
        expect(trigger).toHaveAttribute('data-ch-button-size', 'sm');
    });

    describe('icon trigger mode', () => {
        it('renders a borderless icon-only trigger carrying the save glyph', () => {
            render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} trigger="icon" />);

            const trigger = screen.getByTestId('save-trigger');
            // Ghost (chrome-less) IconButton, not the labelled text Button.
            expect(trigger).toHaveAttribute('data-ch-icon-button-variant', 'ghost');
            expect(trigger.querySelector('svg[data-ch-icon="save"]')).not.toBeNull();
            // Icon-only: the accessible name lives on aria-label, not visible text.
            expect(trigger).toHaveAccessibleName('Save');
            expect(trigger).not.toHaveTextContent('Save');
        });

        it('opens the same name dialog and saves exactly once from the icon trigger', () => {
            const onSave = vi.fn();
            render(<SaveGameButton data-testid="save-trigger" onSave={onSave} trigger="icon" />);

            openDialog();
            typeName('  fort hold  ');
            fireEvent.click(screen.getByTestId('save-name-confirm'));

            expect(onSave).toHaveBeenCalledTimes(1);
            expect(onSave).toHaveBeenCalledWith('fort hold');
            expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
        });

        it('respects disabled in icon mode', () => {
            render(
                <SaveGameButton
                    data-testid="save-trigger"
                    disabled
                    onSave={vi.fn()}
                    trigger="icon"
                />,
            );

            const trigger = screen.getByTestId('save-trigger');
            expect(trigger).toBeDisabled();

            fireEvent.click(trigger);

            expect(screen.queryByTestId('save-name-dialog')).not.toBeInTheDocument();
        });

        it('names the icon trigger through the active-locale translator', () => {
            render(<SaveGameButton data-testid="save-trigger" onSave={vi.fn()} trigger="icon" />, {
                'engine.saveGame.save': 'Uložit',
            });

            const trigger = screen.getByRole('button', { name: 'Uložit' });
            expect(trigger).toHaveAttribute('data-testid', 'save-trigger');
            // The hover title tracks the same translated label as aria-label.
            expect(trigger).toHaveAttribute('title', 'Uložit');
        });

        it('forwards style and hover title to the icon trigger, like button mode', () => {
            render(
                <SaveGameButton
                    data-testid="save-trigger"
                    onSave={vi.fn()}
                    style={{ marginTop: 'var(--ch-space-xs)' }}
                    trigger="icon"
                />,
            );

            const trigger = screen.getByTestId('save-trigger');
            expect(trigger).toHaveStyle({ marginTop: 'var(--ch-space-xs)' });
            expect(trigger).toHaveAttribute('title', 'Save');
        });
    });
});
