import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Unified keyboard-focus contract: every interactive component draws its
 * :focus-visible indicator at or inside its border-box, so an `overflow`
 * ancestor (e.g. the Tabs tablist scroll container) can never clip the ring
 * into a stray sliver. Bordered components recolor their border to the shared
 * focus-ring color and keep a transparent inset outline so forced-colors modes
 * still draw an indicator; borderless components draw a visible inset outline
 * instead. The halo offset token (--ch-focus-ring-offset) is retired — nothing
 * may paint a focus indicator outside the element.
 */

const borderedFocusRules = [
    { fileName: 'Tabs.module.css', focusSelector: '.tab:focus-visible' },
    { fileName: 'Tabs.module.css', focusSelector: '.tabpanel:focus-visible' },
    { fileName: 'Button.module.css', focusSelector: '.button:not(:disabled):focus-visible' },
    { fileName: 'IconButton.module.css', focusSelector: '.icon-button:focus-visible' },
    { fileName: 'ToggleButton.module.css', focusSelector: '.toggle-button:focus-visible' },
    { fileName: 'Toggle.module.css', focusSelector: '.input:focus-visible ~ .track' },
    { fileName: 'TextInput.module.css', focusSelector: '.control:focus-visible' },
    { fileName: 'NumberInput.module.css', focusSelector: '.control:focus-visible' },
    { fileName: 'Select.module.css', focusSelector: '.controlShell:has(.control:focus-visible)' },
] as const;

const insetRingFocusRules = [
    { fileName: 'Slider.module.css', focusSelector: '.input:focus-visible' },
    { fileName: '../shell/listBrowser.module.css', focusSelector: '.row:focus-visible' },
] as const;

function readModuleCss(fileName: string): string {
    return readFileSync(fileURLToPath(new URL(`./${fileName}`, import.meta.url)), 'utf8');
}

function extractDeclarations(css: string, selector: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(css);

    if (match?.[1] === undefined) {
        throw new Error(`Missing rule for selector "${selector}"`);
    }

    return match[1];
}

describe.each(borderedFocusRules)(
    'bordered focus highlight ($fileName $focusSelector)',
    ({ fileName, focusSelector }) => {
        const focus = extractDeclarations(readModuleCss(fileName), focusSelector);

        it('recolors the border to the shared focus-ring color', () => {
            expect(focus).toContain('border-color: var(--ch-focus-ring-color)');
        });

        it('keeps a transparent inset outline for forced-colors modes', () => {
            expect(focus).toContain(
                'outline: var(--ch-focus-ring-width) solid var(--ch-color-transparent)',
            );
            expect(focus).toContain('outline-offset: calc(var(--ch-focus-ring-width) * -1)');
        });
    },
);

describe.each(insetRingFocusRules)(
    'borderless inset focus ring ($fileName $focusSelector)',
    ({ fileName, focusSelector }) => {
        const focus = extractDeclarations(readModuleCss(fileName), focusSelector);

        it('draws a visible inset outline in the shared focus-ring color', () => {
            expect(focus).toContain(
                'outline: var(--ch-focus-ring-width) solid var(--ch-focus-ring-color)',
            );
            expect(focus).toContain('outline-offset: calc(var(--ch-focus-ring-width) * -1)');
        });
    },
);

describe.each([
    ...new Set([...borderedFocusRules, ...insetRingFocusRules].map((rule) => rule.fileName)),
])('halo ring ban (%s)', (fileName) => {
    it('never paints a focus indicator outside the border-box', () => {
        expect(readModuleCss(fileName)).not.toContain('var(--ch-focus-ring-offset)');
    });
});

/**
 * Accent-on-accent collisions: in palettes that point the focus ring at the
 * accent (as Tactics does), the ring color equals the resting accent border of
 * primary buttons and the checked Toggle track, so those states need a second
 * cue beyond the border recolor. The cue is palette-independent so game
 * overrides can never lose keyboard focus visibility.
 */
describe('focus visibility on accent-colored resting states', () => {
    it('Button focus applies the hover backdrop so primary buttons still light up', () => {
        const focus = extractDeclarations(
            readModuleCss('Button.module.css'),
            '.button:not(:disabled):focus-visible',
        );

        expect(focus).toContain('background: var(--ch-button-hover-bg)');
        expect(focus).toContain('box-shadow: var(--ch-button-shadow-hover)');
    });

    it('IconButton focus applies the hover backdrop', () => {
        const focus = extractDeclarations(
            readModuleCss('IconButton.module.css'),
            '.icon-button:focus-visible',
        );

        expect(focus).toContain('background: var(--ch-icon-button-bg-hover)');
        expect(focus).toContain('box-shadow: var(--ch-icon-button-shadow-hover)');
    });

    it('ToggleButton focus raises the hover shadow without overriding the pressed fill', () => {
        const focus = extractDeclarations(
            readModuleCss('ToggleButton.module.css'),
            '.toggle-button:focus-visible',
        );

        expect(focus).toContain('box-shadow: var(--ch-toggle-button-shadow-hover)');
        expect(focus).not.toContain('background:');
    });

    it('checked Toggle track swaps the focus border to text-primary', () => {
        const focus = extractDeclarations(
            readModuleCss('Toggle.module.css'),
            ".root[data-checked='true'] .input:focus-visible ~ .track",
        );

        expect(focus).toContain('border-color: var(--ch-color-text-primary)');
    });
});
