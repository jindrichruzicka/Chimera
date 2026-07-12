// Hardware-cursor token injector for game-declared cursor textures
// (`LoadedRendererGameShell.cursor`, typed from the `GameManifest` cursor
// contract). Runs as a side-effect of game registry initialisation (Invariant
// #93): each declared texture is resolved through the game-asset protocol
// (`chimera://renderer/game-assets/...`, Invariant #97), pre-decoded through
// the shell image-warmup seam so the first paint never flashes the system
// cursor, and written over the engine's `--ch-cursor-<role>` token as an
// inline style on the document root — which outranks the `:root` token
// declarations without any specificity games. No declaration ⇒ strict no-op:
// the document is left untouched, so a later cursor-less game load keeps any
// previously injected overrides (accepted while apps register a single game).
// Shell-internal on purpose: not exported from any renderer barrel (Invariant
// #96); games reach it exclusively through their registration data.

import type {
    GameCursorImage,
    GameCursorRole,
} from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import { DEFAULT_CURSOR_HOTSPOT } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { warmGameImages } from './GameImageWarmup';
import { resolveGameShellAssetPath } from './gameShellAssetSource';

/** A game's cursor declaration — the `GameManifest.cursor` field, verbatim. */
export type GameCursorDeclaration = Partial<Record<GameCursorRole, GameCursorImage>>;

/**
 * CSS keyword appended after each `url(...)` texture so a role degrades to
 * the engine's stock cursor when the texture cannot be used. Matches the
 * `--ch-cursor-*` defaults in `renderer/styles/tokens.css`.
 */
const GAME_CURSOR_FALLBACKS: Record<GameCursorRole, string> = {
    default: 'auto',
    pointer: 'pointer',
    disabled: 'not-allowed',
};

const GAME_CURSOR_ROLES = Object.keys(GAME_CURSOR_FALLBACKS) as readonly GameCursorRole[];

/**
 * Resolve a game's declared cursor textures and override the `--ch-cursor-*`
 * tokens with `url(<resolved>) <hotspot-x> <hotspot-y>, <role-fallback>`
 * values. All declared textures are validated/resolved up front — a malformed
 * declaration throws before any warm-up or token write, never applying a
 * partial set. Warm-up itself stays best-effort: a texture that fails to
 * decode warns and the override still applies (the CSS fallback keyword
 * covers a genuinely broken texture).
 */
export async function applyGameCursorOverrides(
    gameId: string,
    cursor: GameCursorDeclaration | undefined,
): Promise<void> {
    if (cursor === undefined) {
        return;
    }

    const declared = GAME_CURSOR_ROLES.flatMap((role) => {
        const image = cursor[role];
        return image === undefined ? [] : [{ role, image }];
    });
    if (declared.length === 0) {
        return;
    }

    const overrides = declared.map(({ role, image }) => {
        const url = resolveGameShellAssetPath(gameId, image.image, 'cursor');
        const hotspot = image.hotspot ?? DEFAULT_CURSOR_HOTSPOT;
        return {
            token: `--ch-cursor-${role}`,
            value: `url(${url}) ${hotspot.x} ${hotspot.y}, ${GAME_CURSOR_FALLBACKS[role]}`,
        };
    });

    if (typeof document === 'undefined') {
        return;
    }

    await warmGameImages(declared.map(({ image }) => `${gameId}/${image.image}`));

    for (const { token, value } of overrides) {
        document.documentElement.style.setProperty(token, value);
    }
}
