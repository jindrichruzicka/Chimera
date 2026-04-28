import type { PlayerId, PlayerProfile } from '@chimera/electron/preload/api-types.js';
import type { AssetRef, TextureAsset } from '@chimera/simulation/content/AssetRef.js';

export function makeProfile(localProfileId: string, displayName: string): PlayerProfile {
    return {
        localProfileId,
        displayName,
        avatar: {
            kind: 'builtin',
            ref: 'tactics/avatars/default.webp' as AssetRef<TextureAsset>,
        },
        locale: 'en-US',
    };
}

export function makeDirectory(): Readonly<Record<PlayerId, PlayerProfile>> {
    return {
        playerA: makeProfile('local-a', 'Alice'),
        playerB: makeProfile('local-b', 'Bob'),
    };
}
