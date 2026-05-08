import { defaultTheme } from '../default-theme';
import { registry } from '../ThemeRegistry.store';

export interface ThemeRegistryTestApi {
    reset(): void;
}

export const ThemeRegistryTestHelpers: ThemeRegistryTestApi = {
    reset(): void {
        registry.clear();
        registry.set(defaultTheme.id, defaultTheme);
    },
};
