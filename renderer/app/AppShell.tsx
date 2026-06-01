import React, { type ReactNode } from 'react';
import { CrashRecoveryBanner } from '../components/CrashRecoveryBanner';
import { ConnectionStatusIndicator } from '../components/shell/ConnectionStatusIndicator';
import { RootErrorBoundary } from '../components/shell/RootErrorBoundary';
import { ShellBackgroundHost } from '../components/shell/ShellBackgroundHost';
import { ToastHost } from '../components/shell/ToastHost';
import { ThemeProvider } from '../theme/ThemeProvider';
import { GameStoreBootstrap } from './GameStoreBootstrap';
import { LoggingBootstrap } from './LoggingBootstrap';
import { LobbyStoreBootstrap } from './LobbyStoreBootstrap';
import { SaveStoreBootstrap } from './SaveStoreBootstrap';
import { SettingsBootstrap } from './SettingsBootstrap';
import { Providers } from './providers';

export function AppShell({ children }: { readonly children: ReactNode }): React.ReactElement {
    return (
        <Providers>
            <ThemeProvider>
                <LoggingBootstrap />
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
                    <ToastHost />
                </div>
            </ThemeProvider>
        </Providers>
    );
}
