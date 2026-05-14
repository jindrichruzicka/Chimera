import { constants, type Dirent } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ScriptKind,
    ScriptTarget,
    createSourceFile,
    forEachChild,
    isArrayLiteralExpression,
    isAsExpression,
    isIdentifier,
    isNoSubstitutionTemplateLiteral,
    isPropertyAssignment,
    isSatisfiesExpression,
    isStringLiteral,
} from 'typescript';
import type { ArrayLiteralExpression, Expression, Node, PropertyName } from 'typescript';

import { MalformedAssetRefError, parseAssetRef } from '../shared/asset-ref-parse.js';

export interface WorkspaceFileHost {
    findDataJsonFiles(workspaceRoot: string): Promise<readonly string[]>;
    findSceneSourceFiles(workspaceRoot: string): Promise<readonly string[]>;
    readFile(filePath: string): Promise<string>;
    fileExists(filePath: string): Promise<boolean>;
}

export interface ValidateAssetWorkspaceOptions {
    readonly workspaceRoot: string;
    readonly host?: WorkspaceFileHost;
}

export type AssetReferenceSourceKind = 'data-json' | 'scene-required-assets';

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

export interface AssetValidationReport {
    readonly ok: boolean;
    readonly checkedRefs: number;
    readonly missing: readonly MissingAssetReference[];
    readonly malformed: readonly MalformedAssetReference[];
}

interface CollectedAssetReferences {
    readonly refs: readonly AssetReference[];
    readonly malformed: readonly MalformedAssetReference[];
}

export type AssetValidationExitCode = 0 | 1;

const assetRefCandidatePattern = /^[^\0/]+\/[^\0]*$/u;

export async function validateAssetWorkspace(
    options: ValidateAssetWorkspaceOptions,
): Promise<AssetValidationReport> {
    const workspaceRoot = resolve(options.workspaceRoot);
    const host = options.host ?? createNodeWorkspaceFileHost();
    const dataJsonFiles = [...(await host.findDataJsonFiles(workspaceRoot))].sort();
    const sceneSourceFiles = [...(await host.findSceneSourceFiles(workspaceRoot))].sort();

    const refs: AssetReference[] = [];
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

    const missing: MissingAssetReference[] = [];
    for (const ref of refs) {
        const expectedPath = resolve(
            workspaceRoot,
            'games',
            ref.gameId,
            'assets',
            ref.relativePath,
        );
        if (!(await host.fileExists(expectedPath))) {
            missing.push({ ...ref, expectedPath });
        }
    }

    missing.sort(compareReferenceFailures);
    malformed.sort(compareMalformedFailures);

    return {
        ok: missing.length === 0 && malformed.length === 0,
        checkedRefs: refs.length,
        missing,
        malformed,
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

    return `${lines.join('\n')}\n`;
}

export function createNodeWorkspaceFileHost(): WorkspaceFileHost {
    return {
        findDataJsonFiles: async (workspaceRoot) => findDataJsonFiles(workspaceRoot),
        findSceneSourceFiles: async (workspaceRoot) => findSceneSourceFiles(workspaceRoot),
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

function unwrapArrayLiteral(expression: Expression): ArrayLiteralExpression | undefined {
    if (isArrayLiteralExpression(expression)) {
        return expression;
    }
    if (isAsExpression(expression) || isSatisfiesExpression(expression)) {
        return unwrapArrayLiteral(expression.expression);
    }
    return undefined;
}

function isRequiredAssetsName(name: PropertyName): boolean {
    if (isIdentifier(name) || isStringLiteral(name)) {
        return name.text === 'requiredAssets';
    }
    return false;
}

function getScriptKind(filePath: string): ScriptKind {
    return filePath.endsWith('.tsx') ? ScriptKind.TSX : ScriptKind.TS;
}

async function findDataJsonFiles(workspaceRoot: string): Promise<readonly string[]> {
    const gamesRoot = resolve(workspaceRoot, 'games');
    const gameEntries = await readDirectoryOrEmpty(gamesRoot);
    const files: string[] = [];

    for (const entry of gameEntries) {
        if (entry.isDirectory()) {
            const dataRoot = resolve(gamesRoot, entry.name, 'data');
            files.push(...(await collectFiles(dataRoot, (filePath) => filePath.endsWith('.json'))));
        }
    }

    return files.sort();
}

async function findSceneSourceFiles(workspaceRoot: string): Promise<readonly string[]> {
    const roots = [resolve(workspaceRoot, 'games'), resolve(workspaceRoot, 'simulation', 'scene')];
    const files: string[] = [];

    for (const root of roots) {
        files.push(...(await collectFiles(root, isSceneSourceFile)));
    }

    return files.sort();
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

function compareMalformedFailures(
    left: MalformedAssetReference,
    right: MalformedAssetReference,
): number {
    return compareStrings(referenceSortKey(left), referenceSortKey(right));
}

function referenceSortKey(reference: AssetReference | MalformedAssetReference): string {
    return `${reference.source.filePath}\u0000${reference.source.location}\u0000${reference.ref}`;
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
