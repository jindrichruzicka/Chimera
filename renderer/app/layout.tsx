// renderer/app/layout.tsx
//
// Root layout required by Next.js App Router. Kept intentionally minimal —
// the engine shell (GameShell, SceneRouter, TransitionOverlay, etc.) is
// introduced by later features (§4.18–§4.19). For the M1 boot-smoke all we
// need is a valid HTML scaffold that hosts `page.tsx`.

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import React from 'react';
import '../styles/tokens.css';
import { GameStoreBootstrap } from './GameStoreBootstrap';
import { LobbyStoreBootstrap } from './LobbyStoreBootstrap';
import { SettingsBootstrap } from './SettingsBootstrap';
import { SaveStoreBootstrap } from './SaveStoreBootstrap';
import { ConnectionStatusIndicator } from '../components/shell/ConnectionStatusIndicator';
import { RootErrorBoundary } from '../components/shell/RootErrorBoundary';
import { ShellBackgroundHost } from '../components/shell/ShellBackgroundHost';
import { CrashRecoveryBanner } from '../components/CrashRecoveryBanner';
import { ThemeProvider } from '../theme/ThemeProvider';
import { Providers } from './providers';

export const metadata: Metadata = {
    title: 'Chimera',
    description: 'Chimera engine shell',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta
                    httpEquiv="Content-Security-Policy"
                    content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'"
                />
            </head>
            <body
                style={{
                    margin: 0,
                    backgroundColor: 'var(--ch-color-surface)',
                    color: 'var(--ch-color-text-primary)',
                    fontFamily: 'var(--ch-font-ui)',
                }}
            >
                <Providers>
                    <ThemeProvider>
                        <SettingsBootstrap />
                        <LobbyStoreBootstrap />
                        <GameStoreBootstrap />
                        <SaveStoreBootstrap />
                        <React.Suspense fallback={null}>
                            <ShellBackgroundHost />
                        </React.Suspense>
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <CrashRecoveryBanner />
                            <ConnectionStatusIndicator />
                            <RootErrorBoundary>{children}</RootErrorBoundary>
                        </div>
                        {/* ToastHost will be added here as a sibling in §4.30 */}
                    </ThemeProvider>
                </Providers>
            </body>
        </html>
    );
}
