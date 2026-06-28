// @vitest-environment jsdom
//
// Unit tests for useGameInteraction hook.
// Architecture: §4.23 — Pointer and Click Interactions
// Issue: #551

import { act, renderHook } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    entityId,
    playerId,
    type EngineAction,
    type EntityId,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { InteractionContext } from '../components/r3f/InteractionBlocker.js';
import { useGameInteraction } from './useGameInteraction.js';

const mockSendAction = vi.fn();

vi.mock('../bridge/useSendAction.js', () => ({
    useSendAction: () => mockSendAction,
}));

const ENTITY_ID: EntityId = entityId('entity-1');

function makeAction(): EngineAction {
    return { type: 'test:action', playerId: playerId('p1'), tick: 0, payload: {} };
}

function makeClickEvent(): { stopPropagation: ReturnType<typeof vi.fn> } {
    return { stopPropagation: vi.fn() };
}

function makePointerEvent() {
    return {};
}

function makeWrapper(isBlocked: boolean) {
    return ({ children }: { children: ReactNode }) => (
        <InteractionContext.Provider value={{ isBlocked }}>{children}</InteractionContext.Provider>
    );
}

describe('useGameInteraction', () => {
    beforeEach(() => {
        mockSendAction.mockReset();
    });

    it('dispatches the built action when not blocked', () => {
        const action = makeAction();
        const actionBuilder = vi.fn(() => action);
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, actionBuilder), {
            wrapper: makeWrapper(false),
        });

        act(() => {
            result.current.onClick(makeClickEvent() as any);
        });

        expect(actionBuilder).toHaveBeenCalledOnce();
        expect(mockSendAction).toHaveBeenCalledWith(action);
    });

    it('calls stopPropagation on the click event when not blocked', () => {
        const event = makeClickEvent();
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, () => makeAction()), {
            wrapper: makeWrapper(false),
        });

        act(() => {
            result.current.onClick(event as any);
        });

        expect(event.stopPropagation).toHaveBeenCalledOnce();
    });

    it('is a no-op on click when blocked — does not call actionBuilder or dispatch', () => {
        const actionBuilder = vi.fn(() => makeAction());
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, actionBuilder), {
            wrapper: makeWrapper(true),
        });

        act(() => {
            result.current.onClick(makeClickEvent() as any);
        });

        expect(actionBuilder).not.toHaveBeenCalled();
        expect(mockSendAction).not.toHaveBeenCalled();
    });

    it('calls stopPropagation on the click event when blocked', () => {
        const event = makeClickEvent();
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, () => makeAction()), {
            wrapper: makeWrapper(true),
        });

        act(() => {
            result.current.onClick(event as any);
        });

        expect(event.stopPropagation).toHaveBeenCalledOnce();
    });

    it('updates isHovered to true on pointer enter when not blocked', () => {
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, () => makeAction()), {
            wrapper: makeWrapper(false),
        });

        expect(result.current.isHovered).toBe(false);

        act(() => {
            result.current.onPointerEnter(makePointerEvent() as any);
        });

        expect(result.current.isHovered).toBe(true);
    });

    it('updates isHovered on pointer enter and leave even when blocked', () => {
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, () => makeAction()), {
            wrapper: makeWrapper(true),
        });

        act(() => {
            result.current.onPointerEnter(makePointerEvent() as any);
        });
        expect(result.current.isHovered).toBe(true);

        act(() => {
            result.current.onPointerLeave(makePointerEvent() as any);
        });
        expect(result.current.isHovered).toBe(false);
    });

    it('isInteractive is false when blocked', () => {
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, () => makeAction()), {
            wrapper: makeWrapper(true),
        });
        expect(result.current.isInteractive).toBe(false);
    });

    it('isInteractive is true when not blocked', () => {
        const { result } = renderHook(() => useGameInteraction(ENTITY_ID, () => makeAction()), {
            wrapper: makeWrapper(false),
        });
        expect(result.current.isInteractive).toBe(true);
    });
});
