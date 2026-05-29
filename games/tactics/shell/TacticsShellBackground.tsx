import React from 'react';

const menuBackgroundStyles = `
.menu-bg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a12 70%);
    z-index: 0;
}

.menu-bg::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    height: 400px;
    background: radial-gradient(circle, rgba(147, 51, 234, 0.15) 0%, transparent 70%);
    animation: pulse 4s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
    50% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
}
`;

export function TacticsShellBackground(): React.ReactElement {
    return (
        <>
            <style>{menuBackgroundStyles}</style>
            <div data-testid="tactics-shell-background" className="menu-bg" />
        </>
    );
}
