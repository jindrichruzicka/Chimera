import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Select draws its chrome on `.controlShell` instead of `.control`: the macOS
 * native popup anchors to the <select> border-box, which Select offsets inside
 * the shell so the menu lands flush with the visible box. The shell therefore
 * owns the border/background and mirrors the control state via `:has()`.
 */
const fieldModules = [
    {
        fileName: 'TextInput.module.css',
        focusSelector: '.control:focus-visible',
        hoverSelector: '.control:hover:not(:disabled)',
        invalidSelector: ".control[data-invalid='true']",
    },
    {
        fileName: 'NumberInput.module.css',
        focusSelector: '.control:focus-visible',
        hoverSelector: '.control:hover:not(:disabled)',
        invalidSelector: ".control[data-invalid='true']",
    },
    {
        fileName: 'Select.module.css',
        focusSelector: '.controlShell:has(.control:focus-visible)',
        hoverSelector: '.controlShell:has(.control:enabled):hover',
        invalidSelector: ".controlShell:has(.control[data-invalid='true'])",
    },
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

describe.each(fieldModules)(
    'labeled field styles ($fileName)',
    ({ fileName, focusSelector, hoverSelector, invalidSelector }) => {
        const css = readModuleCss(fileName);

        it('caps the field width so controls do not stretch across wide containers', () => {
            expect(extractDeclarations(css, '.root')).toContain(
                'max-inline-size: calc(var(--ch-space-xl) * 12)',
            );
        });

        it('renders the label in the secondary text color sized to its content', () => {
            const label = extractDeclarations(css, '.label');

            expect(label).toContain('color: var(--ch-color-text-secondary)');
            expect(label).toContain('align-self: flex-start');
        });

        it('brightens the border on hover as an affordance', () => {
            expect(extractDeclarations(css, hoverSelector)).toContain(
                'border-color: var(--ch-color-border-strong)',
            );
        });

        it('focuses with a single accent border instead of an offset halo ring', () => {
            const focus = extractDeclarations(css, focusSelector);

            expect(focus).toContain('border-color: var(--ch-focus-ring-color)');
            expect(focus).toContain('background-color: var(--ch-color-surface-overlay)');
            expect(focus).toContain(
                'outline: var(--ch-focus-ring-width) solid var(--ch-color-transparent)',
            );
            expect(focus).toContain('outline-offset: calc(var(--ch-focus-ring-width) * -1)');
            expect(focus).not.toContain('var(--ch-focus-ring-offset)');
        });

        it('keeps the invalid border override declared after the focus rule', () => {
            expect(css.indexOf(invalidSelector)).toBeGreaterThan(css.indexOf(focusSelector));
        });
    },
);

describe.each(['TextInput.module.css', 'NumberInput.module.css'])(
    'text field control padding (%s)',
    (fileName) => {
        it('uses compact inline padding so the text sits closer to the border', () => {
            expect(extractDeclarations(readModuleCss(fileName), '.control')).toContain(
                'padding: var(--ch-space-sm) calc(var(--ch-space-sm) + var(--ch-space-xs))',
            );
        });
    },
);

describe('select control padding', () => {
    it('indents the value text to match the compact text field padding', () => {
        expect(extractDeclarations(readModuleCss('Select.module.css'), '.control')).toContain(
            'text-indent: calc(var(--ch-space-sm) + var(--ch-space-xs))',
        );
    });
});
