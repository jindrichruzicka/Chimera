// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render as baseRender } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { ReplayExportToastBridge } from './ReplayExportToastBridge';
import { I18nProvider } from '../../i18n/I18nProvider';
import { useToastStore } from '../../state/toastStore';

// The bridge calls useTranslate(), which throws outside I18nProvider; the inert
// provider resolves engine English so the existing toast-title assertions hold.
const render = (ui: React.ReactElement): ReturnType<typeof baseRender> =>
    baseRender(ui, { wrapper: I18nProvider });

function installReplayBridge(replay: Partial<ReplayAPI>): void {
    Object.defineProperty(window, '__chimera', { configurable: true, value: { replay } });
}

beforeEach(() => {
    useToastStore.getState().dismissAll();
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('ReplayExportToastBridge', () => {
    it('subscribes to onExported and pushes a success "Replay saved" toast on export', () => {
        const onExported = vi.fn((_listener: (path: string) => void) => () => undefined);
        installReplayBridge({ onExported });

        render(<ReplayExportToastBridge />);

        expect(onExported).toHaveBeenCalledOnce();
        const listener = onExported.mock.calls[0]?.[0];
        listener?.('/replays/tactics/abc.chimera-replay');

        const queue = useToastStore.getState().queue;
        expect(queue).toHaveLength(1);
        expect(queue[0]!.severity).toBe('success');
        expect(queue[0]!.title).toBe('Replay saved');
        // Invariant #74: static content — the pushed path is not surfaced.
        expect(queue[0]!.body).toBeUndefined();
    });

    it('resolves the toast title through the active-locale translator', () => {
        const onExported = vi.fn((_listener: (path: string) => void) => () => undefined);
        installReplayBridge({ onExported });

        baseRender(
            <I18nProvider gameOverride={{ 'engine.toast.replaySaved': 'Replay stored' }}>
                <ReplayExportToastBridge />
            </I18nProvider>,
        );
        onExported.mock.calls[0]?.[0]?.('/replays/tactics/abc.chimera-replay');

        expect(useToastStore.getState().queue[0]!.title).toBe('Replay stored');
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        installReplayBridge({ onExported: vi.fn(() => unsubscribe) });

        const { unmount } = render(<ReplayExportToastBridge />);
        expect(unsubscribe).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('renders nothing and no-ops when the bridge is absent', () => {
        const { container } = render(<ReplayExportToastBridge />);
        expect(container).toBeEmptyDOMElement();
        expect(useToastStore.getState().queue).toHaveLength(0);
    });
});
