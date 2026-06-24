import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
    GameFontDisplay,
    GameFontFace,
    GameFontStyle,
} from '@chimera/simulation/foundation/game-shell-contract.js';

export interface FontFetchResponse {
    readonly ok: boolean;
    readonly status: number;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export type FontFetch = (url: string, init?: FontFetchInit) => Promise<FontFetchResponse>;

export interface FontFetchInit {
    readonly headers?: Readonly<Record<string, string>>;
}

export interface FontFileHost {
    ensureDirectory(directoryPath: string): Promise<void>;
    writeFile(filePath: string, data: Uint8Array): Promise<void>;
}

export interface ParsedGoogleFontFace {
    readonly family: string;
    readonly style: GameFontStyle;
    readonly weight: string;
    readonly display: GameFontDisplay;
    readonly url: string;
}

export interface FetchGoogleFontsForGameOptions {
    readonly gameId: string;
    readonly cssUrl: string;
    readonly workspaceRoot: string;
    readonly fetchFont?: FontFetch;
    readonly host?: FontFileHost;
}

export interface DownloadedGameFontFile {
    readonly font: GameFontFace;
    readonly sourceAssetPath: string;
}

export interface FetchGoogleFontsForGameResult {
    readonly fonts: readonly GameFontFace[];
    readonly downloads: readonly DownloadedGameFontFile[];
}

const weightFileNames: Readonly<Record<string, string>> = {
    '100': 'Thin',
    '200': 'ExtraLight',
    '300': 'Light',
    '400': 'Regular',
    '500': 'Medium',
    '600': 'SemiBold',
    '700': 'Bold',
    '800': 'ExtraBold',
    '900': 'Black',
};

const defaultFontFetch: FontFetch = async (url, init) => globalThis.fetch(url, init);

export function parseGoogleFontsCss(css: string): readonly ParsedGoogleFontFace[] {
    const faces = new Map<string, ParsedGoogleFontFace>();
    const fontFacePattern = /@font-face\s*\{([^}]*)\}/gu;

    for (const match of css.matchAll(fontFacePattern)) {
        const declarations = parseCssDeclarations(match[1] ?? '');
        const source = declarations.get('src');
        const url = source === undefined ? undefined : readWoff2Url(source);
        if (url === undefined) {
            continue;
        }

        const face = {
            family: stripCssQuotes(declarations.get('font-family') ?? 'Unknown'),
            style: toFontStyle(declarations.get('font-style')),
            weight: stripCssQuotes(declarations.get('font-weight') ?? '400'),
            display: toFontDisplay(declarations.get('font-display')),
            url,
        };
        faces.set(`${face.family}:${face.style}:${face.weight}`, face);
    }

    return [...faces.values()];
}

export async function fetchGoogleFontsForGame(
    options: FetchGoogleFontsForGameOptions,
): Promise<FetchGoogleFontsForGameResult> {
    const fetchFont = options.fetchFont ?? defaultFontFetch;
    const host = options.host ?? createNodeFontFileHost();
    const cssResponse = await fetchFont(options.cssUrl, {
        headers: {
            'user-agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        },
    });
    if (!cssResponse.ok) {
        throw new Error(
            `Failed to fetch Google Fonts CSS (${cssResponse.status}): ${options.cssUrl}`,
        );
    }

    const faces = parseGoogleFontsCss(await cssResponse.text());
    if (faces.length === 0) {
        throw new Error('No woff2 font faces were found in the Google Fonts CSS response.');
    }

    const sourceFontDir = resolve(
        options.workspaceRoot,
        // Game apps live under apps/<gameId>/ (relocated from games/ in F63 #782).
        'apps',
        options.gameId,
        'assets',
        'fonts',
    );
    await host.ensureDirectory(sourceFontDir);

    const downloads: DownloadedGameFontFile[] = [];
    const fonts: GameFontFace[] = [];

    for (const face of faces) {
        const fontResponse = await fetchFont(face.url);
        if (!fontResponse.ok) {
            throw new Error(`Failed to fetch font file (${fontResponse.status}): ${face.url}`);
        }

        const fileName = buildFontFileName(face);
        const sourceAssetPath = resolve(sourceFontDir, fileName);
        const bytes = new Uint8Array(await fontResponse.arrayBuffer());
        await host.writeFile(sourceAssetPath, bytes);

        const font: GameFontFace = {
            family: face.family,
            src: `${options.gameId}/fonts/${fileName}`,
            weight: face.weight,
            style: face.style,
            display: face.display,
        };
        fonts.push(font);
        downloads.push({ font, sourceAssetPath });
    }

    return { fonts, downloads };
}

export function formatGameFontFacesSnippet(fonts: readonly GameFontFace[]): string {
    const lines = ['export const gameFonts: readonly GameFontFace[] = ['];
    for (const font of fonts) {
        lines.push('    {');
        lines.push(`        family: '${escapeSingleQuoted(font.family)}',`);
        lines.push(`        src: '${escapeSingleQuoted(font.src)}',`);
        if (font.weight !== undefined) {
            lines.push(`        weight: '${escapeSingleQuoted(font.weight)}',`);
        }
        if (font.style !== undefined) {
            lines.push(`        style: '${font.style}',`);
        }
        if (font.display !== undefined) {
            lines.push(`        display: '${font.display}',`);
        }
        lines.push('    },');
    }
    lines.push('];');
    return `${lines.join('\n')}\n`;
}

export async function runFetchGoogleFontsCli(argv: readonly string[]): Promise<void> {
    const args = parseFetchGoogleFontsArgs(argv);
    const result = await fetchGoogleFontsForGame({
        gameId: args.gameId,
        cssUrl: args.cssUrl,
        workspaceRoot: args.workspaceRoot,
    });

    for (const download of result.downloads) {
        console.log(`wrote ${download.sourceAssetPath}`);
    }
    console.log(formatGameFontFacesSnippet(result.fonts));
}

export function isDirectInvocation(importMetaUrl: string, argv1: string | undefined): boolean {
    if (argv1 === undefined || !importMetaUrl.startsWith('file://')) {
        return false;
    }
    return fileURLToPath(importMetaUrl) === argv1;
}

function parseFetchGoogleFontsArgs(argv: readonly string[]): {
    readonly gameId: string;
    readonly cssUrl: string;
    readonly workspaceRoot: string;
} {
    const gameId = readFlagValue(argv, '--game');
    const cssUrl = readFlagValue(argv, '--url');
    const workspaceRoot = readFlagValue(argv, '--workspace-root') ?? process.cwd();
    if (gameId === undefined || cssUrl === undefined) {
        throw new Error(
            'Usage: tsx tools/fetch-google-fonts.ts --game <gameId> --url <google-css-url>',
        );
    }
    return { gameId, cssUrl, workspaceRoot };
}

function readFlagValue(argv: readonly string[], flag: string): string | undefined {
    const index = argv.indexOf(flag);
    if (index < 0) {
        return undefined;
    }
    return argv[index + 1];
}

function createNodeFontFileHost(): FontFileHost {
    return {
        ensureDirectory: async (directoryPath) => {
            await mkdir(directoryPath, { recursive: true });
        },
        writeFile: async (filePath, data) => {
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, data);
        },
    };
}

function parseCssDeclarations(block: string): ReadonlyMap<string, string> {
    const declarations = new Map<string, string>();
    for (const declaration of block.split(';')) {
        const colon = declaration.indexOf(':');
        if (colon < 1) {
            continue;
        }
        declarations.set(
            declaration.slice(0, colon).trim().toLowerCase(),
            declaration.slice(colon + 1).trim(),
        );
    }
    return declarations;
}

function readWoff2Url(src: string): string | undefined {
    const urlMatch = /url\((['"]?)([^'")]+\.woff2(?:\?[^'")]*)?)\1\)/iu.exec(src);
    return urlMatch?.[2];
}

function stripCssQuotes(value: string): string {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function toFontStyle(value: string | undefined): GameFontStyle {
    const style = stripCssQuotes(value ?? 'normal');
    return style === 'italic' ? 'italic' : 'normal';
}

function toFontDisplay(value: string | undefined): GameFontDisplay {
    const display = stripCssQuotes(value ?? 'swap');
    switch (display) {
        case 'auto':
        case 'block':
        case 'swap':
        case 'fallback':
        case 'optional':
            return display;
        default:
            return 'swap';
    }
}

function buildFontFileName(face: ParsedGoogleFontFace): string {
    const family = sanitiseFileName(face.family);
    const weight =
        weightFileNames[face.weight] ?? sanitiseFileName(face.weight.replace(/\s+/gu, '-'));
    const styleSuffix = face.style === 'italic' ? 'Italic' : '';
    return `${family}-${weight}${styleSuffix}.woff2`;
}

function sanitiseFileName(value: string): string {
    const segments = value.split(/[^A-Za-z0-9]+/u).filter((segment) => segment.length > 0);
    return segments.length === 0 ? 'Font' : segments.join('');
}

function escapeSingleQuoted(value: string): string {
    return value.replace(/\\/gu, '\\\\').replace(/'/gu, "\\'");
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
    runFetchGoogleFontsCli(process.argv.slice(2)).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
