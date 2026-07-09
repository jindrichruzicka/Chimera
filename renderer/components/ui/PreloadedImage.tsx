'use client';

// PreloadedImage — a next/image that never paints partially.
//
// Large images paint progressively while their bytes stream in and their
// bitmap decodes ("tearing" scanline slices), and a <link rel="preload"> only
// moves the fetch earlier — it cannot move the decode. This component closes
// the gap: the img is held at opacity 0 until `img.decode()` settles, so the
// compositor's first paint of the picture is the complete, fully decoded
// bitmap. Defaults to `priority` (eager fetch + exported <head> preload);
// pair with game-declared warm-up (`LoadedRendererGameShell.preloadImages`)
// for images that appear after initial navigation.

import React, { useEffect, useRef, useState } from 'react';
import Image, { type ImageProps } from 'next/image';

export type PreloadedImageProps = Readonly<Omit<ImageProps, 'ref'>>;

export function PreloadedImage({ style, ...imageProps }: PreloadedImageProps): React.ReactElement {
    const imageRef = useRef<HTMLImageElement | null>(null);
    const [decoded, setDecoded] = useState(false);

    useEffect(() => {
        const image = imageRef.current;
        if (image === null) {
            return;
        }
        let cancelled = false;
        const reveal = () => {
            if (!cancelled) {
                setDecoded(true);
            }
        };
        // decode() settles only once the full bitmap is ready (it waits for
        // the load itself first). Reveal on rejection too: a broken asset
        // should surface visibly, not blank the screen.
        if (typeof image.decode === 'function') {
            image.decode().then(reveal, reveal);
        } else {
            reveal();
        }
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <Image
            priority
            {...imageProps}
            ref={imageRef}
            style={{ ...style, opacity: decoded ? (style?.opacity ?? 1) : 0 }}
        />
    );
}
