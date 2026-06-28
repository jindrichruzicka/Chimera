import type { PlayerId, PlayerProfile } from '@chimera-engine/simulation/bridge/api-types.js';
import { playerId } from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';

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
        [playerId('playerA')]: makeProfile('local-a', 'Alice'),
        [playerId('playerB')]: makeProfile('local-b', 'Bob'),
    };
}
