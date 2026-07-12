import { constants, type Dirent } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ScriptKind,
    ScriptTarget,
    createSourceFile,
    forEachChild,
    isArrayLiteralExpression,
    isAsExpression,
    isCallExpression,
    isIdentifier,
    isNoSubstitutionTemplateLiteral,
    isObjectLiteralExpression,
    isPropertyAccessExpression,
    isPropertyAssignment,
    isPropertyDeclaration,
    isSatisfiesExpression,
    isStringLiteral,
} from 'typescript';
import type {
    ArrayLiteralExpression,
    Expression,
    Node,
    ObjectLiteralExpression,
    PropertyName,
} from 'typescript';

import {
    MalformedAssetRefError,
    parseAssetRef,
} from '@chimera-engine/simulation/foundation/asset-ref-parse.js';

export interface WorkspaceFileHost {
    findDataJsonFiles(workspaceRoot: string): Promise<readonly string[]>;
    findSceneSourceFiles(workspaceRoot: string): Promise<readonly string[]>;
    findAssetManifestFiles?(workspaceRoot: string): Promise<readonly string[]>;
    findAssetLoaderSourceFiles?(workspaceRoot: string): Promise<readonly string[]>;
    findGameFontSourceFiles?(workspaceRoot: string): Promise<readonly string[]>;
    findRendererPublicAssetFiles?(workspaceRoot: string): Promise<readonly string[]>;
    readFile(filePath: string): Promise<string>;
    fileExists(filePath: string): Promise<boolean>;
}

export interface ValidateAssetWorkspaceOptions {
    readonly workspaceRoot: string;
    readonly host?: WorkspaceFileHost;
    readonly assetLoaderKinds?: readonly string[];
}

export type AssetReferenceSourceKind =
    | 'data-json'
    | 'scene-required-assets'
    | 'asset-manifest'
    | 'game-fonts';

export interface AssetReferenceSource {
    readonly kind: AssetReferenceSourceKind;
    readonly filePath: string;
    readonly location: string;
}

export interface AssetReference {
    readonly ref: string;
    readonly gameId: string;
    readonly relativePath: string;
    readonly source: AssetReferenceSource;
}

export interface MissingAssetReference extends AssetReference {
    readonly expectedPath: string;
}

export interface MalformedAssetReference {
    readonly ref: string;
    readonly source: AssetReferenceSource;
    readonly reason: string;
}

export interface ForbiddenRendererPublicAsset {
    readonly filePath: string;
    readonly gameId: string;
    readonly relativePath: string;
    readonly expectedSourcePath: string;
}

export type UnmanifestedAssetReference = AssetReference;

export interface UnknownAssetManifestKind {
    readonly kind: string;
    readonly source: AssetReferenceSource;
    readonly ref?: string;
}

export interface AssetValidationReport {
    readonly ok: boolean;
    readonly checkedRefs: number;
    readonly missing: readonly MissingAssetReference[];
    readonly missingFontSources: readonly MissingAssetReference[];
    readonly forbiddenRendererPublicAssets: readonly ForbiddenRendererPublicAsset[];
    readonly malformed: readonly MalformedAssetReference[];
    readonly unmanifested: readonly UnmanifestedAssetReference[];
    readonly unknownKinds: readonly UnknownAssetManifestKind[];
}

interface CollectedAssetReferences {
    readonly refs: readonly AssetReference[];
    readonly malformed: readonly MalformedAssetReference[];
}

interface CollectedAssetManifestReferences extends CollectedAssetReferences {
    readonly kinds: readonly UnknownAssetManifestKind[];
}

export type AssetValidationExitCode = 0 | 1;

const assetRefCandidatePattern = /^[^\0/]+\/[^\0]*$/u;
const externalOrAbsoluteAssetPattern = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/)/u;
const defaultAssetLoaderKinds = new Set([
    'texture',
    'audio-clip',
    'gltf-model',
    'sprite-sheet',
    'particle-config',
]);

export async function validateAssetWorkspace(
    options: ValidateAssetWorkspaceOptions,
): Promise<AssetValidationReport> {
    const workspaceRoot = resolve(options.workspaceRoot);
    const host = options.host ?? createNodeWorkspaceFileHost();
    const dataJsonFiles = [...(await host.findDataJsonFiles(workspaceRoot))].sort();
    const sceneSourceFiles = [...(await host.findSceneSourceFiles(workspaceRoot))].sort();
    const assetManifestFiles = [
        ...(await (host.findAssetManifestFiles?.(workspaceRoot) ?? [])),
    ].sort();
    const assetLoaderSourceFiles = [
        ...(await (host.findAssetLoaderSourceFiles?.(workspaceRoot) ?? [])),
    ].sort();
    const gameFontSourceFiles = [
        ...(await (host.findGameFontSourceFiles?.(workspaceRoot) ?? [])),
    ].sort();
    const rendererPublicAssetFiles = [
        ...(await (host.findRendererPublicAssetFiles?.(workspaceRoot) ?? [])),
    ].sort();

    const refs: AssetReference[] = [];
    const manifestRefs: AssetReference[] = [];
    const fontRefs: AssetReference[] = [];
    const manifestKinds: UnknownAssetManifestKind[] = [];
    const malformed: MalformedAssetReference[] = [];

    for (const filePath of dataJsonFiles) {
        const sourceText = await host.readFile(filePath);
        const parsed: unknown = JSON.parse(sourceText);
        const collected = collectDataJsonAssetRefs(parsed, filePath);
        refs.push(...collected.refs);
        malformed.push(...collected.malformed);
    }

    for (const filePath of sceneSourceFiles) {
        const sourceText = await host.readFile(filePath);
        const collected = collectSceneRequiredAssetRefs(sourceText, filePath);
        refs.push(...collected.refs);
        malformed.push(...collected.malformed);
    }

    for (const filePath of assetManifestFiles) {
        const sourceText = await host.readFile(filePath);
        const collected = collectAssetManifestRefs(sourceText, filePath);
        manifestRefs.push(...collected.refs);
        manifestKinds.push(...collected.kinds);
        malformed.push(...collected.malformed);
    }

    for (const filePath of gameFontSourceFiles) {
        const sourceText = await host.readFile(filePath);
        const collected = collectGameFontRefs(sourceText, filePath);
        fontRefs.push(...collected.refs);
        malformed.push(...collected.malformed);
    }

    const assetLoaderKinds = new Set<string>([
        ...defaultAssetLoaderKinds,
        ...(options.assetLoaderKinds ?? []),
    ]);
    for (const filePath of assetLoaderSourceFiles) {
        const sourceText = await host.readFile(filePath);
        for (const kind of collectAssetLoaderKinds(sourceText, filePath)) {
            assetLoaderKinds.add(kind);
        }
    }

    const missing: MissingAssetReference[] = [];
    for (const ref of [...refs, ...manifestRefs]) {
        const expectedPath = resolve(workspaceRoot, 'apps', ref.gameId, 'assets', ref.relativePath);
        if (!(await host.fileExists(expectedPath))) {
            missing.push({ ...ref, expectedPath });
        }
    }

    const missingFontSources: MissingAssetReference[] = [];
    for (const ref of fontRefs) {
        const sourceExpectedPath = resolve(
            workspaceRoot,
            'apps',
            ref.gameId,
            'assets',
            ref.relativePath,
        );
        if (!(await host.fileExists(sourceExpectedPath))) {
            missingFontSources.push({ ...ref, expectedPath: sourceExpectedPath });
        }
    }

    const forbiddenRendererPublicAssets = collectForbiddenRendererPublicAssets(
        rendererPublicAssetFiles,
        workspaceRoot,
    );

    const manifestRefSet = new Set(manifestRefs.map((ref) => ref.ref));
    const unmanifested = refs.filter((ref) => !manifestRefSet.has(ref.ref));
    const unknownKinds = manifestKinds.filter((entry) => !assetLoaderKinds.has(entry.kind));

    missing.sort(compareReferenceFailures);
    missingFontSources.sort(compareReferenceFailures);
    forbiddenRendererPublicAssets.sort(compareForbiddenRendererPublicAssets);
    malformed.sort(compareMalformedFailures);
    unmanifested.sort(compareAssetReferenceFailures);
    unknownKinds.sort(compareUnknownKindFailures);

    return {
        ok:
            missing.length === 0 &&
            missingFontSources.length === 0 &&
            forbiddenRendererPublicAssets.length === 0 &&
            malformed.length === 0 &&
            unmanifested.length === 0 &&
            unknownKinds.length === 0,
        checkedRefs: refs.length + fontRefs.length,
        missing,
        missingFontSources,
        forbiddenRendererPublicAssets,
        malformed,
        unmanifested,
        unknownKinds,
    };
}

export function toAssetValidationExitCode(report: AssetValidationReport): AssetValidationExitCode {
    return report.ok ? 0 : 1;
}

export function formatAssetValidationReport(
    report: AssetValidationReport,
    workspaceRoot: string,
): string {
    const root = resolve(workspaceRoot);
    if (report.ok) {
        return `[validate-assets] Checked ${report.checkedRefs} asset refs; all files exist.\n`;
    }

    const lines: string[] = ['[validate-assets] Asset validation failed.'];

    if (report.missing.length > 0) {
        lines.push('', 'Missing asset files:');
        for (const missing of report.missing) {
            lines.push(
                `- ${missing.ref}`,
                `  source: ${formatSource(missing.source, root)}`,
                `  expected: ${relative(root, missing.expectedPath)}`,
            );
        }
    }

    if (report.missingFontSources.length > 0) {
        lines.push('', 'Missing font source files:');
        for (const missing of report.missingFontSources) {
            lines.push(
                `- ${missing.ref}`,
                `  source: ${formatSource(missing.source, root)}`,
                `  expected: ${relative(root, missing.expectedPath)}`,
            );
        }
    }

    if (report.forbiddenRendererPublicAssets.length > 0) {
        lines.push('', 'Renderer-public game assets are forbidden:');
        for (const forbidden of report.forbiddenRendererPublicAssets) {
            lines.push(
                `- ${relative(root, forbidden.filePath)}`,
                `  game source: ${relative(root, forbidden.expectedSourcePath)}`,
            );
        }
    }

    if (report.malformed.length > 0) {
        lines.push('', 'Malformed asset refs:');
        for (const malformed of report.malformed) {
            lines.push(
                `- ${malformed.ref}`,
                `  source: ${formatSource(malformed.source, root)}`,
                `  reason: ${malformed.reason}`,
            );
        }
    }

    if (report.unmanifested.length > 0) {
        lines.push('', 'Asset refs missing from manifests:');
        for (const reference of report.unmanifested) {
            lines.push(`- ${reference.ref}`, `  source: ${formatSource(reference.source, root)}`);
        }
    }

    if (report.unknownKinds.length > 0) {
        lines.push('', 'Manifest kinds without loader coverage:');
        for (const unknownKind of report.unknownKinds) {
            lines.push(
                `- ${unknownKind.kind}`,
                `  source: ${formatSource(unknownKind.source, root)}`,
                ...(unknownKind.ref === undefined ? [] : [`  ref: ${unknownKind.ref}`]),
            );
        }
    }

    return `${lines.join('\n')}\n`;
}

export function createNodeWorkspaceFileHost(): WorkspaceFileHost {
    return {
        findDataJsonFiles: async (workspaceRoot) => findDataJsonFiles(workspaceRoot),
        findSceneSourceFiles: async (workspaceRoot) => findSceneSourceFiles(workspaceRoot),
        findAssetManifestFiles: async (workspaceRoot) => findAssetManifestFiles(workspaceRoot),
        findAssetLoaderSourceFiles: async (workspaceRoot) =>
            findAssetLoaderSourceFiles(workspaceRoot),
        findGameFontSourceFiles: async (workspaceRoot) => findGameFontSourceFiles(workspaceRoot),
        findRendererPublicAssetFiles: async (workspaceRoot) =>
            findRendererPublicAssetFiles(workspaceRoot),
        readFile: async (filePath) => readFile(filePath, 'utf8'),
        fileExists: async (filePath) => {
            try {
                await access(filePath, constants.F_OK);
                return true;
            } catch {
                return false;
            }
        },
    };
}

function collectForbiddenRendererPublicAssets(
    rendererPublicAssetFiles: readonly string[],
    workspaceRoot: string,
): ForbiddenRendererPublicAsset[] {
    const rendererAssetsRoot = resolve(workspaceRoot, 'renderer', 'public', 'assets');
    const forbidden: ForbiddenRendererPublicAsset[] = [];

    for (const filePath of rendererPublicAssetFiles) {
        const relativePathFromRendererAssets = relative(rendererAssetsRoot, filePath);
        if (
            relativePathFromRendererAssets === '' ||
            relativePathFromRendererAssets.startsWith('..') ||
            relativePathFromRendererAssets.startsWith('/')
        ) {
            continue;
        }

        const [gameId, ...relativeSegments] = relativePathFromRendererAssets.split(/[\\/]/u);
        if (gameId === undefined || relativeSegments.length === 0) {
            continue;
        }
        const relativePath = relativeSegments.join('/');
        forbidden.push({
            filePath,
            gameId,
            relativePath,
            expectedSourcePath: resolve(workspaceRoot, 'apps', gameId, 'assets', relativePath),
        });
    }

    return forbidden;
}

function collectGameFontRefs(sourceText: string, filePath: string): CollectedAssetReferences {
    const sourceFile = createSourceFile(
        filePath,
        sourceText,
        ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
    );
    const refs: AssetReference[] = [];
    const malformed: MalformedAssetReference[] = [];

    visit(sourceFile);

    return { refs, malformed };

    function visit(node: Node): void {
        if (isArrayLiteralExpression(node)) {
            collectFontArray(node);
        }

        forEachChild(node, visit);
    }

    function collectFontArray(arrayLiteral: ArrayLiteralExpression): void {
        arrayLiteral.elements.forEach((element, index) => {
            const entry = unwrapObjectLiteral(element);
            if (entry === undefined) {
                return;
            }

            const src = readStringProperty(entry, 'src');
            if (src !== undefined) {
                collectRequiredFontRef(
                    src,
                    {
                        kind: 'game-fonts',
                        filePath,
                        location: `fonts[${index}].src`,
                    },
                    refs,
                    malformed,
                );
            }
        });
    }
}

function collectDataJsonAssetRefs(value: unknown, filePath: string): CollectedAssetReferences {
    const refs: AssetReference[] = [];
    const malformed: MalformedAssetReference[] = [];

    collectJsonValue(value, {
        kind: 'data-json',
        filePath,
        location: '$',
    });

    return { refs, malformed };

    function collectJsonValue(jsonValue: unknown, source: AssetReferenceSource): void {
        if (typeof jsonValue === 'string') {
            collectCandidate(jsonValue, source, refs, malformed);
            return;
        }

        if (Array.isArray(jsonValue)) {
            jsonValue.forEach((item, index) =>
                collectJsonValue(item, { ...source, location: `${source.location}[${index}]` }),
            );
            return;
        }

        if (isRecord(jsonValue)) {
            for (const [key, child] of Object.entries(jsonValue)) {
                collectJsonValue(child, {
                    ...source,
                    location: `${source.location}${formatJsonPathSegment(key)}`,
                });
            }
        }
    }
}

function collectSceneRequiredAssetRefs(
    sourceText: string,
    filePath: string,
): CollectedAssetReferences {
    const sourceFile = createSourceFile(
        filePath,
        sourceText,
        ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
    );
    const refs: AssetReference[] = [];
    const malformed: MalformedAssetReference[] = [];

    visit(sourceFile);

    return { refs, malformed };

    function visit(node: Node): void {
        if (isPropertyAssignment(node) && isRequiredAssetsName(node.name)) {
            const arrayLiteral = unwrapArrayLiteral(node.initializer);
            if (arrayLiteral !== undefined) {
                collectRequiredAssetsArray(arrayLiteral);
            }
        }

        forEachChild(node, visit);
    }

    function collectRequiredAssetsArray(arrayLiteral: ArrayLiteralExpression): void {
        arrayLiteral.elements.forEach((element, index) => {
            if (isStringLiteral(element) || isNoSubstitutionTemplateLiteral(element)) {
                collectCandidate(
                    element.text,
                    {
                        kind: 'scene-required-assets',
                        filePath,
                        location: `requiredAssets[${index}]`,
                    },
                    refs,
                    malformed,
                );
            }
        });
    }
}

function collectAssetManifestRefs(
    sourceText: string,
    filePath: string,
): CollectedAssetManifestReferences {
    const sourceFile = createSourceFile(
        filePath,
        sourceText,
        ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
    );
    const refs: AssetReference[] = [];
    const malformed: MalformedAssetReference[] = [];
    const kinds: UnknownAssetManifestKind[] = [];

    visit(sourceFile);

    return { refs, malformed, kinds };

    function visit(node: Node): void {
        if (isPropertyAssignment(node) && isPropertyName(node.name, 'entries')) {
            const arrayLiteral = unwrapArrayLiteral(node.initializer);
            if (arrayLiteral !== undefined) {
                collectManifestEntries(arrayLiteral);
            }
        }

        forEachChild(node, visit);
    }

    function collectManifestEntries(arrayLiteral: ArrayLiteralExpression): void {
        arrayLiteral.elements.forEach((element, index) => {
            const entry = unwrapObjectLiteral(element);
            if (entry === undefined) {
                return;
            }

            const ref = readStringProperty(entry, 'ref');
            const kind = readStringProperty(entry, 'kind');
            const source = {
                kind: 'asset-manifest' as const,
                filePath,
                location: `entries[${index}]`,
            };

            if (ref !== undefined) {
                collectCandidate(
                    ref,
                    { ...source, location: `${source.location}.ref` },
                    refs,
                    malformed,
                );
            }

            if (kind !== undefined) {
                const kindReference: UnknownAssetManifestKind = { kind, source };
                kinds.push(ref === undefined ? kindReference : { ...kindReference, ref });
            }
        });
    }
}

function collectAssetLoaderKinds(sourceText: string, filePath: string): readonly string[] {
    const sourceFile = createSourceFile(
        filePath,
        sourceText,
        ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
    );
    const kinds = new Set<string>();

    visit(sourceFile);

    return [...kinds].sort();

    function visit(node: Node): void {
        if (
            (isPropertyAssignment(node) || isPropertyDeclaration(node)) &&
            isPropertyName(node.name, 'kind') &&
            node.initializer !== undefined
        ) {
            const kind = readStringExpression(node.initializer);
            if (kind !== undefined) {
                kinds.add(kind);
            }
        }

        forEachChild(node, visit);
    }
}

function collectCandidate(
    value: string,
    source: AssetReferenceSource,
    refs: AssetReference[],
    malformed: MalformedAssetReference[],
): void {
    if (!assetRefCandidatePattern.test(value)) {
        return;
    }

    try {
        const parsed = parseAssetRef(value);
        refs.push({
            ref: value,
            gameId: parsed.gameId,
            relativePath: parsed.relativePath,
            source,
        });
    } catch (error: unknown) {
        if (error instanceof MalformedAssetRefError) {
            malformed.push({ ref: value, source, reason: error.message });
            return;
        }
        throw error;
    }
}

function collectRequiredFontRef(
    value: string,
    source: AssetReferenceSource,
    refs: AssetReference[],
    malformed: MalformedAssetReference[],
): void {
    if (externalOrAbsoluteAssetPattern.test(value) || !assetRefCandidatePattern.test(value)) {
        malformed.push({
            ref: value,
            source,
            reason: 'Game font source must be a local game asset ref.',
        });
        return;
    }

    collectCandidate(value, source, refs, malformed);
}

function unwrapArrayLiteral(expression: Expression): ArrayLiteralExpression | undefined {
    if (isArrayLiteralExpression(expression)) {
        return expression;
    }
    if (isAsExpression(expression) || isSatisfiesExpression(expression)) {
        return unwrapArrayLiteral(expression.expression);
    }
    return undefined;
}

function unwrapObjectLiteral(expression: Expression): ObjectLiteralExpression | undefined {
    if (isObjectLiteralExpression(expression)) {
        return expression;
    }
    if (isAsExpression(expression) || isSatisfiesExpression(expression)) {
        return unwrapObjectLiteral(expression.expression);
    }
    return undefined;
}

function readStringProperty(
    objectLiteral: ObjectLiteralExpression,
    propertyName: string,
): string | undefined {
    for (const property of objectLiteral.properties) {
        if (!isPropertyAssignment(property) || !isPropertyName(property.name, propertyName)) {
            continue;
        }
        return readStringExpression(property.initializer);
    }
    return undefined;
}

function readStringExpression(expression: Expression): string | undefined {
    if (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text;
    }
    if (isAsExpression(expression) || isSatisfiesExpression(expression)) {
        return readStringExpression(expression.expression);
    }
    if (isCallExpression(expression) && isBuildAssetRefCall(expression.expression)) {
        const [gameIdArg, relativePathArg] = expression.arguments;
        const gameId = gameIdArg === undefined ? undefined : readStringExpression(gameIdArg);
        const relativePath =
            relativePathArg === undefined ? undefined : readStringExpression(relativePathArg);
        if (gameId !== undefined && relativePath !== undefined) {
            return `${gameId}/${relativePath}`;
        }
    }
    return undefined;
}

function isBuildAssetRefCall(expression: Expression): boolean {
    if (isIdentifier(expression)) {
        return expression.text === 'buildAssetRef';
    }
    if (isPropertyAccessExpression(expression)) {
        return expression.name.text === 'buildAssetRef';
    }
    return false;
}

function isRequiredAssetsName(name: PropertyName): boolean {
    return isPropertyName(name, 'requiredAssets');
}

function isPropertyName(name: PropertyName, expected: string): boolean {
    if (isIdentifier(name) || isStringLiteral(name)) {
        return name.text === expected;
    }
    return false;
}

function getScriptKind(filePath: string): ScriptKind {
    return filePath.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS;
}

async function findDataJsonFiles(workspaceRoot: string): Promise<readonly string[]> {
    // Game apps live under apps/<name>/.
    const appsRoot = resolve(workspaceRoot, 'apps');
    const gameEntries = await readDirectoryOrEmpty(appsRoot);
    const files: string[] = [];

    for (const entry of gameEntries) {
        if (entry.isDirectory()) {
            const dataRoot = resolve(appsRoot, entry.name, 'data');
            files.push(...(await collectFiles(dataRoot, (filePath) => filePath.endsWith('.json'))));
        }
    }

    return files.sort();
}

async function findSceneSourceFiles(workspaceRoot: string): Promise<readonly string[]> {
    const roots = [resolve(workspaceRoot, 'apps'), resolve(workspaceRoot, 'simulation', 'scene')];
    const files: string[] = [];

    for (const root of roots) {
        files.push(...(await collectFiles(root, isSceneSourceFile)));
    }

    return files.sort();
}

async function findAssetManifestFiles(workspaceRoot: string): Promise<readonly string[]> {
    const appsRoot = resolve(workspaceRoot, 'apps');
    return collectFiles(appsRoot, (filePath) => basename(filePath) === 'asset-manifest.ts');
}

async function findAssetLoaderSourceFiles(workspaceRoot: string): Promise<readonly string[]> {
    const roots = [resolve(workspaceRoot, 'apps'), resolve(workspaceRoot, 'renderer', 'assets')];
    const files: string[] = [];

    for (const root of roots) {
        files.push(...(await collectFiles(root, isAssetLoaderSourceFile)));
    }

    return files.sort();
}

async function findGameFontSourceFiles(workspaceRoot: string): Promise<readonly string[]> {
    const appsRoot = resolve(workspaceRoot, 'apps');
    return collectFiles(appsRoot, isGameFontSourceFile);
}

async function findRendererPublicAssetFiles(workspaceRoot: string): Promise<readonly string[]> {
    return collectFiles(resolve(workspaceRoot, 'renderer', 'public', 'assets'), () => true);
}

function isGameFontSourceFile(filePath: string): boolean {
    return basename(filePath) === 'fonts.ts' && filePath.split(/[\\/]/u).includes('shell');
}

async function collectFiles(
    directoryPath: string,
    includeFile: (filePath: string) => boolean,
): Promise<readonly string[]> {
    const entries = await readDirectoryOrEmpty(directoryPath);
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = resolve(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFiles(fullPath, includeFile)));
        } else if (entry.isFile() && includeFile(fullPath)) {
            files.push(fullPath);
        }
    }

    return files.sort();
}

async function readDirectoryOrEmpty(directoryPath: string): Promise<readonly Dirent[]> {
    try {
        return await readdir(directoryPath, { withFileTypes: true });
    } catch (error: unknown) {
        if (hasErrorCode(error, 'ENOENT')) {
            return [];
        }
        throw error;
    }
}

function isSceneSourceFile(filePath: string): boolean {
    if (filePath.endsWith('.d.ts')) {
        return false;
    }
    if (/\.(test|spec)\.tsx?$/u.test(filePath)) {
        return false;
    }
    return /\.tsx?$/u.test(filePath);
}

function isAssetLoaderSourceFile(filePath: string): boolean {
    if (!isSceneSourceFile(filePath)) {
        return false;
    }
    const fileName = basename(filePath).toLowerCase();
    return fileName.includes('asset-loader') || fileName.includes('assetloaders');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatJsonPathSegment(key: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)) {
        return `.${key}`;
    }
    return `[${JSON.stringify(key)}]`;
}

function formatSource(source: AssetReferenceSource, workspaceRoot: string): string {
    return `${relative(workspaceRoot, source.filePath)} ${source.location}`;
}

function compareReferenceFailures(
    left: MissingAssetReference,
    right: MissingAssetReference,
): number {
    return compareStrings(referenceSortKey(left), referenceSortKey(right));
}

function compareAssetReferenceFailures(left: AssetReference, right: AssetReference): number {
    return compareStrings(referenceSortKey(left), referenceSortKey(right));
}

function compareMalformedFailures(
    left: MalformedAssetReference,
    right: MalformedAssetReference,
): number {
    return compareStrings(referenceSortKey(left), referenceSortKey(right));
}

function compareUnknownKindFailures(
    left: UnknownAssetManifestKind,
    right: UnknownAssetManifestKind,
): number {
    return compareStrings(
        `${referenceSortKey(left)}\u0000${left.kind}`,
        `${referenceSortKey(right)}\u0000${right.kind}`,
    );
}

function compareForbiddenRendererPublicAssets(
    left: ForbiddenRendererPublicAsset,
    right: ForbiddenRendererPublicAsset,
): number {
    return compareStrings(left.filePath, right.filePath);
}

function referenceSortKey(
    reference: AssetReference | MalformedAssetReference | UnknownAssetManifestKind,
): string {
    return `${reference.source.filePath}\u0000${reference.source.location}\u0000${'ref' in reference ? (reference.ref ?? '') : ''}`;
}

function compareStrings(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function hasErrorCode(error: unknown, code: string): boolean {
    return error instanceof Error && 'code' in error && error.code === code;
}

export async function runValidateAssetsCli(
    argv: readonly string[] = process.argv.slice(2),
): Promise<AssetValidationExitCode> {
    const workspaceRoot = resolve(argv[0] ?? process.cwd());
    const report = await validateAssetWorkspace({ workspaceRoot });
    const output = formatAssetValidationReport(report, workspaceRoot);

    if (report.ok) {
        process.stdout.write(output);
    } else {
        process.stderr.write(output);
    }

    return toAssetValidationExitCode(report);
}

const invokedDirectly = isDirectInvocation(import.meta.url, process.argv[1]);
if (invokedDirectly) {
    runValidateAssetsCli()
        .then((exitCode) => process.exit(exitCode))
        .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[validate-assets] ${message}\n`);
            process.exit(1);
        });
}

export function isDirectInvocation(importMetaUrl: string, argv1: string | undefined): boolean {
    if (argv1 === undefined) return false;
    if (!importMetaUrl.startsWith('file://')) return false;
    try {
        return fileURLToPath(importMetaUrl) === resolve(argv1);
    } catch {
        return false;
    }
}
