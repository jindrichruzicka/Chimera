import React from 'react';

const backgroundStyle = {
    minHeight: '100vh',
    width: '100%',
    height: '100%',
    background:
        'linear-gradient(to bottom, color-mix(in srgb, var(--ch-color-accent) 70%, var(--ch-color-surface)) 0%, var(--ch-color-surface-raised) 50%, var(--ch-color-surface) 100%)',
} satisfies React.CSSProperties;

export function TacticsShellBackground(): React.ReactElement {
    return <div data-testid="tactics-shell-background" style={backgroundStyle} />;
}
