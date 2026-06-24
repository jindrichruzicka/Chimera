/**
 * tools/eslint-plugin-chimera/rules/no-hardcoded-design-values.test.ts
 *
 * Unit tests for the `chimera/no-hardcoded-design-values` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.35 — UI Design System
 * Invariants #86 and #91: renderer UI and shell surfaces must use `--ch-*`
 * design tokens instead of hardcoded colour, spacing, or radius literals.
 *
 * Issue: #560
 */

import css from '@eslint/css';
import { RuleTester } from 'eslint';
import type { ESLint } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-hardcoded-design-values.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        parserOptions: { ecmaFeatures: { jsx: true } },
        sourceType: 'module',
    },
});

const cssRuleTester = new RuleTester({
    language: 'css/css',
    plugins: { css: css as unknown as ESLint.Plugin },
});

ruleTester.run('chimera/no-hardcoded-design-values', rule, {
    valid: [
        {
            filename: 'renderer/app/main-menu/page.tsx',
            code: `const pageStyle = { gap: 'var(--ch-space-sm)' };
export function Page() {
    return <main style={pageStyle} />;
}`,
        },
        {
            filename: 'renderer/components/ui/Button.tsx',
            code: `export function Button() {
    return <button style={{ borderColor: 'var(--ch-color-border)', margin: 0 }} />;
}`,
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `const hudStyle = { minWidth: 'calc(var(--ch-space-xl) * 4)' };
export function Hud() {
    return <section style={hudStyle} />;
}`,
        },
        {
            filename: 'renderer/components/ui/ProgressBar.tsx',
            code: `export function ProgressBar({ fill }) {
    return <span style={{ width: fill + '%' }} />;
}`,
        },
    ],
    invalid: [
        {
            filename: 'renderer/app/settings/page.tsx',
            code: `export function SettingsPage() {
    return <main style={{ color: '#ff0000' }} />;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'renderer/app/saves/page.tsx',
            code: `const rowStyle = { gap: '1rem' };
export function SaveRow() {
    return <li style={rowStyle} />;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'renderer/components/shell/PlayerList.tsx',
            code: `const badgeStyle = { backgroundColor: 'rgb(255, 0, 0)' };
export function Badge() {
    return <span style={badgeStyle} />;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsGameHud.tsx',
            code: `export function Hud() {
    return <section style={{ borderTop: '1px solid var(--ch-color-border)' }} />;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'renderer/components/ui/Panel.tsx',
            code: `export function Panel() {
    return <section style={{ borderRadius: '8px', backgroundColor: 'hsl(0 0% 100%)' }} />;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }, { messageId: 'hardcodedDesignValue' }],
        },
    ],
});

cssRuleTester.run('chimera/no-hardcoded-design-values css modules', rule, {
    valid: [
        {
            filename: 'renderer/components/ui/Button.module.css',
            code: `.button {
    border-color: var(--ch-color-border);
    gap: var(--ch-space-sm);
    max-width: calc(var(--ch-space-xl) * 4);
}`,
        },
        {
            filename: 'renderer/styles/tokens.css',
            code: `:root {
    --ch-color-accent: #e94560;
    --ch-space-md: 16px;
}`,
        },
    ],
    invalid: [
        {
            filename: 'renderer/components/ui/Panel.module.css',
            code: `.panel {
    color: #ff0000;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'renderer/components/ui/Modal.module.css',
            code: `.dialog {
    padding: 16px;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'apps/tactics/screens/TacticsOverlay.module.css',
            code: `.overlay {
    margin: 1rem;
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }],
        },
        {
            filename: 'renderer/components/ui/Badge.module.css',
            code: `.badge {
    background: rgb(255, 0, 0);
    border-color: hsl(0 0% 100%);
}`,
            errors: [{ messageId: 'hardcodedDesignValue' }, { messageId: 'hardcodedDesignValue' }],
        },
    ],
});
