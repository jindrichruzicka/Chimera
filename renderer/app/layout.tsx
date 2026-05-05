// renderer/app/layout.tsx
//
// Root layout required by Next.js App Router. Kept intentionally minimal —
// the engine shell (MatchShell, SceneRouter, TransitionOverlay, etc.) is
// introduced by later features (§4.18–§4.19). For the M1 boot-smoke all we
// need is a valid HTML scaffold that hosts `page.tsx`.

import type { ReactNode } from 'react';
import React from 'react';
import { GameStoreBootstrap } from './GameStoreBootstrap';
import { SettingsBootstrap } from './SettingsBootstrap';
import { SaveStoreBootstrap } from './SaveStoreBootstrap';
import { ConnectionStatusIndicator } from '../components/shell/ConnectionStatusIndicator';
import { RootErrorBoundary } from '../components/shell/RootErrorBoundary';
import { CrashRecoveryBanner } from '../components/CrashRecoveryBanner';

export const metadata = {
    title: 'Chimera',
    description: 'Chimera engine shell',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta
                    httpEquiv="Content-Security-Policy"
                    content="default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'"
                />
            </head>
            <body>
                <SettingsBootstrap />
                <GameStoreBootstrap />
                <SaveStoreBootstrap />
                <CrashRecoveryBanner />
                <ConnectionStatusIndicator />
                <RootErrorBoundary>{children}</RootErrorBoundary>
                {/* ToastHost will be added here as a sibling in §4.30 */}
            </body>
        </html>
    );
}
