import { describe, it, expect } from 'vitest';
import config from './playwright.config';

/**
 * The action suite's Playwright config, pinned where its behaviour depends on a
 * value. It is a SECOND suite in this repo, so the two properties nothing else
 * can see are the ones that keep it from colliding with the tactics one: its own
 * project name is still `electron-e2e` (the CI job passes `--project`), and its
 * reporters write under `apps/action/e2e/`, not into the tactics report the
 * other job uploads.
 */
describe('action playwright.config', () => {
    it('targets ./tests directory', () => {
        expect(config.testDir).toBe('./tests');
    });

    it('resolves @chimera-engine/* for the runner through the sibling tsconfig', () => {
        // Playwright has no non-tsconfig alias hook; without this the transform
        // cannot load global-setup's engine import at all.
        expect(config.tsconfig).toBe('./tsconfig.json');
    });

    it('serialises the tests inside one file, so one port can serve that file', () => {
        // Every test launches a real Electron app that binds `CHIMERA_PORT`, and
        // the tests of one file share one port.
        expect(config.fullyParallel).toBe(false);
    });

    it('runs two workers, which is what the per-FILE port exists for', () => {
        // `fullyParallel: false` leaves the FILES parallel, so two spec files run
        // at once and a single suite-wide port would collide. Pinned because the
        // fixture's `actionPort` option and §13.12's ports row both rest on this
        // number being greater than one.
        expect(config.workers).toBe(2);
    });

    it('retries: 1', () => {
        expect(config.retries).toBe(1);
    });

    // The retry stays for the trace it captures, but it must not BUY a pass: a
    // run reporting `1 flaky` exits 0, and what reads this suite is that code.
    it('fails the run on a flaky test, so a retried spec cannot pass a gate silently', () => {
        expect(config.failOnFlakyTests).toBe(true);
    });

    it('sets trace on-first-retry', () => {
        expect((config.use as Record<string, unknown>)?.['trace']).toBe('on-first-retry');
    });

    it('sets video retain-on-failure', () => {
        expect((config.use as Record<string, unknown>)?.['video']).toBe('retain-on-failure');
    });

    it('sets screenshot only-on-failure', () => {
        expect((config.use as Record<string, unknown>)?.['screenshot']).toBe('only-on-failure');
    });

    it('registers this suite’s own global-setup', () => {
        expect(config.globalSetup).toBe('./global-setup.ts');
    });

    it('writes its html report and junit xml under this suite, not the tactics one', () => {
        const reporters = config.reporter as [string, Record<string, string>][];
        const html = reporters.find(([name]) => name === 'html');
        const junit = reporters.find(([name]) => name === 'junit');
        expect(html?.[1]?.['outputFolder']).toBe('playwright-report');
        expect(junit?.[1]?.['outputFile']).toBe('results/e2e.xml');
    });

    it('defines an "electron-e2e" project — required by the e2e.yml --project flag', () => {
        const projects = (config.projects ?? []) as { name: string }[];
        expect(projects.map((project) => project.name)).toContain('electron-e2e');
    });
});
