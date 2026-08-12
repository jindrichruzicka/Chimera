'use client';

// renderer/components/scene/EngineLoadingPreset.tsx
//
// The engine-supplied loading covers (§4.36): the two string sentinels
// ('spinner' / 'progress') and the two static forms ({ message } / { image })
// a game may declare instead of writing a component. The moving parts come from
// the shared ui primitives: the motion is `Spinner`'s single global
// `ch-spinner-rotate` keyframe parameterised by `--ch-spinner-anim-*` tokens and
// collapses under `prefers-reduced-motion` without this module knowing that
// (Invariant #109 — reuse IS the compliance).

import React from 'react';
import type { CSSProperties } from 'react';
import type {
    GameLoadingImage,
    GameLoadingMessage,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { LOADING_KEYS } from '../../i18n/engine-keys';
import type { TranslateFn } from '../../i18n/i18n-context';
import { translationKey } from '../../i18n/translation-bundle';
import { useTranslate } from '../../i18n/useTranslate';
import { ProgressBar } from '../ui/ProgressBar';
import { Spinner } from '../ui/Spinner';

/** Every cover form the engine renders itself — the union minus the game's own component and the `'none'` opt-out. */
export type EngineLoadingPresetKind =
    | 'spinner'
    | 'progress'
    | GameLoadingMessage
    | GameLoadingImage;

export interface EngineLoadingPresetProps {
    /** Which engine preset the registry declared for this screen key. */
    readonly preset: EngineLoadingPresetKind;
    /**
     * Fraction in `[0, 1]` of the wait that has settled, or `null` when it is
     * not measured. `'progress'` degrades to the spinner for `null` rather than
     * drawing an empty bar.
     */
    readonly progress: number | null;
}

// Absolute inside the already-`position: relative` game-canvas section (see
// GameShell), mirroring the game-result banner: a cover must not eat clicks and
// must not push the HUD down by growing the canvas grid row. No z-index — the
// preset is a sibling inside the scene, not a route-level layer.
const engineLoadingPresetStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    pointerEvents: 'none',
};

const engineLoadingImageStyle: CSSProperties = {
    maxWidth: '100%',
    maxHeight: '100%',
};

export function EngineLoadingPreset({
    preset,
    progress,
}: EngineLoadingPresetProps): React.ReactElement {
    const t = useTranslate();
    // One accessible name across the presets: the spinner's and the bar's label
    // and an image cover's default alt all describe the same wait.
    const label = t(LOADING_KEYS.label);

    return (
        <div data-testid="scene-loading-preset" style={engineLoadingPresetStyle}>
            {renderPreset(preset, progress, label, t)}
        </div>
    );
}

function renderPreset(
    preset: EngineLoadingPresetKind,
    progress: number | null,
    label: string,
    t: TranslateFn,
): React.ReactElement {
    // NARROWING ORDER, same discipline as SceneLoadingFallback: the string
    // sentinels first, then the static object forms by their own field.
    if (preset === 'spinner') {
        return <Spinner label={label} />;
    }
    if (preset === 'progress') {
        // `max={1}` keeps the declared fraction the reported value — no percent
        // conversion, so aria-valuenow states exactly what the caller measured.
        return progress === null ? (
            <Spinner label={label} />
        ) : (
            <ProgressBar label={label} max={1} value={progress} />
        );
    }
    if ('message' in preset) {
        // `t` returns an unknown key unchanged, so one path serves both a
        // registered token and a literal a game wrote without shipping a bundle.
        return <p>{t(translationKey(preset.message))}</p>;
    }
    // A plain <img>, not next/image or PreloadedImage: the contract admits a
    // `chimera://` URL or a `data:` URI, which the Next image loader rewrites
    // and cannot serve, and a cover has no intrinsic dimensions to declare. The
    // decode-then-reveal wrapper would also hold the cover back behind the very
    // wait it exists to mask.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={preset.alt ?? label} src={preset.image} style={engineLoadingImageStyle} />;
}
