'use client';

// renderer/components/ui/LanguageSelector.tsx
//
// Engine UI-barrel control for picking the active game's UI language. It renders
// the supplied `languages` (endonym labels), shows the current `value`, and calls
// `onLanguageChange` with the chosen BCP-47 code.
//
// PURE / presentational by design: it reads no store and dispatches nothing —
// the settings read/write is injected by the caller (a game HUD, or the shell's
// store-connected `SettingsLanguageSelector`). This keeps the public
// `components/ui` barrel side-effect-free (Invariant #96): importing a design
// primitive must never drag in `renderer/state/` or the IPC bridge. Its own
// accessible label comes from `useTranslate()` (React context — no store).
//
// Shown nowhere by default: a game mounts it wherever it wants. Single-language
// games (fewer than two `languages`) render `null`, so it is safe to drop in
// unconditionally.

import React from 'react';
import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { SETTINGS_KEYS } from '../../i18n/engine-keys';
import { useTranslate } from '../../i18n/useTranslate';
import { Select } from './Select';
import { ToggleButton } from './ToggleButton';
import styles from './LanguageSelector.module.css';

/** A game must supply at least this many languages for the selector to show. */
const MIN_LANGUAGES = 2;

export interface LanguageSelectorProps {
    /** The game's declared UI languages (endonym labels). Fewer than two ⇒ renders `null`. */
    readonly languages: readonly GameLanguage[];
    /** The active locale (BCP-47), i.e. the persisted `gameplay.language`. */
    readonly value: string;
    /** Called with the chosen language code when the player picks a language. */
    readonly onLanguageChange: (code: string) => void;
    readonly className?: string;
    /** `'select'` (default) or `'inline'` (segmented buttons) presentation. */
    readonly variant?: 'select' | 'inline';
}

export function LanguageSelector({
    languages,
    value,
    onLanguageChange,
    className,
    variant = 'select',
}: LanguageSelectorProps): React.ReactElement | null {
    const t = useTranslate();
    const label = t(SETTINGS_KEYS.language);

    // Self-hide for single-language games: safe to mount unconditionally.
    if (languages.length < MIN_LANGUAGES) {
        return null;
    }

    if (variant === 'inline') {
        const rootClassName = [styles['inlineRoot'], className].filter(Boolean).join(' ');
        return (
            <div className={rootClassName}>
                <span className={styles['inlineLabel']}>{label}</span>
                <div className={styles['inlineGroup']} role="radiogroup" aria-label={label}>
                    {languages.map((language) => (
                        <ToggleButton
                            key={language.code}
                            pressed={language.code === value}
                            onPressedChange={() => onLanguageChange(language.code)}
                        >
                            {language.label}
                        </ToggleButton>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <Select
            className={className}
            label={label}
            onValueChange={onLanguageChange}
            options={languages.map((language) => ({
                value: language.code,
                label: language.label,
            }))}
            value={value}
        />
    );
}
