'use client';
// renderer/hooks/useGameInteraction.ts
//
// R3F pointer interaction hook for §4.23.
// Reads InteractionContext to gate click dispatching;
// hover state is always local (invariant #58).
// Issue: #551

import { useCallback, useDebugValue, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { EntityId, EngineAction } from '@chimera-engine/simulation/bridge/api-types.js';
import { useSendAction } from '../bridge/useSendAction.js';
import { useInteractionContext } from '../components/r3f/interactionContext.js';

export interface InteractionHandlers {
    onClick: (e: ThreeEvent<MouseEvent>) => void;
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => void;
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => void;
    /** false when InteractionContext.isBlocked */
    isInteractive: boolean;
    /** local useState — never stored externally (invariant #58) */
    isHovered: boolean;
}

/**
 * Returns R3F event handlers for an interactive entity.
 * Reads {@link InteractionBlocker} context; no-ops click when blocked.
 * Hover state continues updating even when blocked (prevents highlight artifacts).
 *
 * @param entityId - Entity this interaction belongs to; exposed in React DevTools diagnostics.
 * @param actionBuilder - Called on each unblocked click to produce the action to dispatch.
 */
export function useGameInteraction(
    entityId: EntityId,
    actionBuilder: () => EngineAction,
): InteractionHandlers {
    const { isBlocked } = useInteractionContext();
    const sendAction = useSendAction();
    const [isHovered, setIsHovered] = useState(false);

    useDebugValue({ entityId, isBlocked });

    const onClick = useCallback(
        (e: ThreeEvent<MouseEvent>): void => {
            e.stopPropagation();
            if (isBlocked) {
                return;
            }
            sendAction(actionBuilder());
        },
        [isBlocked, sendAction, actionBuilder],
    );

    const onPointerEnter = useCallback((_e: ThreeEvent<PointerEvent>): void => {
        setIsHovered(true);
    }, []);

    const onPointerLeave = useCallback((_e: ThreeEvent<PointerEvent>): void => {
        setIsHovered(false);
    }, []);

    return {
        onClick,
        onPointerEnter,
        onPointerLeave,
        isInteractive: !isBlocked,
        isHovered,
    };
}
