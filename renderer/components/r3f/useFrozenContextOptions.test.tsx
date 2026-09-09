// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFrozenContextOptions } from './useFrozenContextOptions';
import type { WebGLContextOptions } from './rendererConfig';

let logEmit: ReturnType<typeof vi.fn>;

beforeEach(() => {
    logEmit = vi.fn();
    vi.stubGlobal('__chimera', { logs: { emit: logEmit } });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

/** The error entries the renderer log bridge received. */
function reportedErrors(): Record<string, unknown>[] {
    return logEmit.mock.calls
        .map(([entry]) => entry as Record<string, unknown>)
        .filter((entry) => entry['level'] === 'error');
}

/**
 * The refusal's own text — the Error's message, not the entry's summary line.
 * That is where the changed key names are, and naming them is what makes the
 * refusal actionable rather than merely visible.
 */
function refusalText(entry: Record<string, unknown> | undefined): string {
    const error = entry?.['error'];
    return typeof error === 'object' && error !== null
        ? String((error as Record<string, unknown>)['message'])
        : '';
}

function Probe({ options }: { readonly options: WebGLContextOptions | undefined }): null {
    frozen = useFrozenContextOptions(options);
    return null;
}

let frozen: WebGLContextOptions | undefined;

describe('useFrozenContextOptions', () => {
    it('hands back the options the canvas mounted with', () => {
        render(<Probe options={{ antialias: false, stencil: true }} />);

        expect(frozen).toEqual({ antialias: false, stencil: true });
    });

    it('hands back undefined when the game authored no context options', () => {
        render(<Probe options={undefined} />);

        expect(frozen).toBeUndefined();
    });

    // The whole point of the frozen half: a WebGL context's attributes are
    // fixed when the context is built, so a later value can only be refused.
    it('keeps the mount value when a later render passes a different one', () => {
        const { rerender } = render(<Probe options={{ antialias: true }} />);

        rerender(<Probe options={{ antialias: false }} />);

        expect(frozen).toEqual({ antialias: true });
    });

    it('refuses the change observably, by name, through the renderer logger', () => {
        const { rerender } = render(<Probe options={{ antialias: true }} />);

        rerender(<Probe options={{ antialias: false }} />);

        const [report] = reportedErrors();
        expect(report?.['error']).toMatchObject({ name: 'ContextOptionsAfterMountError' });
        expect(refusalText(report)).toContain('antialias');
    });

    it('reports nothing while the authored options are unchanged', () => {
        const { rerender } = render(<Probe options={{ antialias: true, alpha: false }} />);

        // A fresh object with equal contents is what a caller writing the
        // options inline passes on every render. Refusing THAT would report a
        // change no player made.
        rerender(<Probe options={{ antialias: true, alpha: false }} />);

        expect(reportedErrors()).toHaveLength(0);
    });

    it('names every key that differs, not just the first', () => {
        const { rerender } = render(<Probe options={{ antialias: true, stencil: false }} />);

        rerender(<Probe options={{ antialias: false, stencil: true }} />);

        const [report] = reportedErrors();
        expect(refusalText(report)).toContain('antialias');
        expect(refusalText(report)).toContain('stencil');
    });

    // Dropping a key is a change too: `{}` asks for r3f's default where the
    // mount asked for something else, and the context cannot be rebuilt.
    it('refuses a key that is dropped as well as one that is rewritten', () => {
        const { rerender } = render(<Probe options={{ preserveDrawingBuffer: true }} />);

        rerender(<Probe options={{}} />);

        expect(refusalText(reportedErrors()[0])).toContain('preserveDrawingBuffer');
    });

    // powerPreference is the one option whose values are names rather than
    // booleans, and the only one no other case drives through the drift
    // comparison — without this, dropping it from WEBGL_CONTEXT_OPTION_KEYS
    // leaves every test green and a real change silently accepted.
    it('refuses a changed powerPreference, the one option that is a name', () => {
        const { rerender } = render(<Probe options={{ powerPreference: 'high-performance' }} />);

        rerender(<Probe options={{ powerPreference: 'low-power' }} />);

        expect(refusalText(reportedErrors()[0])).toContain('powerPreference');
        expect(frozen).toEqual({ powerPreference: 'high-performance' });
    });

    // The guard that keeps a return to the MOUNT value quiet. Without it the
    // effect reports again with an empty key list — "changed after mount ()"
    // — for a value that matches the mount exactly.
    it('reports nothing when a later render returns to the mounted value', () => {
        const { rerender } = render(<Probe options={{ antialias: true }} />);
        rerender(<Probe options={{ antialias: false }} />);

        rerender(<Probe options={{ antialias: true }} />);

        expect(reportedErrors()).toHaveLength(1);
    });

    // "Once per change" means once per TRANSITION into a rejected value, not
    // once per distinct rejected value ever seen. A game that toggles back to
    // the mounted value and away again has made two changes that cannot take
    // effect, and silently accepting the second is the failure mode this hook
    // exists to prevent.
    it('refuses a rejected value again after a render returned to the mounted one', () => {
        const { rerender } = render(<Probe options={{ antialias: true }} />);
        rerender(<Probe options={{ antialias: false }} />);
        rerender(<Probe options={{ antialias: true }} />);

        rerender(<Probe options={{ antialias: false }} />);

        expect(reportedErrors()).toHaveLength(2);
    });

    it('reports once per change rather than on every later render', () => {
        const { rerender } = render(<Probe options={{ alpha: true }} />);

        rerender(<Probe options={{ alpha: false }} />);
        rerender(<Probe options={{ alpha: false }} />);

        expect(reportedErrors()).toHaveLength(1);
    });
});
