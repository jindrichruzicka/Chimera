'use client';

import React from 'react';
import { useOptionalFade } from '../shell/FadeContext';
import { screenFadeMs } from '../shell/screenFadeDuration';
import styles from './LogoVideoScreen.module.css';
import { LOGO_VIDEO_DEFAULT_DURATION_MS } from './logoVideoScreenDuration';

export { LOGO_VIDEO_DEFAULT_DURATION_MS } from './logoVideoScreenDuration';

export type LogoVideoScreenProps = Readonly<{
    src: string;
    durationMs?: number;
    onDone: () => void;
}>;

export function LogoVideoScreen({
    src,
    durationMs = LOGO_VIDEO_DEFAULT_DURATION_MS,
    onDone,
}: LogoVideoScreenProps): React.ReactElement {
    const fade = useOptionalFade();
    const videoRef = React.useRef<HTMLVideoElement | null>(null);
    const exitStartedRef = React.useRef(false);
    const fadeRef = React.useRef(fade);
    fadeRef.current = fade;
    const onDoneRef = React.useRef(onDone);
    onDoneRef.current = onDone;

    React.useLayoutEffect(() => {
        // Pre-paint snap to black so the video never flashes before the fade.
        void fadeRef.current?.fadeOut(0);
    }, []);

    React.useEffect(() => {
        void fadeRef.current?.fadeIn(screenFadeMs());
    }, []);

    const beginExit = React.useCallback((): void => {
        if (exitStartedRef.current) {
            return;
        }
        exitStartedRef.current = true;
        void (async () => {
            // If the component unmounts mid-fade the promise still settles (the
            // provider cancels-and-resolves on teardown), so onDone fires at
            // most once either way.
            await fadeRef.current?.fadeOut(screenFadeMs());
            onDoneRef.current();
        })();
    }, []);

    React.useEffect(() => {
        const timeoutId = window.setTimeout(beginExit, durationMs);
        window.addEventListener('click', beginExit);
        window.addEventListener('keydown', beginExit);
        return () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener('click', beginExit);
            window.removeEventListener('keydown', beginExit);
        };
    }, [durationMs, beginExit]);

    React.useEffect(() => {
        // The autoPlay attribute alone gives no catchable rejection signal, so
        // playback also starts imperatively. jsdom's play() is unimplemented
        // and returns undefined instead of the autoplay promise, hence the
        // conditional chain. The disposed flag keeps the AbortError of an
        // unmount- or StrictMode-interrupted play() request from triggering a
        // phantom skip.
        let disposed = false;
        const playResult: Promise<void> | undefined = videoRef.current?.play();
        playResult?.catch(() => {
            if (!disposed) {
                beginExit();
            }
        });
        return () => {
            disposed = true;
        };
    }, [beginExit]);

    return (
        <div className={styles['logo-video-screen']} data-testid="logo-video-screen">
            <video
                ref={videoRef}
                className={styles['video']}
                src={src}
                autoPlay
                playsInline
                data-testid="logo-video"
                onEnded={beginExit}
                onError={beginExit}
            />
        </div>
    );
}
