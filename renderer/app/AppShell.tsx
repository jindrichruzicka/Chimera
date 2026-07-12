import React, { type ReactNode } from 'react';
import { PlayerConnectionToastBridge } from '../components/lobby/PlayerConnectionToastBridge';
import { PlayerLeftToastBridge } from '../components/lobby/PlayerLeftToastBridge';
import { ProfileRejectedToastBridge } from '../components/lobby/ProfileRejectedToastBridge';
import { ReplayExportToastBridge } from '../components/replay/ReplayExportToastBridge';
import { ReplayNavigationBridge } from '../components/replay/ReplayNavigationBridge';
import { ConnectionStatusIndicator } from '../components/shell/ConnectionStatusIndicator';
import { RestoreWaitingOverlay } from '../components/shell/RestoreWaitingOverlay';
import { RootErrorBoundary } from '../components/shell/RootErrorBoundary';
import { ScreenFadeRoot } from '../components/shell/ScreenFadeRoot';
import { ShellBackgroundHost } from '../components/shell/ShellBackgroundHost';
import { ToastHost } from '../components/shell/ToastHost';
import { I18nProvider } from '../i18n/I18nProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { GameRegistrationBootstrap } from './GameRegistrationBootstrap';
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
                {/*
                 * Opt-in i18n runtime (F71). Mounted inert here: with no props
                 * it resolves engine English at zero cost, so single-language /
                 * no-i18n games are unaffected. Live inputs (settings locale,
                 * the game's declared languages + contributed override bundle,
                 * the debug token-mode flag) are wired by later F71 tasks; this
                 * mount only makes useTranslate() available to pages and the
                 * bootstraps below.
                 */}
                <I18nProvider>
                    {/*
                     * App-level fade for cross-screen route transitions
                     * (main-menu ↔ lobby ↔ game). Lives above {children} so its
                     * opacity survives Next.js soft navigation; the bootstraps
                     * (GameStoreBootstrap drives the lobby⇄game fades) and the
                     * pages all consume this provider via useFade(). Distinct from
                     * GameShell's own inner FadeProvider, which only fades in-game
                     * scene swaps.
                     */}
                    <ScreenFadeRoot>
                        <GameRegistrationBootstrap />
                        <LoggingBootstrap />
                        <SettingsBootstrap />
                        <LobbyStoreBootstrap />
                        <GameStoreBootstrap />
                        <SaveStoreBootstrap />
                        <ReplayNavigationBridge />
                        <ReplayExportToastBridge />
                        <PlayerConnectionToastBridge />
                        <PlayerLeftToastBridge />
                        <ProfileRejectedToastBridge />
                        <React.Suspense fallback={null}>
                            <ShellBackgroundHost />
                        </React.Suspense>
                        <div style={{ position: 'relative', zIndex: 1 }}>
                            <ConnectionStatusIndicator />
                            <RootErrorBoundary>{children}</RootErrorBoundary>
                            {/*
                             * App-level so the waiting modal survives the
                             * /saves → /game route hop mid-restore.
                             */}
                            <RestoreWaitingOverlay />
                            <ToastHost />
                        </div>
                    </ScreenFadeRoot>
                </I18nProvider>
            </ThemeProvider>
        </Providers>
    );
}
