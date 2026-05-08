'use client';

import { useRouter } from 'next/navigation';
import React from 'react';

export default function MainMenuPage() {
    const router = useRouter();

    return (
        <main
            data-testid="main-menu"
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100vh',
            }}
        >
            <button data-testid="main-menu-play" onClick={() => router.push('/lobby')}>
                Play
            </button>
            <button data-testid="main-menu-settings" onClick={() => router.push('/settings')}>
                Settings
            </button>
            <button data-testid="main-menu-quit" onClick={() => window.__chimera.system.quit()}>
                Quit
            </button>
        </main>
    );
}
