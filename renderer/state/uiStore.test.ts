import { describe, expect, it } from 'vitest';
import { createUiStore } from './uiStore.js';

describe('uiStore', () => {
    it('defaults to the playfield screen with no active scene id', () => {
        const store = createUiStore();

        expect(store.getState().activeScreenKey).toBe('playfield');
        expect(store.getState().activeSceneId).toBeNull();
    });

    it('updates active screen key locally without changing scene id', () => {
        const store = createUiStore();

        store.getState().navigateToScreen('tech-tree');

        expect(store.getState().activeScreenKey).toBe('tech-tree');
        expect(store.getState().activeSceneId).toBeNull();
    });

    it('resets active screen to playfield when the scene id changes', () => {
        const store = createUiStore();
        store.getState().navigateToScreen('tech-tree');

        store.getState().setActiveSceneId('engine:post-game');

        expect(store.getState().activeSceneId).toBe('engine:post-game');
        expect(store.getState().activeScreenKey).toBe('playfield');
    });

    it('resets to a supplied scene default screen when activeSceneId changes', () => {
        const store = createUiStore();

        store.getState().navigateToScreen('tech-tree');
        store.getState().setActiveSceneId('engine:post-game', 'summary');

        expect(store.getState().activeSceneId).toBe('engine:post-game');
        expect(store.getState().activeScreenKey).toBe('summary');
    });
});
