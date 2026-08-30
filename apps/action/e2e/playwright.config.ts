import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    // Resolve `@chimera-engine/*` specifiers for the Playwright transform via
    // e2e/tsconfig.json. The root tsconfig carries no `@chimera-engine/*` paths,
    // and Playwright has no non-tsconfig alias hook, so this shim restores
    // resolution for the runner only.
    tsconfig: './tsconfig.json',
    timeout: 90_000,
    expect: { timeout: 10_000 },
    // Serialises the tests INSIDE one file, which is what lets one
    // `CHIMERA_PORT` serve a whole file: every test launches a real Electron app
    // that binds it. It does NOT serialise the files themselves — `workers` runs
    // two at once, which is why each spec file declares a port of its own
    // through the fixture's `actionPort` option.
    fullyParallel: false,
    workers: 2,
    retries: 1,
    // The retry is kept for the trace it captures on the first failure, not to
    // buy a pass. A run that reported `1 flaky` on stdout still exited 0, and
    // what reads this suite reads that exit code. With this, the retry still
    // produces the trace AND the run reds.
    failOnFlakyTests: true,
    reporter: [
        // Under this suite's own directory: the tactics job uploads its report
        // from `apps/tactics/e2e/playwright-report/`, and a shared path would
        // have whichever job finished last overwrite the other's artefact.
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'results/e2e.xml' }],
    ],
    use: {
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    globalSetup: './global-setup.ts', // Builds this app's renderer + Electron bundles once
    projects: [
        {
            name: 'electron-e2e',
            // testDir inherited from top-level; all specs in ./tests run under this project.
        },
    ],
});
