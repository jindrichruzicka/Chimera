import { describe, expect, it, vi } from 'vitest';

import {
    fetchGoogleFontsForGame,
    formatGameFontFacesSnippet,
    parseGoogleFontsCss,
    type FontFetch,
    type FontFileHost,
} from './fetch-google-fonts.js';

const cinzelCss = `
@font-face {
  font-family: 'Cinzel';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT7.woff2) format('woff2');
}
@font-face {
  font-family: 'Cinzel';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT_.woff2) format('woff2');
}
@font-face {
  font-family: 'Cinzel';
  font-style: normal;
  font-weight: 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT9.woff2) format('woff2');
}
`;

describe('parseGoogleFontsCss', () => {
    it('extracts woff2 font-face declarations from Google Fonts CSS', () => {
        const faces = parseGoogleFontsCss(cinzelCss);

        expect(faces.map((face) => `${face.family}:${face.weight}:${face.style}`)).toEqual([
            'Cinzel:400:normal',
            'Cinzel:700:normal',
            'Cinzel:900:normal',
        ]);
        expect(faces[0]?.url).toContain('fonts.gstatic.com');
    });

    it('ignores non-woff2 font sources', () => {
        const faces = parseGoogleFontsCss(`
            @font-face {
                font-family: 'Cinzel';
                font-style: normal;
                font-weight: 400;
                src: url(https://example.test/cinzel.ttf) format('truetype');
            }
        `);

        expect(faces).toEqual([]);
    });

    it('keeps one face per family style and weight when Google emits unicode subsets', () => {
        const faces = parseGoogleFontsCss(`
            /* latin-ext */
            @font-face {
                font-family: 'Cinzel';
                font-style: normal;
                font-weight: 400;
                src: url(https://fonts.gstatic.com/latin-ext.woff2) format('woff2');
                unicode-range: U+0100-02BA;
            }
            /* latin */
            @font-face {
                font-family: 'Cinzel';
                font-style: normal;
                font-weight: 400;
                src: url(https://fonts.gstatic.com/latin.woff2) format('woff2');
                unicode-range: U+0000-00FF;
            }
        `);

        expect(faces).toHaveLength(1);
        expect(faces[0]?.url).toBe('https://fonts.gstatic.com/latin.woff2');
    });
});

describe('fetchGoogleFontsForGame', () => {
    it('downloads Google font files into source and renderer public asset locations', async () => {
        const host = createFontFileHost();
        const fetchFont = createFontFetch({
            'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900': cinzelCss,
            'https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT7.woff2': 'regular',
            'https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT_.woff2': 'bold',
            'https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT9.woff2': 'black',
        });

        const result = await fetchGoogleFontsForGame({
            gameId: 'tactics',
            cssUrl: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900',
            workspaceRoot: '/repo',
            fetchFont,
            host,
        });

        expect(result.fonts).toEqual([
            {
                family: 'Cinzel',
                src: 'tactics/fonts/Cinzel-Regular.woff2',
                weight: '400',
                style: 'normal',
                display: 'swap',
            },
            {
                family: 'Cinzel',
                src: 'tactics/fonts/Cinzel-Bold.woff2',
                weight: '700',
                style: 'normal',
                display: 'swap',
            },
            {
                family: 'Cinzel',
                src: 'tactics/fonts/Cinzel-Black.woff2',
                weight: '900',
                style: 'normal',
                display: 'swap',
            },
        ]);
        expect([...host.writes.keys()]).toEqual([
            '/repo/games/tactics/assets/fonts/Cinzel-Regular.woff2',
            '/repo/games/tactics/assets/fonts/Cinzel-Bold.woff2',
            '/repo/games/tactics/assets/fonts/Cinzel-Black.woff2',
        ]);
        expect(formatGameFontFacesSnippet(result.fonts)).toContain(
            "src: 'tactics/fonts/Cinzel-Regular.woff2'",
        );
    });

    it('rejects Google CSS with no usable woff2 declarations', async () => {
        const host = createFontFileHost();
        const fetchFont = createFontFetch({
            'https://fonts.googleapis.com/css2?family=Cinzel': '@font-face { src: url(font.ttf); }',
        });

        await expect(
            fetchGoogleFontsForGame({
                gameId: 'tactics',
                cssUrl: 'https://fonts.googleapis.com/css2?family=Cinzel',
                workspaceRoot: '/repo',
                fetchFont,
                host,
            }),
        ).rejects.toThrow('No woff2 font faces were found');
    });
});

interface RecordedFontFileHost extends FontFileHost {
    readonly writes: Map<string, Uint8Array>;
}

function createFontFileHost(): RecordedFontFileHost {
    const writes = new Map<string, Uint8Array>();
    return {
        writes,
        ensureDirectory: vi.fn(async () => undefined),
        writeFile: vi.fn(async (filePath, data) => {
            writes.set(filePath, data);
        }),
    };
}

function createFontFetch(responses: Readonly<Record<string, string>>): FontFetch {
    return async (url: string) => {
        const body = responses[url];
        if (body === undefined) {
            return {
                ok: false,
                status: 404,
                text: async () => 'not found',
                arrayBuffer: async () => new ArrayBuffer(0),
            };
        }

        return {
            ok: true,
            status: 200,
            text: async () => body,
            arrayBuffer: async () => stringToArrayBuffer(body),
        };
    };
}

function stringToArrayBuffer(value: string): ArrayBuffer {
    const bytes = new TextEncoder().encode(value);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
