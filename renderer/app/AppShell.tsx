import React, { type ReactNode } from 'react';
import { PlayerConnectionToastBridge } from '../components/lobby/PlayerConnectionToastBridge';
import { PlayerLeftToastBridge } from '../components/lobby/PlayerLeftToastBridge';
import { ProfileRejectedToastBridge } from '../components/lobby/ProfileRejectedToastBridge';
import { ReplayExportToastBridge } from '../components/replay/ReplayExportToastBridge';
import { ReplayNavigationBridge } from '../components/replay/ReplayNavigationBridge';
import { ConnectionStatusIndicator } from '../components/shell/ConnectionStatusIndicator';
import { ConfirmDialogHost } from '../components/shell/ConfirmDialogHost';
import { I18nTokenModeToggle } from '../components/shell/debug/I18nTokenModeToggle';
import { RestoreWaitingOverlay } from '../components/shell/RestoreWaitingOverlay';
import { RootErrorBoundary } from '../components/shell/RootErrorBoundary';
import { ScreenFadeRoot } from '../components/shell/ScreenFadeRoot';
import { ShellAudioSession } from '../components/shell/ShellAudioSession';
import { ShellBackgroundHost } from '../components/shell/ShellBackgroundHost';
import { ShellContentLayer } from '../components/shell/ShellContentLayer';
import { ShellStateBridge } from '../components/shell/ShellStateBridge';
import { ToastHost } from '../components/shell/ToastHost';
import { ActiveGameIconProvider } from '../components/ui/icons/ActiveGameIconProvider';
import { TokenModeI18nProvider } from '../i18n/TokenModeI18nProvider';
import { ThemeProvider } from '../theme/ThemeProvider';
import { DebugI18nBootstrap } from './DebugI18nBootstrap';
import { GameRegistrationBootstrap } from './GameRegistrationBootstrap';
import { GameStoreBootstrap } from './GameStoreBootstrap';
import { InputActionsBootstrap } from './InputActionsBootstrap';
import { LoggingBootstrap } from './LoggingBootstrap';
import { LobbyStoreBootstrap } from './LobbyStoreBootstrap';
import { SaveStoreBootstrap } from './SaveStoreBootstrap';
import { SettingsBootstrap } from './SettingsBootstrap';
import { Providers } from './providers';

export function AppShell({ children }: { readonly children: ReactNode }): React.ReactElement {
    return (
        <>
            {/*
             * First child of the shell root, and deliberately OUTSIDE
             * <Providers> (§4.27, Invariant #67). The renderer logging bridge
             * patches console.warn/console.error during LoggingBootstrap's
             * render — not in an effect — and React renders siblings in order,
             * so everything below is covered, including what <Providers> logs
             * while rendering. Mounting it inside <Providers> drops that
             * provider's own render-phase warns. Do not reorder: pinned by
             * renderer/app/AppShell.test.tsx.
             */}
            <LoggingBootstrap />
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
                         * Game-contributed UI icons: ActiveGameIconProvider resolves
                         * the active game's `icons` set from the registry shell seam
                         * and publishes it to <Icon> via IconContext, so a game glyph
                         * (<Icon name="game.<id>.*">) renders with the engine's
                         * currentColor + token sizing — inside an <IconButton> or on
                         * its own. Inert (engine icons only) for a no-icon game, and
                         * mounted above {children} + the game screens so every <Icon>
                         * resolves a game glyph. Ordering vs i18n is irrelevant
                         * (independent contexts).
                         */}
                        <ActiveGameIconProvider>
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
                                <SettingsBootstrap />
                                {/*
                                 * Registers the active game's declared input
                                 * actions off its SHELL payload (§4.26), so a
                                 * shell background, a game page and the
                                 * Settings > Controls pane all see them before
                                 * any match has run. App-level and
                                 * lifetime-free by design: GameShell's own
                                 * registration then re-registers the same
                                 * table and is a no-op.
                                 */}
                                <InputActionsBootstrap />
                                <LobbyStoreBootstrap />
                                <GameStoreBootstrap />
                                <SaveStoreBootstrap />
                                <ReplayNavigationBridge />
                                <ReplayExportToastBridge />
                                <PlayerConnectionToastBridge />
                                <PlayerLeftToastBridge />
                                <ProfileRejectedToastBridge />
                                {/*
                                 * The shell-state spine (§4.37.18) — see
                                 * ShellStateBridge's own header for what it
                                 * publishes and why. The boundary is for the
                                 * bridge: it calls `useSearchParams()`, which
                                 * forces one under `output: 'export'`.
                                 */}
                                <React.Suspense fallback={null}>
                                    <ShellStateBridge />
                                    <ShellBackgroundHost />
                                </React.Suspense>
                                {/*
                                 * The shell-scoped audio session (§4.25): the
                                 * app-level asset delegate that makes useSound /
                                 * useMusicTrack resolve a clip outside a match,
                                 * and the menu bed a game declares. App-level so
                                 * ONE bed spans /main-menu → /settings → /saves;
                                 * a session owned by a screen would restart the
                                 * music on every hop. Outside the boundary above
                                 * on purpose — it reads the store the bridge
                                 * publishes and calls no router hook of its own,
                                 * so a suspending sibling must not tear its
                                 * delegate and its voice down.
                                 */}
                                <ShellAudioSession />
                                {/*
                                 * The raised frame page content and the engine's
                                 * overlay hosts render inside. A component rather
                                 * than a bare div because it stands aside — goes
                                 * click-through — under a game's interactive
                                 * background opt-in (§4.37.9); see its own header.
                                 */}
                                <ShellContentLayer>
                                    <ConnectionStatusIndicator />
                                    <RootErrorBoundary>{children}</RootErrorBoundary>
                                    {/*
                                     * App-level so the waiting modal survives the
                                     * /saves → /game route hop mid-restore.
                                     */}
                                    <RestoreWaitingOverlay />
                                    {/*
                                     * The single confirm surface (Invariant
                                     * #96 barrel hook useConfirmDialog()).
                                     * App-level for the same reason as the
                                     * overlay above: a question asked on one
                                     * route must still be answerable after the
                                     * asking screen navigates away.
                                     */}
                                    <ConfirmDialogHost />
                                    <ToastHost />
                                </ShellContentLayer>
                            </ScreenFadeRoot>
                        </ActiveGameIconProvider>
                    </TokenModeI18nProvider>
                </ThemeProvider>
            </Providers>
        </>
    );
}
