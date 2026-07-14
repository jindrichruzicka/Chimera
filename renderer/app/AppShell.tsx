import React, { type ReactNode } from 'react';
import { PlayerConnectionToastBridge } from '../components/lobby/PlayerConnectionToastBridge';
import { PlayerLeftToastBridge } from '../components/lobby/PlayerLeftToastBridge';
import { ProfileRejectedToastBridge } from '../components/lobby/ProfileRejectedToastBridge';
import { ReplayExportToastBridge } from '../components/replay/ReplayExportToastBridge';
import { ReplayNavigationBridge } from '../components/replay/ReplayNavigationBridge';
import { ConnectionStatusIndicator } from '../components/shell/ConnectionStatusIndicator';
import { I18nTokenModeToggle } from '../components/shell/debug/I18nTokenModeToggle';
import { RestoreWaitingOverlay } from '../components/shell/RestoreWaitingOverlay';
import { RootErrorBoundary } from '../components/shell/RootErrorBoundary';
import { ScreenFadeRoot } from '../components/shell/ScreenFadeRoot';
import { ShellBackgroundHost } from '../components/shell/ShellBackgroundHost';
import { ToastHost } from '../components/shell/ToastHost';
import { TokenModeI18nProvider } from '../i18n/TokenModeI18nProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { DebugI18nBootstrap } from './DebugI18nBootstrap';
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
                 * Opt-in i18n runtime. The TokenModeI18nProvider wrapper feeds
                 * <I18nProvider> the `showTokens` debug flag from debugI18nStore
                 * (flipped by the global F4 hotkey — I18nTokenModeToggle —
                 * round-tripped through the main-process debug bridge back into
                 * DebugI18nBootstrap). With the flag off — its default,
                 * and always in production — it resolves engine English at zero
                 * cost, so single-language / no-i18n games are unaffected.
                 * Settings locale, declared languages, and the game override
                 * bundle are wired elsewhere; this makes useTranslate() available
                 * to pages and the bootstraps below.
                 */}
                <TokenModeI18nProvider>
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
                        <DebugI18nBootstrap />
                        {/*
                         * App-level (not GameShell) so F4 flips token mode on
                         * every shell route — main menu, settings, lobby —
                         * where the F9 Inspector toggle is unavailable.
                         */}
                        <I18nTokenModeToggle />
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
                        <div style={{ position: 'relative', zIndex: 'var(--ch-z-raised)' }}>
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
                </TokenModeI18nProvider>
            </ThemeProvider>
        </Providers>
    );
}
