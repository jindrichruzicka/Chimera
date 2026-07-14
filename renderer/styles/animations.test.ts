import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readRendererFile(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

function collectModuleCssFiles(rootDir: string): readonly string[] {
    return readdirSync(rootDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.module.css'))
        .map((entry) => join(entry.parentPath, entry.name));
}

function extractKeyframeNames(css: string): readonly string[] {
    return Array.from(css.matchAll(/@keyframes\s+([\w-]+)/g), (match) => match[1]).filter(
        (v): v is string => v !== undefined,
    );
}

describe('renderer overlay animations stylesheet', () => {
    it('declares exactly the nine global engine keyframes', () => {
        const names = extractKeyframeNames(readRendererFile('./animations.css'));

        expect(new Set(names)).toEqual(
            new Set([
                'ch-backdrop-enter',
                'ch-backdrop-exit',
                'ch-modal-enter',
                'ch-modal-exit',
                'ch-drawer-enter',
                'ch-drawer-exit',
                'ch-spinner-rotate',
                'ch-toast-enter',
                'ch-toast-fade-in',
            ]),
        );
        expect(names).toHaveLength(9);
    });

    it('backs every *-anim-*name token with a keyframe declared here', () => {
        const tokens = readRendererFile('./tokens.css');
        const declaredKeyframes = new Set(
            extractKeyframeNames(readRendererFile('./animations.css')),
        );
        const nameTokenValues = Array.from(
            tokens.matchAll(/--ch-[\w-]+-anim-[\w-]*name:\s*([\w-]+);/g),
            (match) => match[1],
        ).filter((v): v is string => v !== undefined);

        // Covers the overlay enter/exit names plus the continuous spinner and
        // toast names (including the reduced-motion toast variant).
        expect(nameTokenValues.length).toBeGreaterThanOrEqual(9);
        for (const value of nameTokenValues) {
            expect(declaredKeyframes).toContain(value);
        }
    });

    it('keeps every keyframe global: no renderer CSS module declares its own', () => {
        // CSS Modules hash keyframe names, which would break the *-anim-*name
        // token indirection, so engine keyframes live only in this stylesheet.
        const componentRoots = ['../components', '../app'].map((dir) =>
            fileURLToPath(new URL(dir, import.meta.url)),
        );

        for (const root of componentRoots) {
            for (const file of collectModuleCssFiles(root)) {
                expect(readFileSync(file, 'utf8')).not.toContain('@keyframes');
            }
        }
    });

    it('keeps the modal panel keyframes transform-only so the backdrop owns the fade', () => {
        const css = readRendererFile('./animations.css');
        const modalBlocks = css.match(/@keyframes ch-modal-(?:enter|exit)\s*{[^@]*}/gs) ?? [];

        expect(modalBlocks).toHaveLength(2);
        for (const block of modalBlocks) {
            expect(block).toContain('transform:');
            expect(block).not.toContain('opacity:');
        }
    });

    it('keeps the stylesheet free of hardcoded visual literals', () => {
        const css = readRendererFile('./animations.css');

        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/\brgba?\s*\(/iu);
        expect(css).not.toMatch(/\bhsla?\s*\(/iu);
        expect(css.replace(/var\([^)]+\)/g, '')).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem)\b/);
    });

    it('is imported by the root layout after the design tokens', () => {
        const layout = readRendererFile('../app/layout.tsx');
        const tokensImportIndex = layout.indexOf("import '../styles/tokens.css';");
        const animationsImportIndex = layout.indexOf("import '../styles/animations.css';");

        expect(tokensImportIndex).toBeGreaterThanOrEqual(0);
        expect(animationsImportIndex).toBeGreaterThan(tokensImportIndex);
    });
});
