import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 8,
    retries: 1,
    reporter: [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'results/e2e.xml' }],
    ],
    use: {
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    globalSetup: './global-setup.ts', // Compile renderer bundle once before all tests
    projects: [
        {
            name: 'electron-e2e',
            // testDir inherited from top-level; all specs in ./tests run under this project.
        },
    ],
});
