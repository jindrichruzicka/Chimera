import React from 'react';
import { usePathname } from 'next/navigation';

import { useTranslate } from '@chimera-engine/renderer/i18n';

import { tacticsManifest } from '../manifest';
import { SHELL_KEYS } from './translations/keys';
import styles from './TacticsShellBackground.module.css';

export function TacticsShellBackground(): React.ReactElement {
    const t = useTranslate();
    const pathname = usePathname();
    const isMainMenu = normalizeRoutePath(pathname) === '/main-menu';

    return (
        <>
            <div data-testid="tactics-shell-background" className={styles['menu-bg']} />
            {isMainMenu && (
                <div
                    data-testid="tactics-shell-background-main-menu-overlay"
                    className={styles['main-menu-overlay']}
                >
                    <h1
                        data-testid="tactics-shell-background-title"
                        className={styles['game-title']}
                    >
                        {tacticsManifest.displayName}
                    </h1>
                    <p
                        data-testid="tactics-shell-background-subtitle"
                        className={styles['subtitle']}
                    >
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
