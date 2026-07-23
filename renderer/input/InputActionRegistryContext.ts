'use client';

import { createContext, useContext } from 'react';

import type { InputActionRegistry } from './InputActionRegistry.js';

export const InputActionRegistryContext = createContext<InputActionRegistry | null>(null);

export function useInputActionRegistry(): InputActionRegistry {
    const inputActionRegistry = useContext(InputActionRegistryContext);
    if (inputActionRegistry === null) {
        throw new Error(
            'useInputActionRegistry() must be used within the app root (inside <Providers>).',
        );
    }

    return inputActionRegistry;
}
