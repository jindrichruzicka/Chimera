/**
 * electron/dev-tools/eslint/rules/no-raw-r3f-canvas.test.ts
 *
 * Unit tests for the `chimera/no-raw-r3f-canvas` ESLint rule using
 * Vitest + ESLint RuleTester (typescript-eslint parser: the type-only import
 * forms the rule must PASS are TS syntax espree cannot parse).
 *
 * Architecture reference: §4.22 Camera System; Invariant #127
 */

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import rule from './no-raw-r3f-canvas.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        parserOptions: { ecmaFeatures: { jsx: true } },
        sourceType: 'module',
    },
});

ruleTester.run('chimera/no-raw-r3f-canvas', rule, {
    valid: [
        {
            // The legitimate in-Canvas imports that share the banned binding's
            // specifier — the whole reason the rule is name-based.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import { useFrame, useThree } from '@react-three/fiber';`,
        },
        {
            filename: 'apps/tactics/components/TacticsUnitPrimitive.tsx',
            code: `import type { ThreeEvent } from '@react-three/fiber';`,
        },
        {
            // A type cannot mount a canvas.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import type { Canvas } from '@react-three/fiber';`,
        },
        {
            // Inline type qualifier: still type-only for the Canvas binding.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { type Canvas, useFrame } from '@react-three/fiber';`,
        },
        {
            // A namespace import whose members never include Canvas passes —
            // this is the false positive that rules out core
            // no-restricted-imports.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nexport function useTick(cb) { fiber.useFrame(cb); }`,
        },
        {
            // Namespace JSX member other than Canvas.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nexport const S = () => <fiber.mesh />;`,
        },
        {
            // The engine root is the sanctioned canvas.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { GameCanvas } from '@chimera-engine/renderer/components/r3f';`,
        },
        {
            // Name-based means specifier-bound: Canvas from another package is
            // not r3f's root.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { Canvas } from 'some-charting-lib';`,
        },
        {
            // A game SURFACE — the shape the invalid cases use — at a bare
            // project root. No `apps/<name>/` segment, so the predicate does
            // not match and the rule is inert. This is the layout `preset.ts`
            // warns a standalone game about.
            filename: 'screens/GameScene.tsx',
            code: `import { Canvas } from '@react-three/fiber';\nexport const S = () => <Canvas />;`,
        },
        {
            // The predicate's SEGMENT anchor, on the shape that has a
            // real-world trigger: `webapps/` merely ENDS in `apps`, so
            // `apps/tactics/` sits inside it as a substring. Drop `(?:^|\/)`
            // and this fires. Checking the repo out under any directory whose
            // name ends in `apps` makes every engine renderer file read as a
            // game file the same way, with no code change at all.
            filename: '/repo/webapps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { Canvas } from '@react-three/fiber';\nexport const S = () => <Canvas />;`,
        },
        {
            // The predicate's TRAILING `\/`: `apps/<name>/` wants a directory
            // after the app name, so a file sitting DIRECTLY under `apps/` is
            // not inside a game app. Drop the trailing slash and `[^/]+`
            // swallows the filename, so this fires.
            //
            // Its sibling mutant `[^/]+` → `[^/]*` deliberately gets no case:
            // the two regexes differ only on an EMPTY app-name segment, and
            // `path.resolve('apps//screens/Foo.tsx')` collapses the doubled
            // slash, and a real lint run's filename goes through `path.resolve`.
            // A case for it would assert about an input no lint run produces.
            filename: 'apps/scratch.tsx',
            code: `import { Canvas } from '@react-three/fiber';\nexport const S = () => <Canvas />;`,
        },
        {
            // Outside a game app the rule is inert — renderer-internal code
            // and tests keep raw/fake Canvas (Invariant #127 scopes game
            // surfaces only).
            filename: 'renderer/components/r3f/GameCanvas.tsx',
            code: `import { Canvas } from '@react-three/fiber';`,
        },
        {
            filename: 'tools/some-tool.ts',
            code: `import { Canvas } from '@react-three/fiber';`,
        },
        {
            // The absolute-path form real lint runs hand the rule: still
            // outside a game app.
            filename: '/repo/renderer/components/r3f/GameCanvas.tsx',
            code: `import { Canvas } from '@react-three/fiber';`,
        },
        {
            // A non-fiber namespace with a Canvas member is not r3f's root —
            // the reach must be bound to a fiber namespace, not to any
            // namespace.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import * as charting from 'some-charting-lib';\nconst Root = charting.Canvas;\nexport { Root };`,
        },
        {
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import * as charting from 'some-charting-lib';\nexport const S = () => <charting.Canvas />;`,
        },
        {
            // Type-only re-exports cannot mount a canvas, in either position.
            filename: 'apps/tactics/screens/index.ts',
            code: `export type { Canvas } from '@react-three/fiber';`,
        },
        {
            filename: 'apps/tactics/screens/index.ts',
            code: `export { type Canvas } from '@react-three/fiber';`,
        },
        {
            filename: 'apps/tactics/screens/index.ts',
            code: `export type * from '@react-three/fiber';`,
        },
        {
            // Destructuring anything else off the namespace stays legal.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst { useFrame } = fiber;\nexport { useFrame };`,
        },
    ],
    invalid: [
        {
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { Canvas } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // Aliasing does not launder the binding.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { Canvas as Root } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // Mixed import: exactly one error, on the Canvas specifier.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import { useFrame, Canvas } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // The scaffolded standalone layout is the same apps/<kebab> shape.
            filename: 'apps/my-game/shell/MyGameHud.tsx',
            code: `import { Canvas } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // Namespace member access in expression position.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst Root = fiber.Canvas;\nexport { Root };`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            // Computed member access with a literal name.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst Root = fiber['Canvas'];\nexport { Root };`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            // JSX namespace member: one report per element, not one per tag.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nexport const S = () => <fiber.Canvas><fiber.mesh /></fiber.Canvas>;`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            // Re-exporting hands the binding to every importer.
            filename: 'apps/tactics/screens/index.ts',
            code: `export { Canvas } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            filename: 'apps/tactics/screens/index.ts',
            code: `export { Canvas as Root } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // export * re-exports Canvas along with everything else.
            filename: 'apps/tactics/screens/index.ts',
            code: `export * from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // The absolute-path form real lint runs hand the rule.
            filename: '/repo/apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { Canvas } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // The Windows filename shape — the third axis. `normalizePath` is
            // the whole reason a `/`-separated regex reads a backslash path as
            // segments; drop that call and the rule goes silently inert for
            // every Windows developer.
            filename: 'C:\\repo\\apps\\tactics\\screens\\TacticsDemoBoard.tsx',
            code: `import { Canvas } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // String-named import and re-export are the same binding.
            filename: 'apps/tactics/screens/TacticsDemoBoard.tsx',
            code: `import { 'Canvas' as C } from '@react-three/fiber';\nexport { C };`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            filename: 'apps/tactics/screens/index.ts',
            code: `export { 'Canvas' as Root } from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasImport' }],
        },
        {
            // A reach textually above the import is valid ESM (import
            // bindings are hoisted) and must still be caught.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `export const Root = fiber.Canvas;\nimport * as fiber from '@react-three/fiber';`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            // The static namespace destructure.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst { Canvas } = fiber;\nexport { Canvas };`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst { Canvas: Root } = fiber;\nexport { Root };`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            // String and computed-literal destructure keys are the same reach.
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst { 'Canvas': Root } = fiber;\nexport { Root };`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
        {
            filename: 'apps/tactics/components/TacticsScene.tsx',
            code: `import * as fiber from '@react-three/fiber';\nconst { ['Canvas']: Root } = fiber;\nexport { Root };`,
            errors: [{ messageId: 'rawCanvasMember' }],
        },
    ],
});
