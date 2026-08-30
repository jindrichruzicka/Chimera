import { describe, it, expect } from 'vitest';
import { describeLaunchStall, type LaunchStallFacts } from './open-window';

/**
 * One case per ARM, because the arms are the whole point: a launch timeout says
 * only `Timeout 30000ms exceeded`, and which of these four it was decides where
 * a reader looks next. A single fixture that happened to trip two at once would
 * leave the collapse-either-one mutant alive.
 */
describe('describeLaunchStall', () => {
    const alive: LaunchStallFacts = {
        windowCount: 0,
        exitCode: null,
        signal: null,
        stderrTail: '',
    };

    it('names a dead main process, and prefers that over the phase', () => {
        // Checked FIRST: an app that exited never reached either wait, so
        // reporting "the renderer entry is late" would send a reader to a
        // renderer that was never loaded.
        const message = describeLaunchStall('load', { ...alive, exitCode: 1, windowCount: 3 });

        expect(message).toContain('had already exited');
        expect(message).toContain('code=1');
        expect(message).not.toContain('domcontentloaded');
    });

    it('treats a killing signal as death too, with no exit code', () => {
        expect(describeLaunchStall('first-window', { ...alive, signal: 'SIGKILL' })).toContain(
            'signal=SIGKILL',
        );
    });

    it('names the renderer entry when a window opened but never loaded', () => {
        const message = describeLaunchStall('load', { ...alive, windowCount: 1 });

        expect(message).toContain('domcontentloaded');
        expect(message).toContain('(1 open)');
    });

    it('names a main process stuck before its first window', () => {
        expect(describeLaunchStall('first-window', alive)).toContain('opened no window');
    });

    it('names a late ATTACH when windows already exist and the app is alive', () => {
        // The one arm that blames the runner rather than the app.
        expect(describeLaunchStall('first-window', { ...alive, windowCount: 2 })).toContain(
            "the runner's attach is late",
        );
    });

    it('says the stderr was not captured rather than printing an empty tail', () => {
        expect(describeLaunchStall('first-window', alive)).toContain(
            'no main-process stderr was captured',
        );
    });

    it('prints the captured stderr when there is some', () => {
        const message = describeLaunchStall('first-window', {
            ...alive,
            stderrTail: 'Error: boom',
        });

        expect(message).toContain('main-process stderr');
        expect(message).toContain('Error: boom');
    });

    it('distinguishes an uninspectable app from one with no windows', () => {
        // `null` is the READ failing, not an answer about the app — and the two
        // send a reader to different places.
        const uninspectable = describeLaunchStall('first-window', null);

        expect(uninspectable).toContain('could not be inspected');
        expect(uninspectable).not.toContain('opened no window');
    });
});
