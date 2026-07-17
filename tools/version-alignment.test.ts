// tools/version-alignment.test.ts
//
// Unit tests for the `verify:version-alignment` locked-`1.X.Y` release gate.
//
// Exercises the pure surface only — the `1.X.Y` shape predicate and the alignment
// check (all first-party packages on the identical, valid `1.X.Y`) — plus the
// self-test's synthetic-drift detection. All inputs are in-memory, so no real
// package.json, disk, or process is touched.
//
// The lock-step rule encodes docs/versioning-policy.md: every `@chimera-engine/*`
// package AND `create-chimera-game` share one `1.X.Y` version so a matching `1.X.*`
// is the mutual-compatibility promise.

import { describe, it, expect } from 'vitest';
import {
    isLockstepVersion,
    checkAlignment,
    verifyVersionAlignmentSelfTest,
    LOCKSTEP_PACKAGE_DIRS,
    type VersionedPackage,
} from './version-alignment.js';

// ── Fixtures ────────────────────────────────────────────────────────────────────

/** A fully-aligned first-party set at 1.0.0 (the M10 target state). */
const ALIGNED_1_0_0: VersionedPackage[] = [
    { name: '@chimera-engine/simulation', version: '1.0.0' },
    { name: '@chimera-engine/ai', version: '1.0.0' },
    { name: '@chimera-engine/networking', version: '1.0.0' },
    { name: '@chimera-engine/renderer', version: '1.0.0' },
    { name: '@chimera-engine/electron', version: '1.0.0' },
    { name: 'create-chimera-game', version: '1.0.0' },
];

// ── isLockstepVersion ─────────────────────────────────────────────────────────────

describe('isLockstepVersion', () => {
    it('accepts plain MAJOR.MINOR.PATCH with MAJOR >= 1', () => {
        expect(isLockstepVersion('1.0.0')).toBe(true);
        expect(isLockstepVersion('1.4.12')).toBe(true);
        expect(isLockstepVersion('2.0.0')).toBe(true);
        expect(isLockstepVersion(' 1.0.1 ')).toBe(true); // trimmed
    });

    it('accepts release candidates (1.X.Y-rc.N) so a milestone can be previewed on npm', () => {
        expect(isLockstepVersion('1.0.0-rc.0')).toBe(true);
        expect(isLockstepVersion('1.0.0-rc.3')).toBe(true);
        expect(isLockstepVersion('1.2.0-rc.0')).toBe(true);
        expect(isLockstepVersion(' 1.0.0-rc.1 ')).toBe(true); // trimmed
    });

    it('rejects 0.x versions (the retired independent scheme)', () => {
        expect(isLockstepVersion('0.9.0')).toBe(false);
        expect(isLockstepVersion('0.0.1')).toBe(false);
        expect(isLockstepVersion('0.9.0-rc.0')).toBe(false); // rc does not license a 0.x major
    });

    it('rejects non-rc pre-release, build, partial, and malformed rc shapes', () => {
        expect(isLockstepVersion('1.0.0-beta.1')).toBe(false); // only -rc.N is licensed
        expect(isLockstepVersion('1.0.0-alpha')).toBe(false);
        expect(isLockstepVersion('1.0.0-rc')).toBe(false); // rc needs a numeric counter
        expect(isLockstepVersion('1.0.0-rc.')).toBe(false);
        expect(isLockstepVersion('1.0.0-rc.0+build.5')).toBe(false); // no trailing build metadata
        expect(isLockstepVersion('1.0.0+build.5')).toBe(false);
        expect(isLockstepVersion('1.0')).toBe(false);
        expect(isLockstepVersion('1')).toBe(false);
        expect(isLockstepVersion('v1.0.0')).toBe(false);
        expect(isLockstepVersion('(missing)')).toBe(false);
        expect(isLockstepVersion('')).toBe(false);
    });
});

// ── checkAlignment ────────────────────────────────────────────────────────────────

describe('checkAlignment', () => {
    it('passes when every first-party package shares one valid 1.X.Y and returns that version', () => {
        const result = checkAlignment(ALIGNED_1_0_0);
        expect(result.ok).toBe(true);
        expect(result.version).toBe('1.0.0');
        expect(result.reasons).toEqual([]);
    });

    it('passes on a later aligned patch line', () => {
        const at103 = ALIGNED_1_0_0.map((p) => ({ ...p, version: '1.0.3' }));
        const result = checkAlignment(at103);
        expect(result.ok).toBe(true);
        expect(result.version).toBe('1.0.3');
    });

    it('passes when the whole set is aligned on one release candidate', () => {
        const atRc = ALIGNED_1_0_0.map((p) => ({ ...p, version: '1.0.0-rc.0' }));
        const result = checkAlignment(atRc);
        expect(result.ok).toBe(true);
        expect(result.version).toBe('1.0.0-rc.0');
        expect(result.reasons).toEqual([]);
    });

    it('fails when one package is stable but the rest are on the release candidate', () => {
        const mixed = ALIGNED_1_0_0.map((p) =>
            p.name === '@chimera-engine/ai'
                ? { ...p, version: '1.0.0' }
                : { ...p, version: '1.0.0-rc.0' },
        );
        const result = checkAlignment(mixed);
        expect(result.ok).toBe(false);
        expect(result.reasons.join('\n')).toContain('not aligned');
    });

    it('fails when one package has drifted, naming the offending version group', () => {
        const drifted = ALIGNED_1_0_0.map((p) =>
            p.name === '@chimera-engine/ai'
                ? { ...p, version: '1.0.0' }
                : { ...p, version: '1.0.1' },
        );
        const result = checkAlignment(drifted);
        expect(result.ok).toBe(false);
        expect(result.version).toBeUndefined();
        expect(result.reasons.join('\n')).toContain('not aligned');
        expect(result.reasons.join('\n')).toContain('@chimera-engine/ai');
    });

    it('fails when the aligned version is a legacy 0.x (not 1.X.Y)', () => {
        const at090 = ALIGNED_1_0_0.map((p) => ({ ...p, version: '0.9.0' }));
        const result = checkAlignment(at090);
        expect(result.ok).toBe(false);
        // every package flagged as non-1.X.Y
        expect(result.reasons.filter((r) => r.includes('not a valid locked 1.X.Y'))).toHaveLength(
            at090.length,
        );
    });

    it('fails (rather than throws) on an empty set', () => {
        const result = checkAlignment([]);
        expect(result.ok).toBe(false);
        expect(result.reasons[0]).toContain('no first-party packages');
    });

    it('reports both misalignment AND the invalid-version reason when a drifted package is also non-1.X.Y', () => {
        const messy: VersionedPackage[] = [
            { name: '@chimera-engine/simulation', version: '1.0.1' },
            { name: '@chimera-engine/ai', version: '0.9.0' },
        ];
        const result = checkAlignment(messy);
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes('not aligned'))).toBe(true);
        expect(result.reasons.some((r) => r.includes('not a valid locked 1.X.Y'))).toBe(true);
    });
});

// ── LOCKSTEP_PACKAGE_DIRS ─────────────────────────────────────────────────────────

describe('LOCKSTEP_PACKAGE_DIRS', () => {
    it('covers the five engine packages plus the initializer, and excludes the private app/template', () => {
        expect([...LOCKSTEP_PACKAGE_DIRS]).toEqual([
            'simulation',
            'ai',
            'networking',
            'renderer',
            'electron',
            'tools/create-chimera-game',
        ]);
        expect(LOCKSTEP_PACKAGE_DIRS).not.toContain('apps/tactics');
        expect(LOCKSTEP_PACKAGE_DIRS).not.toContain('tools/create-chimera-game/templates/blank');
    });
});

// ── verifyVersionAlignmentSelfTest ────────────────────────────────────────────────

describe('verifyVersionAlignmentSelfTest', () => {
    it('detects the synthetic drift and reports ok: true (the negative gate passes)', async () => {
        const logs: string[] = [];
        const result = await verifyVersionAlignmentSelfTest({ log: (m) => logs.push(m) });
        expect(result.ok).toBe(true); // ok === "the gate correctly detected drift"
        expect(logs.join('\n')).toContain('PASS');
    });
});
