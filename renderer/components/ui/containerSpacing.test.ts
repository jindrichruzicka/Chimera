import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

describe('container spacing', () => {
    it('Panel trims the leading and trailing child margins inside its body', () => {
        const css = readModuleCss('Panel.module.css');

        expect(extractDeclarations(css, '.body > :first-child')).toContain(
            'margin-block-start: var(--ch-space-none)',
        );
        expect(extractDeclarations(css, '.body > :last-child')).toContain(
            'margin-block-end: var(--ch-space-none)',
        );
    });

    it('Card trims the leading and trailing child margins inside its content box', () => {
        const css = readModuleCss('Card.module.css');

        expect(extractDeclarations(css, '.card > :first-child')).toContain(
            'margin-block-start: var(--ch-space-none)',
        );
        expect(extractDeclarations(css, '.card > :last-child')).toContain(
            'margin-block-end: var(--ch-space-none)',
        );
    });

    it('Drawer trims the leading and trailing child margins inside its body', () => {
        const css = readModuleCss('Drawer.module.css');

        expect(extractDeclarations(css, '.body > :first-child')).toContain(
            'margin-block-start: var(--ch-space-none)',
        );
        expect(extractDeclarations(css, '.body > :last-child')).toContain(
            'margin-block-end: var(--ch-space-none)',
        );
    });

    it('Modal trims the leading and trailing child margins inside its body', () => {
        const css = readModuleCss('Modal.module.css');

        expect(extractDeclarations(css, '.body > :first-child')).toContain(
            'margin-block-start: var(--ch-space-none)',
        );
        expect(extractDeclarations(css, '.body > :last-child')).toContain(
            'margin-block-end: var(--ch-space-none)',
        );
    });

    it('Popover trims the leading and trailing child margins inside its content', () => {
        const css = readModuleCss('Popover.module.css');

        expect(extractDeclarations(css, '.content > :first-child')).toContain(
            'margin-block-start: var(--ch-space-none)',
        );
        expect(extractDeclarations(css, '.content > :last-child')).toContain(
            'margin-block-end: var(--ch-space-none)',
        );
    });
});
