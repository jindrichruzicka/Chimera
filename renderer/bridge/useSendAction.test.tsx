// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { playerId, type EngineAction } from '@chimera/simulation/bridge/api-types.js';
import { useSendAction } from './useSendAction';

const recordActionDispatched = vi.fn<(stamp: number) => void>();

vi.mock('../components/shell/perf/perfStore.js', () => ({
    usePerfStore: {
        getState: () => ({
            recordActionDispatched,
        }),
    },
}));

function makeAction(): EngineAction {
    return {
        type: 'engine:end_turn',
        playerId: playerId('p1'),
        tick: 3,
        payload: {},
    };
}

describe('useSendAction', () => {
    it('records a local action dispatch stamp in perfStore after send', () => {
        const sendAction = vi.fn();
        const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1234.5);
        const { result } = renderHook(() => useSendAction({ __chimera: { game: { sendAction } } }));

        result.current(makeAction());

        expect(recordActionDispatched).toHaveBeenCalledOnce();
        expect(recordActionDispatched).toHaveBeenCalledWith(1234.5);
        nowSpy.mockRestore();
    });

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
