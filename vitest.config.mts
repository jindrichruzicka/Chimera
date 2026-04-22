import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        name: 'chimera',
        environment: 'node',
        include: ['**/*.test.ts', '**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'],
        globals: false,
        restoreMocks: true,
        clearMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: [
                'electron/**/*.ts',
                'simulation/**/*.ts',
                'ai/**/*.ts',
                'renderer/**/*.ts',
                'shared/**/*.ts',
                'games/**/*.ts',
                'networking/**/*.ts',
                'tools/**/*.ts',
            ],
            exclude: ['**/*.test.ts', '**/*.test.tsx', '**/node_modules/**', '**/out/**'],
        },
    },
});
