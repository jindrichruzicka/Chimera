'use client';

import { useRouter } from 'next/navigation';
import React from 'react';
import { LogoVideoScreen } from '../../components/ui/LogoVideoScreen';
import { resolveShellGameId, withShellGameId } from '../../shell/resolveMainMenuGameId';

const ENGINE_LOGO_VIDEO_SRC = '/chimera_logo.mp4';

// The engine's default boot logo screen: the page owns the whole flow (the
// host never automates it) and hands off to the main menu when the component
// reports done. Games wanting a custom logo sequence ship their own page
// instead of re-exporting this one.
export default function LogoScreenPage(): React.ReactElement {
    const router = useRouter();

    const handleDone = React.useCallback((): void => {
        router.push(
            withShellGameId(
                '/main-menu',
                resolveShellGameId(new URLSearchParams(window.location.search)),
            ),
        );
    }, [router]);

    return <LogoVideoScreen src={ENGINE_LOGO_VIDEO_SRC} onDone={handleDone} />;
}
