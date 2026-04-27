/**
 * simulation/profile/ProfileSanitizer.test.ts
 *
 * Unit tests for ProfileSanitizer.admit() — the host-side trust gate.
 * Architecture: §4.24 — Player Profiles & Directory
 * Task: F14-T02 (issue #339)
 *
 * Tests written first (red) — implementation lands in ProfileSanitizer.ts.
 *
 * Invariants verified:
 *   #2  — zero imports from renderer/, electron/, games/*, or DOM APIs
 *   #61 — admit() is the mandatory gate; all 7 rejection types covered
 */

import { describe, expect, it } from 'vitest';
import {
    admit,
    MAX_DISPLAY_NAME_LENGTH,
    MAX_CUSTOM_AVATAR_BYTES,
    ALLOWED_AVATAR_MIME_TYPES,
    RESERVED_ID_PREFIXES,
} from './ProfileSanitizer.js';
import type { AdmissionRejection, AdmissionResult } from './ProfileSanitizer.js';
import type { PlayerProfile } from './ProfileSchema.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

// NOTE: admit() validates image magic bytes only — it does NOT full-decode the
// image (too expensive for a host-side trust gate). The architecture §4.24
// documents this as the intended contract. Fixtures below therefore use
// magic-prefix-only buffers, not fully valid PNG/JPEG files.

/**
 * Returns a Buffer whose first bytes are the PNG magic bytes, with `extraBytes`
 * of zero-padding appended. Used to synthesise payloads of arbitrary size.
 */
function makePngMagicPrefixBytes(extraBytes = 0): Buffer {
    const buf = Buffer.alloc(8 + extraBytes);
    buf[0] = 0x89;
    buf[1] = 0x50;
    buf[2] = 0x4e;
    buf[3] = 0x47;
    buf[4] = 0x0d;
    buf[5] = 0x0a;
    buf[6] = 0x1a;
    buf[7] = 0x0a;
    return buf;
}

/**
 * Returns a Buffer whose first bytes are the JPEG SOI magic bytes (FF D8 FF),
 * with `extraBytes` of zero-padding appended.
 */
function makeJpegMagicPrefixBytes(extraBytes = 0): Buffer {
    const buf = Buffer.alloc(3 + extraBytes);
    buf[0] = 0xff;
    buf[1] = 0xd8;
    buf[2] = 0xff;
    return buf;
}

// Magic-bytes-only base64 strings (not full images — see NOTE above).
const pngMagicOnlyBase64 = makePngMagicPrefixBytes().toString('base64');
const jpegMagicOnlyBase64 = makeJpegMagicPrefixBytes().toString('base64');

/** A valid attestation object with a builtin avatar. */
function makeBuiltinAttestation(overrides: Record<string, unknown> = {}): unknown {
    return {
        localProfileId: 'player-abc',
        displayName: 'Test Player',
        avatar: { kind: 'builtin', ref: 'tactics/textures/avatars/red.png' },
        locale: 'en-US',
        ...overrides,
    };
}

/** A valid attestation object with a custom PNG avatar. */
function makeCustomPngAttestation(overrides: Record<string, unknown> = {}): unknown {
    return {
        localProfileId: 'player-abc',
        displayName: 'Test Player',
        avatar: { kind: 'custom', mimeType: 'image/png', base64: pngMagicOnlyBase64 },
        locale: 'en-US',
        ...overrides,
    };
}

/** A valid attestation object with a custom JPEG avatar. */
function makeCustomJpegAttestation(overrides: Record<string, unknown> = {}): unknown {
    return {
        localProfileId: 'player-abc',
        displayName: 'Test Player',
        avatar: { kind: 'custom', mimeType: 'image/jpeg', base64: jpegMagicOnlyBase64 },
        locale: 'en-US',
        ...overrides,
    };
}

/** Extracts the reason from a rejection result, throws if result was ok. */
function getReason(result: AdmissionResult): AdmissionRejection {
    if (result.ok) {
        throw new Error('Expected a rejection but got ok=true');
    }
    return result.reason;
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('exported constants', () => {
    it('MAX_DISPLAY_NAME_LENGTH is 32', () => {
        expect(MAX_DISPLAY_NAME_LENGTH).toBe(32);
    });

    it('MAX_CUSTOM_AVATAR_BYTES is 64 KB (65536)', () => {
        expect(MAX_CUSTOM_AVATAR_BYTES).toBe(65536);
    });

    it('ALLOWED_AVATAR_MIME_TYPES contains image/png and image/jpeg', () => {
        expect(ALLOWED_AVATAR_MIME_TYPES).toContain('image/png');
        expect(ALLOWED_AVATAR_MIME_TYPES).toContain('image/jpeg');
        expect(ALLOWED_AVATAR_MIME_TYPES).toHaveLength(2);
    });

    it('RESERVED_ID_PREFIXES is non-empty', () => {
        expect(RESERVED_ID_PREFIXES.length).toBeGreaterThan(0);
    });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('admit() — happy path', () => {
    it('admits a valid attestation with a builtin avatar', () => {
        const result = admit(makeBuiltinAttestation());
        expect(result.ok).toBe(true);
    });

    it('returns the profile with correct fields on success (builtin avatar)', () => {
        const result = admit(makeBuiltinAttestation());
        if (!result.ok) throw new Error('Expected ok=true');
        expect(result.profile.localProfileId).toBe('player-abc');
        expect(result.profile.displayName).toBe('Test Player');
        expect(result.profile.locale).toBe('en-US');
        expect(result.profile.avatar).toEqual({
            kind: 'builtin',
            ref: 'tactics/textures/avatars/red.png',
        });
    });

    it('admits a valid attestation with a custom PNG avatar', () => {
        const result = admit(makeCustomPngAttestation());
        expect(result.ok).toBe(true);
    });

    it('returns the profile with correct fields on success (custom PNG avatar)', () => {
        const result = admit(makeCustomPngAttestation());
        if (!result.ok) throw new Error('Expected ok=true');
        expect(result.profile.avatar).toEqual({
            kind: 'custom',
            mimeType: 'image/png',
            base64: pngMagicOnlyBase64,
        });
    });

    it('admits a valid attestation with a custom JPEG avatar', () => {
        const result = admit(makeCustomJpegAttestation());
        expect(result.ok).toBe(true);
    });

    it('admits when displayName is exactly MAX_DISPLAY_NAME_LENGTH characters', () => {
        const name = 'A'.repeat(MAX_DISPLAY_NAME_LENGTH);
        const result = admit(makeBuiltinAttestation({ displayName: name }));
        expect(result.ok).toBe(true);
    });

    it('admits when custom avatar decoded bytes are exactly MAX_CUSTOM_AVATAR_BYTES', () => {
        // Build a PNG-magic-bytes-prefixed buffer of exactly 64 KB
        const buf = makePngMagicPrefixBytes(MAX_CUSTOM_AVATAR_BYTES - 8);
        const result = admit(
            makeCustomPngAttestation({
                avatar: { kind: 'custom', mimeType: 'image/png', base64: buf.toString('base64') },
            }),
        );
        expect(result.ok).toBe(true);
    });

    it('never throws — returns ok:false instead of throwing on any input', () => {
        const weirdInputs = [null, undefined, 0, false, [], 'string', Symbol()];
        for (const input of weirdInputs) {
            expect(() => admit(input)).not.toThrow();
        }
    });
});

// ─── SCHEMA_MISMATCH ──────────────────────────────────────────────────────────

describe('admit() — SCHEMA_MISMATCH', () => {
    it('rejects null with SCHEMA_MISMATCH', () => {
        expect(getReason(admit(null))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects undefined with SCHEMA_MISMATCH', () => {
        expect(getReason(admit(undefined))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects a primitive (number) with SCHEMA_MISMATCH', () => {
        expect(getReason(admit(42))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects an empty object with SCHEMA_MISMATCH', () => {
        expect(getReason(admit({}))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects when localProfileId is missing', () => {
        const { localProfileId: _omit, ...rest } = makeBuiltinAttestation() as Record<
            string,
            unknown
        >;
        expect(getReason(admit(rest))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects when displayName is missing', () => {
        const { displayName: _omit, ...rest } = makeBuiltinAttestation() as Record<string, unknown>;
        expect(getReason(admit(rest))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects when avatar is missing', () => {
        const { avatar: _omit, ...rest } = makeBuiltinAttestation() as Record<string, unknown>;
        expect(getReason(admit(rest))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects when locale is missing', () => {
        const { locale: _omit, ...rest } = makeBuiltinAttestation() as Record<string, unknown>;
        expect(getReason(admit(rest))).toBe('SCHEMA_MISMATCH');
    });

    it('rejects when localProfileId is not a string', () => {
        expect(getReason(admit(makeBuiltinAttestation({ localProfileId: 123 })))).toBe(
            'SCHEMA_MISMATCH',
        );
    });

    it('rejects when displayName is not a string', () => {
        expect(getReason(admit(makeBuiltinAttestation({ displayName: true })))).toBe(
            'SCHEMA_MISMATCH',
        );
    });

    it('rejects when avatar kind is unknown', () => {
        expect(
            getReason(
                admit(
                    makeBuiltinAttestation({
                        avatar: { kind: 'external', url: 'https://x.com/a.png' },
                    }),
                ),
            ),
        ).toBe('SCHEMA_MISMATCH');
    });

    it('rejects builtin avatar missing ref', () => {
        expect(getReason(admit(makeBuiltinAttestation({ avatar: { kind: 'builtin' } })))).toBe(
            'SCHEMA_MISMATCH',
        );
    });

    it('rejects custom avatar missing base64', () => {
        expect(
            getReason(
                admit(
                    makeBuiltinAttestation({ avatar: { kind: 'custom', mimeType: 'image/png' } }),
                ),
            ),
        ).toBe('SCHEMA_MISMATCH');
    });
});

// ─── DISPLAY_NAME_EMPTY ───────────────────────────────────────────────────────

describe('admit() — DISPLAY_NAME_EMPTY', () => {
    it('rejects an empty displayName', () => {
        expect(getReason(admit(makeBuiltinAttestation({ displayName: '' })))).toBe(
            'DISPLAY_NAME_EMPTY',
        );
    });

    it('rejects a displayName of only spaces', () => {
        expect(getReason(admit(makeBuiltinAttestation({ displayName: '   ' })))).toBe(
            'DISPLAY_NAME_EMPTY',
        );
    });

    it('rejects a displayName of only whitespace characters', () => {
        expect(getReason(admit(makeBuiltinAttestation({ displayName: '\t\n\r' })))).toBe(
            'DISPLAY_NAME_EMPTY',
        );
    });
});

// ─── DISPLAY_NAME_TOO_LONG ────────────────────────────────────────────────────

describe('admit() — DISPLAY_NAME_TOO_LONG', () => {
    it('rejects a displayName longer than MAX_DISPLAY_NAME_LENGTH', () => {
        const name = 'A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1);
        expect(getReason(admit(makeBuiltinAttestation({ displayName: name })))).toBe(
            'DISPLAY_NAME_TOO_LONG',
        );
    });

    it('rejects a displayName of 33 characters', () => {
        expect(getReason(admit(makeBuiltinAttestation({ displayName: 'A'.repeat(33) })))).toBe(
            'DISPLAY_NAME_TOO_LONG',
        );
    });

    it('rejects a very long displayName', () => {
        const name = 'x'.repeat(500);
        expect(getReason(admit(makeBuiltinAttestation({ displayName: name })))).toBe(
            'DISPLAY_NAME_TOO_LONG',
        );
    });
});

// ─── AVATAR_INVALID_MIME ──────────────────────────────────────────────────────

describe('admit() — AVATAR_INVALID_MIME', () => {
    it('rejects a custom avatar with mimeType image/gif', () => {
        const attestation = {
            localProfileId: 'player-abc',
            displayName: 'Test Player',
            avatar: { kind: 'custom', mimeType: 'image/gif', base64: pngMagicOnlyBase64 },
            locale: 'en-US',
        };
        expect(getReason(admit(attestation))).toBe('AVATAR_INVALID_MIME');
    });

    it('rejects a custom avatar with mimeType image/webp', () => {
        const attestation = {
            localProfileId: 'player-abc',
            displayName: 'Test Player',
            avatar: { kind: 'custom', mimeType: 'image/webp', base64: pngMagicOnlyBase64 },
            locale: 'en-US',
        };
        expect(getReason(admit(attestation))).toBe('AVATAR_INVALID_MIME');
    });

    it('rejects a custom avatar with an empty mimeType string', () => {
        const attestation = {
            localProfileId: 'player-abc',
            displayName: 'Test Player',
            avatar: { kind: 'custom', mimeType: '', base64: pngMagicOnlyBase64 },
            locale: 'en-US',
        };
        expect(getReason(admit(attestation))).toBe('AVATAR_INVALID_MIME');
    });
});

// ─── AVATAR_TOO_LARGE ─────────────────────────────────────────────────────────

describe('admit() — AVATAR_TOO_LARGE', () => {
    it('rejects a custom avatar whose decoded bytes exceed MAX_CUSTOM_AVATAR_BYTES', () => {
        const buf = makePngMagicPrefixBytes(MAX_CUSTOM_AVATAR_BYTES); // 8 magic + 65536 extra = 65544 bytes
        const base64 = buf.toString('base64');
        const result = admit(
            makeCustomPngAttestation({ avatar: { kind: 'custom', mimeType: 'image/png', base64 } }),
        );
        expect(getReason(result)).toBe('AVATAR_TOO_LARGE');
    });

    it('rejects a custom avatar that is exactly 1 byte over the limit', () => {
        const buf = makePngMagicPrefixBytes(MAX_CUSTOM_AVATAR_BYTES - 8 + 1); // total = 65537
        const base64 = buf.toString('base64');
        const result = admit(
            makeCustomPngAttestation({ avatar: { kind: 'custom', mimeType: 'image/png', base64 } }),
        );
        expect(getReason(result)).toBe('AVATAR_TOO_LARGE');
    });
});

// ─── AVATAR_DECODE_FAILED ─────────────────────────────────────────────────────

describe('admit() — AVATAR_DECODE_FAILED', () => {
    it('rejects when bytes do not start with PNG magic bytes (mimeType image/png)', () => {
        // Valid JPEG bytes but mimeType is PNG → magic-bytes mismatch
        const result = admit(
            makeCustomPngAttestation({
                avatar: { kind: 'custom', mimeType: 'image/png', base64: jpegMagicOnlyBase64 },
            }),
        );
        expect(getReason(result)).toBe('AVATAR_DECODE_FAILED');
    });

    it('rejects when bytes do not start with JPEG magic bytes (mimeType image/jpeg)', () => {
        // Valid PNG bytes but mimeType is JPEG → magic-bytes mismatch
        const result = admit(
            makeCustomJpegAttestation({
                avatar: { kind: 'custom', mimeType: 'image/jpeg', base64: pngMagicOnlyBase64 },
            }),
        );
        expect(getReason(result)).toBe('AVATAR_DECODE_FAILED');
    });

    it('rejects when bytes have no recognised image magic bytes', () => {
        // Plain text content
        const plainBase64 = Buffer.from('hello world').toString('base64');
        const result = admit(
            makeCustomPngAttestation({
                avatar: { kind: 'custom', mimeType: 'image/png', base64: plainBase64 },
            }),
        );
        expect(getReason(result)).toBe('AVATAR_DECODE_FAILED');
    });

    it('rejects when custom avatar base64 string contains invalid characters', () => {
        const result = admit(
            makeCustomPngAttestation({
                avatar: { kind: 'custom', mimeType: 'image/png', base64: 'not-valid-base64!!!' },
            }),
        );
        expect(getReason(result)).toBe('AVATAR_DECODE_FAILED');
    });

    it('rejects an empty base64 string (no bytes to check)', () => {
        const result = admit(
            makeCustomPngAttestation({
                avatar: { kind: 'custom', mimeType: 'image/png', base64: '' },
            }),
        );
        expect(getReason(result)).toBe('AVATAR_DECODE_FAILED');
    });
});

// ─── NAMESPACE_COLLISION ──────────────────────────────────────────────────────

describe('admit() — NAMESPACE_COLLISION', () => {
    it('rejects when localProfileId matches a reserved prefix', () => {
        const reservedId = RESERVED_ID_PREFIXES[0] + 'some-id';
        const result = admit(makeBuiltinAttestation({ localProfileId: reservedId }));
        expect(getReason(result)).toBe('NAMESPACE_COLLISION');
    });

    it('rejects when localProfileId duplicates an existing lobby entry', () => {
        const existingIds = new Set(['player-existing', 'player-abc']);
        const result = admit(makeBuiltinAttestation({ localProfileId: 'player-abc' }), existingIds);
        expect(getReason(result)).toBe('NAMESPACE_COLLISION');
    });

    it('admits when localProfileId is unique and not a reserved prefix', () => {
        const existingIds = new Set(['player-other']);
        const result = admit(makeBuiltinAttestation({ localProfileId: 'player-new' }), existingIds);
        expect(result.ok).toBe(true);
    });

    it('rejects all known reserved prefixes', () => {
        for (const prefix of RESERVED_ID_PREFIXES) {
            const result = admit(makeBuiltinAttestation({ localProfileId: prefix + 'xyz' }));
            expect(getReason(result)).toBe('NAMESPACE_COLLISION');
        }
    });

    it('admits with no existingIds argument (defaults to empty set)', () => {
        const result = admit(makeBuiltinAttestation());
        expect(result.ok).toBe(true);
    });
});

// ─── gameSchemaValidator (game-specific extension) ───────────────────────────

describe('admit() — gameSchemaValidator', () => {
    it('admits when gameSchemaValidator returns true', () => {
        const result = admit(makeBuiltinAttestation(), new Set(), () => true);
        expect(result.ok).toBe(true);
    });

    it('rejects with SCHEMA_MISMATCH when gameSchemaValidator returns false', () => {
        const result = admit(makeBuiltinAttestation(), new Set(), () => false);
        expect(getReason(result)).toBe('SCHEMA_MISMATCH');
    });

    it('passes the admitted profile to the gameSchemaValidator', () => {
        const seen: PlayerProfile[] = [];
        admit(makeBuiltinAttestation(), new Set(), (p) => {
            seen.push(p);
            return true;
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]!.localProfileId).toBe('player-abc');
    });

    it('does not call gameSchemaValidator when base schema validation fails', () => {
        let called = false;
        admit(null, new Set(), () => {
            called = true;
            return true;
        });
        expect(called).toBe(false);
    });

    it('does not call gameSchemaValidator when avatar check fails', () => {
        let called = false;
        const attestation = {
            localProfileId: 'player-abc',
            displayName: 'Test Player',
            avatar: { kind: 'custom', mimeType: 'image/gif', base64: pngMagicOnlyBase64 },
            locale: 'en-US',
        };
        admit(attestation, new Set(), () => {
            called = true;
            return true;
        });
        expect(called).toBe(false);
    });

    it('does not call gameSchemaValidator when displayName validation fails', () => {
        let called = false;
        admit(makeBuiltinAttestation({ displayName: '' }), new Set(), () => {
            called = true;
            return true;
        });
        expect(called).toBe(false);
    });

    it('admits without gameSchemaValidator when the argument is omitted', () => {
        const result = admit(makeBuiltinAttestation(), new Set());
        expect(result.ok).toBe(true);
    });
});
