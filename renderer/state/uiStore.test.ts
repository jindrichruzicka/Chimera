import { describe, expect, it } from 'vitest';
import { createUiStore } from './uiStore.js';

describe('uiStore', () => {
    it('defaults to the board screen with no active scene id', () => {
        const store = createUiStore();

        expect(store.getState().activeScreenKey).toBe('board');
        expect(store.getState().activeSceneId).toBeNull();
    });

    it('updates active screen key locally without changing scene id', () => {
        const store = createUiStore();

        store.getState().navigateToScreen('tech-tree');

        expect(store.getState().activeScreenKey).toBe('tech-tree');
        expect(store.getState().activeSceneId).toBeNull();
    });

    it('resets active screen to board when the scene id changes', () => {
        const store = createUiStore();
        store.getState().navigateToScreen('tech-tree');

        store.getState().setActiveSceneId('engine:post-match');

        expect(store.getState().activeSceneId).toBe('engine:post-match');
        expect(store.getState().activeScreenKey).toBe('board');
    });

    it('resets to a supplied scene default screen when activeSceneId changes', () => {
        const store = createUiStore();

        store.getState().navigateToScreen('tech-tree');
        store.getState().setActiveSceneId('engine:post-match', 'summary');

        expect(store.getState().activeSceneId).toBe('engine:post-match');
        expect(store.getState().activeScreenKey).toBe('summary');
    });
});
