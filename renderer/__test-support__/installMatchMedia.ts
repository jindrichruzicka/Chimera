// renderer/__test-support__/installMatchMedia.ts
//
// jsdom has no window.matchMedia; shell-level component tests (ThemeProvider
// and friends) need a permissive stub. Restored by vitest's environment reset
// per file; `configurable: true` lets a test replace it mid-file.

import { vi } from 'vitest';

export function installMatchMedia(): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => true),
        })),
    });
}
