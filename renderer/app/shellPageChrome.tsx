'use client';

/**
 * renderer/app/shellPageChrome.tsx
 *
 * The chrome a game's own shell page composes (§4.37.17). A game page is a
 * PHYSICAL Next route in the game's own host tree
 * (`apps/<game>/renderer/app/<route>/page.tsx`); this module is what makes it
 * look like one of the engine's own — the settings-style permanently-open modal
 * over the shell background, with the same Escape handling and the same exit
 * back to the main menu.
 *
 * Reached from the game's host tree as
 * `@chimera-engine/renderer/shell/shellPageChrome`, the composition-module half
 * of the `shell/*` allowance `gameAssetSession` already uses (Invariant #96) —
 * so a game page composes engine chrome without importing a renderer internal.
 * Like every engine shell page it imports no `apps/*` (Invariant #94).
 *
 * The page owns its BODY and nothing else: geometry, action row and exit are
 * declarations, and the default exit is the one every engine shell page uses —
 * back to `/main-menu` with the URL's `?gameId=` carried along, so the game's
 * menu, fonts and background keep resolving on arrival.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 */

import React from 'react';
import { useRouter } from 'next/navigation';

import { Modal, type ModalAction, type ModalSize } from '../components/ui/Modal';
import { resolveShellGameId, withShellGameId } from '../shell/resolveMainMenuGameId';

export interface ShellPageChromeProps {
    /** The dialog title. A translation token resolves through the page's own `t()`. */
    readonly title: React.ReactNode;
    /** The page body. */
    readonly children: React.ReactNode;
    /**
     * The right-aligned control row. Omitted ⇒ a single `Close` control that
     * runs the exit below, exactly like a bare {@link Modal}.
     */
    readonly actions?: readonly ModalAction[];
    /** Dialog geometry preset; defaults to `lg`, the engine browser/workspace size. */
    readonly size?: ModalSize;
    /** Pins the dialog to one block-size so a body swap never resizes it. */
    readonly fixedHeight?: boolean;
    /**
     * Replaces the default exit — the Close control, a dismissing action and
     * Escape all run this instead. A page that takes this over navigates for
     * itself; the chrome then pushes nothing.
     */
    readonly onClose?: () => void;
    /** Forwarded to the dialog element. */
    readonly 'data-testid'?: string;
    /** Forwarded to the action row. */
    readonly actionsTestId?: string;
}

/**
 * The active game id as the PAGE's own URL declares it. Read at exit time
 * rather than resolved into state on mount: the value is only ever needed at
 * the moment of the hop, and reading it then cannot go stale.
 */
function currentShellGameId(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    return resolveShellGameId(new URLSearchParams(window.location.search));
}

export function ShellPageChrome({
    title,
    children,
    actions,
    size = 'lg',
    fixedHeight = false,
    onClose,
    'data-testid': dataTestId,
    actionsTestId,
}: ShellPageChromeProps): React.ReactElement {
    const router = useRouter();

    const handleClose = React.useCallback((): void => {
        if (onClose !== undefined) {
            onClose();
            return;
        }
        router.push(withShellGameId('/main-menu', currentShellGameId()));
    }, [onClose, router]);

    return (
        <Modal
            open
            title={title}
            onClose={handleClose}
            size={size}
            fixedHeight={fixedHeight}
            {...(actions === undefined ? {} : { actions })}
            {...(actionsTestId === undefined ? {} : { actionsTestId })}
            {...(dataTestId === undefined ? {} : { 'data-testid': dataTestId })}
        >
            {children}
        </Modal>
    );
}
