'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import type { GameMainMenuButton } from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import { useOptionalFade } from '../../components/shell/FadeContext';
import { screenFadeMs } from '../../components/shell/screenFadeDuration';
import { IconButton } from '../../components/ui/IconButton';
import { Tooltip } from '../../components/ui/Tooltip';
import { isGalleryEnabled } from '../component-gallery/galleryGate';
import {
    loadRendererGameShell,
    type LoadedRendererGameShell,
} from '../../game/rendererGameRegistry';
import { RenderMainMenuDefinition } from '../../shell/renderMainMenuDefinition';
import { resolveMainMenuGameId } from '../../shell/resolveMainMenuGameId';
import pageStyles from './page.module.css';

const COMPONENT_GALLERY_ROUTE = '/component-gallery';
const COMPONENT_GALLERY_LABEL = 'Open component gallery';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 'var(--ch-space-sm)',
        position: 'relative' as const,
    },
} satisfies Record<string, React.CSSProperties>;

function getMainMenuButtonTestId(button: GameMainMenuButton): string | undefined {
    switch (button.action.type) {
        case 'open-lobby':
            return 'main-menu-play';
        case 'navigate':
            if (button.action.target === '/game') {
                return 'main-menu-play';
            }
            if (button.action.target === '/settings') {
                return 'main-menu-settings';
            }
            if (button.action.target === '/saves') {
                return 'main-menu-load-game';
            }
            if (button.action.target === '/replays') {
                return 'main-menu-replays';
            }
            return undefined;
        case 'quit':
            return 'main-menu-quit';
        case 'command':
            return undefined;
    }
}

function ComponentGalleryButton(): React.ReactElement | null {
    const router = useRouter();

    if (!isGalleryEnabled()) return null;

    return (
        <div className={pageStyles['component-gallery-link']}>
            <Tooltip content="Component gallery">
                {(triggerProps) => (
                    <IconButton
                        {...triggerProps}
                        aria-label={COMPONENT_GALLERY_LABEL}
                        data-testid="main-menu-component-gallery"
                        onClick={() => {
                            router.push(COMPONENT_GALLERY_ROUTE);
                        }}
                    >
                        <span aria-hidden="true" className={pageStyles['component-gallery-icon']}>
                            ▦
                        </span>
                    </IconButton>
                )}
            </Tooltip>
        </div>
    );
}

// ── Menu resolution state ─────────────────────────────────────────────────────
//
// Distinguishes "URL context not yet read" and "game shell loading" from "no
// game context at all". This prevents the engine-default buttons (Play /
// Settings / Quit) from flashing before a URL-selected game shell resolves.
//
// • 'unresolved'    — initial SSR-safe state; URL not yet inspected
// • 'engine-default' — no gameId in URL; show engine default menu
// • 'loading'       — gameId present, shell fetch in flight; show no menu
// • 'loaded'        — shell fetched; show game-provided menu (or engine
//                     default when the game provides no mainMenu)
// • 'load-failed'   — shell fetch rejected; fall back to engine default
type MenuLoadState =
    | { status: 'unresolved' }
    | { status: 'engine-default' }
    | { status: 'loading'; gameId: string }
    | { status: 'loaded'; gameId: string; shell: LoadedRendererGameShell }
    | { status: 'load-failed' };

// True once the menu has appeared at least once this session. Module scope so it
// survives the menu route unmounting/remounting (the menu is a separate Next page).
let menuHasAppeared = false;

/** Test seam: reset the session "menu has appeared" flag between tests. */
export function __resetMainMenuFadeForTest(): void {
    menuHasAppeared = false;
}

// The app-level screen fade for the menu. On the FIRST appearance of the session
// (app boot) the overlay snaps black pre-paint (`useLayoutEffect`, no 1-frame
// flash) and then eases in. On later mounts it only `fadeIn`s: arriving from a
// faded-out screen (game/lobby) already left the overlay black so it reveals;
// arriving from a non-fading screen (settings/saves/replays) left it transparent
// so the fadeIn is a no-op and the menu does NOT fade. `useOptionalFade` degrades
// to a no-op when the page is rendered without the app shell's provider.
function useMainMenuFadeIn(): void {
    const fade = useOptionalFade();
    const fadeRef = React.useRef(fade);
    fadeRef.current = fade;

    React.useLayoutEffect(() => {
        if (!menuHasAppeared) {
            void fadeRef.current?.fadeOut(0);
        }
    }, []);

    React.useEffect(() => {
        menuHasAppeared = true;
        void fadeRef.current?.fadeIn(screenFadeMs());
    }, []);
}

export default function MainMenuPage() {
    const [menuState, setMenuState] = React.useState<MenuLoadState>({ status: 'unresolved' });
    useMainMenuFadeIn();

    React.useEffect(() => {
        const gameId = resolveMainMenuGameId(new URLSearchParams(window.location.search));

        if (gameId === null) {
            setMenuState({ status: 'engine-default' });
            return;
        }

        setMenuState({ status: 'loading', gameId });
        let isActive = true;

        loadRendererGameShell(gameId)
            .then((loadedShell) => {
                if (isActive) {
                    setMenuState({ status: 'loaded', gameId, shell: loadedShell });
                }
            })
            .catch(() => {
                if (isActive) {
                    setMenuState({ status: 'load-failed' });
                }
            });

        return () => {
            isActive = false;
        };
    }, []);

    // Derive the props to pass to the renderer. While 'unresolved' or
    // 'loading', render no menu buttons so the engine-default buttons never
    // flash before the game shell settles.
    if (menuState.status === 'unresolved' || menuState.status === 'loading') {
        return (
            <main data-testid="main-menu" style={styles.container}>
                <ComponentGalleryButton />
            </main>
        );
    }

    const definition = menuState.status === 'loaded' ? menuState.shell.mainMenu : undefined;
    const gameId = menuState.status === 'loaded' ? menuState.gameId : null;
    const menuCommands = menuState.status === 'loaded' ? menuState.shell.menuCommands : undefined;

    return (
        <main data-testid="main-menu" style={styles.container}>
            {/* POM alignment guard literals: data-testid="main-menu-play" data-testid="main-menu-settings" data-testid="main-menu-load-game" data-testid="main-menu-replays" data-testid="main-menu-quit" data-testid="main-menu-component-gallery" */}
            <RenderMainMenuDefinition
                definition={definition}
                gameId={gameId}
                menuCommands={menuCommands}
                getButtonTestId={getMainMenuButtonTestId}
            />
            <ComponentGalleryButton />
        </main>
    );
}
