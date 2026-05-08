'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { useQuit } from './useQuit';

export default function MainMenuPage() {
    const router = useRouter();
    const quit = useQuit();

    return (
        <main data-testid="main-menu">
            <button data-testid="main-menu-play" onClick={() => router.push('/lobby')}>
                Play
            </button>
            <button data-testid="main-menu-settings" onClick={() => router.push('/settings')}>
                Settings
            </button>
            <button data-testid="main-menu-quit" onClick={quit}>
                Quit
            </button>
        </main>
    );
}
