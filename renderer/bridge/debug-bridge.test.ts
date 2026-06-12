// @vitest-environment jsdom
// renderer/bridge/debug-bridge.test.ts

import { describe, expect, it } from 'vitest';
import { createDebugApiMock } from '../components/debug/__test-support__/DebugApiStubs';
import { getDebugBridge } from './debug-bridge';

describe('getDebugBridge', () => {
    it('returns null when source has no __chimeraDebug property', () => {
        expect(getDebugBridge({})).toBeNull();
    });

    it('returns null when source is undefined-like (prerender pass)', () => {
        expect(getDebugBridge(Object.create(null))).toBeNull();
    });

    it('returns the debug API when present', () => {
        const api = createDebugApiMock();
        expect(getDebugBridge({ __chimeraDebug: api })).toBe(api);
    });

    it('defaults to globalThis, where no bridge is installed in jsdom', () => {
        expect(getDebugBridge()).toBeNull();
    });
});
