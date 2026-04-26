// electron/preload/extensions-api.test.ts
//
// Unit tests for the extension registration infrastructure.
// Exercises registerExtension() and buildExtensionsApi() in isolation —
// no Electron module is needed here because extensions-api.ts has no IPC
// or contextBridge dependency.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOTE: The module is reset before every test so that the module-level
// registry starts clean for each case (vi.resetModules + re-import).
// We import via a helper to ensure the reset takes effect.

let buildExtensionsApi: () => Record<string, unknown>;
let registerExtension: (name: string, factory: () => unknown) => void;

async function reimportModule(): Promise<void> {
    const { buildExtensionsApi: b, registerExtension: r } =
        (await import('./extensions-api.js')) as {
            buildExtensionsApi: () => Record<string, unknown>;
            registerExtension: (name: string, factory: () => unknown) => void;
        };
    buildExtensionsApi = b;
    registerExtension = r;
}

beforeEach(async () => {
    vi.resetModules();
    await reimportModule();
});

afterEach(() => {
    vi.resetModules();
});

describe('extensions-api', () => {
    describe('registerExtension()', () => {
        it('accepts a named extension without throwing', () => {
            expect(() =>
                registerExtension('myGame', () => ({ doThing: () => 'hello' })),
            ).not.toThrow();
        });

        it('calls the factory exactly once during registration', () => {
            let callCount = 0;
            registerExtension('counter', () => {
                callCount += 1;
                return {};
            });
            expect(callCount).toBe(1);
        });

        it('throws when the same name is registered twice', () => {
            registerExtension('duplicate', () => ({}));
            expect(() => registerExtension('duplicate', () => ({}))).toThrow(/already registered/i);
        });

        it('allows distinct names to coexist', () => {
            expect(() => {
                registerExtension('alpha', () => ({ a: 1 }));
                registerExtension('beta', () => ({ b: 2 }));
            }).not.toThrow();
        });
    });

    describe('buildExtensionsApi()', () => {
        it('returns an empty object when no extensions are registered', () => {
            const result = buildExtensionsApi();
            expect(result).toEqual({});
        });

        it('returns an object containing all registered extensions by name', () => {
            const alphaApi = { doAlpha: () => 'alpha' };
            const betaApi = { doBeta: () => 'beta' };
            registerExtension('alpha', () => alphaApi);
            registerExtension('beta', () => betaApi);

            const result = buildExtensionsApi();
            expect(result['alpha']).toBe(alphaApi);
            expect(result['beta']).toBe(betaApi);
        });

        it('returns a frozen object so the surface cannot be mutated at runtime', () => {
            registerExtension('immutable', () => ({ x: 1 }));
            const result = buildExtensionsApi();
            expect(Object.isFrozen(result)).toBe(true);
        });

        it('can be called multiple times and always returns the same registered set', () => {
            registerExtension('stable', () => ({ v: 42 }));
            const first = buildExtensionsApi();
            const second = buildExtensionsApi();
            expect(first['stable']).toBe(second['stable']);
        });
    });
});
