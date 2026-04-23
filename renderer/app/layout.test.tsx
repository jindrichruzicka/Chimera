// renderer/app/layout.test.tsx
//
// Tests for the root layout CSP meta tag (WARN-1 / #193).
// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import RootLayout from './layout';

describe('RootLayout', () => {
    it('renders a Content-Security-Policy meta tag in the document head', () => {
        render(<RootLayout>{null}</RootLayout>);

        const metaList = Array.from(
            document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'),
        );
        expect(metaList.length).toBeGreaterThan(0);

        const content = metaList[0]?.getAttribute('content') ?? '';
        expect(content).toContain("default-src 'self'");
        expect(content).toContain("object-src 'none'");
        expect(content).toContain("base-uri 'none'");
    });
});
