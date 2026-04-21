import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['**/*.test.ts', '**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'],
        globals: false,
        restoreMocks: true,
        clearMocks: true,
    },
});
