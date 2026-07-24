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
    isVariableDeclaration,
} from 'typescript';
import type {
    ArrayLiteralExpression,
    CallExpression,
    Expression,
    Node,
    ObjectLiteralExpression,
    PropertyName,
    SourceFile,
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
    findOnDemandLoadSourceFiles?(workspaceRoot: string): Promise<readonly string[]>;
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
    | 'game-fonts'
    | 'on-demand-load';

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

/** A statically-resolved on-demand load whose ref is declared in no asset surface (hard error). */
export type UndeclaredOnDemandLoad = AssetReference;

/** An on-demand load whose argument could not be statically resolved to a ref (warning, not a failure). */
export interface UnresolvedOnDemandLoad {
    readonly callee: string;
    readonly source: AssetReferenceSource;
    readonly reason: string;
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
    readonly undeclaredOnDemandLoads: readonly UndeclaredOnDemandLoad[];
    readonly unresolvedOnDemandLoads: readonly UnresolvedOnDemandLoad[];
}

interface CollectedAssetReferences {
    readonly refs: readonly AssetReference[];
    readonly malformed: readonly MalformedAssetReference[];
}

interface CollectedAssetManifestReferences extends CollectedAssetReferences {
    readonly kinds: readonly UnknownAssetManifestKind[];
}

interface CollectedOnDemandLoads {
    readonly refs: readonly AssetReference[];
    readonly unresolved: readonly UnresolvedOnDemandLoad[];
    readonly malformed: readonly MalformedAssetReference[];
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
    const onDemandLoadSourceFiles = [
        ...(await (host.findOnDemandLoadSourceFiles?.(workspaceRoot) ?? [])),
    ].sort();

    const refs: AssetReference[] = [];
    const manifestRefs: AssetReference[] = [];
    const fontRefs: AssetReference[] = [];
    const manifestKinds: UnknownAssetManifestKind[] = [];
    const malformed: MalformedAssetReference[] = [];
    const manifestConstMembers = new Map<string, string>();

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
        // Key the tier-B const map by the manifest's own game so an identically-named
        // const in another game's manifest cannot cross-resolve an on-demand load
        // (a manifest lives at apps/<gameId>/asset-manifest.ts).
        const manifestGameId = gameIdFromPath(workspaceRoot, filePath);
        if (manifestGameId !== undefined) {
            for (const [member, ref] of collectManifestConstMembers(sourceText, filePath)) {
                manifestConstMembers.set(`${manifestGameId} ${member}`, ref);
            }
        }
    }

    for (const filePath of gameFontSourceFiles) {
        const sourceText = await host.readFile(filePath);
        const collected = collectGameFontRefs(sourceText, filePath);
        fontRefs.push(...collected.refs);
        malformed.push(...collected.malformed);
    }

    const onDemandRefs: AssetReference[] = [];
    const unresolvedOnDemandLoads: UnresolvedOnDemandLoad[] = [];
    for (const filePath of onDemandLoadSourceFiles) {
        const sourceText = await host.readFile(filePath);
        const collected = collectOnDemandAssetLoadRefs(
            sourceText,
            filePath,
            workspaceRoot,
            manifestConstMembers,
        );
        onDemandRefs.push(...collected.refs);
        unresolvedOnDemandLoads.push(...collected.unresolved);
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

    // An on-demand load is "declared" if its ref appears in ANY declared surface
    // (data JSON, scene requiredAssets, asset manifest, or font src). Manifest
    // coverage per Invariant #22 is enforced transitively by `unmanifested`, so a
    // declared-but-unmanifested ref is already flagged there — no double-counting.
    const declaredRefSet = new Set(
        [...refs, ...manifestRefs, ...fontRefs].map((reference) => reference.ref),
    );
    const undeclaredOnDemandLoads = onDemandRefs.filter(
        (reference) => !declaredRefSet.has(reference.ref),
    );

    missing.sort(compareReferenceFailures);
    missingFontSources.sort(compareReferenceFailures);
    forbiddenRendererPublicAssets.sort(compareForbiddenRendererPublicAssets);
    malformed.sort(compareMalformedFailures);
    unmanifested.sort(compareAssetReferenceFailures);
    unknownKinds.sort(compareUnknownKindFailures);
    undeclaredOnDemandLoads.sort(compareAssetReferenceFailures);
    unresolvedOnDemandLoads.sort(compareUnresolvedOnDemandLoads);

    return {
        ok:
            missing.length === 0 &&
            missingFontSources.length === 0 &&
            forbiddenRendererPublicAssets.length === 0 &&
            malformed.length === 0 &&
            unmanifested.length === 0 &&
            unknownKinds.length === 0 &&
            undeclaredOnDemandLoads.length === 0,
        checkedRefs: refs.length + fontRefs.length,
        missing,
        missingFontSources,
        forbiddenRendererPublicAssets,
        malformed,
        unmanifested,
        unknownKinds,
        undeclaredOnDemandLoads,
        unresolvedOnDemandLoads,
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
        const okLines = [
            `[validate-assets] Checked ${report.checkedRefs} asset refs; all files exist.`,
        ];
        appendUnresolvedOnDemandWarnings(okLines, report, root);
        return `${okLines.join('\n')}\n`;
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

    if (report.undeclaredOnDemandLoads.length > 0) {
        lines.push(
            '',
            'Undeclared on-demand asset loads (ref declared in no manifest/requiredAssets/data JSON/font surface):',
        );
        for (const load of report.undeclaredOnDemandLoads) {
            lines.push(`- ${load.ref}`, `  source: ${formatSource(load.source, root)}`);
        }
    }

    appendUnresolvedOnDemandWarnings(lines, report, root);

    return `${lines.join('\n')}\n`;
}

/**
 * Warnings are diagnostics, not failures: they surface unresolved (dynamic/computed)
 * on-demand load call sites in BOTH the ok and failed outputs, and never affect
 * `report.ok`. Appends nothing when the warn bucket is empty, so the success message
 * stays byte-identical when there is nothing to warn about.
 */
function appendUnresolvedOnDemandWarnings(
    lines: string[],
    report: AssetValidationReport,
    workspaceRoot: string,
): void {
    if (report.unresolvedOnDemandLoads.length === 0) {
        return;
    }
    lines.push(
        '',
        'Warning: on-demand asset load call sites that could not be statically verified:',
    );
    for (const load of report.unresolvedOnDemandLoads) {
        lines.push(
            `- ${load.callee}`,
            `  source: ${formatSource(load.source, workspaceRoot)}`,
            `  reason: ${load.reason}`,
        );
    }
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
        findOnDemandLoadSourceFiles: async (workspaceRoot) =>
            findOnDemandLoadSourceFiles(workspaceRoot),
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

/**
 * Pre-scans a manifest source file for `const X = { member: '<ref>' as ... }` object
 * literals, yielding `[`${constName}.${member}`, refString]` entries. Enables tier-B
 * resolution of on-demand load args expressed as a manifest-const member access
 * (e.g. `tacticsAudioRefs.step`) without a TypeChecker. Keyed by source-text name,
 * which the real `import { tacticsAudioRefs }` pattern preserves; the caller further
 * scopes these by game so same-named consts in two games never cross-resolve.
 */
function collectManifestConstMembers(
    sourceText: string,
    filePath: string,
): readonly (readonly [string, string])[] {
    const sourceFile = createSourceFile(
        filePath,
        sourceText,
        ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
    );
    const members: [string, string][] = [];

    visit(sourceFile);

    return members;

    function visit(node: Node): void {
        if (
            isVariableDeclaration(node) &&
            isIdentifier(node.name) &&
            node.initializer !== undefined
        ) {
            const objectLiteral = unwrapObjectLiteral(node.initializer);
            if (objectLiteral !== undefined) {
                collectConstMembers(node.name.text, objectLiteral);
            }
        }

        forEachChild(node, visit);
    }

    function collectConstMembers(constName: string, objectLiteral: ObjectLiteralExpression): void {
        for (const property of objectLiteral.properties) {
            if (!isPropertyAssignment(property)) {
                continue;
            }
            const memberName = propertyKeyText(property.name);
            if (memberName === undefined) {
                continue;
            }
            const value = readStringExpression(property.initializer);
            if (value !== undefined) {
                members.push([`${constName}.${memberName}`, value]);
            }
        }
    }
}

/**
 * AST-scans scene/screen source for on-demand asset load call sites — `useAsset(...)`,
 * `<assetReceiver>.load(...)`, `<assetReceiver>.get(...)` — and resolves the first
 * argument to a ref key. String literals and `buildAssetRef(g, p)` (tier A) and
 * manifest-const member accesses (tier B, via `manifestConstMembers`) become refs;
 * anything dynamic/computed (tier C) becomes an `unresolved` warning and never throws.
 * The `.load`/`.get` matchers are receiver-gated on `/asset/iu` to avoid firing on the
 * many unrelated `Map.get` / `loader.load` call sites in the scan scope.
 */
function collectOnDemandAssetLoadRefs(
    sourceText: string,
    filePath: string,
    workspaceRoot: string,
    manifestConstMembers: ReadonlyMap<string, string>,
): CollectedOnDemandLoads {
    const sourceFile = createSourceFile(
        filePath,
        sourceText,
        ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
    );
    const refs: AssetReference[] = [];
    const unresolved: UnresolvedOnDemandLoad[] = [];
    const malformed: MalformedAssetReference[] = [];
    const fileGameId = gameIdFromPath(workspaceRoot, filePath);

    visit(sourceFile);

    return { refs, unresolved, malformed };

    function visit(node: Node): void {
        if (isCallExpression(node)) {
            const callee = matchOnDemandLoadCallee(node);
            if (callee !== undefined) {
                collectLoadCall(node, callee);
            }
        }

        forEachChild(node, visit);
    }

    function collectLoadCall(call: CallExpression, callee: string): void {
        const firstArg = call.arguments[0];
        if (firstArg === undefined) {
            return;
        }

        const source: AssetReferenceSource = {
            kind: 'on-demand-load',
            filePath,
            location: `${callee} (${describeCallSite(sourceFile, call)})`,
        };

        // Tier A — string literal / buildAssetRef(g, p).
        const literal = readStringExpression(firstArg);
        if (literal !== undefined) {
            collectCandidate(literal, source, refs, malformed);
            return;
        }

        // Tier B — manifest-const member access (e.g. tacticsAudioRefs.step),
        // resolved only against the SAME game's manifest consts so an identically-named
        // const in another game's manifest cannot cross-resolve this load.
        const memberKey = readMemberAccessKey(firstArg);
        if (memberKey !== undefined && fileGameId !== undefined) {
            const resolved = manifestConstMembers.get(`${fileGameId} ${memberKey}`);
            if (resolved !== undefined) {
                collectCandidate(resolved, source, refs, malformed);
                return;
            }
        }

        // Tier C — dynamic / computed / unresolved. Warn, never crash.
        unresolved.push({
            callee,
            source,
            reason: 'on-demand load argument is not a statically resolvable AssetRef',
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

/**
 * Returns a display label for an on-demand load callee, or undefined when the call
 * is not one: `useAsset(...)` (exact identifier), or `<recv>.load(...)`/`<recv>.get(...)`
 * where the receiver name matches `/asset/iu`. The receiver gate is what keeps the very
 * generic `.load`/`.get` matchers from firing on unrelated Map/loader call sites; the
 * cost is a deliberate false-negative — a load through an aliased or destructured
 * receiver whose name lacks "asset" (e.g. `const { load } = useAssetManager()`) is not
 * scanned at all, rather than warned. Keep asset-manager receivers named accordingly.
 */
function matchOnDemandLoadCallee(call: CallExpression): string | undefined {
    const target = call.expression;
    if (isIdentifier(target)) {
        return target.text === 'useAsset' ? 'useAsset' : undefined;
    }
    if (isPropertyAccessExpression(target)) {
        const method = target.name.text;
        if ((method === 'load' || method === 'get') && isAssetManagerReceiver(target.expression)) {
            return `${receiverName(target.expression)}.${method}`;
        }
    }
    return undefined;
}

function isAssetManagerReceiver(receiver: Expression): boolean {
    if (isIdentifier(receiver)) {
        return /asset/iu.test(receiver.text);
    }
    if (isPropertyAccessExpression(receiver)) {
        return /asset/iu.test(receiver.name.text);
    }
    if (isCallExpression(receiver)) {
        // e.g. useAssetManager().load(ref)
        const callee = receiver.expression;
        if (isIdentifier(callee)) {
            return /asset/iu.test(callee.text);
        }
        if (isPropertyAccessExpression(callee)) {
            return /asset/iu.test(callee.name.text);
        }
    }
    return false;
}

function receiverName(receiver: Expression): string {
    if (isIdentifier(receiver)) {
        return receiver.text;
    }
    if (isPropertyAccessExpression(receiver)) {
        return receiver.name.text;
    }
    if (isCallExpression(receiver)) {
        const callee = receiver.expression;
        if (isIdentifier(callee)) {
            return `${callee.text}()`;
        }
        if (isPropertyAccessExpression(callee)) {
            return `${callee.name.text}()`;
        }
    }
    return 'assets';
}

/** Resolves a `<identifier>.<member>` access to the key `"identifier.member"` (tier-B lookup). */
function readMemberAccessKey(expression: Expression): string | undefined {
    if (isAsExpression(expression) || isSatisfiesExpression(expression)) {
        return readMemberAccessKey(expression.expression);
    }
    if (isPropertyAccessExpression(expression) && isIdentifier(expression.expression)) {
        return `${expression.expression.text}.${expression.name.text}`;
    }
    return undefined;
}

function describeCallSite(sourceFile: SourceFile, call: CallExpression): string {
    const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
    return `L${line + 1}`;
}

function propertyKeyText(name: PropertyName): string | undefined {
    if (isIdentifier(name) || isStringLiteral(name)) {
        return name.text;
    }
    return undefined;
}

/**
 * The `<gameId>` of a workspace `apps/<gameId>/...` path, or undefined for a non-app
 * path. Relativizes against `workspaceRoot` first so an ancestor directory that happens
 * to be named `apps` (e.g. a checkout under `/srv/apps/Chimera`) cannot be mistaken for
 * the workspace apps root — mirrors the renderer-public resolution above.
 */
function gameIdFromPath(workspaceRoot: string, filePath: string): string | undefined {
    const segments = relative(workspaceRoot, filePath).split(/[\\/]/u);
    if (segments[0] !== 'apps') {
        return undefined;
    }
    return segments[1];
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

async function findOnDemandLoadSourceFiles(workspaceRoot: string): Promise<readonly string[]> {
    const roots = [resolve(workspaceRoot, 'apps'), resolve(workspaceRoot, 'simulation', 'scene')];
    const files: string[] = [];

    for (const root of roots) {
        files.push(...(await collectFiles(root, isOnDemandLoadSourceFile)));
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

const buildOrDependencyDirectories = new Set(['node_modules', 'dist', '.next', 'out', 'build']);
const onDemandLoadDirectories = new Set(['scene', 'scenes', 'screen', 'screens']);

// Scope: scene + screen source only (Invariant #52's "on-demand inside the new scene"),
// excluding build output and dependencies so the generic `.get`/`.load` scan stays narrow.
function isOnDemandLoadSourceFile(filePath: string): boolean {
    if (!isSceneSourceFile(filePath)) {
        return false;
    }
    const segments = filePath.split(/[\\/]/u);
    if (segments.some((segment) => buildOrDependencyDirectories.has(segment))) {
        return false;
    }
    return segments.some((segment) => onDemandLoadDirectories.has(segment));
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

function compareUnresolvedOnDemandLoads(
    left: UnresolvedOnDemandLoad,
    right: UnresolvedOnDemandLoad,
): number {
    return compareStrings(
        `${left.source.filePath}\u0000${left.source.location}\u0000${left.callee}`,
        `${right.source.filePath}\u0000${right.source.location}\u0000${right.callee}`,
    );
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
