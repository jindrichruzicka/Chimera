// @vitest-environment jsdom

/**
 * renderer/components/r3f/useEngineFrameloop.test.ts
 *
 * Unit tests for the Canvas-FREE hook that turns the active game's
 * `settings.display.targetFps` into the `frameloop` prop a `<Canvas>` needs.
 *
 * Rules:
 *  - @react-three/fiber is mocked to THROW from every export: the hook is called
 *    OUTSIDE a `<Canvas>` to compute its prop, so it must reach no R3F hook.
 *  - No electron/, ai/ or apps/* imports; the settings defaults are the same
 *    declared contract the hook's selector reads.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_DEFAULTS } from '@chimera-engine/simulation/settings/index.js';
import { useSettingsStore } from '../../state/settingsStore';
import { useEngineFrameloop } from './useEngineFrameloop';

// Any R3F hook reached from this module is a defect, not a test failure mode:
// the hook runs outside the canvas it configures.
vi.mock('@react-three/fiber', () => {
    const outsideCanvas = (name: string) => (): never => {
        throw new Error(`${name} reached from a Canvas-free module`);
    };
    return {
        Canvas: outsideCanvas('Canvas'),
        useThree: outsideCanvas('useThree'),
        useFrame: outsideCanvas('useFrame'),
        advance: outsideCanvas('advance'),
        invalidate: outsideCanvas('invalidate'),
    };
});

function setTargetFps(targetFps: number): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { ...ENGINE_DEFAULTS, display: { targetFps } } },
    });
}

beforeEach(() => {
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    vi.clearAllMocks();
});

describe('useEngineFrameloop', () => {
    it.each([30, 60, 120] as const)('returns never at a %i fps cap', (targetFps) => {
        setTargetFps(targetFps);

        expect(renderHook(() => useEngineFrameloop()).result.current).toBe('never');
    });

    it('returns always at targetFps 0 so the uncapped path is R3F default', () => {
        setTargetFps(0);

        expect(renderHook(() => useEngineFrameloop()).result.current).toBe('always');
    });

    it('returns always when settings are not yet hydrated', () => {
        expect(renderHook(() => useEngineFrameloop()).result.current).toBe('always');
    });

    it('reads the engine settings namespace when no game is active', () => {
        useSettingsStore.setState({
            activeGameId: null,
            settings: { __engine__: { ...ENGINE_DEFAULTS, display: { targetFps: 30 } } },
        });

        expect(renderHook(() => useEngineFrameloop()).result.current).toBe('never');
    });

    it('renders outside a Canvas without reaching an R3F hook', () => {
        setTargetFps(60);

        // The fiber mock throws from every export; reaching one would surface
        // here rather than as a "hooks can only be used within the Canvas" crash
        // at a game's call site.
        expect(() => renderHook(() => useEngineFrameloop())).not.toThrow();
    });

    it.each([
        [120, 0, 'never', 'always'],
        [0, 30, 'always', 'never'],
        [30, 120, 'never', 'never'],
    ] as const)(
        'flips from %i to %i fps on re-render',
        (from, to, expectedBefore, expectedAfter) => {
            setTargetFps(from);
            const { result, rerender } = renderHook(() => useEngineFrameloop());
            expect(result.current).toBe(expectedBefore);

            setTargetFps(to);
            rerender();

            expect(result.current).toBe(expectedAfter);
        },
    );

    it.each([
        [120, 0, 'never', 'always'],
        [0, 30, 'always', 'never'],
    ] as const)(
        'subscribes: %i to %i fps flips with no re-render of its own',
        (from, to, expectedBefore, expectedAfter) => {
            setTargetFps(from);
            const { result } = renderHook(() => useEngineFrameloop());
            expect(result.current).toBe(expectedBefore);

            // `settingsStore` changes with no re-render from above. A one-shot
            // `getState()` read would leave the value stale here, and a stale
            // frameloop is either an uncapped loop or a driver that never
            // advances.
            act(() => {
                setTargetFps(to);
            });

            expect(result.current).toBe(expectedAfter);
        },
    );
});
