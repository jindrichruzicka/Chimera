'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { useQuit } from './useQuit';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 'var(--ch-space-sm)',
    },
} satisfies Record<string, React.CSSProperties>;

export default function MainMenuPage() {
    const router = useRouter();
    const quit = useQuit();

    return (
        <main data-testid="main-menu" style={styles.container}>
            <Heading level={1} size="xl">
                Chimera
            </Heading>
            <Button
                data-testid="main-menu-play"
                onClick={() => router.push('/lobby')}
                variant="primary"
            >
                Play
            </Button>
            <Button
                data-testid="main-menu-settings"
                onClick={() => router.push('/settings')}
                variant="secondary"
            >
                Settings
            </Button>
            <Button data-testid="main-menu-quit" onClick={quit} variant="danger">
                Quit
            </Button>
        </main>
    );
}
