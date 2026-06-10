// renderer/app/layout.tsx
//
// Root layout required by Next.js App Router. It owns the HTML/CSP scaffold and
// delegates runtime renderer chrome to AppShell.

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import React from 'react';
import '../styles/tokens.css';
import '../styles/globals.css';
import { AppShell } from './AppShell';

const bootstrapBackgroundColor = '#111113';
const surfaceBackgroundColor = `var(--ch-color-surface, ${bootstrapBackgroundColor})`;

export const metadata: Metadata = {
    title: 'Chimera',
    description: 'Chimera engine shell',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" style={{ backgroundColor: surfaceBackgroundColor }}>
            <head>
                <meta
                    httpEquiv="Content-Security-Policy"
                    content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'"
                />
            </head>
            <body
                style={{
                    margin: 0,
                    backgroundColor: surfaceBackgroundColor,
                    color: 'var(--ch-color-text-primary)',
                    fontFamily: 'var(--ch-font-ui)',
                }}
            >
                <AppShell>{children}</AppShell>
            </body>
        </html>
    );
}
