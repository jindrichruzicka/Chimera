// @vitest-environment jsdom
// renderer/app/logo-screen/page.test.tsx

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LogoScreenPage from './page';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

function setLogoScreenUrl(search = ''): void {
    window.history.replaceState({}, '', `/logo-screen${search}`);
}

beforeEach(() => {
    mockPush.mockReset();
    setLogoScreenUrl();
    // jsdom does not implement HTMLMediaElement.play(); the spy silences the
    // "Not implemented" virtual-console error.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
    setLogoScreenUrl();
    vi.restoreAllMocks();
});

describe('LogoScreenPage', () => {
    it('renders the engine brand video', () => {
        render(<LogoScreenPage />);

        expect(screen.getByTestId('logo-video')).toHaveAttribute('src', '/chimera_logo.mp4');
    });

    it('continues to the main menu preserving the shell gameId', async () => {
        setLogoScreenUrl('?gameId=tactics');
        render(<LogoScreenPage />);

        fireEvent.click(window);

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/main-menu?gameId=tactics'));
        expect(mockPush).toHaveBeenCalledTimes(1);
    });

    it('continues to the main menu without a gameId when none is present', async () => {
        render(<LogoScreenPage />);

        fireEvent.click(window);

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/main-menu'));
    });

    it('navigates exactly once across repeated triggers', async () => {
        setLogoScreenUrl('?gameId=tactics');
        render(<LogoScreenPage />);

        fireEvent.click(window);
        fireEvent.ended(screen.getByTestId('logo-video'));
        fireEvent.keyDown(window, { key: 'Enter' });

        await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1));
        await act(async () => {});
        expect(mockPush).toHaveBeenCalledTimes(1);
    });
});
