import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { ReplayPlayerPage } from './ReplayPlayerPage';

interface FakeLocator {
    readonly click: () => Promise<void>;
    readonly innerText: () => Promise<string>;
    readonly selectOption: (value: string) => Promise<void>;
}

const buildPageDouble = (): {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly requestedLabels: string[];
    readonly requestedRoles: string[];
} => {
    const requestedTestIds: string[] = [];
    const requestedLabels: string[] = [];
    const requestedRoles: string[] = [];
    const makeLocator = (): FakeLocator => ({
        click: async (): Promise<void> => {},
        innerText: async (): Promise<string> => '0 / 0',
        selectOption: async (): Promise<void> => {},
    });
    const page = {
        getByTestId: (testId: string): FakeLocator => {
            requestedTestIds.push(testId);
            return makeLocator();
        },
        getByLabel: (label: string): FakeLocator => {
            requestedLabels.push(label);
            return makeLocator();
        },
        getByRole: (role: string, options?: { name?: string }): FakeLocator => {
            requestedRoles.push(`${role}${options?.name ? `[${options.name}]` : ''}`);
            return makeLocator();
        },
    };
    return { page: page as unknown as Page, requestedTestIds, requestedLabels, requestedRoles };
};

describe('ReplayPlayerPage', () => {
    it('binds the transport locators by test id, the speed select by label, and the seek/step buttons by role', () => {
        const { page, requestedTestIds, requestedLabels, requestedRoles } = buildPageDouble();

        const player = new ReplayPlayerPage(page);

        expect(player.playButton).toBeDefined();
        expect(player.pauseButton).toBeDefined();
        expect(player.tickCounter).toBeDefined();
        expect(player.scrubber).toBeDefined();
        expect(player.speedSelect).toBeDefined();
        expect(player.seekToEndButton).toBeDefined();
        expect(player.stepBackButton).toBeDefined();
        expect(player.saveButton).toBeDefined();
        expect(requestedTestIds).toEqual([
            'replay-play-btn',
            'replay-pause-btn',
            'replay-tick-counter',
            'replay-scrubber',
            'replay-save-btn',
        ]);
        expect(requestedLabels).toEqual(['Playback speed']);
        expect(requestedRoles).toEqual(['button[Seek to end]', 'button[Step back]']);
    });

    describe('parseTickCounter', () => {
        it('parses "<current> / <total>"', () => {
            expect(ReplayPlayerPage.parseTickCounter('4 / 10')).toEqual({ current: 4, total: 10 });
        });

        it('tolerates surrounding whitespace and no spaces around the slash', () => {
            expect(ReplayPlayerPage.parseTickCounter('  12/12  ')).toEqual({
                current: 12,
                total: 12,
            });
        });

        it('throws on text that is not a tick counter', () => {
            expect(() => ReplayPlayerPage.parseTickCounter('Loading…')).toThrow(/tick counter/i);
        });
    });
});
