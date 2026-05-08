'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { useQuit } from './useQuit';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '12px',
    },
    button: {
        width: '200px',
        padding: '12px 0',
        fontSize: '16px',
    },
} satisfies Record<string, React.CSSProperties>;

export default function MainMenuPage() {
    const router = useRouter();
    const quit = useQuit();

    return (
        <main data-testid="main-menu" style={styles.container}>
            <button
                data-testid="main-menu-play"
                style={styles.button}
                onClick={() => router.push('/lobby')}
            >
                Play
            </button>
            <button
                data-testid="main-menu-settings"
                style={styles.button}
                onClick={() => router.push('/settings')}
            >
                Settings
            </button>
            <button data-testid="main-menu-quit" style={styles.button} onClick={quit}>
                Quit
            </button>
        </main>
    );
}
