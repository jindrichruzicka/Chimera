// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type { AssetManager } from './AssetManager';
import { createDelegatingAssetManager, NoActiveGameSessionError } from './DelegatingAssetManager';

function makeStubAssetManager(): AssetManager {
    return {
        registerManifest: vi.fn(),
        preloadCritical: vi.fn(async () => undefined),
        get: vi.fn(() => null),
        getManifestMetadata: vi.fn(() => undefined),
        load: vi.fn(async () => {
            throw new Error('unreachable stub load');
        }),
        dispose: vi.fn(),
    };
}

describe('DelegatingAssetManager', () => {
    it('rejects load() with NoActiveGameSessionError naming the ref and the unbound delegate when none is set', async () => {
        // The message used to name GameShell as THE registrant. It no longer can:
        // `ShellAudioSession` registers one outside a match, so a reader pointed at
        // GameShell would be sent to the wrong lifetime half the time. What the two
        // assertions below still catch is the ref (a message that named no clip is
        // unactionable) and the diagnosis (an unbound delegate, not a missing file).
        const mgr = createDelegatingAssetManager();
        const rejection = mgr.load('tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0]);
        await expect(rejection).rejects.toBeInstanceOf(NoActiveGameSessionError);
        await expect(rejection).rejects.toThrow(/tactics\/audio\/sfx\/hit\.ogg/);
        await expect(rejection).rejects.toThrow(/No AssetManager delegate is registered/);
        // error.name is consumer-visible: the logging pipeline serializes it.
        await expect(rejection).rejects.toHaveProperty('name', 'NoActiveGameSessionError');
    });

    it('forwards load() to the current delegate', async () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        const fakeAsset = {};
        vi.mocked(delegate.load).mockResolvedValueOnce(fakeAsset);

        mgr.setDelegate(delegate);
        const ref = 'tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0];
        const result = await mgr.load(ref);

        expect(delegate.load).toHaveBeenCalledWith(ref);
        expect(result).toBe(fakeAsset);
    });

    it('forwards registerManifest() to the current delegate', () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        mgr.setDelegate(delegate);

        const manifest = { entries: [] };
        mgr.registerManifest(manifest as never);

        expect(delegate.registerManifest).toHaveBeenCalledWith(manifest);
    });

    it('silently skips registerManifest() when no delegate is set', () => {
        const mgr = createDelegatingAssetManager();
        expect(() => mgr.registerManifest({ entries: [] } as never)).not.toThrow();
    });

    it('forwards preloadCritical() to the current delegate', async () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        vi.mocked(delegate.preloadCritical).mockResolvedValueOnce(undefined);
        mgr.setDelegate(delegate);

        const manifest = { entries: [] };
        const progress = vi.fn();
        // The failure channel is forwarded too, and asserted alongside the
        // progress one: it is the only channel that reports a broken ref before
        // the run settles, so a delegate that never received it would leave the
        // caller waiting on the slowest entry for every report.
        const entryFailure = vi.fn();
        await mgr.preloadCritical(manifest as never, progress, entryFailure);

        expect(delegate.preloadCritical).toHaveBeenCalledWith(manifest, progress, entryFailure);
    });

    it('returns null for get() when no delegate is set', () => {
        const mgr = createDelegatingAssetManager();
        expect(
            mgr.get('tactics/textures/soldier.webp' as Parameters<typeof mgr.get>[0]),
        ).toBeNull();
    });

    it('forwards get() to the current delegate', () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        const fakeAsset = {};
        vi.mocked(delegate.get).mockReturnValueOnce(fakeAsset);
        mgr.setDelegate(delegate);

        const ref = 'tactics/textures/soldier.webp' as Parameters<typeof mgr.get>[0];
        const result = mgr.get(ref);

        expect(delegate.get).toHaveBeenCalledWith(ref);
        expect(result).toBe(fakeAsset);
    });

    it('forwards getManifestMetadata() to the current delegate', () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        const metadata = { cues: { chorus: 5 } };
        vi.mocked(delegate.getManifestMetadata).mockReturnValueOnce(metadata);
        mgr.setDelegate(delegate);

        const ref = 'tactics/audio/theme.ogg' as Parameters<typeof mgr.getManifestMetadata>[0];
        const result = mgr.getManifestMetadata(ref);

        expect(delegate.getManifestMetadata).toHaveBeenCalledWith(ref);
        expect(result).toBe(metadata);
    });

    it('returns undefined for getManifestMetadata() when no delegate is set', () => {
        const mgr = createDelegatingAssetManager();
        expect(
            mgr.getManifestMetadata(
                'tactics/audio/theme.ogg' as Parameters<typeof mgr.getManifestMetadata>[0],
            ),
        ).toBeUndefined();
    });

    it('clears the delegate on setDelegate(null) and rejects load() again', async () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        mgr.setDelegate(delegate);
        mgr.setDelegate(null);

        await expect(
            mgr.load('tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0]),
        ).rejects.toBeInstanceOf(NoActiveGameSessionError);
    });

    it('dispose() clears the delegate', async () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        mgr.setDelegate(delegate);
        mgr.dispose();

        await expect(
            mgr.load('tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0]),
        ).rejects.toBeInstanceOf(NoActiveGameSessionError);
    });

    it('does NOT dispose the underlying delegate when dispose() is called', () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        mgr.setDelegate(delegate);
        mgr.dispose();

        expect(delegate.dispose).not.toHaveBeenCalled();
    });
});

describe('DelegatingAssetManager.releaseDelegate', () => {
    it('clears the delegate when the caller still owns it', async () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        mgr.setDelegate(delegate);

        mgr.releaseDelegate(delegate);

        await expect(
            mgr.load('tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0]),
        ).rejects.toBeInstanceOf(NoActiveGameSessionError);
    });

    it('leaves a delegate registered by someone else alone', async () => {
        const mgr = createDelegatingAssetManager();
        const shell = makeStubAssetManager();
        const match = makeStubAssetManager();
        const fakeAsset = {};
        vi.mocked(match.load).mockResolvedValueOnce(fakeAsset);

        mgr.setDelegate(shell);
        // The match took the binding over before the shell's teardown ran — the
        // late release must not clear a delegate that is no longer the shell's.
        mgr.setDelegate(match);
        mgr.releaseDelegate(shell);

        await expect(
            mgr.load('tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0]),
        ).resolves.toBe(fakeAsset);
        expect(match.load).toHaveBeenCalledTimes(1);
    });

    it('never disposes the delegate it releases', () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();
        mgr.setDelegate(delegate);

        mgr.releaseDelegate(delegate);

        expect(delegate.dispose).not.toHaveBeenCalled();
    });

    it('is a no-op when nothing is bound', async () => {
        const mgr = createDelegatingAssetManager();
        const delegate = makeStubAssetManager();

        expect(() => {
            mgr.releaseDelegate(delegate);
        }).not.toThrow();

        await expect(
            mgr.load('tactics/audio/sfx/hit.ogg' as Parameters<typeof mgr.load>[0]),
        ).rejects.toBeInstanceOf(NoActiveGameSessionError);
    });
});
