/**
 * electron/main/runtime/e2e-hooks.test.ts
 *
 * Unit tests for e2e-hooks helpers.
 *
 * Architecture: §13.9, §13.10 — E2E hooks and CHIMERA_E2E flag.
 * Issue: #472
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createE2eHooks, registerE2eHooks, getE2eHooks, MAX_WS_FRAMES } from './e2e-hooks';
import type { WsFrame } from './e2e-hooks';

afterEach(() => {
    // Restore env and clear global hook between tests
    globalThis.__e2eHooks = undefined;
    delete process.env['CHIMERA_E2E'];
});

// ---------------------------------------------------------------------------
// registerE2eHooks
// ---------------------------------------------------------------------------

describe('registerE2eHooks', () => {
    it('registers __e2eHooks on globalThis when CHIMERA_E2E=1', () => {
        registerE2eHooks({ CHIMERA_E2E: '1' });

        expect(globalThis.__e2eHooks).toBeDefined();
    });

    it('removes __e2eHooks from globalThis when CHIMERA_E2E is absent', () => {
        globalThis.__e2eHooks = createE2eHooks();

        registerE2eHooks({});

        expect(globalThis.__e2eHooks).toBeUndefined();
    });

    it('returns undefined when CHIMERA_E2E is absent', () => {
        expect(registerE2eHooks({})).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// getE2eHooks
// ---------------------------------------------------------------------------

describe('getE2eHooks', () => {
    it('returns the registered hooks', () => {
        const hooks = registerE2eHooks({ CHIMERA_E2E: '1' });

        expect(getE2eHooks()).toBe(hooks);
    });

    it('returns undefined when hooks have not been registered', () => {
        expect(getE2eHooks()).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// pushWsFrame
// ---------------------------------------------------------------------------

describe('pushWsFrame', () => {
    it('appends a frame when wsFrames is initialized', () => {
        const hooks = createE2eHooks();
        hooks.wsFrames = [];
        const frame: WsFrame = { direction: 'inbound', data: '{"tick":1}', timestamp: 100 };

        hooks.pushWsFrame(frame);

        expect(hooks.wsFrames).toEqual([frame]);
    });

    it('appends multiple frames in order', () => {
        const hooks = createE2eHooks();
        hooks.wsFrames = [];
        const f1: WsFrame = { direction: 'inbound', data: 'a', timestamp: 1 };
        const f2: WsFrame = { direction: 'outbound', data: 'b', timestamp: 2 };

        hooks.pushWsFrame(f1);
        hooks.pushWsFrame(f2);

        expect(hooks.wsFrames).toEqual([f1, f2]);
    });

    it('is a no-op when wsFrames is undefined', () => {
        const hooks = createE2eHooks();
        const frame: WsFrame = { direction: 'inbound', data: '{}', timestamp: 1 };

        expect(() => hooks.pushWsFrame(frame)).not.toThrow();
        expect(hooks.wsFrames).toBeUndefined();
    });

    it('drops the oldest frame when buffer reaches MAX_WS_FRAMES', () => {
        const hooks = createE2eHooks();
        hooks.wsFrames = [];

        for (let i = 0; i < MAX_WS_FRAMES; i++) {
            hooks.wsFrames.push({ direction: 'inbound', data: String(i), timestamp: i });
        }

        const newFrame: WsFrame = { direction: 'outbound', data: 'new', timestamp: MAX_WS_FRAMES };
        hooks.pushWsFrame(newFrame);

        expect(hooks.wsFrames).toHaveLength(MAX_WS_FRAMES);
        expect(hooks.wsFrames[hooks.wsFrames.length - 1]).toEqual(newFrame);
        // Frame at index 0 (data: '0') has been dropped; first entry is now data: '1'
        expect(hooks.wsFrames[0]).toEqual({
            direction: 'inbound',
            data: '1',
            timestamp: 1,
        });
    });

    it('keeps buffer exactly at MAX_WS_FRAMES after repeated overflow pushes', () => {
        const hooks = createE2eHooks();
        hooks.wsFrames = [];

        for (let i = 0; i < MAX_WS_FRAMES + 5; i++) {
            hooks.pushWsFrame({ direction: 'inbound', data: String(i), timestamp: i });
        }

        expect(hooks.wsFrames).toHaveLength(MAX_WS_FRAMES);
    });
});
