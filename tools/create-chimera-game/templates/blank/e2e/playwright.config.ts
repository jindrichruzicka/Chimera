import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    // Resolve `@chimera-engine/*` specifiers for the Playwright transform via e2e/tsconfig.json.
    // The root tsconfig drops the `@chimera-engine/*` paths; Playwright has no non-tsconfig alias
    // hook, so this shim restores resolution for the runner only.
    tsconfig: './tsconfig.json',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 2,
    retries: 1,
    // The retry is kept for the trace `on-first-retry` captures below, which a
    // zero-retry run can never record — not to buy a pass. Without the flag,
    // Playwright reports a spec that failed its first attempt as `N flaky` on
    // stdout and still exits 0, so whatever reads this suite's exit code reads
    // a clean run. With it, the retry still produces the trace AND the run reds.
    failOnFlakyTests: true,
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
