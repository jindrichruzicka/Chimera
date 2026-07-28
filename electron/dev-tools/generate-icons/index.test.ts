import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
    ScriptKind,
    ScriptTarget,
    createSourceFile,
    forEachChild,
    isCallExpression,
    isExportDeclaration,
    isExternalModuleReference,
    isIdentifier,
    isImportDeclaration,
    isImportEqualsDeclaration,
    isNamedExports,
    isNamedImports,
    isStringLiteral,
} from 'typescript';
import type {
    ExportDeclaration,
    Expression,
    ImportDeclaration,
    Node,
    SourceFile,
} from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    DEFAULT_ICON_BASENAME,
    MISSING_CODECS_MESSAGE,
    PNG_SIZES,
    generateIcons,
    loadIconCodecs,
} from './index.js';

/**
 * electron/dev-tools/generate-icons/index.test.ts
 *
 * The icon generator derives the platform set (`.icns`/`.ico` + loose PNGs) from a
 * single square master logo PNG. These tests drive a synthetic in-memory master (no
 * repo asset) into a temp dir so they stay fast and deterministic, and assert the
 * contract the generator's two consumers depend on — the dev-runtime window icon and
 * the packaging set: the canonical filenames exist, each loose PNG decodes to its
 * exact square size, and the container files carry valid `.icns`/`.ico` magic headers.
 */
describe('generateIcons', () => {
    let outDir: string;
    let sourcePng: string;

    beforeEach(async () => {
        outDir = await mkdtemp(path.join(tmpdir(), 'chimera-icons-out-'));
        const srcDir = await mkdtemp(path.join(tmpdir(), 'chimera-icons-src-'));
        sourcePng = path.join(srcDir, 'master.png');
        // A transparent square master, large enough that every target size is a downscale.
        await sharp({
            create: {
                width: 1024,
                height: 1024,
                channels: 4,
                background: { r: 255, g: 80, b: 0, alpha: 1 },
            },
        })
            .png()
            .toFile(sourcePng);
    });

    afterEach(async () => {
        await rm(outDir, { recursive: true, force: true });
        await rm(path.dirname(sourcePng), { recursive: true, force: true });
    });

    it('writes a loose PNG at every declared size, each decoding to its exact square dimensions', async () => {
        await generateIcons({ sourcePng, outDir });

        for (const size of PNG_SIZES) {
            const file = path.join(outDir, `${DEFAULT_ICON_BASENAME}-${size}.png`);
            const meta = await sharp(file).metadata();
            expect(meta.format).toBe('png');
            expect(meta.width).toBe(size);
            expect(meta.height).toBe(size);
        }
    });

    it('writes the dev-runtime default `chimera.png` at 512×512, the stable size-less filename', async () => {
        await generateIcons({ sourcePng, outDir });

        const meta = await sharp(path.join(outDir, `${DEFAULT_ICON_BASENAME}.png`)).metadata();
        expect(meta.format).toBe('png');
        expect(meta.width).toBe(512);
        expect(meta.height).toBe(512);
    });

    it('writes a macOS `.icns` carrying the `icns` magic header', async () => {
        await generateIcons({ sourcePng, outDir });

        const icns = await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.icns`));
        expect(icns.byteLength).toBeGreaterThan(0);
        expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
    });

    it('writes a Windows `.ico` with a valid ICONDIR header (reserved=0, type=1)', async () => {
        await generateIcons({ sourcePng, outDir });

        const ico = await readFile(path.join(outDir, `${DEFAULT_ICON_BASENAME}.ico`));
        expect(ico.byteLength).toBeGreaterThan(0);
        expect(ico.readUInt16LE(0)).toBe(0); // reserved
        expect(ico.readUInt16LE(2)).toBe(1); // image type: 1 = icon (.ico)
    });

    it('returns every written filename, sorted', async () => {
        const result = await generateIcons({ sourcePng, outDir });

        const expected = [
            `${DEFAULT_ICON_BASENAME}.icns`,
            `${DEFAULT_ICON_BASENAME}.ico`,
            `${DEFAULT_ICON_BASENAME}.png`,
            ...PNG_SIZES.map((size) => `${DEFAULT_ICON_BASENAME}-${size}.png`),
        ].sort();
        // Compared as returned, not re-sorted: `expected` is already in sorted
        // order, so this is the only assertion that can observe the documented
        // ordering. Sorting the actual first would green over its removal —
        // files are pushed in generation order, which is not sorted order.
        expect(result.written).toEqual(expected);

        // Every reported file must actually exist on disk.
        for (const name of result.written) {
            const info = await stat(path.join(outDir, name));
            expect(info.isFile()).toBe(true);
        }
    });

    it('reports the actionable codec error rather than failing somewhere downstream', async () => {
        // Injected rather than observed: the monorepo always has both codecs
        // installed, so the uninstalled case is unreachable from a test that
        // cannot uninstall a native binary.
        await expect(
            generateIcons({
                sourcePng,
                outDir,
                importer: () => Promise.reject(missingModule('sharp')),
            }),
        ).rejects.toThrow(MISSING_CODECS_MESSAGE);
    });

    it('creates no output directory when the codecs are absent', async () => {
        // Only a directory that does not already exist can show the ordering:
        // `outDir` is created by the fixture, so a nested path is what makes it
        // observable.
        const nested = path.join(outDir, 'nested', 'icons');

        await expect(
            generateIcons({
                sourcePng,
                outDir: nested,
                importer: () => Promise.reject(missingModule('sharp')),
            }),
        ).rejects.toThrow(MISSING_CODECS_MESSAGE);

        await expect(stat(nested)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('creates no output directory when the master cannot be read', async () => {
        // The OTHER way this run ends early, and the one a user hits far more
        // often than an absent codec — a typo in `--source`. Asserted separately
        // because it is a different statement's ordering: the codec case only
        // constrains the load, this one constrains the master read.
        const nested = path.join(outDir, 'nested', 'icons');

        await expect(
            generateIcons({ sourcePng: path.join(outDir, 'no-such-master.png'), outDir: nested }),
        ).rejects.toMatchObject({ code: 'ENOENT' });

        await expect(stat(nested)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

/** Restates the production set — see `MODULE_NOT_FOUND_CODES` in `index.ts`. */
const MODULE_NOT_FOUND_CODES = ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'] as const;

/** What node throws for an unresolvable bare specifier. */
function missingModule(
    specifier: string,
    code: string = MODULE_NOT_FOUND_CODES[0],
): Error & { code: string } {
    return Object.assign(new Error(`Cannot find package '${specifier}'`), { code });
}

/**
 * Covers the on-demand codec load: that it stays on demand, that both interop
 * shapes resolve, and that every way it can fail says which codec and what to
 * do. The rationale for loading on demand at all lives on `loadIconCodecs`.
 */
describe('loadIconCodecs', () => {
    /** A resolved sharp: CJS `module.exports = fn`, so ESM sees it as `default`. */
    const sharpModule = { default: () => undefined };
    /** A resolved png2icons: the `__esModule` named-export namespace. */
    const png2iconsModule = {
        __esModule: true,
        createICNS: () => null,
        createICO: () => null,
        BICUBIC2: 3,
    };

    function importerFor(modules: Readonly<Record<string, unknown>>) {
        return (specifier: string): Promise<unknown> => {
            const resolved = modules[specifier];
            return resolved === undefined
                ? Promise.reject(missingModule(specifier))
                : Promise.resolve(resolved);
        };
    }

    it('names both codecs and the one-time install command', () => {
        // Asserted on the constant itself, not on a thrown message: the text IS
        // the deliverable — it is what a game author sees, and the only thing
        // standing between them and a bare ERR_MODULE_NOT_FOUND.
        expect(MISSING_CODECS_MESSAGE).toContain('sharp');
        expect(MISSING_CODECS_MESSAGE).toContain('png2icons');
        expect(MISSING_CODECS_MESSAGE).toContain('pnpm add -D sharp png2icons');
    });

    it.each(MODULE_NOT_FOUND_CODES)(
        'rejects with the actionable message on %s, keeping the cause',
        async (code) => {
            // Parametrised over both codes because recognising only one sends the
            // other down the "could not be loaded" branch, which says nothing
            // about installing the thing that is missing. The cause is asserted
            // because it is all that survives the translation into the install
            // message.
            const importer = (specifier: string): Promise<unknown> =>
                specifier === 'sharp'
                    ? Promise.reject(missingModule(specifier, code))
                    : Promise.resolve(png2iconsModule);

            await expect(loadIconCodecs(importer)).rejects.toThrow(MISSING_CODECS_MESSAGE);
            await expect(loadIconCodecs(importer)).rejects.toMatchObject({ cause: { code } });
        },
    );

    it('rejects with the actionable message when png2icons is missing', async () => {
        // Asserted separately from the sharp case: a loader that awaited only
        // the first import would pass the test above and still fail opaquely
        // here, which is the asymmetry a single combined case cannot see.
        await expect(loadIconCodecs(importerFor({ sharp: sharpModule }))).rejects.toThrow(
            MISSING_CODECS_MESSAGE,
        );
    });

    it('does NOT advise installing a codec whose import failed for another reason', async () => {
        // sharp ships prebuilt native bindings, and a platform or Node-ABI
        // mismatch fails the import of a package that is present — with no
        // `code`, since sharp's loader composes its own message. "Install it as a
        // devDependency" is a road with nothing at the end of it for that reader,
        // so the two cases must not share a message.
        const nativeFailure = new Error(
            'Could not load the sharp module using the darwin-arm64 runtime',
        );
        const rejects = loadIconCodecs((specifier) =>
            specifier === 'sharp'
                ? Promise.reject(nativeFailure)
                : Promise.resolve(png2iconsModule),
        );

        await expect(rejects).rejects.toThrow(/'sharp' could not be loaded/u);
        await expect(rejects).rejects.not.toThrow(/pnpm add -D/u);
        await expect(rejects).rejects.toMatchObject({ cause: nativeFailure });
    });

    it('claims nothing about the install when the rejection carries no code', async () => {
        // Reachable through the public `importer`, and through any loader that
        // reports absence codelessly. Whatever happened, the headline must not
        // assert a filesystem fact it did not check — `cause` carries the truth.
        const codeless = new Error('something failed, and said nothing about what');
        const rejects = loadIconCodecs(() => Promise.reject(codeless));

        await expect(rejects).rejects.toThrow(/'sharp' could not be loaded/u);
        await expect(rejects).rejects.not.toThrow(/installed/u);
        await expect(rejects).rejects.toMatchObject({ cause: codeless });
    });

    it('survives a rejection that is not an Error at all', async () => {
        // The `code` read has to be nullish-safe against a non-object too: a
        // custom `importer` is public API, and `('str').code` on an unguarded
        // read is the same class of opaque TypeError the unwrappers were
        // hardened against.
        // @chimera-review: rejecting with a non-Error IS the case under test.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        const rejects = loadIconCodecs(() => Promise.reject('not even an Error'));

        await expect(rejects).rejects.toThrow(/'sharp' could not be loaded/u);
        await expect(rejects).rejects.toMatchObject({ cause: 'not even an Error' });
    });

    it('unwraps sharp from the CJS default slot, and png2icons from its namespace', async () => {
        const codecs = await loadIconCodecs(
            importerFor({ sharp: sharpModule, png2icons: png2iconsModule }),
        );
        expect(codecs.sharp).toBe(sharpModule.default);
        expect(codecs.png2icons.createICNS).toBe(png2iconsModule.createICNS);
    });

    it('accepts sharp delivered as the bare function, without a default slot', async () => {
        // tsx's CJS transform hands back `module.exports` itself rather than an
        // interop namespace, so the same source must survive both shapes.
        const bareSharp = () => undefined;
        const codecs = await loadIconCodecs(
            importerFor({ sharp: bareSharp, png2icons: png2iconsModule }),
        );
        expect(codecs.sharp).toBe(bareSharp);
    });

    it('accepts png2icons delivered under a default slot', async () => {
        const codecs = await loadIconCodecs(
            importerFor({ sharp: sharpModule, png2icons: { default: png2iconsModule } }),
        );
        expect(codecs.png2icons.createICNS).toBe(png2iconsModule.createICNS);
    });

    it('names the offending codec when one resolves to something it cannot drive', async () => {
        // Naming it is the whole reason the check exists — a shared message
        // would make the two codecs, and the missing-install case, all
        // indistinguishable to a reader and to this assertion.
        await expect(
            loadIconCodecs(
                importerFor({ sharp: { default: 'not a function' }, png2icons: png2iconsModule }),
            ),
        ).rejects.toThrow(/'sharp' resolved but is not callable/u);

        await expect(
            loadIconCodecs(importerFor({ sharp: sharpModule, png2icons: { __esModule: true } })),
        ).rejects.toThrow(/'png2icons' resolved but does not provide/u);
    });

    it('rejects a png2icons missing ANY member the generate path calls', async () => {
        // Each fixture is a codec a one-member check would accept.
        const partial = { createICNS: () => null, BICUBIC2: 3 };
        await expect(
            loadIconCodecs(importerFor({ sharp: sharpModule, png2icons: partial })),
        ).rejects.toThrow(/'png2icons' resolved but does not provide/u);

        const noConstant = { createICNS: () => null, createICO: () => null };
        await expect(
            loadIconCodecs(importerFor({ sharp: sharpModule, png2icons: noConstant })),
        ).rejects.toThrow(/'png2icons' resolved but does not provide/u);

        // Truthy but not callable: distinguishes a `typeof === 'function'` check
        // from a bare truthiness check, which the fixtures above cannot.
        const notCallable = { createICNS: 3, createICO: 3, BICUBIC2: 3 };
        await expect(
            loadIconCodecs(importerFor({ sharp: sharpModule, png2icons: notCallable })),
        ).rejects.toThrow(/'png2icons' resolved but does not provide/u);

        // Present but the wrong TYPE, which only a `typeof === 'number'` check
        // catches — a namespace whose `BICUBIC2` is a string is not the one this
        // module was written against.
        const stringConstant = {
            createICNS: () => null,
            createICO: () => null,
            BICUBIC2: 'BICUBIC2',
        };
        await expect(
            loadIconCodecs(importerFor({ sharp: sharpModule, png2icons: stringConstant })),
        ).rejects.toThrow(/'png2icons' resolved but does not provide/u);
    });

    it('reports rather than throws a TypeError when a codec resolves to nothing', async () => {
        // `importer` is public, so a loader handing back null reaches the
        // unwrappers. Reading `.default` off it unguarded yields "cannot read
        // properties of null" — the opaque failure this whole path exists to
        // prevent, produced by the code meant to prevent it.
        for (const empty of [null, undefined]) {
            await expect(loadIconCodecs(() => Promise.resolve(empty))).rejects.toThrow(
                /'sharp' resolved but is not callable/u,
            );
        }
    });

    it('names sharp first when BOTH codecs are unusable', () => {
        // Pins the load ORDER, which is otherwise invisible: every other case
        // breaks exactly one codec, so swapping the two statements passes them
        // all while changing which failure a user is told about.
        return expect(
            loadIconCodecs(importerFor({ sharp: 'not a function', png2icons: 'not a codec' })),
        ).rejects.toThrow(/'sharp'/u);
    });

    it('resolves the real codecs through a real dynamic import', async () => {
        // The fakes above pin the unwrap logic; only this pins that the unwrap
        // matches what the REAL packages actually deliver under this loader.
        const codecs = await loadIconCodecs();
        expect(typeof codecs.sharp).toBe('function');
        expect(typeof codecs.png2icons.createICNS).toBe('function');
        expect(typeof codecs.png2icons.createICO).toBe('function');
        expect(typeof codecs.png2icons.BICUBIC2).toBe('number');
    });

    it('is the only route to the codecs — neither is loaded eagerly', async () => {
        // A property of the module GRAPH, which no value a test can read
        // exposes: with a codec statically imported every assertion above still
        // passes, in a checkout that has it installed.
        const source = await readFile(
            fileURLToPath(new URL('./index.ts', import.meta.url)),
            'utf8',
        );
        const eager = eagerLoadsOf(source);

        // Positive first, and against the REAL file: `createSourceFile` recovers
        // from a syntax error by dropping statements, so an empty result is
        // indistinguishable from a clean one — the two negatives below would
        // both pass over a source that was never parsed at all.
        expect(eager).toContain('node:fs/promises');

        expect(eager).not.toContain('sharp');
        expect(eager).not.toContain('png2icons');
    });

    it('detects every eager-load form, and no deferred or erased one', () => {
        // The negative control the scan above cannot carry itself: a typo inside
        // `eagerLoadsOf` would make it return nothing and green the guard over a
        // module that DOES load a codec. Same shape as the
        // `verify:publish --self-test` gate — the check proves it bites on the
        // same run it is trusted on.
        for (const hazard of [
            "import 'sharp';", // bare side-effect — throws at load, binds nothing
            "import sharp from 'sharp';",
            "import * as sharp from 'sharp';",
            "import { cache } from 'sharp';",
            "import sharp, { type Sharp } from 'sharp';", // default binding survives
            "export { cache } from 'sharp';",
            "export * from 'sharp';",
            // Not import syntax at all, and every bit as eager. `require` is not
            // defined in an ES module, but `createRequire` is the documented way
            // back into CJS and runs at module top just the same.
            "const sharp = require('sharp');",
            "const sharp = createRequire(import.meta.url)('sharp');",
            "import sharp = require('sharp');",
        ]) {
            expect(eagerLoadsOf(hazard), hazard).toContain('sharp');
        }

        // Erased or deferred: none of these puts the codec in the module graph.
        for (const safe of [
            "import type Sharp from 'sharp';",
            "import type * as Sharp from 'sharp';",
            "export type { Sharp } from 'sharp';",
            // Inline-type — fully erased, and the form `eslint --fix` writes under
            // this repo's `fixStyle: 'inline-type-imports'`. Flagging it would red
            // on erased code and invite the next reader to weaken the guard.
            "import { type Sharp } from 'sharp';",
            "import { type Sharp, type Metadata } from 'sharp';",
            "export { type Sharp } from 'sharp';",
            "const s = await import('sharp');",
            'const s = await import(specifier);',
        ]) {
            expect(eagerLoadsOf(safe), safe).not.toContain('sharp');
        }
    });

    it('documents where the require-shaped heuristic misses, and where it over-reaches', () => {
        // Recorded as tests, not as a comment, so the boundary is inherited
        // rather than rediscovered — and so it reds the day someone closes one
        // of these, rather than silently over-covering. All three DO load the
        // codec; none is matched, because matching is on the callee's text.
        for (const escapes of [
            "const req = createRequire(import.meta.url);\nconst s = req('sharp');",
            "const s = module.require('sharp');",
            "const s = globalThis.require('sharp');",
        ]) {
            expect(eagerLoadsOf(escapes), escapes).not.toContain('sharp');
        }

        // And where it over-reaches: a deferred require is reported as though it
        // were eager. Harmless here — this module has no business reaching CJS
        // at any time — but it is a false positive, not a detection.
        for (const deferred of [
            "function load() { return require('sharp'); }",
            "async function load() { return createRequire(import.meta.url)('sharp'); }",
        ]) {
            expect(eagerLoadsOf(deferred), deferred).toContain('sharp');
        }
    });
});

/**
 * The packages `source` pulls in outside a dynamic `import()`. Two checks, of
 * deliberately different strength — see each below. Both parse rather than
 * pattern-match, because a guard written around import SYNTAX has to enumerate
 * binding forms and the one it forgets is the one that ships.
 */
function eagerLoadsOf(source: string): readonly string[] {
    const parsed = createSourceFile('probe.ts', source, ScriptTarget.ESNext, true, ScriptKind.TS);
    return [...declaredImportsOf(parsed), ...requireShapedCallsIn(parsed)];
}

/**
 * Every package `source` imports through a DECLARATION — exact, not heuristic.
 * Import and export declarations may only appear at a module's top level, so
 * every one of these loads before the module finishes loading.
 *
 * What is absent is absent by construction: type-only imports in either
 * spelling are erased before they reach a module graph, and dynamic `import()`
 * is not a declaration at all — it is the mechanism under test.
 */
function declaredImportsOf(parsed: SourceFile): readonly string[] {
    return parsed.statements.flatMap((statement) => {
        if (isImportDeclaration(statement)) {
            return isErasedImport(statement) ? [] : specifierTextOf(statement.moduleSpecifier);
        }
        if (isExportDeclaration(statement)) {
            return isErasedExport(statement) ? [] : specifierTextOf(statement.moduleSpecifier);
        }
        if (isImportEqualsDeclaration(statement)) {
            const reference = statement.moduleReference;
            return isExternalModuleReference(reference)
                ? specifierTextOf(reference.expression)
                : [];
        }
        return [];
    });
}

/**
 * Every package named by a `require`-SHAPED call, anywhere in the file. A
 * deliberately conservative name-based heuristic, and NOT a proof in either
 * direction:
 *
 *   - it over-reports — a `require` inside a function body is deferred, not
 *     eager, and is still listed. That is the trade this module can afford:
 *     nothing here has any business reaching CJS at all, so the false positive
 *     is a conversation rather than a defect;
 *   - it under-reports — matching is on the callee's TEXT, so
 *     `const req = createRequire(url); req('sharp')`, `module.require('sharp')`
 *     and `globalThis.require('sharp')` all escape. The control test lists
 *     these as known non-coverage rather than leaving the next reader to
 *     rediscover them.
 *
 * The load-bearing guarantee is `declaredImportsOf`; this is a second net under
 * it, not a substitute.
 */
function requireShapedCallsIn(parsed: SourceFile): readonly string[] {
    const required: string[] = [];
    const visit = (node: Node): void => {
        if (isCallExpression(node) && isRequireLike(node.expression)) {
            required.push(...specifierTextOf(node.arguments[0]));
        }
        forEachChild(node, visit);
    };
    forEachChild(parsed, visit);
    return required;
}

/**
 * Whether an import declaration is erased entirely. True for the `import type`
 * prefix, and equally for `import { type A, type B }` — which is what
 * `eslint --fix` writes under this repo's `fixStyle: 'inline-type-imports'`. A
 * default or namespace binding alongside them survives, so only a named clause
 * whose every element is type-only counts.
 */
function isErasedImport(node: ImportDeclaration): boolean {
    const clause = node.importClause;
    if (clause === undefined) return false; // `import 'sharp';` — binds nothing, loads it
    if (clause.isTypeOnly) return true;
    if (clause.name !== undefined) return false;
    const bindings = clause.namedBindings;
    return (
        bindings !== undefined &&
        isNamedImports(bindings) &&
        bindings.elements.every((element) => element.isTypeOnly)
    );
}

/** The `export { … } from` mirror of `isErasedImport`. */
function isErasedExport(node: ExportDeclaration): boolean {
    if (node.isTypeOnly) return true;
    const clause = node.exportClause;
    return (
        clause !== undefined &&
        isNamedExports(clause) &&
        clause.elements.every((element) => element.isTypeOnly)
    );
}

/** `require(…)` itself, or the `createRequire(…)(…)` route back into CJS. */
function isRequireLike(expression: Expression): boolean {
    if (isIdentifier(expression)) return expression.text === 'require';
    return (
        isCallExpression(expression) &&
        isIdentifier(expression.expression) &&
        expression.expression.text === 'createRequire'
    );
}

/** The literal text of a module specifier; a computed one names no package. */
function specifierTextOf(specifier: Expression | undefined): readonly string[] {
    return specifier !== undefined && isStringLiteral(specifier) ? [specifier.text] : [];
}
