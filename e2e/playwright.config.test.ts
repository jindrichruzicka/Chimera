import { describe, it, expect } from 'vitest';
import config from './playwright.config';

describe('playwright.config', () => {
    it('targets ./tests directory', () => {
        expect(config.testDir).toBe('./tests');
    });

    it('uses 90 s timeout', () => {
        expect(config.timeout).toBe(90_000);
    });

    it('runs serially — fullyParallel: false', () => {
        expect(config.fullyParallel).toBe(false);
    });

    it('caps the fixed-port Electron suite to one worker', () => {
        expect(config.workers).toBe(1);
    });

    it('retries: 1', () => {
        expect(config.retries).toBe(1);
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

    it('registers global-setup', () => {
        expect(config.globalSetup).toBe('./global-setup.ts');
    });

    it('includes html and junit reporters', () => {
        const reporters = config.reporter as [string, unknown][];
        const names = reporters.map(([name]) => name);
        expect(names).toContain('html');
        expect(names).toContain('junit');
    });

    it('defines an "electron-e2e" project — required by e2e.yml --project=electron-e2e', () => {
        const projects = (config.projects ?? []) as { name: string }[];
        const names = projects.map((p) => p.name);
        expect(names).toContain('electron-e2e');
    });
});
