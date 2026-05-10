import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

export interface UiStoreState {
    readonly activeSceneId: string | null;
    readonly activeScreenKey: string;
    navigateToScreen(this: void, screenKey: string): void;
    setActiveSceneId(this: void, sceneId: string, defaultScreenKey?: string): void;
    resetScreenNavigation(this: void): void;
}

export function createUiStore(): StoreApi<UiStoreState> {
    return createStore<UiStoreState>()((set) => ({
        activeSceneId: null,
        activeScreenKey: 'board',

        navigateToScreen(screenKey: string): void {
            set(() => ({ activeScreenKey: screenKey }));
        },

        setActiveSceneId(sceneId: string, defaultScreenKey = 'board'): void {
            set((state) => {
                if (state.activeSceneId === sceneId) {
                    return {};
                }
                return {
                    activeSceneId: sceneId,
                    activeScreenKey: defaultScreenKey,
                };
            });
        },

        resetScreenNavigation(): void {
            set(() => ({ activeSceneId: null, activeScreenKey: 'board' }));
        },
    }));
}

const uiStoreInstance = createUiStore();

export function useUiStore<TSelected>(selector: (state: UiStoreState) => TSelected): TSelected {
    return useStore(uiStoreInstance, selector);
}

export function useActiveScreen(): string {
    return useUiStore((state) => state.activeScreenKey);
}

export function useNavigateToScreen(): (screenKey: string) => void {
    return useUiStore((state) => state.navigateToScreen);
}

useUiStore.getState = uiStoreInstance.getState.bind(uiStoreInstance);
useUiStore.setState = uiStoreInstance.setState.bind(uiStoreInstance);
useUiStore.subscribe = uiStoreInstance.subscribe.bind(uiStoreInstance);
