'use client';

import React from 'react';
import { Caption, Panel } from '@chimera-engine/renderer/components/ui';
import type { GameScreenProps } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { useTranslate } from '@chimera-engine/renderer/i18n';
import { SCENE_KEYS } from '../shell/translations/keys.js';

/**
 * The screen behind the contributed `tactics:asset-demo` scene (§4.10).
 *
 * It renders the entered scene's declared refs, read off the SNAPSHOT rather
 * than off the descriptor it imports — that read is the whole point. A scene's
 * `requiredAssets` are declared in the main process, and the registry holding
 * them never leaves it; the renderer sees them only because the commit reducer
 * copies them onto `sceneRequiredAssets`. Printing them here is what makes that
 * channel observable end to end.
 *
 * Deliberately DOM-only: it resolves no asset and mounts no canvas, so what it
 * shows is what the snapshot said, not what a loader happened to have cached.
 */
export function TacticsAssetDemoScreen({ snapshot }: GameScreenProps): React.ReactElement {
    const t = useTranslate();
    const requiredAssets = snapshot.sceneRequiredAssets ?? [];

    return (
        <Panel data-testid="tactics-asset-demo">
            <Caption>{t(SCENE_KEYS.assetDemoHeading)}</Caption>
            {requiredAssets.length === 0 ? (
                <Caption tone="muted">{t(SCENE_KEYS.assetDemoEmpty)}</Caption>
            ) : (
                <ul>
                    {requiredAssets.map((ref) => (
                        <li key={ref}>{ref}</li>
                    ))}
                </ul>
            )}
        </Panel>
    );
}

export default TacticsAssetDemoScreen;
