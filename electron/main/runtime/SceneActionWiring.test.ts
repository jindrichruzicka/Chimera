import { describe, expect, it } from 'vitest';
import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { wireDefaultSceneActions } from './SceneActionWiring.js';

describe('wireDefaultSceneActions', () => {
    it('registers the scene prepare, ready, and commit engine actions', () => {
        const registry = new ActionRegistry();

        wireDefaultSceneActions(registry);

        expect(registry.has('engine:scene_prepare')).toBe(true);
        expect(registry.has('engine:scene_ready')).toBe(true);
        expect(registry.has('engine:scene_commit')).toBe(true);
    });
});
