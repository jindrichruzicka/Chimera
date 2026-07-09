// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreloadedImage } from './PreloadedImage';

interface DecodeControl {
    resolve: () => void;
    reject: (error: Error) => void;
    spy: ReturnType<typeof vi.fn>;
}

function stubImageDecode(): DecodeControl {
    let resolveDecode!: () => void;
    let rejectDecode!: (error: Error) => void;
    const decodePromise = new Promise<void>((resolve, reject) => {
        resolveDecode = resolve;
        rejectDecode = reject;
    });
    const spy = vi.fn(() => decodePromise);
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
        configurable: true,
        value: spy,
    });
    return { resolve: resolveDecode, reject: rejectDecode, spy };
}

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
    vi.restoreAllMocks();
});

describe('PreloadedImage', () => {
    it('renders an eager (priority) image with the given source and alt text', () => {
        stubImageDecode();
        render(<PreloadedImage src="/hero.png" alt="Hero" width={64} height={64} />);

        const image = screen.getByAltText('Hero');
        expect(image.getAttribute('loading')).not.toBe('lazy');
    });

    it('keeps the image hidden until the bitmap is fully decoded, then reveals it atomically', async () => {
        const decode = stubImageDecode();
        render(<PreloadedImage src="/hero.png" alt="Hero" width={64} height={64} />);

        const image = screen.getByAltText('Hero');
        expect(image.style.opacity).toBe('0');

        decode.resolve();
        await waitFor(() => expect(image.style.opacity).toBe('1'));
    });

    it('reveals the image when decoding fails (fail open — a broken asset stays debuggable)', async () => {
        const decode = stubImageDecode();
        render(<PreloadedImage src="/hero.png" alt="Hero" width={64} height={64} />);

        decode.reject(new Error('broken image'));
        const image = screen.getByAltText('Hero');
        await waitFor(() => expect(image.style.opacity).toBe('1'));
    });

    it('reveals the image when the environment lacks img.decode()', async () => {
        render(<PreloadedImage src="/hero.png" alt="Hero" width={64} height={64} />);

        const image = screen.getByAltText('Hero');
        await waitFor(() => expect(image.style.opacity).toBe('1'));
    });

    it("preserves the caller's style, including a custom opacity, once revealed", async () => {
        const decode = stubImageDecode();
        render(
            <PreloadedImage
                src="/hero.png"
                alt="Hero"
                width={64}
                height={64}
                style={{ opacity: 0.5, borderRadius: 'var(--ch-radius-sm)' }}
            />,
        );

        const image = screen.getByAltText('Hero');
        expect(image.style.opacity).toBe('0');
        expect(image.style.borderRadius).toBe('var(--ch-radius-sm)');

        decode.resolve();
        await waitFor(() => expect(image.style.opacity).toBe('0.5'));
    });
});
