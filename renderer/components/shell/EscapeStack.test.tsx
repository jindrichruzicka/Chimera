// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EscapeStackProvider, useEscapeLayer, type EscapeLayerHandle } from './EscapeStack.js';

// Stand-ins for the window-level InputManager keydown listener (bubble phase).
// The EscapeStack provider attaches a capture-phase window listener, so these
// run *after* it and let us assert whether Escape fell through (base invoked)
// or was consumed (base not invoked).
const baseListeners: EventListener[] = [];

function addBaseHandler(): ReturnType<typeof vi.fn> {
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    baseListeners.push(spy);
    return spy;
}

afterEach(() => {
    for (const listener of baseListeners) {
        window.removeEventListener('keydown', listener);
    }
    baseListeners.length = 0;
    cleanup();
    vi.restoreAllMocks();
});

function Layer({
    onEscape,
    active,
}: {
    readonly onEscape: () => void;
    readonly active: boolean;
}): null {
    useEscapeLayer(onEscape, active);
    return null;
}

describe('EscapeStack', () => {
    it('throws a descriptive error when useEscapeLayer is used outside the provider', () => {
        expect(() => renderHook(() => useEscapeLayer(() => undefined, true))).toThrow(
            'useEscapeLayer() must be used within <EscapeStackProvider>.',
        );
    });

    it('defers to the base handler (does not consume Escape) when the stack is empty', () => {
        const base = addBaseHandler();

        render(
            <EscapeStackProvider>
                <Layer onEscape={vi.fn()} active={false} />
            </EscapeStackProvider>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(base).toHaveBeenCalledTimes(1);
    });

    it('closes the top layer and does not fall through to the base handler', () => {
        const base = addBaseHandler();
        const onEscape = vi.fn();

        render(
            <EscapeStackProvider>
                <Layer onEscape={onEscape} active />
            </EscapeStackProvider>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onEscape).toHaveBeenCalledTimes(1);
        expect(base).not.toHaveBeenCalled();
    });

    it('handles a single Escape exactly once, invoking only the most-recently-registered layer', () => {
        const first = vi.fn();
        const second = vi.fn();

        render(
            <EscapeStackProvider>
                <Layer onEscape={first} active />
                <Layer onEscape={second} active />
            </EscapeStackProvider>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });

    it('pops the layer when it deactivates so Escape again defers to the base handler', () => {
        const base = addBaseHandler();
        const onEscape = vi.fn();

        const { rerender } = render(
            <EscapeStackProvider>
                <Layer onEscape={onEscape} active />
            </EscapeStackProvider>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onEscape).toHaveBeenCalledTimes(1);
        expect(base).not.toHaveBeenCalled();

        rerender(
            <EscapeStackProvider>
                <Layer onEscape={onEscape} active={false} />
            </EscapeStackProvider>,
        );

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onEscape).toHaveBeenCalledTimes(1);
        expect(base).toHaveBeenCalledTimes(1);
    });

    it('ignores non-Escape keys so focus-trap handlers (e.g. Tab) still run', () => {
        const base = addBaseHandler();

        render(
            <EscapeStackProvider>
                <Layer onEscape={vi.fn()} active />
            </EscapeStackProvider>,
        );

        fireEvent.keyDown(document, { key: 'Tab' });

        expect(base).toHaveBeenCalledTimes(1);
    });
});

function HandleLayer({
    active,
    handles,
    name,
}: {
    readonly active: boolean;
    readonly handles: Map<string, EscapeLayerHandle>;
    readonly name: string;
}): null {
    handles.set(
        name,
        useEscapeLayer(() => undefined, active),
    );
    return null;
}

describe('useEscapeLayer handle', () => {
    it('reports it is the top layer while it is the only active layer', () => {
        const handles = new Map<string, EscapeLayerHandle>();

        render(
            <EscapeStackProvider>
                <HandleLayer active handles={handles} name="only" />
            </EscapeStackProvider>,
        );

        expect(handles.get('only')?.isTopLayer()).toBe(true);
    });

    it('reports not-top while inactive', () => {
        const handles = new Map<string, EscapeLayerHandle>();

        render(
            <EscapeStackProvider>
                <HandleLayer active={false} handles={handles} name="idle" />
            </EscapeStackProvider>,
        );

        expect(handles.get('idle')?.isTopLayer()).toBe(false);
    });

    it('reports not-top while a later layer sits above it, and top again once that layer deactivates', () => {
        const handles = new Map<string, EscapeLayerHandle>();

        const { rerender } = render(
            <EscapeStackProvider>
                <HandleLayer active handles={handles} name="below" />
                <HandleLayer active handles={handles} name="above" />
            </EscapeStackProvider>,
        );

        expect(handles.get('below')?.isTopLayer()).toBe(false);
        expect(handles.get('above')?.isTopLayer()).toBe(true);

        rerender(
            <EscapeStackProvider>
                <HandleLayer active handles={handles} name="below" />
                <HandleLayer active={false} handles={handles} name="above" />
            </EscapeStackProvider>,
        );

        expect(handles.get('below')?.isTopLayer()).toBe(true);
        expect(handles.get('above')?.isTopLayer()).toBe(false);
    });
});
