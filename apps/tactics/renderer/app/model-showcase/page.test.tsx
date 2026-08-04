// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tacticsAssetManifest } from '@chimera-engine/tactics/asset-manifest.js';
import TacticsModelShowcasePage from './page';

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

import { notFound as notFoundMock } from 'next/navigation';

// The screen mounts a real R3F Canvas, which needs WebGL; this suite is about
// the ROUTE — the gate, and what the route hands the asset session. The screen
// itself has its own co-located test.
vi.mock('@chimera-engine/tactics/screens/TacticsModelShowcaseScreen.js', () => ({
    TacticsModelShowcaseScreen: () => <div data-testid="tactics-model-showcase" />,
}));

const sessionCalls = vi.hoisted((): { readonly assetManifest: unknown }[] => []);

vi.mock('@chimera-engine/renderer/shell/gameAssetSession', () => ({
    GameAssetSession: ({
        assetManifest,
        children,
    }: {
        readonly assetManifest: unknown;
        readonly children: React.ReactNode;
    }) => {
        sessionCalls.push({ assetManifest });
        return <div data-testid="game-asset-session">{children}</div>;
    },
}));

afterEach(() => {
    cleanup();
    sessionCalls.length = 0;
    vi.unstubAllEnvs();
    vi.mocked(notFoundMock).mockClear();
});

describe('TacticsModelShowcasePage — packaged gate', () => {
    it('calls notFound() in the packaged production build', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_PACKAGED', '1');

        render(<TacticsModelShowcasePage />);

        expect(vi.mocked(notFoundMock)).toHaveBeenCalledOnce();
    });

    it('does not call notFound() in a non-packaged build', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_PACKAGED', '');

        render(<TacticsModelShowcasePage />);

        expect(vi.mocked(notFoundMock)).not.toHaveBeenCalled();
    });
});

describe('TacticsModelShowcasePage — composition', () => {
    it("opens a game asset session with THIS game's manifest", async () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_PACKAGED', '');

        render(<TacticsModelShowcasePage />);

        await waitFor(() => {
            expect(sessionCalls.length).toBeGreaterThanOrEqual(1);
        });
        // The manifest is what makes the showcase ref loadable at all — an
        // undeclared ref rejects UnknownAssetManifestEntryError.
        expect(sessionCalls[0]?.assetManifest).toBe(tacticsAssetManifest);
    });

    it('renders the showcase screen INSIDE the session, so useModelInstance resolves', async () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_PACKAGED', '');

        render(<TacticsModelShowcasePage />);

        await waitFor(() => {
            expect(screen.getByTestId('game-asset-session')).toContainElement(
                screen.getByTestId('tactics-model-showcase'),
            );
        });
    });
});
