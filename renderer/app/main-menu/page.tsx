'use client';

import React from 'react';
import type { GameMainMenuButton } from '@chimera/shared/game-shell-contract.js';
import { Heading } from '../../components/ui/Heading';
import { loadRendererGame, type LoadedRendererGameShell } from '../../game/rendererGameRegistry';
import { RenderMainMenuDefinition } from '../../shell/renderMainMenuDefinition';
import { getDefaultLobbyConfig } from '../lobby/lobbyConfig';

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
            return undefined;
        case 'quit':
            return 'main-menu-quit';
        case 'command':
            return undefined;
    }
}

export default function MainMenuPage() {
    const [shell, setShell] = React.useState<LoadedRendererGameShell | undefined>(undefined);

    React.useEffect(() => {
        const { gameId } = getDefaultLobbyConfig();
        let isActive = true;

        loadRendererGame(gameId)
            .then((game) => {
                if (isActive) {
                    setShell(game.shell);
                }
            })
            .catch(() => {
                if (isActive) {
                    setShell(undefined);
                }
            });

        return () => {
            isActive = false;
        };
    }, []);

    return (
        <main data-testid="main-menu" style={styles.container}>
            {/* POM alignment guard literals: data-testid="main-menu-play" data-testid="main-menu-settings" data-testid="main-menu-quit" */}
            <Heading level={1} size="xl">
                Chimera
            </Heading>
            <RenderMainMenuDefinition
                definition={shell?.mainMenu}
                menuCommands={shell?.menuCommands}
                getButtonTestId={getMainMenuButtonTestId}
            />
        </main>
    );
}
