import React from 'react';
import { usePathname } from 'next/navigation';

import { useTranslate } from '@chimera-engine/renderer/i18n';

import { tacticsManifest } from '../manifest';
import { SHELL_KEYS } from './translations/keys';

const menuBackgroundStyles = `
.menu-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a12 70%);
    z-index: 0;
}

.menu-bg::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, transparent 70%);
    animation: pulse 4s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
    50% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
}

.main-menu-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    transform: translateY(-160px);
}

.game-title {
    font-family: 'Cinzel', serif; font-size: 4rem; font-weight: 900;
    background: linear-gradient(135deg, #f4d03f, #e67e22, #f4d03f);
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    text-shadow: none; margin-bottom: 0.5rem; letter-spacing: 3px;
    line-height: 0.75;
}
.subtitle { font-size: 1.2rem; color: #9b8ec4; font-style: italic; }
`;

export function TacticsShellBackground(): React.ReactElement {
    const t = useTranslate();
    const pathname = usePathname();
    const isMainMenu = normalizeRoutePath(pathname) === '/main-menu';

    return (
        <>
            <style>{menuBackgroundStyles}</style>
            <div data-testid="tactics-shell-background" className="menu-bg" />
            {isMainMenu && (
                <div
                    data-testid="tactics-shell-background-main-menu-overlay"
                    className="main-menu-overlay"
                >
                    <h1 data-testid="tactics-shell-background-title" className="game-title">
                        {tacticsManifest.displayName}
                    </h1>
                    <p data-testid="tactics-shell-background-subtitle" className="subtitle">
                        {t(SHELL_KEYS.subtitle)}
                    </p>
                </div>
            )}
        </>
    );
}

function normalizeRoutePath(pathname: string | null): string {
    if (pathname === null || pathname.length === 0) {
        return '/';
    }

    return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}
