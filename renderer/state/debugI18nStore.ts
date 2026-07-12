// renderer/state/debugI18nStore.ts
//
// Tiny renderer-only debug flag for i18n token mode (§4.12, Invariant #27).
// When `showTranslationTokens` is true, the I18nProvider is fed
// `showTokens=true` and every `useTranslate()` call renders its raw token
// instead of the translated string — a debug affordance for auditing
// translation coverage.
//
// The flag is flipped exclusively by the Debug Inspector's "Show translation
// tokens" toggle, relayed main → game-renderer over `chimera:system:i18n-token-mode`
// (see the AppShell subscription bootstrap). It defaults to `false` and, in
// production, nothing ever pushes on that channel, so it stays `false`.

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';

export interface DebugI18nStoreState {
    readonly showTranslationTokens: boolean;
    setShowTranslationTokens(this: void, enabled: boolean): void;
}

export function createDebugI18nStore(): StoreApi<DebugI18nStoreState> {
    return createStore<DebugI18nStoreState>()((set) => ({
        showTranslationTokens: false,

        setShowTranslationTokens(enabled: boolean): void {
            set((state) =>
                state.showTranslationTokens === enabled ? {} : { showTranslationTokens: enabled },
            );
        },
    }));
}

const debugI18nStoreInstance = createDebugI18nStore();

export function useDebugI18nStore<TSelected>(
    selector: (state: DebugI18nStoreState) => TSelected,
): TSelected {
    return useStore(debugI18nStoreInstance, selector);
}

useDebugI18nStore.getState = debugI18nStoreInstance.getState.bind(debugI18nStoreInstance);
useDebugI18nStore.setState = debugI18nStoreInstance.setState.bind(debugI18nStoreInstance);
useDebugI18nStore.subscribe = debugI18nStoreInstance.subscribe.bind(debugI18nStoreInstance);
