import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { ActionPipeline } from '@chimera-engine/simulation/engine/ActionPipeline.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import {
    gamePhase,
    playerId,
    type BaseGameSnapshot,
    type PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import {
    registerDefaultScenes,
    SceneManager,
    SceneRegistry,
    sceneId,
} from '@chimera-engine/simulation/scene/index.js';
import { tacticsAssetManifest, tacticsAudioRefs, tacticsModelRefs } from '../asset-manifest.js';
import { registerTacticsScenes, TACTICS_ASSET_DEMO_SCENE_ID } from './scenes.js';

const HOST: PlayerId = playerId('host');

function makeSnapshot(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 7,
        players: { [HOST]: { id: HOST } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        hostPlayerId: HOST,
        timers: {},
        gameResult: null,
        sceneId: sceneId('engine:game'),
        sceneTransition: null,
        ...overrides,
    };
}

/** The registry the host builds: engine defaults plus the tactics scenes. */
function makePipeline(): ActionPipeline<BaseGameSnapshot> {
    const sceneRegistry = new SceneRegistry<BaseGameSnapshot>();
    registerDefaultScenes(sceneRegistry);
    registerTacticsScenes(sceneRegistry);
    const actionRegistry = new ActionRegistry<BaseGameSnapshot>();
    registerEngineActions(actionRegistry);
    new SceneManager(sceneRegistry).registerActions(actionRegistry);
    return new ActionPipeline(actionRegistry);
}

function action(type: string, snapshot: BaseGameSnapshot, payload: Record<string, unknown>) {
    return { type, playerId: HOST, tick: snapshot.tick, payload };
}

function demoDescriptor() {
    const registry = new SceneRegistry<BaseGameSnapshot>();
    registerTacticsScenes(registry);
    return registry.resolve(TACTICS_ASSET_DEMO_SCENE_ID);
}

const SCENES_SOURCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'scenes.ts');

/**
 * The element kinds `validate-assets` collects — its own predicate is
 * `isStringLiteral(element) || isNoSubstitutionTemplateLiteral(element)`.
 *
 * Both are listed even though the descriptor uses only the first, so this set
 * is the gate's rule rather than a description of today's file: a backtick-
 * quoted ref is readable by the gate and must not red here.
 */
const GATE_READABLE_KINDS: ReadonlySet<string> = new Set([
    'StringLiteral',
    'NoSubstitutionTemplateLiteral',
]);

/**
 * The syntax kind of each element of every `requiredAssets:` array in `source`,
 * flattened.
 *
 * The runtime value of that array says nothing about whether the gate can read
 * it: a member expression and a string literal produce the identical ref, and
 * only one of them is visible to a static scan. So this walks the syntax —
 * unwrapping `as` / `satisfies` around the ARRAY, as the gate does — and hands
 * back the kinds rather than judging them, leaving {@link GATE_READABLE_KINDS}
 * to say which ones `validate-assets` accepts.
 */
function requiredAssetsElementKinds(source: string): readonly string[] {
    const parsed = ts.createSourceFile('scenes.ts', source, ts.ScriptTarget.ESNext, true);
    const kinds: string[] = [];

    const unwrap = (expression: ts.Expression): ts.Expression =>
        ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)
            ? unwrap(expression.expression)
            : expression;

    // Named through the gate's OWN two predicates, not through
    // `ts.SyntaxKind[kind]` — that reverse map does not answer
    // `NoSubstitutionTemplateLiteral` for one, which the backtick case below
    // pins. Anything else falls through to the reverse map, where the name is
    // only diagnostic.
    const elementKind = (element: ts.Expression): string => {
        if (ts.isStringLiteral(element)) {
            return 'StringLiteral';
        }
        if (ts.isNoSubstitutionTemplateLiteral(element)) {
            return 'NoSubstitutionTemplateLiteral';
        }
        return ts.SyntaxKind[element.kind];
    };

    const visit = (node: ts.Node): void => {
        if (
            ts.isPropertyAssignment(node) &&
            (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
            node.name.text === 'requiredAssets'
        ) {
            const initializer = unwrap(node.initializer);
            if (ts.isArrayLiteralExpression(initializer)) {
                for (const element of initializer.elements) {
                    kinds.push(elementKind(element));
                }
            } else {
                // Not an array literal at all — the gate reads NOTHING here.
                kinds.push(`non-array:${ts.SyntaxKind[initializer.kind]}`);
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(parsed);
    return kinds;
}

describe('registerTacticsScenes', () => {
    it('registers the asset-demo scene under the tactics namespace', () => {
        const registry = new SceneRegistry<BaseGameSnapshot>();

        registerTacticsScenes(registry);

        expect(registry.registeredSceneIds()).toEqual([TACTICS_ASSET_DEMO_SCENE_ID]);
        expect(String(TACTICS_ASSET_DEMO_SCENE_ID)).toBe('tactics:asset-demo');
    });

    it('points the scene at its own screen key, not the playfield', () => {
        // Its own key, so what the screen registry declares against
        // `asset-demo` reaches this scene and no other.
        expect(demoDescriptor().defaultScreen).toBe('asset-demo');
    });

    it('declares a non-empty requiredAssets list', () => {
        // The point of the scene: a descriptor declaring `[]` gives the preload
        // arm nothing to wait for, which is what the engine's own scenes do.
        expect(demoDescriptor().requiredAssets.length).toBeGreaterThan(0);
    });

    it('mirrors the manifest consts exactly, in order', () => {
        // This is what makes the hand-written string literals in the descriptor
        // safe. They cannot be written as `tacticsModelRefs.showcaseRig`:
        // `validate-assets` walks only string-literal elements of the inline
        // array, so a member expression would be read as an empty list and
        // Invariant #52 would check nothing. The mirror is checked HERE
        // instead, so a ref renamed in `asset-manifest.ts` reds rather than
        // pointing the scene at a file that is no longer shipped.
        expect(demoDescriptor().requiredAssets).toEqual([
            tacticsModelRefs.showcaseRig,
            tacticsAudioRefs.step,
            tacticsAudioRefs.swordHit,
            tacticsAudioRefs.reveal,
        ]);
    });

    it('declares only refs the tactics asset manifest carries', () => {
        // Membership, on top of the identity check above: the mirror could hold
        // while a ref was dropped from the manifest entirely, which is the
        // other half of what Invariant #52 asks of a declared ref.
        // Keyed by the raw string: a manifest entry is typed against its own
        // asset kind, while a descriptor's list is the kind-agnostic
        // `AssetRef`, and the two do not compare as the same type.
        const manifestRefs = new Set(
            tacticsAssetManifest.entries.map((entry) => String(entry.ref)),
        );

        for (const ref of demoDescriptor().requiredAssets) {
            expect(manifestRefs.has(String(ref))).toBe(true);
        }
    });

    it('declares only refs the manifest marks deferred', () => {
        // A `critical` ref is already warmed before the match starts, so a
        // scene gating on one would wait for a load that had already happened
        // and the demo would prove nothing.
        const priorityByRef = new Map(
            tacticsAssetManifest.entries.map((entry) => [String(entry.ref), entry.priority]),
        );

        for (const ref of demoDescriptor().requiredAssets) {
            expect(priorityByRef.get(String(ref))).toBe('deferred');
        }
    });

    it('leaves the snapshot untouched when the scene initializes', () => {
        // The demo scene is a preload vehicle, not a gameplay scene: it seeds
        // nothing, so entering it cannot perturb a running match.
        const state = makeSnapshot();

        const initialized = demoDescriptor().initialize(state, {}, {
            dispatchDepth: 0,
        } as never);

        expect(initialized).toBe(state);
    });
});

describe('requiredAssetsElementKinds', () => {
    // Synthetic controls for the predicate itself: the tree's own contents are
    // not the pin, and a predicate that answered the same thing for every shape
    // would make the case below vacuous.

    it('reads a bare inline array', () => {
        expect(requiredAssetsElementKinds(`const s = { requiredAssets: ['a/b.glb'] };`)).toEqual([
            'StringLiteral',
        ]);
    });

    it('reads a backtick-quoted element, which the gate also accepts', () => {
        expect(requiredAssetsElementKinds('const s = { requiredAssets: [`a/b.glb`] };')).toEqual([
            'NoSubstitutionTemplateLiteral',
        ]);
        expect(GATE_READABLE_KINDS.has('NoSubstitutionTemplateLiteral')).toBe(true);
    });

    it('unwraps a cast around the whole array, however many layers', () => {
        expect(
            requiredAssetsElementKinds(
                `const s = { requiredAssets: ['a/b.glb'] as unknown as readonly AssetRef[] };`,
            ),
        ).toEqual(['StringLiteral']);
        expect(
            requiredAssetsElementKinds(
                `const s = { requiredAssets: ['a/b.glb'] satisfies readonly string[] };`,
            ),
        ).toEqual(['StringLiteral']);
    });

    it('reports a per-element cast as the non-literal it is', () => {
        // The scanner unwraps the ARRAY only, so `'x' as AssetRef` is skipped —
        // which is why the descriptor's elements must stay unadorned.
        expect(
            requiredAssetsElementKinds(`const s = { requiredAssets: ['a/b.glb' as AssetRef] };`),
        ).toEqual(['AsExpression']);
    });

    it('reports a member expression as the non-literal it is', () => {
        expect(
            requiredAssetsElementKinds(`const s = { requiredAssets: [refs.showcaseRig] };`),
        ).toEqual(['PropertyAccessExpression']);
    });

    it('reports a const-referenced list as not an array at all', () => {
        expect(requiredAssetsElementKinds(`const s = { requiredAssets: REFS };`)).toEqual([
            'non-array:Identifier',
        ]);
    });

    it('reports nothing for a differently named property', () => {
        expect(requiredAssetsElementKinds(`const s = { assets: ['a/b.glb'] };`)).toEqual([]);
    });
});

describe('the asset-demo scene as validate-assets reads it', () => {
    it('writes every declared ref in a form the gate can read', () => {
        // The killer for the rewrite that keeps every other test in this file
        // green: swapping the literals for `tacticsModelRefs.showcaseRig` &c.
        // produces identical runtime values, so the mirror case above still
        // passes — while `validate-assets` silently reads an EMPTY list and
        // Invariant #52's disk-existence and manifest-membership checks stop
        // covering this scene. Measured at the tree: with the member-expression
        // form, `pnpm validate:assets` reports four fewer refs and still
        // exits 0 with a deliberately nonexistent ref in the list.
        const kinds = requiredAssetsElementKinds(readFileSync(SCENES_SOURCE_PATH, 'utf8'));

        expect(kinds.filter((kind) => !GATE_READABLE_KINDS.has(kind))).toEqual([]);
        // Cardinality too, because "none unreadable" holds vacuously for an
        // empty list — which is exactly what the gate would collect.
        expect(kinds).toHaveLength(demoDescriptor().requiredAssets.length);
    });
});

describe('the asset-demo scene through the real action pipeline', () => {
    it('carries its declared refs onto sceneTransition.requiredAssets on prepare', () => {
        const pipeline = makePipeline();
        const start = makeSnapshot();

        const prepared = pipeline.process(
            start,
            action('engine:scene_prepare', start, {
                toSceneId: 'tactics:asset-demo',
                params: {},
            }),
        );

        expect(prepared.sceneTransition?.toSceneId).toBe(TACTICS_ASSET_DEMO_SCENE_ID);
        expect(prepared.sceneTransition?.requiredAssets).toEqual(demoDescriptor().requiredAssets);
    });

    it('carries the same refs onto sceneRequiredAssets when the transition commits', () => {
        // The producer-to-channel proof: the refs a game declared in main reach
        // the committed snapshot, which is what the renderer reads.
        const pipeline = makePipeline();
        const start = makeSnapshot();

        const prepared = pipeline.process(
            start,
            action('engine:scene_prepare', start, {
                toSceneId: 'tactics:asset-demo',
                params: {},
            }),
        );
        const ready = pipeline.process(
            prepared,
            action('engine:scene_ready', prepared, { playerId: HOST }),
        );
        const committed = pipeline.process(ready, action('engine:scene_commit', ready, {}));

        expect(committed.sceneId).toBe(TACTICS_ASSET_DEMO_SCENE_ID);
        expect(committed.sceneDefaultScreen).toBe('asset-demo');
        expect(committed.sceneRequiredAssets).toEqual(demoDescriptor().requiredAssets);
        expect(committed.sceneTransition).toBeNull();
    });

    it('still carries nothing for an engine scene that declares nothing', () => {
        // Positive control for the two cases above: the refs on the transition
        // come from the ENTERED descriptor, not from a constant. `engine:lobby`
        // declares `[]`, so its transition omits the field entirely.
        const pipeline = makePipeline();
        const start = makeSnapshot();

        const prepared = pipeline.process(
            start,
            action('engine:scene_prepare', start, { toSceneId: 'engine:lobby', params: {} }),
        );

        expect(prepared.sceneTransition?.requiredAssets).toBeUndefined();
    });
});
