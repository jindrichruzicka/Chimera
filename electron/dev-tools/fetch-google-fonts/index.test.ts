import { describe, expect, it, vi } from 'vitest';

import {
    buildFetchGoogleFontsOptions,
    fetchGoogleFontsForGame,
    formatGameFontFacesSnippet,
    parseFetchGoogleFontsArgs,
    parseGoogleFontsCss,
    type FontFetch,
    type FontFileHost,
} from './index.js';

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

const cinzelCssUrl = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900';

const cinzelResponses: Readonly<Record<string, string>> = {
    [cinzelCssUrl]: cinzelCss,
    'https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT7.woff2': 'regular',
    'https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT_.woff2': 'bold',
    'https://fonts.gstatic.com/s/cinzel/v25/8vIJ7ww63mVu7gt79mT9.woff2': 'black',
};

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
        const fetchFont = createFontFetch(cinzelResponses);

        const result = await fetchGoogleFontsForGame({
            gameId: 'tactics',
            cssUrl: cinzelCssUrl,
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
            '/repo/apps/tactics/assets/fonts/Cinzel-Regular.woff2',
            '/repo/apps/tactics/assets/fonts/Cinzel-Bold.woff2',
            '/repo/apps/tactics/assets/fonts/Cinzel-Black.woff2',
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

    it('writes downloads under a workspaceRoot-relative outDir when supplied', async () => {
        const host = createFontFileHost();
        const fetchFont = createFontFetch(cinzelResponses);

        // The standalone scaffold's exact shape: cwd (= workspaceRoot) is the
        // app package apps/<kebab>, and the scaffolded script will pass
        // --out-dir assets/fonts.
        const result = await fetchGoogleFontsForGame({
            gameId: 'my-game',
            cssUrl: cinzelCssUrl,
            workspaceRoot: '/w/apps/my-game',
            outDir: 'assets/fonts',
            fetchFont,
            host,
        });

        expect([...host.writes.keys()]).toEqual([
            '/w/apps/my-game/assets/fonts/Cinzel-Regular.woff2',
            '/w/apps/my-game/assets/fonts/Cinzel-Bold.woff2',
            '/w/apps/my-game/assets/fonts/Cinzel-Black.woff2',
        ]);
        // Only the download location moves; the emitted src keeps its
        // `${gameId}/fonts` default.
        expect(result.fonts.map((font) => font.src)).toEqual([
            'my-game/fonts/Cinzel-Regular.woff2',
            'my-game/fonts/Cinzel-Bold.woff2',
            'my-game/fonts/Cinzel-Black.woff2',
        ]);
    });

    it('takes an absolute outDir as-is', async () => {
        const host = createFontFileHost();
        const fetchFont = createFontFetch(cinzelResponses);

        await fetchGoogleFontsForGame({
            gameId: 'tactics',
            cssUrl: cinzelCssUrl,
            workspaceRoot: '/repo',
            outDir: '/srv/fonts',
            fetchFont,
            host,
        });

        expect([...host.writes.keys()]).toEqual([
            '/srv/fonts/Cinzel-Regular.woff2',
            '/srv/fonts/Cinzel-Bold.woff2',
            '/srv/fonts/Cinzel-Black.woff2',
        ]);
    });

    it('emits src under a custom srcPrefix while downloads stay at the default location', async () => {
        const host = createFontFileHost();
        const fetchFont = createFontFetch(cinzelResponses);

        const result = await fetchGoogleFontsForGame({
            gameId: 'tactics',
            cssUrl: cinzelCssUrl,
            workspaceRoot: '/repo',
            srcPrefix: 'fonts',
            fetchFont,
            host,
        });

        expect(result.fonts.map((font) => font.src)).toEqual([
            'fonts/Cinzel-Regular.woff2',
            'fonts/Cinzel-Bold.woff2',
            'fonts/Cinzel-Black.woff2',
        ]);
        expect([...host.writes.keys()]).toEqual([
            '/repo/apps/tactics/assets/fonts/Cinzel-Regular.woff2',
            '/repo/apps/tactics/assets/fonts/Cinzel-Bold.woff2',
            '/repo/apps/tactics/assets/fonts/Cinzel-Black.woff2',
        ]);
    });

    it.each([
        '/etc/fonts',
        'https://fonts.gstatic.com/hosted',
        'http://evil.example/fonts',
        'HTTPS://evil.example/fonts',
        'file:///etc/fonts',
        'C:\\fonts',
        '\\\\server\\fonts',
    ])('rejects the non-relative srcPrefix %s before any fetch', async (srcPrefix) => {
        const host = createFontFileHost();
        const fetchFont = vi.fn(createFontFetch(cinzelResponses));

        await expect(
            fetchGoogleFontsForGame({
                gameId: 'tactics',
                cssUrl: cinzelCssUrl,
                workspaceRoot: '/repo',
                srcPrefix,
                fetchFont,
                host,
            }),
        ).rejects.toThrow(/srcPrefix/u);
        expect(fetchFont).not.toHaveBeenCalled();
        expect(host.writes.size).toBe(0);
    });

    it('runs the derived default srcPrefix through the same guard', async () => {
        const host = createFontFileHost();
        const fetchFont = vi.fn(createFontFetch(cinzelResponses));

        await expect(
            fetchGoogleFontsForGame({
                gameId: '/pwn',
                cssUrl: cinzelCssUrl,
                workspaceRoot: '/repo',
                fetchFont,
                host,
            }),
        ).rejects.toThrow(/srcPrefix/u);
        expect(fetchFont).not.toHaveBeenCalled();
        expect(host.writes.size).toBe(0);
    });
});

describe('parseFetchGoogleFontsArgs', () => {
    it('reads --out-dir and --src-prefix into the parsed options', () => {
        const args = parseFetchGoogleFontsArgs([
            '--game',
            'my-game',
            '--url',
            'https://fonts.googleapis.com/css2?family=Cinzel',
            '--out-dir',
            'assets/fonts',
            '--src-prefix',
            'fonts',
        ]);

        expect(args.outDir).toBe('assets/fonts');
        expect(args.srcPrefix).toBe('fonts');
    });

    it('defaults workspaceRoot to the invocation cwd when --workspace-root is omitted', () => {
        // Load-bearing for the scaffolded fetch:fonts script: pnpm runs it
        // with cwd = the app package, and the relative --out-dir resolves
        // against this default.
        const args = parseFetchGoogleFontsArgs([
            '--game',
            'my-game',
            '--url',
            'https://fonts.googleapis.com/css2?family=Cinzel',
        ]);

        expect(args.workspaceRoot).toBe(process.cwd());
    });

    it('leaves outDir and srcPrefix undefined when the flags are omitted', () => {
        const args = parseFetchGoogleFontsArgs([
            '--game',
            'my-game',
            '--url',
            'https://fonts.googleapis.com/css2?family=Cinzel',
        ]);

        expect(args.outDir).toBeUndefined();
        expect(args.srcPrefix).toBeUndefined();
    });

    it('documents the optional flags in the usage error', () => {
        expect(() => parseFetchGoogleFontsArgs([])).toThrow(/--out-dir/u);
        expect(() => parseFetchGoogleFontsArgs([])).toThrow(/--src-prefix/u);
    });
});

describe('buildFetchGoogleFontsOptions', () => {
    it('threads supplied flags into the fetch options', () => {
        const options = buildFetchGoogleFontsOptions({
            gameId: 'my-game',
            cssUrl: cinzelCssUrl,
            workspaceRoot: '/w/apps/my-game',
            outDir: 'assets/fonts',
            srcPrefix: 'fonts',
        });

        expect(options).toEqual({
            gameId: 'my-game',
            cssUrl: cinzelCssUrl,
            workspaceRoot: '/w/apps/my-game',
            outDir: 'assets/fonts',
            srcPrefix: 'fonts',
        });
    });

    it('omits absent flags entirely instead of passing undefined', () => {
        const options = buildFetchGoogleFontsOptions({
            gameId: 'my-game',
            cssUrl: cinzelCssUrl,
            workspaceRoot: '/w/apps/my-game',
            outDir: undefined,
            srcPrefix: undefined,
        });

        expect('outDir' in options).toBe(false);
        expect('srcPrefix' in options).toBe(false);
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
