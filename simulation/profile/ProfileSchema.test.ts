/**
 * simulation/profile/ProfileSchema.test.ts
 *
 * Unit tests for ProfileSchema types and EngineProfileSchema Zod validator.
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T01 (issue #338)
 *
 * Tests written first (red) — implementation lands in ProfileSchema.ts.
 */

import { describe, expect, it } from 'vitest';
import { buildAssetRef } from '../content/AssetRef.js';
import type { TextureAsset } from '../content/AssetRef.js';
import { EngineProfileSchema, localProfileId } from './ProfileSchema.js';
import type {
    LocalProfileId,
    EngineProfile,
    AvatarSource,
    PlayerProfile,
    ProfileRepository,
} from './ProfileSchema.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const validBuiltinAvatar: AvatarSource = {
    kind: 'builtin',
    ref: buildAssetRef<TextureAsset>('tactics', 'textures/avatars/red.png'),
};

const validProfile: EngineProfile = {
    localProfileId: localProfileId('dev-p1'),
    displayName: 'Dev Player 1',
    avatar: validBuiltinAvatar,
    locale: 'en-US',
};

// ─── LocalProfileId branded factory ──────────────────────────────────────────

describe('localProfileId factory', () => {
    it('produces a LocalProfileId from a raw string', () => {
        const id: LocalProfileId = localProfileId('test-123');
        expect(id).toBe('test-123');
    });

    it('returned value is assignable to LocalProfileId type', () => {
        const id = localProfileId('profile-abc');
        // Type assertion: confirm id satisfies LocalProfileId at compile time
        const _check: LocalProfileId = id;
        expect(_check).toBe('profile-abc');
    });
});

// ─── EngineProfileSchema — valid inputs ──────────────────────────────────────

describe('EngineProfileSchema.parse() — valid inputs', () => {
    it('parses a valid profile with a builtin avatar', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.localProfileId).toBe('dev-p1');
            expect(result.data.displayName).toBe('Dev Player 1');
            expect(result.data.locale).toBe('en-US');
            expect(result.data.avatar).toEqual({
                kind: 'builtin',
                ref: 'tactics/textures/avatars/red.png',
            });
        }
    });

    it('parses a valid profile with a custom avatar', () => {
        const raw = {
            localProfileId: 'dev-p2',
            displayName: 'Dev Player 2',
            avatar: { kind: 'custom', mimeType: 'image/jpeg', base64: 'aGVsbG8=' },
            locale: 'fr-FR',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.avatar).toEqual({
                kind: 'custom',
                mimeType: 'image/jpeg',
                base64: 'aGVsbG8=',
            });
        }
    });

    it('parses a profile with image/png custom avatar', () => {
        const raw = {
            localProfileId: 'dev-p3',
            displayName: 'Dev Player 3',
            avatar: { kind: 'custom', mimeType: 'image/png', base64: 'dGVzdA==' },
            locale: 'de-DE',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(true);
    });
});

// ─── EngineProfileSchema — missing required fields ───────────────────────────

describe('EngineProfileSchema.parse() — rejects objects missing required fields', () => {
    it('rejects when localProfileId is missing', () => {
        const raw = {
            displayName: 'Dev Player 1',
            avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects when displayName is missing', () => {
        const raw = {
            localProfileId: 'dev-p1',
            avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects when avatar is missing', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects when locale is missing', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects an empty object', () => {
        const result = EngineProfileSchema.safeParse({});
        expect(result.success).toBe(false);
    });

    it('rejects null', () => {
        const result = EngineProfileSchema.safeParse(null);
        expect(result.success).toBe(false);
    });

    it('rejects undefined', () => {
        const result = EngineProfileSchema.safeParse(undefined);
        expect(result.success).toBe(false);
    });
});

// ─── EngineProfileSchema — invalid field values ───────────────────────────────

describe('EngineProfileSchema.parse() — rejects invalid field values', () => {
    it('rejects when localProfileId is not a string', () => {
        const raw = {
            localProfileId: 42,
            displayName: 'Dev Player 1',
            avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects when displayName is not a string', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 123,
            avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects avatar with unknown kind', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            avatar: { kind: 'external', url: 'https://example.com/avatar.png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects builtin avatar missing ref', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            avatar: { kind: 'builtin' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects custom avatar missing base64', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            avatar: { kind: 'custom', mimeType: 'image/png' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });

    it('rejects custom avatar with disallowed mimeType', () => {
        const raw = {
            localProfileId: 'dev-p1',
            displayName: 'Dev Player 1',
            avatar: { kind: 'custom', mimeType: 'image/gif', base64: 'aGVsbG8=' },
            locale: 'en-US',
        };
        const result = EngineProfileSchema.safeParse(raw);
        expect(result.success).toBe(false);
    });
});

// ─── Type structural checks ───────────────────────────────────────────────────

describe('type structural checks (compile-time assertions expressed as runtime guards)', () => {
    it('EngineProfile has all required fields', () => {
        const p: EngineProfile = validProfile;
        expect(p.localProfileId).toBeDefined();
        expect(p.displayName).toBeDefined();
        expect(p.avatar).toBeDefined();
        expect(p.locale).toBeDefined();
    });

    it('PlayerProfile is assignable from EngineProfile', () => {
        const p: PlayerProfile = validProfile;
        expect(p).toBeDefined();
    });

    it('ProfileRepository interface shape is satisfied by a minimal stub', () => {
        // A structural stub that satisfies ProfileRepository — confirms the interface
        // has the four expected methods.
        const stub: ProfileRepository = {
            load: async (_id: LocalProfileId) => null,
            save: async (_profile: PlayerProfile) => undefined,
            listLocalSlots: async () => [],
            delete: async (_id: LocalProfileId) => undefined,
        };
        expect(typeof stub.load).toBe('function');
        expect(typeof stub.save).toBe('function');
        expect(typeof stub.listLocalSlots).toBe('function');
        expect(typeof stub.delete).toBe('function');
    });
});
