// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@chimera-engine/renderer/i18n';
import type { PlayerSnapshot } from '@chimera-engine/simulation/foundation/snapshot-contract.js';
import type { AssetRef } from '@chimera-engine/simulation/content/AssetRef.js';
import { TacticsAssetDemoScreen } from './TacticsAssetDemoScreen.js';

afterEach(cleanup);

/**
 * Only the fields this screen reads. The projection carries ten more; building
 * them here would assert nothing and would rot with the contract.
 */
function snapshotWith(refs: readonly AssetRef[] | undefined): PlayerSnapshot {
    return { sceneRequiredAssets: refs } as unknown as PlayerSnapshot;
}

/**
 * A bare `I18nProvider` carries no game bundle, so `t` would hand every
 * `game.tactics.*` key back unchanged. The overrides stand in for the real
 * `en.ts` entries, which their own parity test owns.
 */
const COPY = {
    'game.tactics.scene.assetDemoHeading': 'Scene assets',
    'game.tactics.scene.assetDemoEmpty': 'This scene declared no assets.',
} as const;

function renderScreen(refs: readonly AssetRef[] | undefined): void {
    render(
        <I18nProvider gameOverride={COPY}>
            <TacticsAssetDemoScreen snapshot={snapshotWith(refs)} sendAction={() => undefined} />
        </I18nProvider>,
    );
}

describe('TacticsAssetDemoScreen', () => {
    it('lists every ref the entered scene declared, in declaration order', () => {
        renderScreen([
            'tactics/models/showcase-rig.glb' as AssetRef,
            'tactics/audio/sfx/step.wav' as AssetRef,
        ]);

        const items = screen.getAllByRole('listitem').map((node) => node.textContent);

        expect(items).toEqual(['tactics/models/showcase-rig.glb', 'tactics/audio/sfx/step.wav']);
    });

    it('reads the refs off the snapshot rather than off a constant', () => {
        // A different list must render differently — otherwise the case above
        // would hold against a screen that printed the scene's refs from an
        // import instead of from the snapshot channel.
        renderScreen(['tactics/audio/sfx/reveal.wav' as AssetRef]);

        expect(screen.getAllByRole('listitem').map((node) => node.textContent)).toEqual([
            'tactics/audio/sfx/reveal.wav',
        ]);
    });

    it('says so when the snapshot carries an empty list', () => {
        renderScreen([]);

        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByText('This scene declared no assets.')).toBeInTheDocument();
    });

    it('says so when the snapshot omits the field entirely', () => {
        // `sceneRequiredAssets` is optional on the contract, and a snapshot
        // taken before the field existed omits it. Absent and empty are the
        // same story to a reader, and neither may throw.
        renderScreen(undefined);

        expect(screen.queryAllByRole('listitem')).toHaveLength(0);
        expect(screen.getByText('This scene declared no assets.')).toBeInTheDocument();
    });

    it('resolves its heading through the translator', () => {
        // A DIFFERENT string from `COPY`'s, so a heading hardcoded in the
        // component rather than routed through `t` fails here.
        render(
            <I18nProvider gameOverride={{ 'game.tactics.scene.assetDemoHeading': 'Assets here' }}>
                <TacticsAssetDemoScreen snapshot={snapshotWith([])} sendAction={() => undefined} />
            </I18nProvider>,
        );

        expect(screen.getByText('Assets here')).toBeInTheDocument();
    });
});
