// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { createInputActionRegistry } from './InputActionRegistry.js';
import {
    InputActionRegistryContext,
    useInputActionRegistry,
} from './InputActionRegistryContext.js';

afterEach(() => {
    cleanup();
});

describe('InputActionRegistryContext', () => {
    it('throws a descriptive error when used outside the provider', () => {
        expect(() => renderHook(() => useInputActionRegistry())).toThrow(
            'useInputActionRegistry() must be used within the app root (inside <Providers>).',
        );
    });

    it('returns the injected InputActionRegistry instance inside the provider', () => {
        const registry = createInputActionRegistry();
        const wrapper = ({
            children,
        }: {
            readonly children: React.ReactNode;
        }): React.ReactElement => (
            <InputActionRegistryContext.Provider value={registry}>
                {children}
            </InputActionRegistryContext.Provider>
        );

        const { result } = renderHook(() => useInputActionRegistry(), { wrapper });

        expect(result.current).toBe(registry);
    });
});
