'use client';

import React, {
    createContext,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    type ReactNode,
} from 'react';

/**
 * Shared renderer Escape/overlay stack (F55 · T6).
 *
 * Transient overlays (Modal, Drawer, …) register an Escape handler while open
 * and unregister on close. A single capture-phase `window` keydown listener
 * routes each Escape to the *top* registered layer, then suppresses further
 * propagation so the window-level InputManager does not also dispatch
 * `engine:toggle-menu`. When no layer is registered the listener does nothing,
 * letting Escape fall through to the InputManager (the in-game menu toggle is
 * the base layer — it fires only when the stack is empty).
 *
 * The capture phase runs before the InputManager's default-phase `window`
 * listener; this is required because input actions fire at the window level and
 * React's `stopPropagation` cannot suppress them.
 *
 * `useEscapeLayer` returns an {@link EscapeLayerHandle} whose `isTopLayer()`
 * lets a layer gate other keyboard behaviour on stack position — Modal keeps
 * its Tab focus trap active only while topmost, so nested modals (and non-Modal
 * layers such as the settings key-capture) own the keyboard while above it.
 *
 * Invariant #83: the context uses a `null` default with a throwing hook.
 */

interface EscapeLayer {
    readonly id: string;
    readonly onEscape: () => void;
}

interface EscapeStackApi {
    readonly register: (layer: EscapeLayer) => void;
    readonly unregister: (id: string) => void;
    readonly isTop: (id: string) => boolean;
}

/**
 * Handle returned by {@link useEscapeLayer}, letting a layer ask about its own
 * stack position. A Modal uses this to keep its Tab focus trap inert while
 * another overlay (a nested Modal, the key-capture layer, a Drawer) sits above
 * it — the top surface owns the keyboard.
 */
export interface EscapeLayerHandle {
    /** True while this layer is registered and is the top of the stack. */
    readonly isTopLayer: () => boolean;
}

const EscapeStackContext = createContext<EscapeStackApi | null>(null);

export interface EscapeStackProviderProps {
    readonly children: ReactNode;
}

export function EscapeStackProvider({ children }: EscapeStackProviderProps): React.ReactElement {
    const stackRef = useRef<EscapeLayer[]>([]);
    const apiRef = useRef<EscapeStackApi | null>(null);

    apiRef.current ??= {
        register(layer) {
            stackRef.current.push(layer);
        },
        unregister(id) {
            stackRef.current = stackRef.current.filter((layer) => layer.id !== id);
        },
        isTop(id) {
            const stack = stackRef.current;
            return stack[stack.length - 1]?.id === id;
        },
    };

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent): void {
            if (event.key !== 'Escape') return;

            const stack = stackRef.current;
            const top = stack[stack.length - 1];
            if (top === undefined) return;

            // Consume: close the top overlay and stop the InputManager (and any
            // other listener) from also acting on this Escape.
            event.preventDefault();
            event.stopImmediatePropagation();
            top.onEscape();
        }

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, []);

    return (
        <EscapeStackContext.Provider value={apiRef.current}>{children}</EscapeStackContext.Provider>
    );
}

/**
 * Register an Escape handler on the shared stack while `active` is true.
 *
 * The handler is invoked only when this layer is the top of the stack, so a
 * single Escape keydown is handled exactly once. `onEscape` need not be stable;
 * the latest reference is always used.
 *
 * Returns a stable {@link EscapeLayerHandle} so the caller can gate keyboard
 * behaviour (e.g. a focus trap) on being the topmost layer.
 */
export function useEscapeLayer(onEscape: () => void, active: boolean): EscapeLayerHandle {
    const api = useContext(EscapeStackContext);
    if (api === null) {
        throw new Error('useEscapeLayer() must be used within <EscapeStackProvider>.');
    }

    const id = useId();
    const onEscapeRef = useRef(onEscape);

    useEffect(() => {
        onEscapeRef.current = onEscape;
    }, [onEscape]);

    useEffect(() => {
        if (!active) return undefined;

        api.register({ id, onEscape: () => onEscapeRef.current() });
        return () => {
            api.unregister(id);
        };
    }, [active, api, id]);

    return useMemo(() => ({ isTopLayer: () => api.isTop(id) }), [api, id]);
}
