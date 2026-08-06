// Implements the `window.__chimera.content` namespace (§4.8). A single generic,
// game-AGNOSTIC query: given a gameId, return that game's content collections as
// plain data (`Record<collectionType, items[]>`), or null when the game declares
// no content. The renderer never interprets the items — the authoring game does.
//
// Channel names are declared here rather than in the contract package; the
// reason is stated once, in `electron/preload/api.ts`.

import type { ContentAPI, GameContent } from '../api-types.js';
import { NullableGameContentSchema, parseInvokeResponse } from '../shared/schemas.js';

/** `ipcRenderer.invoke` target for {@link ContentAPI.getCollections}. */
export const CONTENT_GET_COLLECTIONS_CHANNEL = 'chimera:content:get-collections';

/** Narrow port over `ipcRenderer` — the content namespace only invokes. */
export interface ContentApiIpcPort {
    invoke(channel: string, arg?: unknown): Promise<unknown>;
}

/**
 * Build the `window.__chimera.content` namespace. The caller supplies the
 * `ipcRenderer` port so the factory has no hidden dependency on the Electron
 * module graph.
 */
export function createContentApi(ipc: ContentApiIpcPort): ContentAPI {
    return {
        getCollections: (gameId: string): Promise<GameContent | null> =>
            ipc
                .invoke(CONTENT_GET_COLLECTIONS_CHANNEL, { gameId })
                .then((value) =>
                    parseInvokeResponse(
                        NullableGameContentSchema,
                        CONTENT_GET_COLLECTIONS_CHANNEL,
                        value,
                    ),
                ),
    };
}
