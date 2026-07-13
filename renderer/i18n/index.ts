// renderer/i18n/index.ts
//
// Public barrel for the engine i18n runtime (F71). Games and their tests import
// the provider, the `useTranslate()` hook, the engine token catalogue, and the
// supporting types from here (`@chimera-engine/renderer/i18n`) rather than
// reaching into the individual modules. Re-export only — no side effects, so
// importing this barrel never installs a store subscription or mounts anything
// (mirrors the side-effect-free `components/ui` barrel).

export { I18nProvider, type I18nProviderProps } from './I18nProvider';
export { TokenModeI18nProvider, type TokenModeI18nProviderProps } from './TokenModeI18nProvider';
export { useI18n, useTranslate } from './useTranslate';
export type { I18nContextValue, MessageParams, TranslateFn } from './i18n-context';
export {
    resolveTranslation,
    translationKey,
    type ResolvedBundles,
    type ResolvedTranslation,
    type TranslationBundle,
    type TranslationKey,
    type TranslationSource,
} from './translation-bundle';
export { engineBundleEn } from './engine-bundle.en';
export {
    CHAT_KEYS,
    COMMON_KEYS,
    CONNECTION_KEYS,
    CRASH_KEYS,
    ENGINE_KEYS,
    GAME_RESULT_KEYS,
    GAME_SHELL_KEYS,
    HUD_KEYS,
    IN_GAME_MENU_KEYS,
    LOBBY_KEYS,
    MENU_KEYS,
    REPLAYS_KEYS,
    RESTORE_KEYS,
    SAVE_GAME_KEYS,
    SAVES_KEYS,
    SETTINGS_KEYS,
    TOAST_KEYS,
} from './engine-keys';
