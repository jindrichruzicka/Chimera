// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon } from './Icon';
import { ICON_REGISTRY, type IconName } from './registry';

afterEach(cleanup);

describe('ICON_REGISTRY', () => {
    it('registers the chat-bubble glyph', () => {
        expect(Object.keys(ICON_REGISTRY)).toContain('chat-bubble');
    });

    it('registers the save glyph', () => {
        expect(Object.keys(ICON_REGISTRY)).toContain('save');
    });

    it.each([
        'close',
        'chevron-down',
        'plus',
        'minus',
        'copy',
        'play',
        'pause',
        'step-back',
        'step-forward',
        'seek-start',
        'seek-end',
    ] as const)('registers the %s glyph', (name) => {
        expect(Object.keys(ICON_REGISTRY)).toContain(name);
    });

    it('defines every glyph with a non-empty viewBox and a renderable content element', () => {
        for (const [name, glyph] of Object.entries(ICON_REGISTRY)) {
            expect(typeof glyph.viewBox, name).toBe('string');
            expect(glyph.viewBox.length, name).toBeGreaterThan(0);
            expect(React.isValidElement(glyph.content), name).toBe(true);
        }
    });

    it('renders exactly one matching svg for every registered name (registry ↔ IconName exhaustive)', () => {
        for (const name of Object.keys(ICON_REGISTRY) as readonly IconName[]) {
            const { container, unmount } = render(<Icon name={name} />);
            const matches = container.querySelectorAll(`svg[data-ch-icon="${name}"]`);
            expect(matches.length, name).toBe(1);
            unmount();
        }
    });
});
