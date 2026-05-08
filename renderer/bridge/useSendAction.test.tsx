// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { playerId, type EngineAction } from '@chimera/electron/preload/api-types.js';
import { useSendAction } from './useSendAction';

function makeAction(): EngineAction {
    return {
        type: 'engine:end_turn',
        playerId: playerId('p1'),
        tick: 3,
        payload: {},
    };
}

describe('useSendAction', () => {
    it('dispatches through a provided game bridge', () => {
        const sendAction = vi.fn();
        const { result } = renderHook(() => useSendAction({ __chimera: { game: { sendAction } } }));
        const action = makeAction();

        result.current(action);

        expect(sendAction).toHaveBeenCalledWith(action);
    });

    it('throws the bridge-unavailable error for null source values', () => {
        const { result } = renderHook(() => useSendAction(null));

        expect(() => result.current(makeAction())).toThrow('Chimera game API not available');
    });
});
