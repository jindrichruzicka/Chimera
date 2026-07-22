// @vitest-environment jsdom
// renderer/app/LoggingBootstrap.guard.test.tsx
//
// Pins uninstall()'s clear-before-invoke ordering — the same guard-both-steps
// rule Invariant #67 imposes on refuseToStart. The bootstrap clears its
// module-scope claim BEFORE invoking the teardown, so a teardown that throws
// cannot leave a stale claim behind that blocks every future re-install.
//
// Separate file because proving it requires installRendererLogger to hand out
// a throwing teardown, and vi.mock is file-wide — LoggingBootstrap.test.tsx
// needs the real module for its ownership and teardown-exactness pins.

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoggingBootstrap } from './LoggingBootstrap';

const loggerMocks = vi.hoisted(() => ({
    installRendererLogger: vi.fn(),
}));

vi.mock('../logging/rendererLogger', () => ({
    installRendererLogger: loggerMocks.installRendererLogger,
}));

beforeEach(() => {
    loggerMocks.installRendererLogger.mockReset();
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            logs: {
                emit: vi.fn(),
                readRecent: vi.fn(() => Promise.resolve([])),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    vi.restoreAllMocks();
});

describe('LoggingBootstrap — teardown guard ordering', () => {
    it('a throwing teardown does not leave a stale claim that blocks the next install', () => {
        loggerMocks.installRendererLogger
            .mockReturnValueOnce(() => {
                throw new Error('teardown blew up');
            })
            .mockReturnValue(vi.fn());

        const first = render(<LoggingBootstrap />);
        expect(loggerMocks.installRendererLogger).toHaveBeenCalledTimes(1);

        // React rethrows the cleanup error from unmount; the ordering under
        // test is what happens to the claim BEFORE that throw escapes.
        try {
            first.unmount();
        } catch {
            // expected — the throwing teardown propagates
        }

        // With the claim cleared first, the next mount re-installs. With the
        // invoke-then-clear order, the stale claim short-circuits
        // ensureInstalled forever and this stays at 1.
        render(<LoggingBootstrap />);
        expect(loggerMocks.installRendererLogger).toHaveBeenCalledTimes(2);
    });
});
