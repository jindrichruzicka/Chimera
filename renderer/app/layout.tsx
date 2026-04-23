// renderer/app/layout.tsx
//
// Root layout required by Next.js App Router. Kept intentionally minimal —
// the engine shell (MatchShell, SceneRouter, TransitionOverlay, etc.) is
// introduced by later features (§4.18–§4.19). For the M1 boot-smoke all we
// need is a valid HTML scaffold that hosts `page.tsx`.

import type { ReactNode } from 'react';
import { SettingsBootstrap } from './SettingsBootstrap';

export const metadata = {
    title: 'Chimera',
    description: 'Chimera engine shell',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                <SettingsBootstrap />
                {children}
            </body>
        </html>
    );
}
